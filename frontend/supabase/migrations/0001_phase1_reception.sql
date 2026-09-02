-- Phase 1: reception screen. Adds to the schema.sql baseline — never edit
-- schema.sql or this file again once applied; add the next migration instead.

-- ============ display names ============
-- auth.users is not exposed to PostgREST (anon/authenticated roles can't
-- select from it), so there is no way to show "which therapist" without a
-- public-schema mirror of at least a display name. One row per user,
-- auto-created at signup.

create table profiles (
  id         uuid primary key references auth.users on delete cascade,
  full_name  text not null
);

alter table profiles enable row level security;

-- Visible to anyone who shares a clinic with this user — reception needs to
-- read every therapist's name, not just their own.
create policy tenant on profiles for select
  using (
    id in (
      select user_id from memberships
      where clinic_id in (select my_clinics())
    )
  );

create policy self_update on profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============ per-therapist walk-in duration ============

alter table memberships
  add column default_session_minutes int not null default 45
    check (default_session_minutes > 0);

-- ============ refunds ============

create table refunds (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics on delete cascade,
  payment_id   uuid not null references payments on delete restrict,
  amount       numeric(12,2) not null check (amount > 0),
  reason       text not null check (length(reason) > 0),
  refunded_at  timestamptz not null default now(),
  taken_by     uuid not null references auth.users
);
create index on refunds (clinic_id, payment_id);

-- security definer + row lock, for two reasons at once:
--   1. clinic_id is derived from the referenced payment, never trusted from
--      the client — otherwise an owner/reception of clinic A could insert a
--      refund with clinic_id = A but payment_id belonging to clinic B (the
--      refunds RLS check only validates the clinic_id the row claims, not
--      that it actually matches the payment).
--   2. "select ... for update" on the payment row serializes concurrent
--      refunds against the same payment, so two simultaneous refund requests
--      can't each independently pass the over-refund check and jointly
--      exceed the original amount.
-- Being security definer also means the payment amount lookup is always
-- authoritative, even if the caller can't otherwise see that payment via RLS.
create or replace function refund_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  paid     numeric(12,2);
  already  numeric(12,2);
begin
  select amount, clinic_id into paid, new.clinic_id
    from payments where id = new.payment_id for update;
  if paid is null then
    raise exception 'refund references a payment that does not exist';
  end if;
  select coalesce(sum(amount), 0) into already
    from refunds where payment_id = new.payment_id and id <> new.id;
  if already + new.amount > paid then
    raise exception 'refund exceeds payment: % + % > %', already, new.amount, paid;
  end if;
  return new;
end;
$$;

create trigger trg_refund_guard
  before insert or update of amount, payment_id on refunds
  for each row execute function refund_guard();

alter table refunds enable row level security;
create policy tenant on refunds for all
  using (my_role(clinic_id) in ('owner','reception'))
  with check (my_role(clinic_id) in ('owner','reception'));

-- ============ split-tender ============
-- Rows created in the same checkout action (e.g. part-cash, part-card)
-- share a group_id so the UI can render them as one receipt.

alter table payments add column group_id uuid not null default gen_random_uuid();

-- ============ the debt indicator ============

create view package_balances as
select k.id as package_id, k.clinic_id, k.patient_id,
       k.price - coalesce(sum(
         pay.amount - coalesce((
           select sum(r.amount) from refunds r where r.payment_id = pay.id
         ), 0)
       ), 0) as balance
from packages k
left join payments pay on pay.package_id = k.id
group by k.id, k.clinic_id, k.patient_id, k.price;

-- schema.sql defined leaking_sessions before refunds existed; now that they
-- do, redefine it to also net refunds out of the amount owed (a fully
-- refunded plain-session payment must not count as "already paid").
create or replace view leaking_sessions as
select a.clinic_id, a.id as appointment_id, a.patient_id, p.name, p.phone,
       lower(a.during)::date as session_date,
       a.price - coalesce(sum(
         pay.amount - coalesce((
           select sum(r.amount) from refunds r where r.payment_id = pay.id
         ), 0)
       ), 0) as amount_owed
from appointments a
join patients p on p.id = a.patient_id
left join payments pay on pay.appointment_id = a.id
where a.status = 'attended'
  and a.package_id is null
  and a.price > 0
group by a.clinic_id, a.id, a.patient_id, p.name, p.phone, a.price
having a.price - coalesce(sum(
         pay.amount - coalesce((
           select sum(r.amount) from refunds r where r.payment_id = pay.id
         ), 0)
       ), 0) > 0;

create view patient_balances as
select clinic_id, patient_id, sum(owed) as amount_owed
from (
  select clinic_id, patient_id, amount_owed as owed from leaking_sessions
  union all
  select clinic_id, patient_id, balance as owed
  from package_balances where balance > 0
) x
group by clinic_id, patient_id;

alter view leaking_sessions  set (security_invoker = on);
alter view package_balances  set (security_invoker = on);
alter view patient_balances  set (security_invoker = on);
