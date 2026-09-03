import { pgEnum } from 'drizzle-orm/pg-core';

/** Staff roles — PRD §9.2. Six, and no more. A patient is never a member (FR-IAM-05b). */
export const membershipRole = pgEnum('membership_role', [
  'owner',
  'branch_manager',
  'reception',
  'therapist',
  'clinical_lead',
  'accountant',
]);

/** FR-PLT-07: an expired subscription is read-only, never a lockout. */
export const subscriptionStatus = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'expired',
  'cancelled',
]);
