import Link from "next/link";
import { ContextGate } from "@/components/ui/ContextGate";
import { NavBar } from "@/components/ui/NavBar";
import { recordPhiAccess } from "@/lib/audit";
import { loadClinicContext } from "@/lib/clinic-context";
import { canSeeMoney } from "@/lib/roles";
import { t } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";
import { ExamRunner } from "./ExamRunner";

export const dynamic = "force-dynamic";

const CLINICAL_ROLES = ["owner", "therapist"];

export default async function ExamPage({
  searchParams,
}: {
  searchParams: Promise<{ patient?: string; appointment?: string }>;
}) {
  const { patient: patientId, appointment } = await searchParams;

  const result = await loadClinicContext();
  if (!result.ok) return <ContextGate result={result} />;
  const { clinicId, clinicName, role, userName, userId } = result.ctx;

  const chrome = (
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
        {chrome}
        <main className="shell">
          <p className="empty" style={{ marginTop: 48 }}>
            {t("clinicalForbidden")}
          </p>
        </main>
      </>
    );
  }

  // The patient has to be named and has to be in this clinic. RLS would return
  // nothing for another clinic's id anyway; this turns that into a sentence.
  const supabase = await createClient();
  const { data: patient } = patientId
    ? await supabase
        .from("patients")
        .select("id, name")
        .eq("clinic_id", clinicId)
        .eq("id", patientId)
        .maybeSingle()
    : { data: null };

  if (patient) {
    // Logged only after the patient resolves inside this clinic: a probe with a
    // stranger's uuid must not write a line implying the record was opened.
    void recordPhiAccess({
      clinicId,
      userId,
      patientIds: [patient.id],
      surface: "examination",
    });
  }

  if (!patient) {
    return (
      <>
        {chrome}
        <main className="shell">
          <p className="empty" style={{ marginTop: 48 }}>
            {t("patientNotFound")}
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      {chrome}
      <main className="shell">
        <div className="dayhead">
          <h1>{t("examTitle")}</h1>
          <span className="date">
            {patient.name} · {t("examSubtitle")}
          </span>
          <Link
            href="/clinical"
            className="btn btn-quiet btn-sm"
            style={{ marginInlineStart: "auto", textDecoration: "none" }}
          >
            {t("cancel")}
          </Link>
        </div>

        <ExamRunner
          patientId={patient.id}
          patientName={patient.name}
          appointmentId={appointment ?? null}
        />
      </main>
    </>
  );
}
