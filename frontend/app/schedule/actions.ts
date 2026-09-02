"use server";

import { revalidatePath } from "next/cache";
import {
  isoToYmd,
  recurringSlots,
  tstzrange,
  wallClockToUtc,
  type Slot,
} from "@/lib/clinic-time";
import { loadClinicContext } from "@/lib/clinic-context";
import { t } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";

const EXCLUSION_VIOLATION = "23P01";

async function requireSession() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("not authenticated");
  return { supabase, user };
}

// Every instant this module computes has to be resolved in the clinic's own
// zone. A Riyadh clinic booking "10:00" means 10:00 Riyadh; resolving it
// against a hardcoded Cairo would file the session an hour out.
async function clinicZone() {
  const result = await loadClinicContext();
  return result.ok ? result.ctx.timezone : undefined;
}

function parseTime(hhmm: string) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

// Every booking path funnels through here so a bad date, a bad time or a
// zero-length session is refused in one place rather than four.
function buildSlots(input: {
  dateISO: string;
  time: string;
  durationMinutes: number;
  weekdays?: number[];
  count?: number;
  timeZone?: string;
}): Slot[] {
  const from = isoToYmd(input.dateISO);
  const at = parseTime(input.time);
  if (!from || !at) throw new Error(t("badDateOrTime"));
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes < 5) {
    throw new Error(t("durationAboveZero"));
  }

  const count = input.count ?? 1;
  if (count < 1 || count > 60) throw new Error(t("tooManySessions"));

  if (count === 1) {
    const startsAt = wallClockToUtc(
      from.year,
      from.month,
      from.day,
      at.hour,
      at.minute,
      input.timeZone
    );
    return [
      {
        startsAt,
        endsAt: new Date(startsAt.getTime() + input.durationMinutes * 60_000),
      },
    ];
  }

  const slots = recurringSlots({
    from,
    hour: at.hour,
    minute: at.minute,
    durationMinutes: input.durationMinutes,
    weekdays: input.weekdays ?? [],
    count,
    timeZone: input.timeZone,
  });
  if (slots.length < count) throw new Error(t("pickWeekdays"));
  return slots;
}

export type SlotPreview = {
  startsAt: string;
  endsAt: string;
  clashesWith: string | null;
};

