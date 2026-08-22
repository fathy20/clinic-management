# Going to production

## Status: Phase 1 is live on a real Supabase project

Project `qasonherbwrbzlrdzegk` is set up and verified end-to-end. Done:

- Schema + Phase 1 migration applied (all 8 tables, all views, all triggers).
- One clinic ("My Clinic") with an owner account and a therapist account.
- `.env.local` written with the project URL + publishable key.
- The app runs, login works, and the reception screen renders real data from
  this project — not a mock.

Verified against the live project, with real user sessions and the
publishable (anon) key, not the secret key:

| Check | Result |
|---|---|
| Clinic A owner reading all patients / clinic B's patients / payments / by-id | 0 rows every time |
| Therapist reading their own clinic's patients | visible (correct) |
| Therapist reading payments / packages / refunds | 0 rows |
| Therapist writing a payment | rejected (RLS 42501) |
| Double-booking the same therapist+slot | rejected by the DB (23P01) |
| Attaching another clinic's patient to an appointment | rejected (P0001) |
| Therapist marks attendance on a package session | credit consumed correctly |
| Reverting that attendance | credit restored |
| Attended unpaid 300 session | shows as 300 owed |
| After 150 partial payment | shows 150 owed |
| After 40 refund | shows 190 owed |
| Over-refunding a payment | rejected (P0001) |
| Full payment | debt badge disappears |
| Owner sees payment/refund buttons | yes |
| Therapist sees payment/refund buttons | no |

All test data was deleted afterwards. The project now holds one clinic, two
staff accounts, and zero patients/appointments/payments.

### If you ever rebuild this from scratch

`supabase/deploy_all.sql` is schema + migration in one paste-and-Run file for
the SQL Editor. `supabase/schema.sql` and `supabase/migrations/` remain the
source of truth for future changes — add a new migration, never edit an
applied one.

### Rotate the secret key

The `sb_secret_...` key was used once, from the terminal, to create the first
clinic and staff accounts (the `clinics` table has no INSERT policy by design,
so no API key without RLS bypass can seed it). It was never written to any
file in this repo — `grep -rn sb_secret` returns nothing outside documentation.
Still, it appeared in a chat transcript, so rotate it: Project Settings → API
→ Secret keys → rotate. Nothing in the app uses it, so nothing breaks.

## Deploy

This is a stock Next.js 16 App Router project — Vercel auto-detects it.
`vercel --prod` or connect the repo in the Vercel dashboard.

Set these two environment variables in the host (Production + Preview) —
the same values already in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

No other build config is needed.

## Add your staff

There's no invite UI in Phase 1 (deliberately — see SPEC.md Non-goals). For
each reception/therapist account:
1. Authentication → Users → add them (email + password), or have them sign
   up if you enable that — Phase 1 doesn't build a signup screen either, so
   for now this also happens from the dashboard.
2. `insert into memberships (user_id, clinic_id, role) values (..., ..., 'reception' | 'therapist');`

This is the actual gap to plan for next: right now, onboarding a new staff
member is a manual SQL step for you, the owner. Fine for one clinic; not fine
once you're selling this as a SaaS product to clinics who don't have you on
call. Worth scoping as its own small feature before a second real clinic
signs up — an "invite a teammate" flow that some role can run from the UI
that doesn't already require them to have your Supabase dashboard access, but
this isn't in Phase 1 and shouldn't be built until it's actually needed.

## What's already been hardened, so you're not re-deriving it

- Every table with clinic data enforces RLS; no exceptions.
- `security_invoker = on` on every view — none of them silently bypass RLS.
- Money-mutating triggers (`consume_package`, `refund_guard`) are
  `security definer` so they work correctly regardless of which role
  (owner/reception/therapist) triggered them, but user-facing writes to
  `packages`/`payments`/`refunds` are still RLS-gated to owner/reception.
- Cross-tenant AND cross-patient linkage guards on appointments/packages/
  payments — a patient/package can't be attached to the wrong clinic *or* the
  wrong patient within the same clinic.
- `leaking_sessions` matches payments to sessions by an actual `appointment_id`
  foreign key and compares amounts, not "does any payment exist nearby."
- No service-role key anywhere in the app code (grep for it if you ever doubt it).
- Refunds can't exceed their payment even under concurrent requests (row-locked).
- Next.js is pinned to 16.3.2, which is patched against CVE-2026-27978
  (Server Actions CSRF bypass via a null `Origin` header) — don't downgrade
  below 16.2.0.
- Today's column is bounded by the clinic's real timezone offset read from the
  zone database, not a hardcoded `+2`. Egypt reinstated DST in 2023, so a
  fixed offset files late-evening appointments under the wrong day for half
  the year. `tests/clinic-timezone.test.ts` pins this.
