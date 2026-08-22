-- Everything Phase 1 needs, in one paste: schema.sql + migrations/0001,
-- 0002 and 0003. This file exists only to make first-time setup a single
-- copy/paste/Run in the Supabase SQL Editor. It is not a migration itself —
-- supabase/schema.sql and supabase/migrations/* remain the source of truth
-- for any future change.
--
-- One deliberate difference from the migrations: 'accountant' is declared in
-- the enum below instead of being added by `alter type ... add value` as
-- 0002 does. The editor runs this paste as one transaction, and a value added
-- by add-value cannot be referenced in the same transaction — the policies at
-- the bottom reference it. A value declared in `create type` has no such
-- restriction, so a fresh install gets the same end state either way.

-- ============================================================
-- schema.sql
-- ============================================================

create extension if not exists btree_gist;

-- ============ tenancy ============

create table clinics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create type clinic_role as enum ('owner', 'reception', 'therapist', 'accountant');

create table memberships (
  user_id    uuid not null references auth.users on delete cascade,
  clinic_id  uuid not null references clinics on delete cascade,
  role       clinic_role not null,
  primary key (user_id, clinic_id)
);

create or replace function my_role(c uuid)
returns clinic_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from memberships where user_id = auth.uid() and clinic_id = c;
$$;

create or replace function my_clinics()
returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select clinic_id from memberships where user_id = auth.uid();
$$;

-- ============ patients ============

create table patients (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics on delete cascade,
  name         text not null,
  phone        text not null,
  birth_date   date,
  consent_at   timestamptz,
  notes        text,
  created_at   timestamptz not null default now()
);
create index on patients (clinic_id, phone);

-- ============ packages ============

create table packages (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics on delete cascade,
  patient_id      uuid not null references patients on delete cascade,
  sessions_total  int  not null check (sessions_total > 0),
  sessions_used   int  not null default 0 check (sessions_used >= 0),
  price           numeric(12,2) not null check (price >= 0),
  expires_at      date,
  created_at      timestamptz not null default now(),
  check (sessions_used <= sessions_total)
);
create index on packages (clinic_id, patient_id);

-- ============ appointments ============

create type appt_status as enum ('booked', 'attended', 'no_show', 'cancelled');

create table appointments (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics on delete cascade,
  patient_id   uuid not null references patients on delete cascade,
  therapist_id uuid not null references auth.users,
  during       tstzrange not null,
  status       appt_status not null default 'booked',
  package_id   uuid references packages,
  price        numeric(12,2) not null default 0 check (price >= 0),
  created_at   timestamptz not null default now(),
  exclude using gist (
    therapist_id with =,
    during       with &&
  ) where (status <> 'cancelled')
);
create index on appointments (clinic_id, lower(during));
create index on appointments (patient_id, lower(during));

-- ============ payments ============

create table payments (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references clinics on delete cascade,
  patient_id     uuid not null references patients on delete cascade,
  package_id     uuid references packages,
  appointment_id uuid references appointments,
  amount         numeric(12,2) not null check (amount > 0),
  method         text not null,
  paid_at        timestamptz not null default now(),
  taken_by       uuid not null references auth.users
);
create index on payments (clinic_id, paid_at);

-- ============ money logic ============

create or replace function consume_package()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'attended' and old.status <> 'attended' and new.package_id is not null then
    update packages set sessions_used = sessions_used + 1 where id = new.package_id;
  elsif old.status = 'attended' and new.status <> 'attended' and new.package_id is not null then
    update packages set sessions_used = sessions_used - 1 where id = new.package_id;
  end if;
  return new;
end;
$$;

create trigger trg_consume_package
  after update of status on appointments
  for each row execute function consume_package();

create or replace function check_appointment_clinic()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pkg_clinic uuid;
  pkg_patient uuid;
begin
  if new.clinic_id <> (select clinic_id from patients where id = new.patient_id) then
    raise exception 'appointment patient belongs to a different clinic';
  end if;
  if new.package_id is not null then
    select clinic_id, patient_id into pkg_clinic, pkg_patient
      from packages where id = new.package_id;
    if new.clinic_id <> pkg_clinic then
      raise exception 'appointment package belongs to a different clinic';
    end if;
    if new.patient_id <> pkg_patient then
      raise exception 'appointment package belongs to a different patient';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_check_appointment_clinic
  before insert or update of patient_id, package_id, clinic_id on appointments
  for each row execute function check_appointment_clinic();

create or replace function check_package_clinic()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.clinic_id <> (select clinic_id from patients where id = new.patient_id) then
    raise exception 'package patient belongs to a different clinic';
  end if;
  return new;
end;
$$;

create trigger trg_check_package_clinic
  before insert or update of patient_id, clinic_id on packages
  for each row execute function check_package_clinic();

create or replace function check_payment_clinic()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pkg_clinic uuid;
  pkg_patient uuid;
  appt_clinic uuid;
  appt_patient uuid;
begin
  if new.clinic_id <> (select clinic_id from patients where id = new.patient_id) then
    raise exception 'payment patient belongs to a different clinic';
  end if;
  if new.package_id is not null then
    select clinic_id, patient_id into pkg_clinic, pkg_patient
      from packages where id = new.package_id;
    if new.clinic_id <> pkg_clinic then
      raise exception 'payment package belongs to a different clinic';
    end if;
    if new.patient_id <> pkg_patient then
      raise exception 'payment package belongs to a different patient';
    end if;
  end if;
  if new.appointment_id is not null then
    select clinic_id, patient_id into appt_clinic, appt_patient
      from appointments where id = new.appointment_id;
    if new.clinic_id <> appt_clinic then
      raise exception 'payment appointment belongs to a different clinic';
    end if;
    if new.patient_id <> appt_patient then
      raise exception 'payment appointment belongs to a different patient';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_check_payment_clinic
  before insert or update of patient_id, package_id, appointment_id, clinic_id on payments
  for each row execute function check_payment_clinic();

-- ============ views (leaking_sessions defined once, correctly, below) ============

create view stale_packages as
select k.clinic_id, k.id as package_id, p.name, p.phone,
       k.sessions_total - k.sessions_used as sessions_left,
       k.expires_at,
       (select max(upper(a.during))::date from appointments a
         where a.package_id = k.id and a.status = 'attended') as last_session
from packages k
join patients p on p.id = k.patient_id
where k.sessions_used < k.sessions_total;

create view noshow_risk as
select clinic_id, patient_id,
       count(*) filter (where status = 'no_show')::numeric
         / nullif(count(*) filter (where status in ('attended','no_show')), 0) as rate,
       count(*) filter (where status in ('attended','no_show')) as history
from appointments
group by clinic_id, patient_id;

-- ============ RLS ============

alter table clinics      enable row level security;
alter table memberships  enable row level security;
alter table patients     enable row level security;
alter table packages     enable row level security;
alter table appointments enable row level security;
alter table payments     enable row level security;

create policy tenant on clinics for select
  using (id in (select my_clinics()));

create policy tenant on memberships for select
  using (clinic_id in (select my_clinics()));

create policy tenant on patients for all
  using (clinic_id in (select my_clinics()))
  with check (clinic_id in (select my_clinics()));

create policy tenant on appointments for all
  using (clinic_id in (select my_clinics()))
  with check (clinic_id in (select my_clinics()));

create policy tenant on packages for all
  using (my_role(clinic_id) in ('owner','reception'))
  with check (my_role(clinic_id) in ('owner','reception'));

create policy tenant on payments for all
  using (my_role(clinic_id) in ('owner','reception'))
  with check (my_role(clinic_id) in ('owner','reception'));

alter view stale_packages set (security_invoker = on);
alter view noshow_risk    set (security_invoker = on);

-- ============================================================
-- migrations/0001_phase1_reception.sql
-- ============================================================

create table profiles (
  id         uuid primary key references auth.users on delete cascade,
  full_name  text not null
);

alter table profiles enable row level security;

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

alter table memberships
  add column default_session_minutes int not null default 45
    check (default_session_minutes > 0);

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

alter table payments add column group_id uuid not null default gen_random_uuid();

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

create view leaking_sessions as
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

-- ============================================================
-- migrations/0002_foundation.sql + 0003_accountant_policies.sql
-- (the enum value itself is already declared above — see the header)
-- ============================================================

alter table clinics
  add column currency char(3) not null default 'EGP'
    check (currency ~ '^[A-Z]{3}$');

-- The accountant sees the till, never the clinical record. Replaces the
-- owner/reception-only policies created above.
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

select 'Phase 1 + foundation schema applied successfully.' as result;
