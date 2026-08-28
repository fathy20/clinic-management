import {
  addDays,
  dayRange,
  isoToYmd,
  partsInClinicTz,
  rangeMinutes,
  rangeStart,
  weekStart,
  ymdToISO,
} from "@/lib/clinic-time";
import { loadClinicContext } from "@/lib/clinic-context";
import { canSeeMoney } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { ContextGate } from "@/components/ui/ContextGate";
import { NavBar } from "@/components/ui/NavBar";
import { WeekGrid } from "./WeekGrid";
import type { ScheduledSession } from "./types";

export const dynamic = "force-dynamic";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; therapist?: string }>;
}) {
  const { week, therapist: therapistFilter } = await searchParams;

  const result = await loadClinicContext();
  if (!result.ok) return <ContextGate result={result} />;
  const {
    clinicId,
    clinicName,
    currency,
    timezone,
    role,
    userName,
    therapists,
    nameById,
  } = result.ctx;

  // An unparseable ?week= falls back to the current week rather than erroring:
  // the URL is user-editable and a typo should not be a dead end.
  const anchor = (week && isoToYmd(week)) || weekStart(new Date(), timezone);
  const start = weekStart(
    new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day, 12)),
    timezone
  );
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  const rangeFrom = dayRange(start.year, start.month, start.day, timezone).start;
  const lastDay = days[6];
  const rangeTo = dayRange(lastDay.year, lastDay.month, lastDay.day, timezone).end;

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("appointments")
    .select(
      "id, patient_id, therapist_id, during, status, package_id, price, patients(name, phone)"
    )
    .eq("clinic_id", clinicId)
    .overlaps("during", `[${rangeFrom.toISOString()},${rangeTo.toISOString()})`)
    .order("during", { ascending: true });

  if (error) {
    return (
      <main className="shell">
        <p className="formerror" style={{ marginTop: 48 }}>
          {error.message}
        </p>
      </main>
    );
  }

  const visible = therapistFilter
    ? (rows ?? []).filter((r) => r.therapist_id === therapistFilter)
    : rows ?? [];

  const sessions: ScheduledSession[] = visible.map((r) => {
    const patient = (
      r as unknown as { patients: { name: string; phone: string } | null }
    ).patients;
    const startsAt = rangeStart(r.during as string);
    const p = partsInClinicTz(new Date(startsAt), timezone);
    return {
      id: r.id,
      patientId: r.patient_id,
      patientName: patient?.name ?? "—",
      therapistId: r.therapist_id,
      therapistName: nameById.get(r.therapist_id) ?? "—",
      startsAt,
      durationMinutes: rangeMinutes(r.during as string) ?? 45,
      dayISO: ymdToISO({ year: p.year, month: p.month, day: p.day }),
      status: r.status,
      hasPackage: Boolean(r.package_id),
      price: Number(r.price),
    };
  });

  return (
    <>
      <NavBar
        clinicName={clinicName}
        userName={userName}
        role={role}
        active="schedule"
        showMoney={canSeeMoney(role)}
      />
      <main className="shell">
        <WeekGrid
          clinicId={clinicId}
          currency={currency}
          canSeeMoney={canSeeMoney(role)}
          therapists={therapists}
          therapistFilter={therapistFilter ?? null}
          days={days.map(ymdToISO)}
          weekStartISO={ymdToISO(start)}
          prevWeekISO={ymdToISO(addDays(start, -7))}
          nextWeekISO={ymdToISO(addDays(start, 7))}
          sessions={sessions}
        />
      </main>
    </>
  );
}
