import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { membershipRole } from './enums.js';
import { clinics } from './platform.js';

/**
 * A physical location. NOT a tenant: patients and packages are shared clinic-wide
 * (PRD §22, FR-PLT-06). Branch is an attribute and an application-level filter —
 * it is deliberately not an RLS dimension (plan 01, D5).
 */
export const branches = pgTable('branches', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id')
    .notNull()
    .references(() => clinics.id),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Africa/Cairo'),
  address: text('address'),
  phone: text('phone'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Global identity. Carries no `clinic_id`: a user's authority over a tenant comes from
 * `memberships`, never from the user row (PRD §9.1). Platform staff have no membership
 * at all and cannot reach PHI (FR-PLT-10).
 */
export const users = pgTable('users', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text('email').unique(),
  phone: text('phone').unique(),
  /** Argon2id (FR-IAM-01, NFR-SEC-04). */
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  isPlatformStaff: boolean('is_platform_staff').notNull().default(false),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The staff authorization mechanism. `branch_id IS NULL` means every branch of the
 * tenant — one meaning, not two (FR-IAM-09).
 */
export const memberships = pgTable('memberships', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id')
    .notNull()
    .references(() => clinics.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  role: membershipRole('role').notNull(),
  branchId: uuid('branch_id').references(() => branches.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  /** Revocation, not deletion — the app role holds no DELETE (NFR-SEC-09). */
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const therapists = pgTable('therapists', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id')
    .notNull()
    .references(() => clinics.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  displayName: text('display_name').notNull(),
  specialties: text('specialties')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  isBookable: boolean('is_bookable').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
