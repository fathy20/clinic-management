"use server";

import { revalidatePath } from "next/cache";
import { loadClinicContext } from "@/lib/clinic-context";
import { newPortalToken } from "@/lib/portal";
import { throwIfNotMigrated } from "@/lib/migration-gate";
import { t } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";

// Issuing and withdrawing a patient's portal link, and prescribing the
// exercises the link exists to carry.
//
// These go through the ordinary RLS-bound client: the policies in migration
// 0007 already say who may issue a link (owner, reception, therapist) and who
// may prescribe (owner, therapist). Reaching for the admin client here would
// move that decision out of the database for no reason.

async function ctx() {
  const result = await loadClinicContext();
  if (!result.ok) throw new Error(t("mustSignIn"));
  return result.ctx;
}

// Verifies the patient is in the caller's clinic before anything is written
// against them. RLS would refuse anyway; this turns a silent zero-row write
// into a sentence.
async function assertPatient(patientId: string, clinicId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("patients")
    .select("id, name, phone")
    .eq("clinic_id", clinicId)
    .eq("id", patientId)
    .maybeSingle();
  if (!data) throw new Error(t("patientNotFound"));
  return data;
}

export type IssuedLink = { url: string; patientName: string; clinicName: string };

// The token is returned once and never again: only its SHA-256 is stored, so
// there is nothing to show a second time. That is the point — a link that can
// be re-read from the database is a link a database leak hands out.
export async function issuePortalLink(input: {
  patientId: string;
  expiresInDays?: number;
}): Promise<IssuedLink> {
  const { clinicId, clinicName, userId } = await ctx();
  const patient = await assertPatient(input.patientId, clinicId);

  const { token, hash } = newPortalToken();

  const days = Number(input.expiresInDays) || 0;
  const expires =
    days > 0
      ? new Date(Date.now() + days * 86_400_000).toISOString()
      : null;

  const supabase = await createClient();
  const { error } = await supabase.from("patient_portal_tokens").insert({
    clinic_id: clinicId,
    patient_id: input.patientId,
    token_hash: hash,
    issued_by: userId,
    expires_at: expires,
  });

  if (error) {
    if (error.code === "42501") throw new Error(t("onlyOwners"));
    throwIfNotMigrated(error, "0007");
  }

  // The absolute URL has to be built here: the client cannot know the public
  // origin behind a proxy, and a relative link is useless in a WhatsApp
  // message. NEXT_PUBLIC_APP_URL is the deployment's own address.
  const origin = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  revalidatePath(`/patients/${input.patientId}`);

  return {
    url: `${origin}/portal/${token}`,
    patientName: patient.name as string,
    clinicName,
  };
}

export async function revokePortalLink(tokenId: string) {
  const { clinicId } = await ctx();
  const supabase = await createClient();

  const { error } = await supabase
    .from("patient_portal_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("clinic_id", clinicId)
    .eq("id", tokenId);

  throwIfNotMigrated(error, "0007");
  revalidatePath("/patients");
}

export async function prescribeExercise(input: {
  patientId: string;
  name: string;
  instructions: string;
  sets?: number | null;
  reps?: number | null;
  holdSeconds?: number | null;
  frequency: string;
  videoUrl?: string | null;
}) {
  const { clinicId, userId } = await ctx();
  await assertPatient(input.patientId, clinicId);

  const name = input.name.trim();
  if (!name) throw new Error(t("exerciseName"));

  // A URL that reaches a patient must not be a javascript: or data: payload.
  // The database has the same check; failing here first gives a sentence
  // instead of a constraint violation.
  const url = (input.videoUrl ?? "").trim();
  if (url && !/^https?:\/\//i.test(url)) {
    throw new Error(t("videoLabel"));
  }

  const positive = (v: unknown) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const supabase = await createClient();
  const { error } = await supabase.from("exercise_prescriptions").insert({
    clinic_id: clinicId,
    patient_id: input.patientId,
    therapist_id: userId,
    name,
    instructions: input.instructions.trim(),
    sets: positive(input.sets),
    reps: positive(input.reps),
    hold_seconds: positive(input.holdSeconds),
    frequency: input.frequency.trim(),
    video_url: url || null,
  });

  if (error) {
    if (error.code === "42501") throw new Error(t("clinicalForbidden"));
    // "relation does not exist" reads as a typo in our own code. Name the
    // step nobody has run instead.
    throwIfNotMigrated(error, "0007");
  }

  revalidatePath(`/patients/${input.patientId}`);
}

// Retiring rather than deleting, so the patient's history of what they were
// asked to do survives. The table has no delete policy at all.
export async function retireExercise(exerciseId: string) {
  const { clinicId } = await ctx();
  const supabase = await createClient();

  const { error } = await supabase
    .from("exercise_prescriptions")
    .update({ active: false })
    .eq("clinic_id", clinicId)
    .eq("id", exerciseId);

  throwIfNotMigrated(error, "0007");
  revalidatePath("/patients");
}
