"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/strings";

async function requireSession() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("not authenticated");
  return { supabase, user };
}

// Never touches payments/packages — the debt indicator (patient_balances)
// is what surfaces an attended-but-unpaid session. Attendance must always
// succeed regardless of payment state.
export async function markAttended(appointmentId: string) {
  const { supabase } = await requireSession();
  const { error } = await supabase
    .from("appointments")
    .update({ status: "attended" })
    .eq("id", appointmentId);
  if (error) {
    // 23514 is the packages check constraint: consume_package tried to push
    // sessions_used past sessions_total. The raw message names the constraint
    // and means nothing to a receptionist with a queue in front of her.
    if (error.code === "23514" || /sessions_used/.test(error.message)) {
      throw new Error(t("packageExhausted"));
    }
    throw new Error(error.message);
  }
  revalidatePath("/reception");
}

export async function markNoShow(appointmentId: string) {
  const { supabase } = await requireSession();
  const { error } = await supabase
    .from("appointments")
    .update({ status: "no_show" })
    .eq("id", appointmentId);
  if (error) throw new Error(error.message);
  revalidatePath("/reception");
}

export async function addWalkIn(input: {
  clinicId: string;
  therapistId: string;
  patientId?: string;
  newPatient?: { name: string; phone: string };
  packageId?: string | null;
  durationMinutes: number;
  price?: number;
}) {
  const { supabase } = await requireSession();

  let patientId = input.patientId;
  if (!patientId) {
    if (!input.newPatient) throw new Error("patient or newPatient required");
    const { data, error } = await supabase
      .from("patients")
      .insert({
        clinic_id: input.clinicId,
        name: input.newPatient.name,
        phone: input.newPatient.phone,
        consent_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    patientId = data.id;
  }

  const start = new Date();
  const end = new Date(start.getTime() + input.durationMinutes * 60_000);
  const during = `[${start.toISOString()},${end.toISOString()})`;

  // Without a price a walk-in is invisible to leaking_sessions, which filters
  // on price > 0 — and the cash walk-in is the commonest transaction in an
  // Egyptian clinic. A packaged session is zero because the package already
  // paid for it; anything else carries what reception agreed at the desk.
  // Computed here, in the server action, never trusted as a total.
  const price = input.packageId ? 0 : Math.max(0, Number(input.price) || 0);

  const { error } = await supabase.from("appointments").insert({
    clinic_id: input.clinicId,
    patient_id: patientId,
    therapist_id: input.therapistId,
    during,
    package_id: input.packageId ?? null,
    price,
  });
  if (error) {
    // exclusion_violation: the DB, not the UI, is what refused the overlap
    if (error.code === "23P01") {
      throw new Error(t("therapistBusy"));
    }
    throw new Error(error.message);
  }
  revalidatePath("/reception");
}

// ilike wildcards in the user's own input would otherwise turn "50%" or
// "a_b" into unintended pattern matches instead of literal search terms.
function escapeLike(value: string) {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}

export async function searchPatients(clinicId: string, query: string) {
  const { supabase } = await requireSession();
  const trimmed = query.trim();
  if (!trimmed) return [];
  const isPhone = /^[0-9]+$/.test(trimmed);
  const pattern = `%${escapeLike(trimmed)}%`;
  const base = supabase
    .from("patients")
    .select("id, name, phone")
    .eq("clinic_id", clinicId)
    .limit(10);
  const { data, error } = isPhone
    ? await base.ilike("phone", pattern)
    : await base.ilike("name", pattern);
  if (error) throw new Error(error.message);
  return data;
}

export async function getPatientPackages(patientId: string) {
  const { supabase } = await requireSession();
  const { data, error } = await supabase
    .from("packages")
    .select("id, sessions_total, sessions_used, price, expires_at")
    .eq("patient_id", patientId);
  if (error) throw new Error(error.message);
  return data.filter((p) => p.sessions_used < p.sessions_total);
}

export async function getPatientPayments(patientId: string) {
  const { supabase } = await requireSession();
  const { data, error } = await supabase
    .from("payments")
    .select("id, amount, method, paid_at, package_id")
    .eq("patient_id", patientId)
    .order("paid_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return data;
}

export async function takePayment(input: {
  clinicId: string;
  patientId: string;
  packageId?: string | null;
  appointmentId?: string | null;
  rows: { method: string; amount: number }[];
}) {
  const { supabase, user } = await requireSession();
  if (input.rows.length === 0) {
    throw new Error("at least one payment row required");
  }

  const groupId = crypto.randomUUID();
  const { error } = await supabase.from("payments").insert(
    input.rows.map((r) => ({
      clinic_id: input.clinicId,
      patient_id: input.patientId,
      package_id: input.packageId ?? null,
      // only linked to a specific appointment when it's a plain (non-package)
      // session payment — that link is what leaking_sessions matches against.
      appointment_id: input.packageId ? null : input.appointmentId ?? null,
      amount: r.amount,
      method: r.method,
      taken_by: user.id,
      group_id: groupId,
    }))
  );
  if (error) throw new Error(error.message);
  revalidatePath("/reception");
}

export async function issueRefund(input: {
  paymentId: string;
  amount: number;
  reason: string;
}) {
  const { supabase, user } = await requireSession();
  // clinic_id is deliberately omitted: the refund_guard trigger derives it
  // from the referenced payment and overwrites whatever is sent here, so
  // that a refund can never claim a clinic other than the payment's own.
  const { error } = await supabase.from("refunds").insert({
    payment_id: input.paymentId,
    amount: input.amount,
    reason: input.reason,
    taken_by: user.id,
  });
  if (error) {
    if (error.message.includes("refund exceeds payment")) {
      throw new Error(t("maxRefundableBefore") + t("maxRefundableAfter"));
    }
    throw new Error(error.message);
  }
  revalidatePath("/reception");
}

export type PatientHit = {
  id: string;
  name: string;
  phone: string;
  amountOwed: number;
};

// Clinic-wide patient lookup. The balance comes from patient_balances, which
// is security_invoker — a therapist gets the patients and zero balances
// rather than an error, and the caller decides whether to render money at all.
export async function findPatients(
  clinicId: string,
  query: string
): Promise<PatientHit[]> {
  const { supabase } = await requireSession();
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const pattern = `%${escapeLike(trimmed)}%`;
  const isPhone = /^[0-9+\s-]+$/.test(trimmed);

  const base = supabase
    .from("patients")
    .select("id, name, phone")
    .eq("clinic_id", clinicId)
    .order("name")
    .limit(20);

  const { data, error } = isPhone
    ? await base.ilike("phone", pattern)
    : await base.ilike("name", pattern);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: balances } = await supabase
    .from("patient_balances")
    .select("patient_id, amount_owed")
    .eq("clinic_id", clinicId)
    .in(
      "patient_id",
      rows.map((r) => r.id)
    );

  const owed = new Map(
    (balances ?? []).map((b) => [b.patient_id, Number(b.amount_owed)])
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    amountOwed: owed.get(r.id) ?? 0,
  }));
}
