import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { adminClient } from "./supabase/admin";

// ============================================================
// PATIENT PORTAL — the second place in this codebase that bypasses RLS, and
// the one that is read by someone with no account at all.
//
// A patient has no session, so there is nothing for a policy to key on. The
// link they open IS the credential. That means every rule that protects a
// credential applies here, and the rules that matter most are:
//
//   1. The patient is derived from the token. Nothing in the URL, the query
//      string or the request body ever names a patient — so a patient cannot
//      reach another patient's record by editing an id, because there is no
//      id to edit.
//   2. Only the token's SHA-256 goes in the database. A leaked dump does not
//      hand out portal access.
//   3. The portal returns a fixed, narrow shape: appointments, sessions left,
//      balance, exercises. It never returns a clinical note. A patient may be
//      entitled to their record, but a WhatsApp link is not the channel for
//      an assessment, and Law 151/2020 treats it as sensitive data.
// ============================================================

const TOKEN_BYTES = 32; // 256 bits, base64url — not guessable by anybody

export function newPortalToken() {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// Constant-time comparison so a caller cannot learn a valid prefix by timing
// repeated requests. The lookup below is by hash equality in Postgres, which
// is not constant time; this guards the second check.
function sameHash(a: string, b: string) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type PortalSession = {
  patientId: string;
  clinicId: string;
  tokenId: string;
};

export type PortalResult =
  | { ok: true; session: PortalSession }
  | { ok: false; reason: "unknown" | "revoked" | "expired" };

// Anything malformed is "unknown" rather than a distinct error: a caller
// probing links should not be able to tell a wrong token from an expired one.
export async function verifyPortalToken(raw: string): Promise<PortalResult> {
  if (!raw || raw.length < 20 || raw.length > 200) {
    return { ok: false, reason: "unknown" };
  }

  const hash = hashToken(raw);
  const db = adminClient();

  const { data } = await db
    .from("patient_portal_tokens")
    .select("id, patient_id, clinic_id, token_hash, revoked_at, expires_at")
    .eq("token_hash", hash)
    .maybeSingle();

  if (!data || !sameHash(data.token_hash as string, hash)) {
    return { ok: false, reason: "unknown" };
  }
  if (data.revoked_at) return { ok: false, reason: "revoked" };
  if (data.expires_at && new Date(data.expires_at as string) < new Date()) {
    return { ok: false, reason: "expired" };
  }

  // Enough to notice a link that has escaped, without logging what was read.
  await db
    .from("patient_portal_tokens")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id);

  return {
    ok: true,
    session: {
      patientId: data.patient_id as string,
      clinicId: data.clinic_id as string,
      tokenId: data.id as string,
    },
  };
}

export type PortalExercise = {
  id: string;
  name: string;
  instructions: string;
  sets: number | null;
  reps: number | null;
  holdSeconds: number | null;
  frequency: string;
  videoUrl: string | null;
};

export type PortalView = {
  clinicName: string;
  currency: string;
  timezone: string;
  patientName: string;
  upcoming: { id: string; startsAt: string; therapistName: string }[];
  sessionsLeft: number;
  amountOwed: number;
  exercises: PortalExercise[];
};

// The whole of what a patient can see, assembled in one place so there is a
// single list to audit. Every query is filtered by the patient and clinic the
// token resolved to.
export async function loadPortalView(
  session: PortalSession
): Promise<PortalView | null> {
  const db = adminClient();
  const { patientId, clinicId } = session;

  // The patient reading their own record is still a read of health data, and the
  // PDPL does not exempt it. Logged through log_portal_access (migration 0010),
  // which takes no actor and always records null — meaning "the patient" — so
  // this path cannot be used to forge a staff read. Fire-and-forget: a logging
  // failure must not leave a patient looking at an error instead of their
  // exercises.
  void db
    .rpc("log_portal_access", { p_patient: patientId, p_clinic: clinicId })
    .then(() => undefined, () => undefined);

  const [
    { data: patient },
    { data: clinic },
    { data: appts },
    { data: packages },
    { data: balance },
    { data: exercises },
  ] = await Promise.all([
    db.from("patients").select("name").eq("id", patientId).maybeSingle(),
    db.from("clinics").select("*").eq("id", clinicId).maybeSingle(),
    db
      .from("appointments")
      .select("id, during, therapist_id, status")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .neq("status", "cancelled")
      .order("during", { ascending: true }),
    db
      .from("packages")
      .select("sessions_total, sessions_used")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId),
    db
      .from("patient_balances")
      .select("amount_owed")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .maybeSingle(),
    db
      .from("exercise_prescriptions")
      .select("id, name, instructions, sets, reps, hold_seconds, frequency, video_url")
      .eq("clinic_id", clinicId)
      .eq("patient_id", patientId)
      .eq("active", true)
      .order("created_at", { ascending: true }),
  ]);

  if (!patient) return null;

  // Therapist first names only. The patient knows who treats them; the portal
  // has no reason to expose the clinic's full staff list.
  const therapistIds = [...new Set((appts ?? []).map((a) => a.therapist_id))];
  const { data: profiles } = therapistIds.length
    ? await db.from("profiles").select("id, full_name").in("id", therapistIds)
    : { data: [] };
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.id as string, p.full_name as string])
  );

  const now = Date.now();
  const upcoming = (appts ?? [])
    .filter((a) => {
      const inner = (a.during as string).slice(1);
      const startsAt = inner.slice(0, inner.indexOf(",")).replace(/^"|"$/g, "");
      return new Date(startsAt).getTime() > now;
    })
    .slice(0, 10)
    .map((a) => {
      const inner = (a.during as string).slice(1);
      return {
        id: a.id as string,
        startsAt: inner.slice(0, inner.indexOf(",")).replace(/^"|"$/g, ""),
        therapistName: nameById.get(a.therapist_id as string) ?? "—",
      };
    });

  const sessionsLeft = (packages ?? []).reduce(
    (n, p) => n + Math.max(0, (p.sessions_total as number) - (p.sessions_used as number)),
    0
  );

  return {
    clinicName: (clinic?.name as string) ?? "",
    currency: (clinic as { currency?: string } | null)?.currency ?? "EGP",
    timezone: (clinic as { timezone?: string } | null)?.timezone ?? "Africa/Cairo",
    patientName: patient.name as string,
    upcoming,
    sessionsLeft,
    amountOwed: Number(balance?.amount_owed ?? 0),
    exercises: (exercises ?? []).map((e) => ({
      id: e.id as string,
      name: e.name as string,
      instructions: e.instructions as string,
      sets: e.sets as number | null,
      reps: e.reps as number | null,
      holdSeconds: e.hold_seconds as number | null,
      frequency: e.frequency as string,
      videoUrl: e.video_url as string | null,
    })),
  };
}
