-- Close the write surface.
--
-- Until now every tenant table carried a single `for all` policy. RLS decided
-- *which rows* a member could touch and said nothing about *what they could do
-- to them*, so with nothing but the publishable key and a valid session:
--
--   * a therapist could DELETE a patient — which cascade-deletes that
--     patient's payments (payments.patient_id ... on delete cascade), so a
--     single request could vacuum till history;
--   * a therapist could PATCH any appointment's price;
--   * reception could PATCH payments.amount after the fact, including below
--     the sum already refunded against it, retroactively breaking the refund
--     guard's invariant;
--   * reception could DELETE a refund row and resurrect the cash, because
--     refund_guard fires on insert and update only.
--
-- CLAUDE.md requires financial records to be append-only and corrections to be
-- reversing entries. That was true of the application code and false of the
-- database. This migration makes it true of both.
--
-- Nothing in the application deletes through the RLS-bound client, and only
-- appointments and memberships are updated, so this removes capability the
-- product never used.

-- ============ patients ============
-- Split so that the cascade can no longer be triggered from a client. Erasure
-- under Law 151/2020 remains possible, but as a deliberate, audited SQL
-- operation rather than a request anyone signed in can make by accident.

drop policy if exists tenant on patients;

create policy read on patients for select
  using (clinic_id in (select my_clinics()));

create policy add on patients for insert
  with check (clinic_id in (select my_clinics()));

create policy amend on patients for update
  using (clinic_id in (select my_clinics()))
  with check (clinic_id in (select my_clinics()));

-- deliberately no delete policy

-- ============ appointments ============

drop policy if exists tenant on appointments;

create policy read on appointments for select
  using (clinic_id in (select my_clinics()));

-- Booking is a front-desk job. A therapist marking attendance goes through
-- the update policy below, not this one.
create policy add on appointments for insert
  with check (my_role(clinic_id) in ('owner','reception'));

create policy amend on appointments for update
  using (clinic_id in (select my_clinics()))
  with check (clinic_id in (select my_clinics()));

-- deliberately no delete policy: cancelling is a status change, and the row is
-- what proves a slot was held

-- RLS cannot express "this role may change only this column", so the column
-- boundary is a trigger. Security invoker on purpose — it has to see the
-- caller's own role.
create or replace function appointment_write_guard()
returns trigger language plpgsql as $$
begin
  if my_role(new.clinic_id) = 'therapist' then
    if new.during      is distinct from old.during
    or new.patient_id  is distinct from old.patient_id
    or new.therapist_id is distinct from old.therapist_id
    or new.package_id  is distinct from old.package_id
    or new.price       is distinct from old.price
    or new.clinic_id   is distinct from old.clinic_id then
      raise exception 'a therapist may only change a session''s status';
    end if;
  end if;

  -- Moving an already-attended session onto a different package would strand
  -- the consumed credit on the old one: consume_package fires on status
  -- changes, so nothing would give the session back.
  if old.status = 'attended'
     and new.package_id is distinct from old.package_id then
    raise exception 'cannot move an attended session to a different package';
  end if;

  return new;
end;
$$;

create trigger trg_appointment_write_guard
  before update on appointments
  for each row execute function appointment_write_guard();

-- ============ packages ============
-- A sold package is a financial record. Its price and session count can be
-- corrected by an owner; it cannot be removed. sessions_used is moved by
-- consume_package, which is security definer and so unaffected by any of this.

drop policy if exists tenant on packages;

create policy read on packages for select
  using (my_role(clinic_id) in ('owner','reception','accountant'));

create policy add on packages for insert
  with check (my_role(clinic_id) in ('owner','reception','accountant'));

create policy amend on packages for update
  using (my_role(clinic_id) = 'owner')
  with check (my_role(clinic_id) = 'owner');

-- deliberately no delete policy

-- ============ payments ============
-- Append-only, with no exceptions. A mistaken payment is corrected by a
-- refund, which is itself a row rather than an edit. This is the whole reason
-- an owner can reconstruct what the books said on any past date.

drop policy if exists tenant on payments;

create policy read on payments for select
  using (my_role(clinic_id) in ('owner','reception','accountant'));

create policy add on payments for insert
  with check (my_role(clinic_id) in ('owner','reception','accountant'));

-- deliberately no update and no delete policy

-- A payment settles a package or a single session, never both: netted by
-- package_balances *and* leaking_sessions, one row would be counted twice.
-- The application already writes it that way; this makes it impossible to
-- write it any other way.
alter table payments
  add constraint payment_targets_one_thing
  check (not (package_id is not null and appointment_id is not null));

-- ============ refunds ============
-- Also append-only. A refund entered in error is corrected by taking a
-- payment, not by deleting the refund.

drop policy if exists tenant on refunds;

create policy read on refunds for select
  using (my_role(clinic_id) in ('owner','reception','accountant'));

create policy add on refunds for insert
  with check (my_role(clinic_id) in ('owner','reception','accountant'));

-- deliberately no update and no delete policy

-- ============ clinical records ============
-- A clinical note is a legal record of care. It can be added to and amended
-- by its clinic's clinicians, never deleted.

drop policy if exists clinical on soap_notes;

create policy read on soap_notes for select
  using (my_role(clinic_id) in ('owner','therapist'));

create policy add on soap_notes for insert
  with check (my_role(clinic_id) in ('owner','therapist'));

create policy amend on soap_notes for update
  using (my_role(clinic_id) in ('owner','therapist'))
  with check (my_role(clinic_id) in ('owner','therapist'));

drop policy if exists clinical on outcome_measures;

create policy read on outcome_measures for select
  using (my_role(clinic_id) in ('owner','therapist'));

create policy add on outcome_measures for insert
  with check (my_role(clinic_id) in ('owner','therapist'));

-- A recorded score is an observation at a point in time. Correcting one means
-- recording another, so there is no update and no delete.
