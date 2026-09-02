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
-- STEP 2 of 3 — run this only after STEP 1 has succeeded.
-- ############################################################

-- ---- 0003: the accountant role in policy form ----
--
-- `drop policy if exists` then `create`, rather than `alter policy`, so this
-- is safe to re-run after a half-applied paste. The failure mode otherwise is
-- a table left with no policy at all, which returns zero rows, looks exactly
-- like a bug, and invites someone to "fix" it by disabling RLS.

drop policy if exists tenant on packages;
create policy tenant on packages for all
  using (my_role(clinic_id) in ('owner','reception','accountant'))
  with check (my_role(clinic_id) in ('owner','reception','accountant'));

drop policy if exists tenant on payments;
create policy tenant on payments for all
  using (my_role(clinic_id) in ('owner','reception','accountant'))
  with check (my_role(clinic_id) in ('owner','reception','accountant'));

drop policy if exists tenant on refunds;
create policy tenant on refunds for all
  using (my_role(clinic_id) in ('owner','reception','accountant'))
  with check (my_role(clinic_id) in ('owner','reception','accountant'));

select 'STEP 2 done — now run STEP 3' as result;


-- ############################################################
