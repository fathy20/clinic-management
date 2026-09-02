"use server";

import { revalidatePath } from "next/cache";
import { loadClinicContext } from "@/lib/clinic-context";
import { throwIfNotMigrated } from "@/lib/migration-gate";
import { t } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";

// Consent, per purpose, under PDPL Article 14.
//
// The clinic is never a parameter — it comes from the caller's own session, so
// there is no clinic for a caller to name but theirs. The patient is checked to
// be in that clinic before anything is written, and the database enforces the
// same thing again with a trigger.
//
// The accountant is absent from the allowed roles on purpose: consent is about
// the clinical relationship, and the till has no part in it. The database
// policy says the same.

const PURPOSES = [
  "treatment",
  "records_storage",
  "whatsapp_messaging",
  "insurance_disclosure",
] as const;
export type ConsentPurpose = (typeof PURPOSES)[number];

const METHODS = ["in_person_signature", "portal", "verbal_witnessed"] as const;
export type ConsentMethod = (typeof METHODS)[number];

const CONSENT_ROLES = ["owner", "reception", "therapist"];

async function gate() {
  const result = await loadClinicContext();
  if (!result.ok) throw new Error(t("mustSignIn"));
  if (!CONSENT_ROLES.includes(result.ctx.role)) throw new Error(t("clinicalForbidden"));
  return result.ctx;
}

export async function recordConsent(input: {
  patientId: string;
  purpose: ConsentPurpose;
  method: ConsentMethod;
  wording: string;
}) {
  const ctx = await gate();
  if (!PURPOSES.includes(input.purpose)) throw new Error("unknown purpose");
  if (!METHODS.includes(input.method)) throw new Error("unknown method");

  const wording = input.wording.trim();
  if (!wording) throw new Error(t("consentWordingRequired"));

  const supabase = await createClient();

  // The patient must be in this clinic. RLS would return no row for anyone
  // else's patient, so this both scopes the check and produces a sentence
  // instead of a foreign-key error.
  const { data: patient } = await supabase
    .from("patients")
    .select("id")
    .eq("clinic_id", ctx.clinicId)
    .eq("id", input.patientId)
    .maybeSingle();
  if (!patient) throw new Error(t("patientNotFound"));

  const { error } = await supabase.from("consents").insert({
    clinic_id: ctx.clinicId,
    patient_id: input.patientId,
    purpose: input.purpose,
    method: input.method,
    // granted_by is not taken from the caller: the policy requires it to equal
    // auth.uid(), so a member of staff cannot record a consent as though a
    // colleague obtained it.
    granted_by: ctx.userId,
    wording,
  });
  throwIfNotMigrated(error, "0010");

  revalidatePath(`/patients/${input.patientId}`);
}

export async function withdrawConsent(input: { consentId: string; patientId: string }) {
  const ctx = await gate();
  const supabase = await createClient();

  // The only permitted update. The trigger in 0010 refuses any other column
  // change and refuses a second withdrawal, so a race here cannot rewrite
  // history — it can only lose to the first withdrawal.
  const { error } = await supabase
    .from("consents")
    .update({ withdrawn_at: new Date().toISOString(), withdrawn_by: ctx.userId })
    .eq("clinic_id", ctx.clinicId)
    .eq("id", input.consentId)
    .is("withdrawn_at", null);
  throwIfNotMigrated(error, "0010");

  revalidatePath(`/patients/${input.patientId}`);
}
