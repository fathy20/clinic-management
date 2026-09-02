# SPEC — Phase 1: Reception Screen

Goal: stop money leaking. A receptionist sees today's appointments, marks
attendance, takes payments (including split-tender and partial package
payments), issues refunds, and sees at a glance who owes money — in three
taps or fewer per patient.

Priority order if anything conflicts: (1) money leak visibility, (2) no-show
tracking, (3) scheduling clarity, (4) everything else. This spec covers (1)
and the attendance half of (2)/(3) only.

## Decisions locked in the interview

- **Walk-ins** are added directly into today's column, not routed through a
  separate "new patient" screen first.
- **Payment**, per checkout action, supports: multiple methods in one
  operation (split tender), partial/deposit payment on a package (balance
  carries forward), and refunds. A single walk-in session (no package) is
  still normally paid in full in one go, but the mechanism doesn't forbid
  partial — see Non-goals.
- **Debt indicator** is one aggregated number per patient combining (a)
  attended sessions with no linked payment and (b) unpaid balance across all
  packages (price minus net payments after refunds).
- **Attended-without-payment is never blocked.** Marking attendance always
  succeeds; it just increases the patient's debt indicator. No confirmation
  dialog, no soft warning — the receptionist's job is speed, not bookkeeping.
- **Walk-in duration** defaults from a per-therapist setting
  (`memberships.default_session_minutes`), editable at the moment of booking.
- **Refunds** are linked to a specific prior payment and require a reason.
  A refund can partially or fully reverse that payment but never exceed it.
- **Today's view** is one column per therapist, side by side, sorted by time.

## Non-goals for Phase 1 (ask before touching these)

