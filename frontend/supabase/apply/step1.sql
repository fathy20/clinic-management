-- ============================================================
-- PENDING MIGRATIONS — paste as THREE separate runs, in this order.
--
-- This is not a style preference. The Supabase SQL editor wraps a paste in a
-- single transaction, and Postgres refuses to *use* a value added to an
-- existing enum inside the transaction that added it. Pasting all of this at
-- once fails with:
--
--     unsafe use of new value "accountant" of enum type clinic_role
--
-- Verified on Postgres 18: one block fails, the split below works, and the
-- schema self-test still passes afterwards.
--
-- Source of truth remains supabase/migrations/0002…0008. This file only makes
-- them one copy/paste each. STEP 3 carries 0005 (clinical records), 0006
-- (append-only money), 0007 (patient portal) and 0008 (the demotion guard);
-- none of them touch an enum, so they share one paste.
-- ============================================================


-- ############################################################
-- STEP 1 of 3 — run this, wait for success, then run STEP 2.
-- ############################################################

-- ---- 0002: per-clinic currency, and the accountant role ----

alter table clinics
  add column currency char(3) not null default 'EGP'
    check (currency ~ '^[A-Z]{3}$');

alter type clinic_role add value if not exists 'accountant';

-- ---- 0004: the settings that cannot be retrofitted ----
--
-- Gulf expansion is a tax-and-invoice-format problem before it is anything
-- else, and Egypt's ETA e-invoicing threshold fell to EGP 250,000 of annual
-- revenue — a three-therapist clinic clears that on roughly 800 sessions a
-- year. None of these can be added after invoices have been issued.

-- IANA name, not an offset. Egypt reinstated DST in 2023, so a stored
-- "+02:00" is wrong for half the year.
alter table clinics
  add column timezone text not null default 'Africa/Cairo'
    check (length(timezone) > 0);

alter table clinics
  add column locale char(2) not null default 'ar'
    check (locale in ('ar', 'en'));

-- A rate plus a label, not a hardcoded VAT: Egypt taxes most private medical
-- services at zero, Saudi at 15%, the UAE at 5%. numeric(5,4) holds 0.1500
-- exactly; a float would not.
alter table clinics
  add column tax_rate numeric(5,4) not null default 0
    check (tax_rate >= 0 and tax_rate <= 1);

alter table clinics
  add column tax_label text not null default '';

create type invoice_regime as enum ('none', 'eta_eg', 'zatca_sa', 'uae');

alter table clinics
  add column invoice_regime invoice_regime not null default 'none';

-- Gapless and scoped to the issuer, which every regime requires. Kept as a
-- counter rather than derived from a count, so a voided invoice cannot cause
-- a number to be reused.
alter table clinics
  add column next_invoice_number bigint not null default 1
    check (next_invoice_number > 0);

select 'STEP 1 done — now run STEP 2' as result;


-- ############################################################
