-- The accountant role in policy form. Separate file from 0002 because the
-- enum value has to be committed before a policy can reference it.
--
-- `drop policy if exists` + `create` rather than `alter policy`, so this file
-- is safe to re-run after a half-applied paste — the failure mode otherwise
-- is a table left with no policy at all, which looks exactly like a bug and
-- invites someone to "fix" it by disabling RLS.

-- The accountant sees the till. Clinical tables land in a later phase; this
-- is the policy shape they will follow, with 'accountant' left out.
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
