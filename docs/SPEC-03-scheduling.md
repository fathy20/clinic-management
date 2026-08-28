# Phase 3 — Scheduling (shipped)

The gap this closed: **the system could not book tomorrow.** Reception could only
add a walk-in "from right now". No clinic runs that way — a physiotherapy patient
books a course of treatment weeks ahead.

## What shipped

- `/schedule` — a week view, Saturday-first, one column per day, filterable by
  therapist. `?week=YYYY-MM-DD` is deep-linkable.
- Book a single future session.
- **Book a plan of care**: "12 sessions, Sundays and Wednesdays at 10:00".
- A **dry run before committing**: reception sees which sessions of a plan clash,
  and with whom, before anything is written.
- Move a session (date and time), cancel a session.
- One nav component across reception and schedule; `TopBar` was folded into
  `NavBar`.

## Decisions

**No migration.** A plan of care is already modelled: it is a package. Twelve
sessions sharing one `package_id` *are* the course of treatment, and the package
already carries the sessions total, the price and the credit counter. A separate
`plans` table would have duplicated all of it. The ceiling: a recurring booking
with no package has nothing grouping its rows, so "cancel the whole course" only
works for packaged plans. Revisit if pay-per-session courses turn out to be
common.

**All clinic-local time reasoning moved to `lib/clinic-time.ts`.** It was
previously inline in `app/reception/page.tsx`, and `tests/clinic-timezone.test.ts`
had a *copy* of it — which meant the test could pass while the app was broken.
Both now use the one module.

**Every occurrence of a plan converts its own wall clock.** Egypt reinstated DST
in 2023. Generating "same time next week" by adding 7×24h moves a 10:00 session
to 09:00 or 11:00 across a transition, and the patient arrives an hour out. A
12-session course starting in late March crosses the change, and the test asserts
two distinct UTC offsets appear while every session still reads 10:00 local.

**One insert per session, not a batch.** A single batch insert loses the whole
course to one clash and leaves reception guessing which session was the problem.
Twelve sessions with two clashes now books ten and names the two.

**A packaged session is priced at zero, in the server action.** The package was
already paid for; charging at the door would double-bill. The client's `price` is
ignored when a `packageId` is present, and a negative price is floored at zero.

**Cancel is a status change, never a delete.** The row is what proves a slot was
held, and if the session had been marked attended, the `consume_package` trigger
hands the package credit back on the way out.

**A move preserves the session's own length.** Read from the stored range via
`rangeMinutes()`. An earlier draft defaulted to 45 minutes, which would have
silently stretched a 30-minute slot over whatever followed it.

## Deliberately not in this phase

- **Clinician absence** (mark a day unavailable, then resolve every affected
  appointment three ways). Same phase in the original brief, but it is a feature
  with its own flows and it needs its own spec.
- Drag-to-move. The date/time fields in the session sheet do the same job; drag
  is polish, and on a tablet it fights scrolling.
- An hour-by-hour lattice. Day columns are the unit reception thinks in; an
  8am–8pm grid is mostly whitespace.
- A price list / service catalogue. Reception types the price at booking, written
  by the server action with the DB's `check (price >= 0)` behind it. A catalogue
  belongs with finance.
- Room/resource booking. The exclusion constraint is per therapist only.

## Verified

`npm run build` clean. `npm test` — 94 passing across 8 files.

Against the live Supabase project, with the real `lib/clinic-time.ts`:

| Check | Result |
|---|---|
| 12-session plan books 12 rows | pass |
| Double-booking the same slot refused by the database (`23P01`) | pass |
| Back-to-back session accepted — half-open ranges are correct | pass |
| Every session reads back as 10:00 clinic-local, no drift | pass |
| Week grid renders 7 days, today highlighted, existing sessions shown | pass |

The DST crossing is proven by unit test (two offsets, same wall clock). The live
run happened to pick a range that missed Egypt's April transition by two days, so
it did not exercise it — worth re-running against a March–May range.

## Still outstanding

- **Migrations `0002` and `0003` are written but not applied.** `clinics.currency`
  and the `accountant` role are absent from the live database. The app degrades
  cleanly (currency falls back to `EGP`), but the accountant role does not exist
  yet. Both need a paste into the SQL editor.
