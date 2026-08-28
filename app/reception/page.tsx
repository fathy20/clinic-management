import { loadClinicContext } from "@/lib/clinic-context";
import { rangeStart, todayRange } from "@/lib/clinic-time";
import { canSeeMoney } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { ContextGate } from "@/components/ui/ContextGate";
import { NavBar } from "@/components/ui/NavBar";
import { DayBoard } from "./DayBoard";
import { MoneyRail } from "./MoneyRail";
import type { DayRow } from "./types";

export const dynamic = "force-dynamic";

export default async function ReceptionPage() {
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

  const supabase = await createClient();
  const { start, end } = todayRange(new Date(), timezone);

  const { data: appointments, error: apptError } = await supabase
    .from("appointments")
    .select("*, patients(name, phone)")
    .eq("clinic_id", clinicId)
    .overlaps("during", `[${start.toISOString()},${end.toISOString()})`)
    .order("during", { ascending: true });

  if (apptError) {
    return (
      <main className="shell">
        <p className="formerror" style={{ marginTop: 48 }}>
          {apptError.message}
        </p>
      </main>
    );
  }

  const [{ data: balances }, { data: risk }, { data: packages }] =
    await Promise.all([
      supabase
        .from("patient_balances")
        .select("patient_id, amount_owed")
        .eq("clinic_id", clinicId),
      supabase
        .from("noshow_risk")
        .select("patient_id, rate, history")
        .eq("clinic_id", clinicId),
      // Packages are invisible to a therapist by RLS, so this returns zero rows
      // for them and the progress arc simply doesn't render — no error, no gap.
      supabase
        .from("packages")
        .select("id, patient_id, sessions_total, sessions_used")
        .eq("clinic_id", clinicId),
    ]);

  const owedByPatient = new Map(
    (balances ?? []).map((b) => [b.patient_id, Number(b.amount_owed)])
  );

  // Only flag a pattern, not a single miss: three finished appointments is the
  // floor at which a rate means anything, and a third of them missed is the
  // point a receptionist would want to confirm the booking.
  const riskByPatient = new Map(
    (risk ?? [])
      .filter((r) => Number(r.history) >= 3 && Number(r.rate) >= 0.34)
      .map((r) => [r.patient_id, Number(r.rate)])
  );

  const pkgById = new Map((packages ?? []).map((p) => [p.id, p]));

  const rows: DayRow[] = (appointments ?? []).map((a) => {
    const patient = (
      a as unknown as { patients: { name: string; phone: string } }
    ).patients;
    const pkg = a.package_id ? pkgById.get(a.package_id) : undefined;
    return {
      id: a.id,
      patientId: a.patient_id,
      patientName: patient?.name ?? "—",
      patientPhone: patient?.phone ?? "—",
      therapistName: nameById.get(a.therapist_id) ?? "—",
      startsAt: rangeStart(a.during),
      status: a.status,
      packageId: a.package_id,
      price: Number(a.price),
      amountOwed: owedByPatient.get(a.patient_id) ?? 0,
      noShowRate: riskByPatient.get(a.patient_id) ?? null,
      packageUsed: pkg ? pkg.sessions_used : null,
      packageTotal: pkg ? pkg.sessions_total : null,
    };
  });

  const showMoney = canSeeMoney(role);
  const attended = rows.filter((r) => r.status === "attended").length;
  const missed = rows.filter((r) => r.status === "no_show").length;
  const waiting = rows.filter((r) => r.status === "booked").length;

  return (
    <>
      <NavBar
        clinicName={clinicName}
        userName={userName}
        role={role}
        active="reception"
        showMoney={canSeeMoney(role)}
      />
      <main className="shell">
        <div className="cols">
          <div>
            <DayBoard
              rows={rows}
              therapists={therapists}
              clinicId={clinicId}
              canSeeMoney={showMoney}
              currency={currency}
              counts={{ waiting, attended, missed, total: rows.length }}
            />
          </div>
          {showMoney && <MoneyRail clinicId={clinicId} currency={currency} />}
        </div>
      </main>
    </>
  );
}
