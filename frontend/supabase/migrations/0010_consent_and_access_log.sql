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
