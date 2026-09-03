import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { subscriptionStatus } from './enums.js';

/** Plan-level feature flags drive availability (FR-PLT-08). */
export const plans = pgTable('plans', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  priceEgp: numeric('price_egp', { precision: 12, scale: 2 }).notNull(),
  maxBranches: integer('max_branches'),
  features: jsonb('features')
    .notNull()
    .default(sql`'{}'::jsonb`),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** The tenant. The isolation boundary, without exception (PRD §8.1). */
export const clinics = pgTable('clinics', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  /** IANA name, never a fixed offset — Egypt reinstated DST in 2023 (NFR-LOC-03). */
  timezone: text('timezone').notNull().default('Africa/Cairo'),
  currency: text('currency').notNull().default('EGP'),
  taxRate: numeric('tax_rate', { precision: 6, scale: 4 })
    .notNull()
    .default('0'),
  taxLabel: text('tax_label'),
  invoiceRegime: text('invoice_regime').notNull().default('none'),
  /** Receipt numbering is per clinic and gapless (§11.11). `series` exists so a future
   *  per-branch or per-regime series is a data change, not a backfill (review F14). */
  receiptSeries: text('receipt_series').notNull().default('default'),
  receiptLastNumber: integer('receipt_last_number').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  clinicId: uuid('clinic_id')
    .notNull()
    .references(() => clinics.id),
  planId: uuid('plan_id')
    .notNull()
    .references(() => plans.id),
  status: subscriptionStatus('status').notNull().default('trialing'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
