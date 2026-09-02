import "server-only";

import { isMissingObject } from "./migration-gate";
import { createClient } from "./supabase/server";

// WHO READ WHAT.
//
// The audit trail covered writes only: it could say who took a payment and never
// who opened a patient's clinical record. Reads are what a health-data audit log
// exists to cover, and under the PDPL Executive Regulations accountability is
// not satisfied by knowing who changed something.
//
// Two rules this module holds to, both from CLAUDE.md:
//
//   "No PHI in logs. Log the patient UUID, nothing else."
//     — the table takes ids, a surface and a time. No name, no phone, no note.
//
//   A logging failure must never take a screen down. A therapist cannot treat a
//     patient because the audit insert timed out is a worse outcome than a
//     missing log line, so every call here is fire-and-forget and swallows its
//     own errors. The place that must not silently fail is the *read* of the
//     log, which is an owner-facing screen and reports its own problems.

export type PhiSurface =
  | "patient_record"
  | "clinical_day"
  | "examination"
  | "receipt"
  | "patient_portal"
  | "export";

/**
 * Records that a signed-in member of staff opened something showing patient
 * health data. `actor` is not a parameter: the row is written through the
 * caller's own session and the policy requires `actor = auth.uid()`, so a
 * member of staff cannot attribute a read to a colleague.
 *
 * Never throws. Never awaited by a render path for correctness — only so the
 * request does not end before the insert is sent.
 */
export async function recordPhiAccess(input: {
  clinicId: string;
  userId: string;
  patientIds: string[];
  surface: PhiSurface;
}): Promise<void> {
  const ids = [...new Set(input.patientIds)].filter(Boolean);
  if (ids.length === 0) return;

  try {
    const supabase = await createClient();
    const { error } = await supabase.from("phi_access_log").insert(
      ids.map((patientId) => ({
        clinic_id: input.clinicId,
        actor: input.userId,
        patient_id: patientId,
        surface: input.surface,
      }))
    );

    // Migration 0010 may not be applied. That is a deployment state, not an
    // error worth a line in the server log on every page view — the screens
    // themselves say which migration is missing.
    if (error && !isMissingObject(error)) {
      // No patient id here: this is a log line about logging, and it must not
      // become the PHI leak the table was built to avoid.
      console.error(`phi_access_log insert failed on ${input.surface}`);
    }
  } catch {
    // Deliberately silent. See the header.
  }
}
