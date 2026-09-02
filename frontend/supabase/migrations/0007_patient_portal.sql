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
