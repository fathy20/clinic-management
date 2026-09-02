import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClinicRole } from "./types";

// WHICH CLINIC AM I LOOKING AT?
//
// One rule, in one place, because two rules is a bug you cannot see. This used
// to be answered twice: the page picked the caller's lowest-uuid membership of
// any role, and the owner gate behind the form picked their lowest-uuid *owner*
// membership. For anyone who is a therapist in one clinic and an owner in
// another, /settings therefore rendered clinic A's name, currency and tax rate
// while Save wrote them to clinic B. Both clinics are theirs, so RLS was never
// violated and nothing looked wrong — the form just edited a clinic that was
// not on screen.
//
// The rule: prefer a clinic they own, then the lowest clinic_id. Preferring the
// owned one matters because /settings is only reachable for an owner; picking
// it here means the screen and the write land on the same clinic instead of the
// gate silently disagreeing with the page. clinic_id breaks the tie so the
// answer is the same on every request — there is no created_at to order by.

export type ActiveMembership = { clinicId: string; role: ClinicRole };

// Takes the RLS-bound client on purpose. The caller can only select their own
// memberships, so this cannot be steered into reporting someone else's clinic.
export async function activeMembership(
  supabase: SupabaseClient,
  userId: string
): Promise<ActiveMembership | null> {
  const { data } = await supabase
    .from("memberships")
    .select("clinic_id, role")
    .eq("user_id", userId)
    .order("clinic_id");

  const rows = (data ?? []) as { clinic_id: string; role: ClinicRole }[];
  if (rows.length === 0) return null;

  const chosen = rows.find((m) => m.role === "owner") ?? rows[0];
  return { clinicId: chosen.clinic_id, role: chosen.role };
}
