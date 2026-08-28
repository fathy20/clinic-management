# Platform admin — security model

`/admin` is the only surface in this product that can see across clinics. It is
also the only code that bypasses Row Level Security. Read this before changing
anything under `lib/supabase/admin.ts` or `app/admin/`.

## Why it is a separate surface, not an RLS clause

The obvious implementation is to add a bypass to every tenant policy:

```sql
-- NOT what we do
using (clinic_id in (select my_clinics()) or (select is_platform_admin()))
```

That was rejected. It puts a bypass path *inside* the mechanism that keeps
clinics apart, in eight places. A mistake in any one of them leaks another
clinic's data, and the mistake is invisible during normal use because every
ordinary query still returns the right rows. The verified isolation model —
17 live checks in `DEPLOY.md` — would have to be re-earned on every future
policy edit.

Instead: the eight tenant policies are untouched, and cross-clinic reads live
in one server-only module. There is a single file to audit, and if it is wrong
the failure is loud rather than silent.

## What guards it

Four layers, in order:

1. **`import "server-only"`** at the top of `lib/supabase/admin.ts`. If any
   client component ever imports it, the **build fails**. This is the hard
   guarantee — the others are conventions, this one is enforced by the
   compiler.
2. **`SUPABASE_SECRET_KEY` has no `NEXT_PUBLIC_` prefix.** Anything with that
   prefix is inlined into the browser bundle. `tests/secret-containment.test.ts`
   asserts the prefix never appears, that the variable is referenced from
   exactly one file, and that no live key is in any git-tracked file.
3. **`requirePlatformAdmin()` takes no arguments.** It resolves the caller from
   the session cookie via the ordinary RLS-bound client, then checks that email
   against `PLATFORM_ADMIN_EMAILS`. A caller cannot pass in an identity.
4. **`adminClient()` is only constructed after the gate returns ok.** Asserted
   by a test that checks the call order in `app/admin/page.tsx`.

Fails closed: no allowlist configured means nobody gets in, not everybody.

## What it deliberately does NOT show

Patient names, phone numbers, and clinical data are not on this page. A
platform admin sees **how the business is running** — clinics, staff counts,
patient counts, appointment volume, money collected and outstanding, and who
performed which financial action.

This is a deliberate product decision, not an oversight:

- The vendor is a **processor**, not the controller, of the clinics' patient
  data. Casually browsable patient health records across customer clinics is
  the kind of access a clinic would refuse to sign, and health data is
  classified as sensitive personal data under Egypt's Law 151/2020.
- Support work almost never needs the patient's name. It needs to know that a
  payment posted, a package decremented, an appointment saved.

**If PHI access is ever genuinely needed**, the pattern to implement is
time-limited, customer-approved, audited support access — not widening this
page. That is a feature with its own spec, not a one-line change.

> **The legal research behind this is incomplete.** The comparison of Egypt
> 151/2020, UK GDPR Art. 28 and UAE requirements was cut short and never
> finished. The design above is the conservative choice, but **get a lawyer to
> confirm the processor obligations and the audit-logging requirement before
> selling to a second clinic.** Do not treat this file as legal advice.

## The activity feed and its ceiling

"Who did what" is reconstructed from records the app already writes:
`payments.taken_by`/`paid_at`, `refunds.taken_by`/`refunded_at`, and the
`created_at` on patients, appointments and packages. That gives a real trail
with no new table.

Two honest limits:

- **It only covers writes**, and only to those five tables. It cannot show who
  *read* a patient record — and reads are exactly what a health-data audit log
  is eventually expected to cover.
- **Patients, appointments and packages carry no actor column**, so those
  entries are attributed to the clinic's owner rather than the specific person.
  That is a guess, and it is labelled as the clinic's activity rather than a
  claim about an individual.

Upgrade path: an append-only `audit_log` table written by triggers, with
actor, action, target, timestamp and reason. At that point `app/admin/activity.ts`
becomes a reader over that table instead of a reconstruction. This is the right
next step before commercial launch.

## Operating it

```bash
# .env.local — server-side only
SUPABASE_SECRET_KEY=sb_secret_...
PLATFORM_ADMIN_EMAILS=you@example.com,cofounder@example.com
```

Removing `PLATFORM_ADMIN_EMAILS` disables the console entirely. Rotate
`SUPABASE_SECRET_KEY` from the Supabase dashboard if it is ever exposed —
it grants full read/write on every table, ignoring RLS.

## Verified

Run against the live project, both roles, output in the session log:

| Check | Result |
|---|---|
| Platform admin reaches `/admin`, sees all clinics and the activity feed | pass |
| Non-admin (therapist) gets the refusal, zero clinic rows, zero activity rows | pass |
| No session at all → redirected to `/login` | pass |
| Secret key absent from every served HTML response | pass |
| `tests/secret-containment.test.ts` — 9 assertions | pass |