- Clinical notes, SOAP, outcome measures (Phase 4).
- Week/month calendar, drag-to-reschedule (Phase 2 — today's column only).
- Owner dashboard / aggregate reports beyond the per-patient debt indicator
  (Phase 3). `leaking_sessions`, `stale_packages`, `noshow_risk` views already
  exist in `supabase/schema.sql` and are not re-used in the UI yet.
- Offline support. Explicitly deferred — Phase 1 assumes the clinic has
  internet. Revisit only if a real clinic reports this as a blocker.
- Enforcing "session payment must be paid in full" — the schema allows
  partial payment on anything with a `package_id`or without one; a plain
  session (no package) receiving a partial payment just leaves a debt on that
  patient like any other unpaid amount. No special-case validation.
- Printed receipts / PDF invoices — a payment confirmation is on-screen only.
- Editing or deleting a payment/refund after creation (audit trail is
  append-only; a mistaken entry is corrected with a counter-refund or a note,
  not an edit).
- Multi-branch, multi-currency.
- Cancelling/rescheduling an appointment from this screen (booking flow is
  Phase 2); this screen only transitions `booked → attended/no_show`.

## Data model changes

Source of truth is the actual files, not a copy here (an earlier version of
this section duplicated the SQL and drifted out of sync during implementation
— don't repeat that mistake): `supabase/schema.sql` (baseline) and
`supabase/migrations/0001_phase1_reception.sql` (Phase 1 additions). Never
edit either again once applied to a live project; add the next migration.

What's in there, briefly:
- `memberships.default_session_minutes` — per-therapist walk-in duration default.
- `refunds` table, tied to one payment, always reasoned, never exceeding it —
  enforced by `refund_guard()`, which also derives `clinic_id` from the
  payment itself (never trusts the caller) and row-locks the payment during
  the check so concurrent refunds against the same payment can't both pass.
- `payments.group_id` — split-tender rows from one checkout action share it.
- `payments.appointment_id` — links a plain (non-package) payment to the
  specific session it pays for. `leaking_sessions` matches on this, amount by
  amount (not "does some payment exist," which let one trivial payment erase
  unlimited real debt — a bug caught during implementation, not shipped).
- `package_balances`, `patient_balances` — the debt indicator's source views.
- `check_appointment_clinic` / `check_package_clinic` / `check_payment_clinic`
  — cross-tenant AND cross-patient linkage guards. RLS confirms a row's own
  `clinic_id` belongs to the caller; it says nothing about whether a
  *referenced* patient/package/appointment belongs to a different clinic, or
  even a different patient in the *same* clinic. Without these, one patient's
  appointment could consume another patient's package credits.

All of the above were validated end-to-end against a real (embedded, throwaway)
Postgres instance during implementation: schema + migration apply cleanly,
the self-test in `supabase/tests/test_schema.sql` passes, and a scripted RLS
check proved cross-clinic row isolation, therapist exclusion from money
tables, and that `consume_package()` still fires correctly when a *therapist*
(who has no direct write access to `packages`) marks attendance — which
required making it `security definer`, the same fix already applied to
`my_role`/`my_clinics`.

## Files to create

```
app/
  reception/
    page.tsx                 -- server component: loads today's appointments
                                 per therapist, renders columns
    actions.ts                -- server actions: markAttended, markNoShow,
                                 addWalkIn, takePayment, issueRefund
    TherapistColumn.tsx        -- one therapist's sorted list for today
    AppointmentCard.tsx        -- name, time, status, debt badge, tap actions
    WalkInDialog.tsx           -- pick/create patient, pick therapist,
                                 duration (prefilled, editable), optional
                                 package selection
    PaymentDialog.tsx          -- amount, one-or-more (method, amount) rows,
                                 optional package selection for partial pay
    RefundDialog.tsx           -- pick a prior payment, amount, required reason
    DebtBadge.tsx               -- renders patient_balances.amount_owed if > 0
lib/
  supabase/
    server.ts                  -- server-side client (service role never used
                                 here — uses the user's session). No browser
                                 client exists: every read/write in this
                                 phase goes through a server component or
                                 server action, so there was nothing for one
                                 to do — added only when a client component
                                 actually needs direct Supabase access.
  types.ts                     -- hand-written rows for the tables above
proxy.ts                       -- Next.js 16's replacement for middleware.ts:
                                 refreshes the auth cookie, redirects to
                                 /login when unauthenticated
app/login/
  page.tsx, actions.ts         -- not in the original file list, but there is
                                 no reception screen to reach without it —
                                 email/password sign-in only, no self-signup
supabase/
  migrations/
    0001_phase1_reception.sql  -- schema changes, including a `profiles`
                                 table not originally planned: auth.users
                                 isn't exposed to PostgREST, so a therapist's
                                 display name has nowhere else to come from
tests/
  payment-path.test.ts         -- vitest: the invariant below
```

## The invariant Phase 1 must not violate

> An appointment transitioned to `attended` must never end up with **both**
> no payment recorded **and** no package credit consumed, while also
> disappearing from the debt indicator.

Concretely: `markAttended` never writes to `payments`. It only flips
`appointments.status`. The `consume_package` trigger (already in
`schema.sql`) handles package credit. If there's no `package_id`, the
`leaking_sessions` view (already in `schema.sql`) picks it up automatically
via `patient_balances`. The test proves the view catches it, not that the
server action tries to prevent it — prevention isn't the design, visibility
is.

## User flows

**Walk-in.** Receptionist taps "+ Walk-in" → search existing patient by
phone or create new (name, phone, consent checkbox required — sets
`consent_at`) → pick therapist → duration prefilled from
`memberships.default_session_minutes`, editable → optional: attach to an
existing package with credits left → appointment inserted with
`during = tstzrange(now(), now() + duration)`, `status = 'booked'`. If the
therapist is already booked for that slot, the DB's exclusion constraint
rejects the insert; the UI surfaces "الأخصائي محجوز في هذا الوقت" and asks
for a different time or therapist.

**Attendance.** One tap on the appointment card cycles `booked → attended`
or `booked → no_show`. This calls `markAttended`/`markNoShow`, nothing else.
No payment prompt is forced.

**Payment (full or split-tender).** From the appointment card or a
patient's debt badge, open `PaymentDialog`. Add one or more (method, amount)
rows; rows are inserted as separate `payments` rows sharing one `group_id`.
Optionally target a specific `package_id` (partial/deposit payment) or leave
it null (plain session payment).

**Refund.** From a patient's payment history, pick a payment, enter amount
and required reason. Insert into `refunds`; the trigger rejects
over-refunding.

**Debt indicator.** Rendered from `patient_balances.amount_owed` next to the
patient's name, wherever it appears on this screen. Zero or missing row =
no badge.

## Verification (must show actual output, not "should work")

1. `npm run build` passes — paste the output.
2. `npx supabase db reset && psql $DB -f supabase/migrations/0001_phase1_reception.sql` applies cleanly on top of `schema.sql`.
3. `psql $DB -f supabase/tests/test_schema.sql` — all `raise notice` checks pass, including the three new ones above.
4. `npm test` — `payment-path.test.ts` passes.
5. **Isolation test**, run against a real (non-mocked) Supabase project with two clinics and the anon key: authenticated as a clinic-A user, reading clinic-B's `patients`, `appointments`, `payments`, and `refunds` returns zero rows for all four. A `therapist`-role user in their own clinic gets zero rows from `payments`, `packages`, and `refunds`. Paste the query results.
6. End-to-end manual walkthrough against the real project: add a walk-in, mark it attended without paying, confirm it shows up under that patient's debt badge, take a split-tender payment (cash + card) against it, confirm the badge clears, then issue a partial refund and confirm the badge reflects it.
