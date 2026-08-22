-- Phase 1 foundation: per-clinic currency, and the accountant role.
--
-- Two statements, and deliberately nothing that *uses* the new enum value.
-- Postgres raises "unsafe use of new value of enum type" when a value added
-- by `alter type ... add value` is referenced in the same transaction, and
-- the Supabase SQL editor wraps a paste in one. The policies that reference
-- 'accountant' therefore live in 0003 and are run separately. That error
-- reads like a syntax mistake and isn't, so it is worth avoiding by design.

-- ISO 4217, so a display can derive its own formatting rather than look it
-- up in a map that has to be kept in step. Existing rows take the default;
-- every clinic today is Egyptian.
alter table clinics
  add column currency char(3) not null default 'EGP'
    check (currency ~ '^[A-Z]{3}$');

-- accountant: all of the till, none of the clinical record. Added now, while
-- there are three policies to revisit instead of thirty.
alter type clinic_role add value if not exists 'accountant';
