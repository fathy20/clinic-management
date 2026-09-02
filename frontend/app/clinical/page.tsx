import { ContextGate } from "@/components/ui/ContextGate";
import { NavBar } from "@/components/ui/NavBar";
import { recordPhiAccess } from "@/lib/audit";
import { loadClinicContext } from "@/lib/clinic-context";
import { gated, notMigratedMessage } from "@/lib/migration-gate";
import { rangeStart, todayRange } from "@/lib/clinic-time";
import { canSeeMoney } from "@/lib/roles";
import { t } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";
import { ClinicalDay } from "./ClinicalDay";
import type { ClinicalRow } from "./types";

export const dynamic = "force-dynamic";

// Clinical records admit owner and therapist only — reception books and takes
// money, the accountant sees the till. Health data is sensitive under Law
// 151/2020, and "everyone signed in" is not a clinical need to know.
const CLINICAL_ROLES = ["owner", "therapist"];

export default async function ClinicalPage() {
  const result = await loadClinicContext();
  if (!result.ok) return <ContextGate result={result} />;
  const { clinicId, clinicName, timezone, role, userName, userId, nameById } =
    result.ctx;

  // Defined once and reused by every return below. An early exit that drops
  // the nav strands whoever hit it — the only way out is the back button.
  const nav = (
    <NavBar
      clinicName={clinicName}
      userName={userName}
      role={role}
      active="clinical"
      showMoney={canSeeMoney(role)}
    />
  );

  if (!CLINICAL_ROLES.includes(role)) {
    return (
      <>
        {nav}
        <main className="shell">
          <p className="empty" style={{ marginTop: 48 }}>
            {t("clinicalForbidden")}
          </p>
        </main>
      </>
    );
  }

  const supabase = await createClient();
  const { start, end } = todayRange(new Date(), timezone);

  // A therapist sees their own list; an owner sees the whole clinic's, since
  // they may be covering or reviewing.
  let query = supabase
    .from("appointments")
    .select("id, patient_id, therapist_id, during, status, patients(name, phone)")
    .eq("clinic_id", clinicId)
    .overlaps("during", `[${start.toISOString()},${end.toISOString()})`)
    .neq("status", "cancelled")
    .order("during", { ascending: true });

  if (role === "therapist") query = query.eq("therapist_id", userId);

  const { data: appts, error } = await query;

  if (error) {
    return (
      <>
        {nav}
        <main className="shell">
          <p className="formerror" style={{ marginTop: 48 }}>
            {error.message}
          </p>
        </main>
      </>
    );
  }

  const patientIds = [...new Set((appts ?? []).map((a) => a.patient_id))];

  // Both of these arrive with migration 0005. Reading them without checking
  // the error rendered "0 written up" for every patient when the table was
  // absent — a therapist reads that as their notes being lost, and stops
  // writing them. See lib/migration-gate.ts.
  type NoteRow = { id: string; patient_id: string; appointment_id: string | null };
  type ProgressRow = {
    patient_id: string;
    kind: string;
    first_score: number;
    latest_score: number;
    max_score: number;
    improvement: number;
    readings: number;
    lower_is_better: boolean;
  };

  const [noteGate, progressGate] = await Promise.all([
    patientIds.length
      ? gated<NoteRow[]>(
          "0005",
          supabase
            .from("soap_notes")
            .select("id, patient_id, appointment_id, created_at")
            .eq("clinic_id", clinicId)
            .in("patient_id", patientIds),
          []
        )
      : Promise.resolve({ ok: true as const, data: [] as NoteRow[] }),
    patientIds.length
      ? gated<ProgressRow[]>(
          "0005",
          supabase
            .from("recovery_progress")
            .select("patient_id, kind, first_score, latest_score, max_score, improvement, readings, lower_is_better")
            .eq("clinic_id", clinicId)
            .in("patient_id", patientIds),
          []
        )
      : Promise.resolve({ ok: true as const, data: [] as ProgressRow[] }),
  ]);

  for (const g of [noteGate, progressGate]) {
    if (!g.ok) {
      return (
        <>
          {nav}
          <main className="shell">
            <p className="formerror" style={{ marginTop: 48 }}>
              {g.reason === "not_migrated"
                ? notMigratedMessage(g.migration)
                : g.message}
            </p>
          </main>
        </>
      );
    }
  }

  // Every patient whose record appeared on this screen, in one insert.
  void recordPhiAccess({ clinicId, userId, patientIds, surface: "clinical_day" });

  const notes = noteGate.ok ? noteGate.data : [];
  const progress = progressGate.ok ? progressGate.data : [];

  // A visit counts as written up when a note exists for that appointment, not
  // merely for that patient — otherwise every follow-up would look done.
  const notedAppointments = new Set(
    (notes ?? []).filter((n) => n.appointment_id).map((n) => n.appointment_id as string)
  );
  const noteCount = new Map<string, number>();
  for (const n of notes ?? []) {
    noteCount.set(n.patient_id, (noteCount.get(n.patient_id) ?? 0) + 1);
  }

  const progressByPatient = new Map<string, ClinicalRow["progress"]>();
  for (const p of progress ?? []) {
    const list = progressByPatient.get(p.patient_id) ?? [];
    list.push({
      kind: p.kind,
      firstScore: Number(p.first_score),
      latestScore: Number(p.latest_score),
      maxScore: Number(p.max_score),
      improvement: Number(p.improvement),
      readings: Number(p.readings),
      lowerIsBetter: p.lower_is_better,
    });
    progressByPatient.set(p.patient_id, list);
  }

  const rows: ClinicalRow[] = (appts ?? []).map((a) => {
    const patient = (
      a as unknown as { patients: { name: string; phone: string } | null }
    ).patients;
    return {
      appointmentId: a.id,
      patientId: a.patient_id,
      patientName: patient?.name ?? "—",
      therapistName: nameById.get(a.therapist_id) ?? "—",
      startsAt: rangeStart(a.during),
      status: a.status,
      writtenUp: notedAppointments.has(a.id),
      noteCount: noteCount.get(a.patient_id) ?? 0,
      progress: progressByPatient.get(a.patient_id) ?? [],
    };
  });

  return (
    <>
      {nav}
      <main className="shell">
        <ClinicalDay rows={rows} isOwner={role === "owner"} />
      </main>
    </>
  );
}
