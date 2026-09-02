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
