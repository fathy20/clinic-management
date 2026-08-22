import type { ClinicRole } from "./types";

// The app-side mirror of the RLS policy on packages/payments/refunds
// (supabase/migrations/0003_accountant_policies.sql). RLS is the real
// boundary — this only decides whether money is rendered at all, so a
// therapist sees a screen with no till rather than an empty one that looks
// broken. tests/accountant-role.test.ts asserts the two stay in step; if
// they drift, the test fails rather than a receptionist discovering it.
export const MONEY_ROLES: readonly ClinicRole[] = [
  "owner",
  "reception",
  "accountant",
];

export function canSeeMoney(role: string | null | undefined): boolean {
  return MONEY_ROLES.includes(role as ClinicRole);
}
