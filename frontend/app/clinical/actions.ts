"use server";

import { revalidatePath } from "next/cache";
import { loadClinicContext } from "@/lib/clinic-context";
import { OUTCOME_MEASURES, isMeasureKind } from "@/lib/clinical";
import { throwIfNotMigrated } from "@/lib/migration-gate";
import { t } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";

// Clinical records go through ordinary RLS. The policy on soap_notes and
// outcome_measures admits owner and therapist only — reception and the
// accountant are refused by the database, not by a check here, so a mistake
// in this file cannot open them up.

async function ctx() {
  const result = await loadClinicContext();
  if (!result.ok) throw new Error(t("mustSignIn"));
  return result.ctx;
}

export type SoapDraft = {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
};

export async function saveNote(input: {
  patientId: string;
  appointmentId?: string | null;
  template?: string;
  note: SoapDraft;
}) {
  const { clinicId, userId } = await ctx();

  const note = {
    subjective: input.note.subjective.trim(),
    objective: input.note.objective.trim(),
    assessment: input.note.assessment.trim(),
    plan: input.note.plan.trim(),
  };

  // The database has the same check. Failing here first turns a constraint
  // violation into a sentence the clinician can act on.
  if (!note.subjective && !note.objective && !note.assessment && !note.plan) {
    throw new Error(t("noteEmpty"));
  }

  const supabase = await createClient();
  const { error } = await supabase.from("soap_notes").insert({
    clinic_id: clinicId,
    patient_id: input.patientId,
    appointment_id: input.appointmentId ?? null,
    therapist_id: userId,
    template: input.template ?? "",
    ...note,
  });

  if (error) {
    // 42501 is RLS refusing the write, which is what reception or an
    // accountant reaching this action would get.
    if (error.code === "42501") throw new Error(t("clinicalForbidden"));
    // "relation does not exist" reads as a typo in our own code. Name the
    // step nobody has run instead.
    throwIfNotMigrated(error, "0005");
  }

  revalidatePath("/clinical");
  revalidatePath(`/patients/${input.patientId}`);
}

// The last note for this patient, for "copy from last visit". Most
// physiotherapy visits are near-identical follow-ups, and starting from the
// previous note is the difference between 45 seconds and five minutes.
export async function lastNoteFor(patientId: string): Promise<SoapDraft | null> {
  const { clinicId } = await ctx();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("soap_notes")
    .select("subjective, objective, assessment, plan")
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data ?? null;
}

export async function recordMeasure(input: {
  patientId: string;
  kind: string;
  score: number;
  note?: string;
}) {
  const { clinicId, userId } = await ctx();

  if (!isMeasureKind(input.kind)) throw new Error("unknown instrument");
  const spec = OUTCOME_MEASURES[input.kind];

  const score = Number(input.score);
  if (!Number.isFinite(score) || score < 0 || score > spec.max) {
    throw new Error(t("scoreOutOfRange"));
  }

  const supabase = await createClient();
  const { error } = await supabase.from("outcome_measures").insert({
    clinic_id: clinicId,
    patient_id: input.patientId,
    therapist_id: userId,
    kind: input.kind,
    score,
    // Written from the table above, not sent by the client: an instrument's
    // scale is part of the historical record, and a future edition that
    // rescales must not retroactively change what a patient scored.
    max_score: spec.max,
    lower_is_better: spec.lowerIsBetter,
    note: (input.note ?? "").trim(),
  });

  if (error) {
    if (error.code === "42501") throw new Error(t("clinicalForbidden"));
    // "relation does not exist" reads as a typo in our own code. Name the
    // step nobody has run instead.
    throwIfNotMigrated(error, "0005");
  }

  revalidatePath("/clinical");
  revalidatePath(`/patients/${input.patientId}`);
}