// A read-only dry run, so reception sees which sessions of a plan of care
// collide *before* committing any of them. It is not a guarantee: another
// receptionist can book the same slot in between, which is why the write
// path still reports per-slot outcomes and the database still has the final
// say via its exclusion constraint.
export async function previewSlots(input: {
  therapistId: string;
  dateISO: string;
  time: string;
  durationMinutes: number;
  weekdays?: number[];
  count?: number;
}): Promise<SlotPreview[]> {
  const { supabase } = await requireSession();
  const slots = buildSlots({ ...input, timeZone: await clinicZone() });

  const spanStart = slots[0].startsAt;
  const spanEnd = slots[slots.length - 1].endsAt;

  // One query for the whole span, then compared in memory — a round trip per
  // session would make a 12-session plan twelve queries for no benefit.
  const { data: existing, error } = await supabase
    .from("appointments")
    .select("during, status, patients(name)")
    .eq("therapist_id", input.therapistId)
    .neq("status", "cancelled")
    .overlaps("during", tstzrange(spanStart, spanEnd));
  if (error) throw new Error(error.message);

  const busy = (existing ?? []).map((row) => {
    const during = row.during as string;
    const inner = during.slice(1, -1).split(",");
    const patient = (row as unknown as { patients: { name: string } | null })
      .patients;
    return {
      from: new Date(inner[0].replace(/"/g, "")).getTime(),
      to: new Date(inner[1].replace(/"/g, "")).getTime(),
      who: patient?.name ?? null,
    };
  });

  return slots.map((s) => {
    const from = s.startsAt.getTime();
    const to = s.endsAt.getTime();
    // Half-open on both sides, matching the tstzrange semantics: a session
    // ending exactly when another starts is not a clash.
    const hit = busy.find((b) => from < b.to && to > b.from);
    return {
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      clashesWith: hit ? hit.who : null,
    };
  });
}

export type BookOutcome = {
  startsAt: string;
  ok: boolean;
  reason: string | null;
};

export async function bookSessions(input: {
  clinicId: string;
  patientId: string;
  therapistId: string;
  dateISO: string;
  time: string;
  durationMinutes: number;
  packageId?: string | null;
  price?: number;
  weekdays?: number[];
  count?: number;
}): Promise<BookOutcome[]> {
  const { supabase } = await requireSession();
  const slots = buildSlots({ ...input, timeZone: await clinicZone() });

  // Booking more sessions than a package has credit for used to succeed here
  // and fail later at the front desk, when attendance number 11 hit the
  // packages check constraint and surfaced a raw Postgres string. Refuse it
  // now, while there is still a person looking at the form.
  //
  // Sessions already booked against the package count too: three bookings of
  // four on a ten-session package is eleven.
  if (input.packageId) {
    const [{ data: pkg }, { count: alreadyBooked }] = await Promise.all([
      supabase
        .from("packages")
        .select("sessions_total, sessions_used")
        .eq("id", input.packageId)
        .maybeSingle(),
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("package_id", input.packageId)
        .in("status", ["booked", "attended"]),
    ]);

    if (pkg) {
      const used = Math.max(
        Number(pkg.sessions_used) || 0,
        Number(alreadyBooked) || 0
      );
      const left = Math.max(0, Number(pkg.sessions_total) - used);
      if (slots.length > left) {
        throw new Error(
          left === 0
            ? t("packageExhausted")
            : t("packageOutOfCredit", { left, asked: slots.length })
        );
      }
    }
  }

  // A session covered by a package costs nothing at the door — the package
  // was already paid for, and charging again would double-bill. The price is
  // written by this server action, never trusted as a total from the client.
  const price = input.packageId ? 0 : Math.max(0, Number(input.price) || 0);

  const outcomes: BookOutcome[] = [];

  // One insert per slot on purpose. A single batch insert would lose the whole
  // plan of care to one clash, and reception would have to work out which
  // session was the problem. This way twelve sessions with two clashes books
  // ten and names the two.
  for (const slot of slots) {
    const { error } = await supabase.from("appointments").insert({
      clinic_id: input.clinicId,
      patient_id: input.patientId,
      therapist_id: input.therapistId,
      during: tstzrange(slot.startsAt, slot.endsAt),
      package_id: input.packageId ?? null,
      price,
    });

    outcomes.push({
      startsAt: slot.startsAt.toISOString(),
      ok: !error,
      reason: error
        ? error.code === EXCLUSION_VIOLATION
          ? t("therapistBusy")
          : error.message
        : null,
    });
  }

  revalidatePath("/schedule");
  revalidatePath("/reception");
  return outcomes;
}

// Cancelling is a status change, never a delete: the row is what proves a
// slot was held, and if the session had already been marked attended the
// consume_package trigger hands the package credit back on the way out.
export async function cancelAppointment(appointmentId: string) {
  const { supabase } = await requireSession();
  const { error } = await supabase
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("id", appointmentId);
  if (error) throw new Error(error.message);
  revalidatePath("/schedule");
  revalidatePath("/reception");
}

export async function moveAppointment(input: {
  appointmentId: string;
  dateISO: string;
  time: string;
  durationMinutes: number;
}) {
  const { supabase } = await requireSession();
  const [slot] = buildSlots({ ...input, timeZone: await clinicZone() });

  const { error } = await supabase
    .from("appointments")
    .update({ during: tstzrange(slot.startsAt, slot.endsAt) })
    .eq("id", input.appointmentId);

  if (error) {
    // The exclusion constraint covers UPDATE as well as INSERT, so a move
    // onto a taken slot is refused by the database rather than by a check
    // here that two receptionists could both pass at once.
    if (error.code === EXCLUSION_VIOLATION) throw new Error(t("therapistBusy"));
    throw new Error(error.message);
  }
  revalidatePath("/schedule");
  revalidatePath("/reception");
}

export async function searchPatientsForBooking(clinicId: string, query: string) {
  const { supabase } = await requireSession();
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const escaped = trimmed.replace(/[%_\\]/g, (c) => `\\${c}`);
  const isPhone = /^[0-9]+$/.test(trimmed);
  const base = supabase
    .from("patients")
    .select("id, name, phone")
    .eq("clinic_id", clinicId)
    .limit(10);
  const { data, error } = isPhone
    ? await base.ilike("phone", `%${escaped}%`)
    : await base.ilike("name", `%${escaped}%`);
  if (error) throw new Error(error.message);
  return data;
}

export async function packagesWithCreditFor(patientId: string) {
  const { supabase } = await requireSession();
  const { data, error } = await supabase
    .from("packages")
    .select("id, sessions_total, sessions_used")
    .eq("patient_id", patientId);
  if (error) throw new Error(error.message);
  return (data ?? []).filter((p) => p.sessions_used < p.sessions_total);
}
