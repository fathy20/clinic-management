-- ONE PASTE, WHOLE DATABASE — for a clinic that has none yet.
--
-- schema.sql + every migration in supabase/migrations, in order, ending in the
-- exact state a fully migrated clinic runs. Use this for a NEW Supabase
-- project. For a project that already has the Phase 1 baseline, use
-- supabase/apply_pending.sql instead — it applies only what is missing, in the
-- three steps that ordering requires.
--
-- This file is not a migration and is not a source of truth: schema.sql and
-- supabase/migrations/* are. It exists so first-time setup is one copy/paste.
-- A test asserts every migration on disk is represented here, because the
-- failure mode is silent — this file stopped at 0003 for four migrations, and
-- a clinic deployed from it would have had no clinical record, no patient
-- portal, and a money surface that still allowed deletes.
--
-- One deliberate difference from the migrations: 'accountant' is declared in
-- `create type` below rather than added by `alter type ... add value` as 0002
-- does. The editor runs this paste as one transaction, and a value added by
-- add-value cannot be referenced in the same transaction — the policies below
-- reference it. Declaring it up front has no such restriction, and a fresh
-- install reaches the same end state either way.

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
-- migrations/0002_foundation.sql
-- ============================================================

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
-- (the accountant enum value is declared in `create type` at the top of
--  this file instead; see the header for why)

-- ============================================================
-- migrations/0003_accountant_policies.sql
-- ============================================================

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

-- ============================================================
-- migrations/0004_clinic_locale_and_tax.sql
-- ============================================================

-- The four settings that cannot be retrofitted.
--
-- Gulf expansion needs ZATCA (Saudi) or the UAE equivalent, and both are
-- invoice-format-and-tax problems before they are anything else. Egypt needs
-- ETA e-invoicing, whose registration threshold fell to EGP 250,000 of annual
-- revenue — a three-therapist clinic clears that on roughly 800 sessions a
-- year, so this is a live obligation, not a future one.
--
-- Currency arrived in 0002. Timezone, tax and locale join it here, because
-- every one of them is currently a constant in the code and each becomes a
-- rewrite the day a clinic outside Cairo signs. The application already reads
-- all four through lib/clinic-context.ts with fallbacks, so applying this
-- changes behaviour for new clinics without breaking existing ones.

-- IANA name, not an offset. Egypt reinstated DST in 2023; a stored "+02:00"
-- is wrong for half the year and silently files late-evening appointments
-- under the wrong day.
alter table clinics
  add column timezone text not null default 'Africa/Cairo'
    check (length(timezone) > 0);

-- The UI language, and with it the text direction. Per clinic rather than per
-- deployment, so one instance can serve an Arabic clinic in Cairo and an
-- English one in Dubai.
alter table clinics
  add column locale char(2) not null default 'ar'
    check (locale in ('ar', 'en'));

-- Tax as a rate plus a label, not a hardcoded VAT. Egypt applies no VAT to
-- most private medical services today, Saudi applies 15%, the UAE 5% — and a
-- clinic that becomes taxable must be able to say so without a deploy.
-- numeric(5,4) holds 0.1500 exactly; a float would not.
alter table clinics
  add column tax_rate numeric(5,4) not null default 0
    check (tax_rate >= 0 and tax_rate <= 1);

alter table clinics
  add column tax_label text not null default '';

-- Which statutory e-invoicing regime this clinic files under. 'none' until a
-- clinic crosses a threshold; the integration itself is a later phase, but
-- the column has to exist before invoices are numbered, because retro-fitting
-- a regime onto issued invoices is not possible.
create type invoice_regime as enum ('none', 'eta_eg', 'zatca_sa', 'uae');

alter table clinics
  add column invoice_regime invoice_regime not null default 'none';

-- Sequential per clinic, because every regime requires gapless numbering
-- scoped to the issuer. Kept on the clinic row rather than derived from a
-- count so that a deleted or voided invoice cannot reuse a number.
alter table clinics
  add column next_invoice_number bigint not null default 1
    check (next_invoice_number > 0);

-- ============================================================
-- migrations/0005_clinical_records.sql
-- ============================================================

-- The clinician's own surface. Until now the system served reception, the
-- owner, the accountant and the platform — the person actually delivering the
-- treatment had no place to record it.
--
-- This is the competitive gap: the global tools are clinically deep and
-- locally blind, the MENA tools are locally fluent and clinically generic.
-- Outcome measures and structured notes in Arabic are the half nobody has.

-- ============ SOAP notes ============
--
-- Four columns rather than one free-text blob, because the whole point is
-- "copy from last visit and change what moved" — and that only works if the
-- parts are separable. Most physiotherapy visits are near-identical
-- follow-ups; documentation burden is the loudest complaint in the category.

create table soap_notes (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references clinics on delete cascade,
  patient_id      uuid not null references patients on delete cascade,
  -- The visit this documents. Nullable so a clinician can write up a phone
  -- consultation or a note that belongs to no booked session.
  appointment_id  uuid references appointments on delete set null,
  therapist_id    uuid not null references auth.users,
  subjective      text not null default '',
  objective       text not null default '',
  assessment      text not null default '',
  plan            text not null default '',
  -- The template it started from, kept so the clinic can see which templates
  -- are actually used and which are dead weight.
  template        text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A note with nothing in it is not a record; it is an accident.
  check (
    length(subjective) + length(objective) + length(assessment) + length(plan) > 0
  )
);

create index on soap_notes (clinic_id, patient_id, created_at desc);
create index on soap_notes (appointment_id);

-- Same clinic as the patient it documents. RLS proves the row's own clinic_id
-- belongs to the caller; it says nothing about whether the *referenced*
-- patient lives somewhere else.
create or replace function check_note_clinic()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.clinic_id <> (select clinic_id from patients where id = new.patient_id) then
    raise exception 'note patient belongs to a different clinic';
  end if;
  if new.appointment_id is not null
     and new.clinic_id <> (select clinic_id from appointments where id = new.appointment_id) then
    raise exception 'note appointment belongs to a different clinic';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_check_note_clinic
  before insert or update on soap_notes
  for each row execute function check_note_clinic();

-- ============ outcome measures ============
--
-- The measures are text with a check constraint rather than an enum. Adding a
-- sixth measure later is then a one-line migration, where extending an enum
-- and using the new value cannot share a transaction with the code that reads
-- it — a hazard this project has already been bitten by.
--
-- max_score is stored per row, not looked up: an instrument's scale is part of
-- the historical record, and a future edition that rescales must not silently
-- rewrite what a patient scored three years ago.

create table outcome_measures (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics on delete cascade,
  patient_id    uuid not null references patients on delete cascade,
  therapist_id  uuid not null references auth.users,
  kind          text not null check (kind in ('NPRS','PSFS','ODI','DASH','BERG','SixMWT')),
  score         numeric(6,2) not null check (score >= 0),
  max_score     numeric(6,2) not null check (max_score > 0),
  -- Lower is better for pain and disability, higher is better for function.
  -- Stored so a chart can be drawn without a lookup table the UI has to keep
  -- in step with this one.
  lower_is_better boolean not null default true,
  note          text not null default '',
  recorded_at   timestamptz not null default now(),
  check (score <= max_score)
);

create index on outcome_measures (clinic_id, patient_id, kind, recorded_at);

create or replace function check_measure_clinic()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.clinic_id <> (select clinic_id from patients where id = new.patient_id) then
    raise exception 'measure patient belongs to a different clinic';
  end if;
  return new;
end;
$$;

create trigger trg_check_measure_clinic
  before insert or update of patient_id, clinic_id on outcome_measures
  for each row execute function check_measure_clinic();

-- ============ RLS ============
--
-- Who sees a clinical note is a different question from who sees the till,
-- and the two must not be the same list:
--
--   owner      — everything, including notes
--   therapist  — notes, because they write them
--   reception  — NO. Reception books and takes money; a receptionist has no
--                clinical reason to read an assessment, and Law 151/2020
--                treats health data as sensitive.
--   accountant — NO. Explicitly finance-only, per the role definition.

alter table soap_notes       enable row level security;
alter table outcome_measures enable row level security;

create policy clinical on soap_notes for all
  using (my_role(clinic_id) in ('owner','therapist'))
  with check (my_role(clinic_id) in ('owner','therapist'));

create policy clinical on outcome_measures for all
  using (my_role(clinic_id) in ('owner','therapist'))
  with check (my_role(clinic_id) in ('owner','therapist'));

-- ============ the recovery view ============
--
-- First and latest score per patient per instrument, with the change between
-- them. "Is this patient getting better" is the question a clinician and an
-- owner both ask, and answering it in SQL keeps the arithmetic in one place.
--
-- security_invoker so it inherits the policies above rather than bypassing
-- them — a view over tenant data without this is the single most common way
-- everything leaks.

create view recovery_progress as
select
  m.clinic_id,
  m.patient_id,
  m.kind,
  m.lower_is_better,
  min(m.recorded_at) as first_recorded,
  max(m.recorded_at) as last_recorded,
  count(*)           as readings,
  (array_agg(m.score order by m.recorded_at))[1]                as first_score,
  (array_agg(m.score order by m.recorded_at desc))[1]           as latest_score,
  (array_agg(m.max_score order by m.recorded_at desc))[1]       as max_score,
  -- Signed so that positive always means improvement, whichever direction the
  -- instrument runs. A caller that had to know the direction itself would get
  -- it wrong for one measure out of six.
  case when m.lower_is_better
    then (array_agg(m.score order by m.recorded_at))[1]
         - (array_agg(m.score order by m.recorded_at desc))[1]
    else (array_agg(m.score order by m.recorded_at desc))[1]
         - (array_agg(m.score order by m.recorded_at))[1]
  end as improvement
from outcome_measures m
group by m.clinic_id, m.patient_id, m.kind, m.lower_is_better;

alter view recovery_progress set (security_invoker = on);

-- ============================================================
-- migrations/0006_immutable_money.sql
-- ============================================================

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

-- ============================================================
-- migrations/0007_patient_portal.sql
-- ============================================================

-- The patient's own view, and the home exercise programme it exists to carry.
--
-- Patients are not in auth.users and have no login. Asking an Egyptian
-- physiotherapy patient to create an account and remember a password is
-- asking them not to use it — the channel that actually reaches them is a
-- WhatsApp message, so the portal is a long unguessable link rather than a
-- sign-in.
--
-- That makes the link a credential, and it is treated as one:
--
--   * only a SHA-256 hash is stored, never the token, so a database leak does
--     not hand out portal access to every patient at once;
--   * a token is revocable, and revoking is a row update rather than a delete
--     so the audit trail survives;
--   * last_seen_at records use without recording what was read — enough to
--     spot a link that has escaped, without building a tracking log.

create table patient_portal_tokens (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references clinics on delete cascade,
  patient_id   uuid not null references patients on delete cascade,
  -- sha256 hex of the token handed to the patient
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  issued_by    uuid not null references auth.users,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_seen_at timestamptz
);

create index on patient_portal_tokens (clinic_id, patient_id);

create or replace function check_portal_token_clinic()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.clinic_id <> (select clinic_id from patients where id = new.patient_id) then
    raise exception 'portal token patient belongs to a different clinic';
  end if;
  return new;
end;
$$;

create trigger trg_check_portal_token_clinic
  before insert or update of patient_id, clinic_id on patient_portal_tokens
  for each row execute function check_portal_token_clinic();

-- ============ home exercise programme ============
--
-- The thing a patient actually opens the link for. Prescribed by a clinician,
-- read by the patient, and the single most-requested feature missing from the
-- generalist clinic software in this market.

create table exercise_prescriptions (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics on delete cascade,
  patient_id    uuid not null references patients on delete cascade,
  therapist_id  uuid not null references auth.users,
  name          text not null check (length(trim(name)) > 0),
  -- Written for the patient, not for the notes: "hold the wall, heel down,
  -- straight back knee" rather than "gastrocnemius stretch 3x30s".
  instructions  text not null default '',
  sets          int,
  reps          int,
  hold_seconds  int,
  -- "twice a day", "every other day" — free text on purpose, because a
  -- structured frequency that cannot express what the clinician means gets
  -- worked around in the instructions field anyway.
  frequency     text not null default '',
  -- A link the clinic already has somewhere, not a video library we host.
  video_url     text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  check (sets is null or sets > 0),
  check (reps is null or reps > 0),
  check (hold_seconds is null or hold_seconds > 0),
  -- A URL shown to a patient must not be a javascript: or data: payload.
  check (video_url is null or video_url ~ '^https?://')
);

create index on exercise_prescriptions (clinic_id, patient_id, active);

create or replace function check_prescription_clinic()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.clinic_id <> (select clinic_id from patients where id = new.patient_id) then
    raise exception 'prescription patient belongs to a different clinic';
  end if;
  return new;
end;
$$;

create trigger trg_check_prescription_clinic
  before insert or update of patient_id, clinic_id on exercise_prescriptions
  for each row execute function check_prescription_clinic();

-- ============ RLS ============
--
-- Neither table is reachable by the patient through RLS: they have no session
-- and therefore no role. The portal reads them server-side after verifying a
-- token, scoped to the one patient that token belongs to — the same
-- discipline as the platform console, in lib/portal.ts.
--
-- These policies are about the *staff* view.

alter table patient_portal_tokens   enable row level security;
alter table exercise_prescriptions  enable row level security;

-- Issuing a link is a front-desk or clinical act; an accountant has no reason
-- to hand out access to a patient's record.
create policy read on patient_portal_tokens for select
  using (my_role(clinic_id) in ('owner','reception','therapist'));

create policy add on patient_portal_tokens for insert
  with check (my_role(clinic_id) in ('owner','reception','therapist'));

-- Revoking is an update, and the only update this table allows. No delete: a
-- token that was issued and then withdrawn is exactly what you want on the
-- record if a link ever escapes.
create policy revoke on patient_portal_tokens for update
  using (my_role(clinic_id) in ('owner','reception','therapist'))
  with check (my_role(clinic_id) in ('owner','reception','therapist'));

-- Exercises are clinical. Reception books and takes money; it does not
-- prescribe. The patient reads them through the portal, not through RLS.
create policy read on exercise_prescriptions for select
  using (my_role(clinic_id) in ('owner','therapist'));

create policy add on exercise_prescriptions for insert
  with check (my_role(clinic_id) in ('owner','therapist'));

create policy amend on exercise_prescriptions for update
  using (my_role(clinic_id) in ('owner','therapist'))
  with check (my_role(clinic_id) in ('owner','therapist'));

-- No delete: retiring an exercise sets active = false, so the patient's
-- history of what they were asked to do survives.

-- ============================================================
-- migrations/0008_demote_member.sql
-- ============================================================

-- Demoting a member, with the last-owner guard inside the write.
--
-- The application used to count owners and then update, which is a race: two
-- owners demoting each other in the same moment both read a count of 2, both
-- proceed, and the clinic is left with nobody who can administer it. Recovery
-- from that needs direct SQL access.
--
-- Doing the count and the update in one statement makes Postgres resolve it:
-- the second transaction sees the first one's effect and its own guard fails.
create or replace function demote_member(
  p_clinic uuid,
  p_user   uuid,
  p_role   clinic_role
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed int;
begin
  -- Security definer, so the caller's own privileges are bypassed — which
  -- means this function must check them itself. Only an owner OF THIS CLINIC
  -- may demote anyone in it.
  -- `is distinct from`, not `<>`. my_role() returns NULL for someone with no
  -- membership in this clinic at all, and `NULL <> 'owner'` is NULL, not true
  -- — so plain inequality let a complete stranger through this check. They
  -- then updated nothing and got a plain `false` back, which reads as "last
  -- owner" rather than "not yours". A live harness caught it.
  if my_role(p_clinic) is distinct from 'owner' then
    raise exception 'only an owner can change a role in this clinic';
  end if;

  if p_role = 'owner' then
    raise exception 'demote_member is for removing owner, not granting it';
  end if;

  with owners as (
    select user_id from memberships
    where clinic_id = p_clinic and role = 'owner'
    for update
  )
  update memberships m
     set role = p_role
   where m.clinic_id = p_clinic
     and m.user_id = p_user
     -- the row survives only if it is not the clinic's last owner
     and (m.role <> 'owner' or (select count(*) from owners) > 1);

  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

-- The function is the only way in, so revoke the blanket EXECUTE Postgres
-- grants to PUBLIC on every new function. A security definer function in a
-- schema the API exposes is otherwise a public endpoint.
revoke all on function demote_member(uuid, uuid, clinic_role) from public;
grant execute on function demote_member(uuid, uuid, clinic_role) to authenticated;

-- ============================================================
-- migrations/0009_receipts.sql
-- ============================================================

-- A NUMBERED RECEIPT FOR MONEY ALREADY TAKEN.
--
-- 0004 added tax_rate, tax_label, invoice_regime and next_invoice_number, and
-- nothing read them. A clinic could take cash and hand the patient nothing.
--
-- This is a receipt, not a statutory e-invoice. It does not claim ETA, ZATCA or
-- UAE compliance and does not transmit anything to a tax authority — those are
-- separate integrations per regime. What it does is the part that cannot be
-- retrofitted: allocate a gapless per-clinic number and freeze the tax basis at
-- the moment of issue.
--
-- Why the numbers and amounts are frozen on the row rather than read live:
-- every regime requires that an issued document never changes. A clinic that
-- becomes taxable next year, or corrects its tax label, must not silently
-- rewrite the tax on receipts already handed to patients. So currency, rate,
-- label and regime are copied here at issue time. That duplication is the
-- point, not an oversight.

create table receipts (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics on delete cascade,
  patient_id  uuid not null references patients on delete cascade,

  -- One receipt per payment. A double-clicked button must not produce two
  -- documents for the same money, and it must not burn a number either — see
  -- issue_receipt below, which returns the existing row instead of inserting.
  payment_id  uuid not null references payments on delete cascade unique,

  -- Gapless within the clinic. Allocated by incrementing the clinic row under
  -- its own lock, never by counting receipts: a count reuses a number the
  -- moment anything is voided.
  number      bigint not null check (number > 0),

  issued_at   timestamptz not null default now(),
  issued_by   uuid references auth.users,

  -- total is what the patient actually paid. subtotal + tax_amount = total,
  -- exactly, enforced below.
  subtotal    numeric(12,2) not null check (subtotal >= 0),
  tax_amount  numeric(12,2) not null check (tax_amount >= 0),
  total       numeric(12,2) not null check (total > 0),

  -- The basis, frozen. Not a join to clinics.
  currency    char(3) not null check (currency ~ '^[A-Z]{3}$'),
  tax_rate    numeric(5,4) not null check (tax_rate >= 0 and tax_rate <= 1),
  tax_label   text not null default '',
  regime      invoice_regime not null default 'none',

  constraint receipt_number_unique_per_clinic unique (clinic_id, number),

  -- The arithmetic is a constraint, not a convention. A receipt whose parts do
  -- not add up is worse than no receipt.
  constraint receipt_adds_up check (subtotal + tax_amount = total)
);

create index receipts_clinic_number on receipts (clinic_id, number desc);
create index receipts_patient on receipts (clinic_id, patient_id);

alter table receipts enable row level security;

-- Money roles only. A therapist has no business in the till, and the receipt
-- carries an amount.
create policy receipts_read on receipts for select
  using (clinic_id in (select my_clinics())
         and my_role(clinic_id) in ('owner','reception','accountant'));

-- No insert policy, no update policy, no delete policy — deliberately.
--
-- Issuing goes through issue_receipt() below, which is the only way a row can
-- appear. That keeps number allocation and the tax snapshot in one place
-- instead of trusting whatever the application sends. An issued financial
-- document is never updated and never deleted; a mistake is corrected by a
-- refund, which is itself an append-only record.

-- A receipt must not point at another clinic's payment or patient. The same
-- guard shape as appointments, packages and payments already use.
-- security definer, and NOT optional. Without it the function runs with the
-- caller's own RLS, so the lookup below cannot SEE another clinic's patient row
-- and returns NULL — making the comparison NULL rather than true, and letting
-- exactly the row this guard exists to refuse straight through. A live harness
-- caught it: every earlier guard in this schema is definer for the same reason.
-- `is distinct from` rather than `<>` so a NULL can never read as "no problem".
create or replace function check_receipt_clinic()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select clinic_id from payments where id = new.payment_id)
     is distinct from new.clinic_id then
    raise exception 'receipt payment belongs to a different clinic';
  end if;
  if (select clinic_id from patients where id = new.patient_id)
     is distinct from new.clinic_id then
    raise exception 'receipt patient belongs to a different clinic';
  end if;
  return new;
end;
$$;

create trigger receipt_clinic_guard
  before insert or update on receipts
  for each row execute function check_receipt_clinic();

-- ============================================================
-- Issuing.
--
-- security definer because it writes the clinic's invoice counter and inserts
-- into a table with no insert policy. That means it must check the caller
-- itself, which it does — `my_role` reads auth.uid(), so this is the caller's
-- own role, not the definer's.
-- ============================================================

create or replace function issue_receipt(p_payment uuid)
returns receipts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pay      payments;
  cl       clinics;
  existing receipts;
  out_row  receipts;
  n        bigint;
  gross    numeric(12,2);
  net      numeric(12,2);
  vat      numeric(12,2);
begin
  select * into pay from payments where id = p_payment;
  if pay.id is null then
    raise exception 'no such payment';
  end if;

  -- The caller's role in the payment's OWN clinic. No clinic is accepted as an
  -- argument, so there is no clinic for a caller to name but theirs.
  --
  -- coalesce, not a bare `not in`: my_role returns NULL for someone with no
  -- membership in this clinic, and `NULL not in (...)` is NULL rather than
  -- true, so a plain check lets a complete stranger straight through. That
  -- exact mistake was caught by a live harness in 0008.
  if coalesce(my_role(pay.clinic_id)::text, '') not in ('owner', 'reception', 'accountant') then
    raise exception 'only the till can issue a receipt in this clinic';
  end if;

  -- Idempotent. A double-clicked button returns the document that already
  -- exists rather than issuing a second one for the same money — and, just as
  -- importantly, without consuming another number.
  select * into existing from receipts where payment_id = p_payment;
  if existing.id is not null then
    return existing;
  end if;

  -- The clinic row is locked for the duration, which is what makes the number
  -- gapless under concurrency: two receptionists issuing at once serialise
  -- here instead of both reading the same next_invoice_number.
  select * into cl from clinics where id = pay.clinic_id for update;

  n := cl.next_invoice_number;
  update clinics set next_invoice_number = n + 1 where id = cl.id;

  -- The amount collected is the gross: it is what the patient handed over. So
  -- tax is extracted from it rather than added to it.
  --
  -- The tax is computed as the REMAINDER after rounding the net, not rounded
  -- independently. Rounding both and hoping they sum is how a receipt ends up
  -- a piastre short of the money in the drawer, and the receipt_adds_up
  -- constraint would then reject it.
  gross := pay.amount;
  net   := round(gross / (1 + cl.tax_rate), 2);
  vat   := gross - net;

  insert into receipts (
    clinic_id, patient_id, payment_id, number, issued_by,
    subtotal, tax_amount, total,
    currency, tax_rate, tax_label, regime
  ) values (
    pay.clinic_id, pay.patient_id, pay.id, n, auth.uid(),
    net, vat, gross,
    cl.currency, cl.tax_rate, cl.tax_label, cl.invoice_regime
  )
  returning * into out_row;

  return out_row;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, and this one is
-- security definer in a schema the API exposes — so the default grant would
-- make it a public endpoint.
revoke all on function issue_receipt(uuid) from public;
grant execute on function issue_receipt(uuid) to authenticated;

revoke all on function check_receipt_clinic() from public;

-- ============================================================
-- migrations/0010_consent_and_access_log.sql
-- ============================================================

-- PDPL GROUNDWORK: purpose-specific consent, and a log of who READ what.
--
-- Egypt's PDPL (Law 151/2020) Article 14 requires explicit consent for
-- sensitive personal data, and health data is sensitive. The Executive
-- Regulations (Decree 816/2025) took effect 1 November 2025 with a one-year
-- grace period, so full enforcement is expected 31 October 2026. Penalties for
-- processing sensitive data without consent run to EGP 500,000–5,000,000 and
-- imprisonment from three months.
--
-- Two things were missing, and both are needed whichever way the data-residency
-- question is answered — so neither is wasted work.
--
-- 1. `patients.consent_at` is a single timestamp. Consent under the PDPL has to
--    be explicit, informed, and SPECIFIC TO A PURPOSE. One timestamp cannot say
--    whether a patient agreed to be messaged on WhatsApp, or to have their file
--    disclosed to an insurer. Those are different questions and a patient may
--    answer them differently.
--
-- 2. The audit trail covered writes only. It could say who took a payment and
--    never who OPENED a patient's clinical record — and reads are exactly what a
--    health-data audit log exists to cover.
--
-- `patients.consent_at` is deliberately left alone. It is the record that
-- treatment consent was taken at registration, it is referenced by screens
-- already, and rewriting live history to fit a new model would destroy the
-- evidence it holds. New consents are recorded here from now on.

-- ============================================================
-- Consent, per purpose.
-- ============================================================

-- Named purposes rather than free text. A free-text purpose cannot be queried
-- for "may we message this patient", which is the question the code needs to
-- ask before it sends anything.
create type consent_purpose as enum (
  'treatment',           -- to assess and treat, and to keep the clinical record
  'records_storage',     -- to store that record, including outside Egypt if so
  'whatsapp_messaging',  -- to be contacted on WhatsApp about appointments
  'insurance_disclosure' -- to disclose the file to a named insurer or TPA
);

-- How the consent was obtained. Article 14 wants explicit and documented; a
-- verbal nod recorded by staff is weaker evidence than a signature, and the
-- record should say which it was rather than flatten them together.
create type consent_method as enum (
  'in_person_signature',
  'portal',
  'verbal_witnessed'
);

create table consents (
  clinic_id   uuid not null references clinics on delete cascade,
  patient_id  uuid not null references patients on delete cascade,
  purpose     consent_purpose not null,
  method      consent_method not null,

  granted_at  timestamptz not null default now(),
  -- The staff member who obtained it. Accountability runs to a person.
  granted_by  uuid references auth.users,

  -- What the patient was actually told. Consent is only informed if the wording
  -- shown to them is recoverable afterwards, so the wording is stored, not a
  -- version number pointing at a document that may have changed.
  wording     text not null check (length(trim(wording)) > 0),

  -- Withdrawal. The PDPL gives the data subject the right to withdraw, so this
  -- has to be expressible — but the grant itself is never erased, because the
  -- fact that processing WAS lawful for a period is itself the record.
  withdrawn_at timestamptz,
  withdrawn_by uuid references auth.users,

  id          uuid primary key default gen_random_uuid(),

  constraint withdrawn_after_granted
    check (withdrawn_at is null or withdrawn_at >= granted_at)
);

-- The current answer to "may we do X for this patient" is the newest row for
-- that purpose, so that lookup has to be fast.
create index consents_current
  on consents (clinic_id, patient_id, purpose, granted_at desc);

alter table consents enable row level security;

-- Clinical and front-desk staff need to know whether consent exists — reception
-- before sending a reminder, a therapist before treating. The accountant has no
-- clinical need to know.
create policy consents_read on consents for select
  using (clinic_id in (select my_clinics())
         and my_role(clinic_id) in ('owner','reception','therapist'));

create policy consents_record on consents for insert
  with check (clinic_id in (select my_clinics())
              and my_role(clinic_id) in ('owner','reception','therapist')
              and granted_by = auth.uid());

-- Withdrawal is the ONLY permitted update, which is why it is its own policy
-- rather than a `for all`. The trigger below enforces what may change.
create policy consents_withdraw on consents for update
  using (clinic_id in (select my_clinics())
         and my_role(clinic_id) in ('owner','reception','therapist'))
  with check (clinic_id in (select my_clinics())
              and my_role(clinic_id) in ('owner','reception','therapist'));

-- No delete policy. A consent record is evidence.

create or replace function consent_write_guard()
returns trigger language plpgsql as $$
begin
  -- Every column except the withdrawal pair is immutable. Without this, the
  -- update policy that exists for withdrawal would also allow rewriting the
  -- wording a patient agreed to, which is the one field whose whole value is
  -- that it cannot change after the fact.
  if new.clinic_id  is distinct from old.clinic_id
     or new.patient_id is distinct from old.patient_id
     or new.purpose    is distinct from old.purpose
     or new.method     is distinct from old.method
     or new.granted_at is distinct from old.granted_at
     or new.granted_by is distinct from old.granted_by
     or new.wording    is distinct from old.wording
     or new.id         is distinct from old.id then
    raise exception 'a recorded consent cannot be altered, only withdrawn';
  end if;

  -- Withdrawal happens once. Un-withdrawing would mean the record no longer
  -- shows that the patient objected; a fresh consent is a new row.
  if old.withdrawn_at is not null and new.withdrawn_at is distinct from old.withdrawn_at then
    raise exception 'this consent is already withdrawn';
  end if;

  if new.withdrawn_at is not null and new.withdrawn_by is null then
    raise exception 'a withdrawal must record who actioned it';
  end if;

  return new;
end;
$$;

create trigger consent_immutable
  before update on consents
  for each row execute function consent_write_guard();

-- security definer, and NOT optional. Without it the function runs with the
-- caller's own RLS, so the lookup below cannot SEE another clinic's patient row
-- and returns NULL — making the comparison NULL rather than true, and letting
-- exactly the row this guard exists to refuse straight through. A live harness
-- caught it: every earlier guard in this schema is definer for the same reason.
-- `is distinct from` rather than `<>` so a NULL can never read as "no problem".
create or replace function check_consent_clinic()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select clinic_id from patients where id = new.patient_id)
     is distinct from new.clinic_id then
    raise exception 'consent patient belongs to a different clinic';
  end if;
  return new;
end;
$$;

create trigger consent_clinic_guard
  before insert or update on consents
  for each row execute function check_consent_clinic();

-- The question the application asks. A purpose is consented if the newest row
-- for it was granted and not withdrawn.
create or replace function has_consent(p_patient uuid, p_purpose consent_purpose)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    (select c.withdrawn_at is null
       from consents c
      where c.patient_id = p_patient
        and c.purpose = p_purpose
      order by c.granted_at desc
      limit 1),
    false
  );
$$;

-- security invoker, deliberately: the caller sees only their own clinic's
-- consents through RLS, so a caller in another clinic gets `false` rather than
-- an answer about a patient they cannot see.

-- ============================================================
-- Who read what.
-- ============================================================

-- The surfaces that display patient health data. An enum rather than free text
-- so the log can be grouped and so a typo cannot create a phantom surface.
create type phi_surface as enum (
  'patient_record',
  'clinical_day',
  'examination',
  'receipt',
  'patient_portal',
  'export'
);

create table phi_access_log (
  id          bigserial primary key,
  clinic_id   uuid not null references clinics on delete cascade,

  -- Nullable because the patient portal is reached with a link, not a login:
  -- there is no auth.users row behind it. A null actor with surface
  -- 'patient_portal' means the patient themselves.
  actor       uuid references auth.users,

  -- CLAUDE.md: "Log the patient UUID, nothing else." No name, no phone, no
  -- diagnosis — an audit log that quotes the record it is protecting is a
  -- second copy of the thing that needed protecting.
  patient_id  uuid not null references patients on delete cascade,

  surface     phi_surface not null,
  at          timestamptz not null default now()
);

-- The two questions this table exists to answer: everything about one patient,
-- and everything one member of staff did.
create index phi_access_by_patient on phi_access_log (clinic_id, patient_id, at desc);
create index phi_access_by_actor   on phi_access_log (clinic_id, actor, at desc);

alter table phi_access_log enable row level security;

-- Only the owner reads the audit log. It records what staff did, so it is not
-- something staff should be browsing about each other, and the accountant has
-- no reason to see which patients exist at all.
create policy phi_access_read on phi_access_log for select
  using (clinic_id in (select my_clinics()) and my_role(clinic_id) = 'owner');

-- Anyone who can open a record can write their own line in the log, and only
-- their own: `actor = auth.uid()` means a member of staff cannot attribute a
-- read to a colleague.
create policy phi_access_write on phi_access_log for insert
  with check (clinic_id in (select my_clinics()) and actor = auth.uid());

-- No update policy and no delete policy, for the obvious reason: an audit log
-- whose subject can edit it is not an audit log. Not even the owner may prune
-- it — that is the point of having it.

-- Definer for the same reason as check_consent_clinic above.
create or replace function check_phi_access_clinic()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select clinic_id from patients where id = new.patient_id)
     is distinct from new.clinic_id then
    raise exception 'access log patient belongs to a different clinic';
  end if;
  return new;
end;
$$;

create trigger phi_access_clinic_guard
  before insert on phi_access_log
  for each row execute function check_phi_access_clinic();

-- The portal has no logged-in user, so its own reads cannot satisfy
-- `actor = auth.uid()`. This is the one writer that runs as definer, and it
-- takes no actor argument at all — it always records a null actor, so it
-- cannot be used to forge a staff read.
create or replace function log_portal_access(p_patient uuid, p_clinic uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The pairing is verified rather than trusted: a caller cannot log a read of
  -- a patient against a clinic that is not theirs.
  if (select clinic_id from patients where id = p_patient) is distinct from p_clinic then
    raise exception 'access log patient belongs to a different clinic';
  end if;

  insert into phi_access_log (clinic_id, actor, patient_id, surface)
  values (p_clinic, null, p_patient, 'patient_portal');
end;
$$;

revoke all on function log_portal_access(uuid, uuid) from public;
grant execute on function log_portal_access(uuid, uuid) to anon, authenticated;

revoke all on function consent_write_guard() from public;
revoke all on function check_consent_clinic() from public;
revoke all on function check_phi_access_clinic() from public;

select 'Whole database applied — schema + migrations 0001 to 0010.' as result;
