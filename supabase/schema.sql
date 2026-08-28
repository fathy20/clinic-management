-- Physio SaaS — core schema (multi-tenant, Supabase/Postgres)
-- Run once in the SQL editor. Every table is tenant-scoped + RLS-on from birth.

create extension if not exists btree_gist;

-- ============ tenancy ============

create table clinics (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create type clinic_role as enum ('owner', 'reception', 'therapist');

create table memberships (
  user_id    uuid not null references auth.users on delete cascade,
  clinic_id  uuid not null references clinics on delete cascade,
  role       clinic_role not null,
  primary key (user_id, clinic_id)
);

-- Wrapped in (select ...) at call sites so Postgres evaluates once per query,
-- not once per row. This is the difference between fast and unusable.
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
  consent_at   timestamptz,          -- Law 151/2020: explicit consent, health data is "sensitive"
  notes        text,
  created_at   timestamptz not null default now()
);
create index on patients (clinic_id, phone);

-- ============ packages (the physio-specific bit) ============

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
  price        numeric(12,2) not null default 0 check (price >= 0),  -- 0 when covered by package
  created_at   timestamptz not null default now(),

  -- Double-booking is refused by the database, not by the UI. Two receptionists
  -- clicking at the same millisecond both lose. Only one row survives.
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
  appointment_id uuid references appointments,  -- which plain (non-package) session this pays for, if any
  amount         numeric(12,2) not null check (amount > 0),
  method         text not null,
  paid_at        timestamptz not null default now(),
  taken_by       uuid not null references auth.users
);
create index on payments (clinic_id, paid_at);

-- ============ money logic lives here, not in the client ============

-- security definer: package credit must be adjusted regardless of who marks
-- attendance. A therapist can mark attendance (packages RLS restricts them
-- from writing packages directly, owner/reception only) but the resulting
-- credit consumption is a system-level consequence, not a user-initiated
-- financial write — without this, the UPDATE below would silently match
-- zero rows under a therapist's RLS context and the credit would never move.
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

-- Cross-tenant linkage guards: RLS confirms a row's own clinic_id belongs to
-- the caller, but says nothing about whether a *referenced* patient/package
-- lives in a different clinic entirely. FK constraints alone don't enforce
-- "same clinic," so without these, clinic_id in (select my_clinics()) alone
-- would let clinic A attach clinic B's patient to an appointment. Security
-- definer so the check is authoritative even when the caller's own RLS
-- would hide the referenced row (which would otherwise make the comparison
-- silently NULL instead of failing).
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
    -- clinic match alone isn't enough: two patients in the same clinic have
    -- different packages, and consume_package() trusts package_id blindly.
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
    -- otherwise patient A's payment could silently clear patient B's
    -- specific-appointment leak in leaking_sessions.
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

-- ============ the two views that answer "where is my money" ============

-- Attended, package-less sessions with a positive balance still owed —
-- amount-matched against payments linked to this specific appointment, not
-- a fuzzy "did this patient pay something around this date" heuristic (which
-- let one trivial unrelated payment erase an unlimited amount of real debt).
-- Redefined in migrations/0001 once refunds exist, to also net those out.
create view leaking_sessions as
select a.clinic_id, a.id as appointment_id, a.patient_id, p.name, p.phone,
       lower(a.during)::date as session_date,
       a.price - coalesce(sum(pay.amount), 0) as amount_owed
from appointments a
join patients p on p.id = a.patient_id
left join payments pay on pay.appointment_id = a.id
where a.status = 'attended'
  and a.package_id is null
  and a.price > 0
group by a.clinic_id, a.id, a.patient_id, p.name, p.phone, a.price
having a.price - coalesce(sum(pay.amount), 0) > 0;

-- Packages the clinic was paid for but never delivered (liability + churn signal).
create view stale_packages as
select k.clinic_id, k.id as package_id, p.name, p.phone,
       k.sessions_total - k.sessions_used as sessions_left,
       k.expires_at,
       (select max(upper(a.during))::date from appointments a
         where a.package_id = k.id and a.status = 'attended') as last_session
from packages k
join patients p on p.id = k.patient_id
where k.sessions_used < k.sessions_total;

-- no-show risk = the patient's own history, nothing else.
-- Beats a cold-start ML model and costs one view. Swap in a trained model
-- once you have ~5k finished appointments per clinic and it beats this.
create view noshow_risk as
select clinic_id, patient_id,
       count(*) filter (where status = 'no_show')::numeric
         / nullif(count(*) filter (where status in ('attended','no_show')), 0) as rate,
       count(*) filter (where status in ('attended','no_show')) as history
from appointments
group by clinic_id, patient_id;

-- ============ RLS — nothing below this line is optional ============

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

-- Therapists treat patients; they do not see the till.
create policy tenant on packages for all
  using (my_role(clinic_id) in ('owner','reception'))
  with check (my_role(clinic_id) in ('owner','reception'));

create policy tenant on payments for all
  using (my_role(clinic_id) in ('owner','reception'))
  with check (my_role(clinic_id) in ('owner','reception'));

alter view leaking_sessions set (security_invoker = on);
alter view stale_packages   set (security_invoker = on);
alter view noshow_risk      set (security_invoker = on);
