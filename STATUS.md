# Where the build actually is

Every "verified" below was run, not assumed, and the command that produced it is
named. `npm run build` clean, `npx tsc --noEmit` clean, `npm test` —
**341 passing across 20 files**.

Two things to read before trusting anything else here:

1. **Nine migrations are written and not applied to the live project** (`0002`
   through `0010`). The live database runs `schema.sql` + `0001` and nothing
   more — confirmed by querying it, not inferred. Everything marked *dark*
   below is built and tested but switched off until they land.
2. **Verification that needs the live project is marked as such.** Anything the
   live project cannot verify yet was proved against a real Postgres instead
   (`embedded-postgres`, no Docker, no sudo), and that is stated where it
   applies. Nothing here rests on "should work".

## Shipped

| Surface | Route | State |
|---|---|---|
| Sign in | `/login` | verified live |
| Reception day | `/reception` | verified live — attendance, split payments, refunds, walk-ins, clinic-wide patient search |
| Schedule | `/schedule` | verified live — week view, single booking, plan of care, move, cancel, package credit guard |
| Patient record | `/patients/[id]` | verified live — history, upcoming, packages, payments, balance net of refunds |
| Money (owner home) | `/finance` | verified live — money-leak first, earned/deferred/receivable/credit, reconciliation check, full export |
| Settings | `/settings` | verified live — add and remove staff, roles, clinic currency/timezone/tax |
| Platform admin | `/admin` | verified live — all clinics, activity feed, allowlist-gated |
| Clinical day | `/clinical` | built, **dark** until `0005` — visit list, written-up state, recovery trend |
| Examination | `/clinical/exam` | built, **dark** until `0005` — 7 regions × 5 disciplines, renders findings into SOAP prose |
| Consent + read audit | on `/patients/[id]` | built, **dark** until `0010` — per-purpose consent, and who opened which record |
| Receipt | `/receipts/[id]` | built, **dark** until `0009` — numbered, printable, per-clinic tax basis |
| Patient portal | `/portal/[token]` | built, **dark** until `0007` — appointments, home exercises, balance; no clinical record, ever |

**The owner and accountant land on `/finance`; everyone else lands on
`/reception`.** The money-leak report is the first element on that page, per the
positioning mandate — it is the product's argument for its own subscription.

**Roles hold on every route.** Crawled page by page with real sessions for an
owner and a therapist: the therapist gets *"This account cannot see clinic
finances"* on `/finance`, *"Only an owner can manage the team"* on `/settings`,
and is refused `/admin` — with zero money-shaped digits anywhere in the returned
HTML. Not inferred from the policy.

## The parts that are load-bearing

**Tenant isolation.** Every table carries `clinic_id`, has RLS on, and has a
policy in the same migration. Cross-tenant reads return zero rows four different
ways. The only code that bypasses RLS is `lib/supabase/admin.ts`, which is
`import "server-only"` — a client component importing it fails the build, and a
test asserts no `sb_secret_` appears in any git-tracked file or client bundle.

**Money.** No monetary value is computed in the browser and trusted. A packaged
session is priced at zero in the server action whatever the client sends.
`consume_package` and `refund_guard` are `security definer` — the first so
package credit still moves when a *therapist* marks attendance, the second with
a `for update` row lock so two simultaneous refunds cannot jointly exceed the
payment. `leaking_sessions` amount-matches against `payments.appointment_id`
rather than guessing from dates; an earlier version let one trivial payment
erase unlimited real debt.

**The ledger reconciles or says it doesn't.** `collected = (earned − receivable)
+ deferred + credit`, asserted as an identity on every render. Cash that names
neither a package nor a session used to fall out of both branches and vanish
from the total — the one number an owner checks by hand.

**Double-booking is refused by Postgres**, not the UI —
`exclude using gist (therapist_id with =, during with &&)`. Confirmed live:
`23P01` on a clash, and back-to-back sessions accepted because the ranges are
half-open.

**A receipt is a document, not a view.** `issue_receipt` (`0009`) allocates the
number by incrementing the clinic row under its own lock, so six concurrent
issues produce a gapless run with no duplicates — proved on a real Postgres.
Currency, rate, label and regime are copied onto the row at issue time: a clinic
that becomes taxable next year must not silently rewrite receipts already handed
to patients. `subtotal + tax_amount = total` is a check constraint, and the tax
is the remainder after rounding the net rather than rounded separately, so a
receipt can never be a piastre short of the drawer. There is no insert, update
or delete policy on the table at all — the function is the only way a row
appears, and issuing twice returns the same document without burning a number.

**A guard trigger cannot be defeated by RLS hiding the row.** Every table
referencing a patient carries a trigger asserting the row belongs to the same
clinic — and the lookup inside it reads a row RLS exists to hide, so without
`security definer` the subquery returns NULL, the comparison is NULL rather than
true, and the guard passes the exact row it was written to refuse. It is
invisible unless the test acts as a real clinic user; a harness inserting as
superuser bypasses RLS and the guard looks fine. `tests/cross-clinic-guards.test.ts`
now fails if any guard that reads another table is not definer, if a definer
function has no pinned `search_path`, or if a role is gated with a bare
`not in` — the NULL-role bug that shipped twice.

**Consent is four questions, not a tick.** Per purpose (treatment, records
storage, WhatsApp contact, insurer disclosure), with the method and **the exact
wording the patient was shown** stored, because consent is only informed if the
wording is recoverable later. Every column but the withdrawal pair is immutable,
there is no delete policy, a withdrawal cannot be undone, and `has_consent()`
answers in the database so the screen cannot disagree with the policy.

**The audit trail now covers reads.** `phi_access_log` records clinic, actor,
patient uuid, surface and time — and nothing else, per `CLAUDE.md`: an audit log
that quotes the record it protects is a second copy of the thing that needed
protecting. Insert and select only, so not even the owner can prune or backdate
it. Staff cannot log a read as a colleague (`actor = auth.uid()`), and the
portal — which has no logged-in user — writes through a function that takes no
actor at all and always records null, so it cannot forge a staff read.

**A clinic cannot be left ownerless.** The last-owner check is inside the write
(`demote_member`, `0008`), not a count followed by an update. Proved on a real
Postgres with two concurrent transactions each demoting the other: the second
blocks, then is refused, and the clinic keeps an owner.

**Clinic-local time is one module.** `lib/clinic-time.ts`. Egypt reinstated DST
in 2023, so every "same time next week" goes through the zone database: a
12-session plan crossing the April change keeps its 10:00 slot, proven by a test
asserting two distinct UTC offsets appear.

**A feature that is switched off says so.** `lib/migration-gate.ts`. An
unapplied migration used to look exactly like no data — `/clinical` rendered
"0 written up" for every patient, which a therapist reads as their notes being
lost. Every read of a post-baseline table now names the migration instead. The
classifier was run against the live project's own error bodies, not invented
ones.

## Known gaps, in the order they hurt

0. **Patient health data is stored outside Egypt.** PDPL Article 16 requires a
   PDPC permit to transfer personal data abroad; **Supabase has no Middle East
   region at all**, so no available option is Egypt. Executive Regulations took
   effect 1 November 2025 with a one-year grace period, so **full enforcement is
   expected 31 October 2026.** Penalties reach EGP 5,000,000 and imprisonment.
   This is a decision plus legal advice, not a ticket — the options are set out
   in `docs/RESEARCH-GLOBAL-GAP.md` §0.1. Migration `0010` builds the part every
   option needs regardless.

1. **The nine migrations.** `supabase/apply_pending.sql` is three pastes, in
   the order the enum forces; the split is load-bearing and a harness proves one
   paste still fails with `unsafe use of new value`. Applying them turns on
   `/clinical`, `/clinical/exam`, `/portal`, home exercises, the accountant
   role, receipts, and saving clinic settings. Until then those surfaces name
   the migration rather than looking broken.

2. **No statutory e-invoicing.** `0009` issues a numbered receipt with the
   clinic's own tax basis, and says on its face that it is not a tax invoice.
   What is *not* built is transmission to a tax authority — ETA in Egypt,
   ZATCA in Saudi. `clinics.invoice_regime` records which regime a clinic
   files under so the integration has somewhere to hang, and Egypt's ETA
   threshold fell to EGP 250,000 of annual revenue — roughly 800 sessions —
   so this becomes real for a growing clinic. Each regime is its own
   integration and its own spec.

3. **No payroll engine.** Phase 4 in `SPEC.md`, still unwritten, still the
   biggest differentiator in the brief and the most expensive thing to get
   wrong. It needs its own spec before any table.

4. **No price list.** Reception types the session price at booking. Fine today,
   wrong once a clinic has more than one service at more than one rate.

5. **No clinician absence handling.** A therapist calls in sick and reception
   moves each appointment by hand. Needs a table, so a migration too.

6. **Money-truth vs billing are two different numbers, deliberately.**
   `patient_balances` says a patient owes the full price of a package they were
   sold; `lib/revenue.ts` says nothing is receivable until treatment is
   delivered. Both are correct — one is billing, one is earned revenue. Any
   future report must label which it means rather than reconciling them.

7. **The write audit trail still attributes by guess.** Reads are now logged
   (`0010`), but `app/admin/activity.ts` reconstructs "who did what" from
   `payments.taken_by`, `refunds.taken_by` and `created_at`. Patients,
   appointments and packages carry no actor column, so those entries are
   attributed to the clinic owner — a labelled guess, not a claim about a
   person. There is also no owner-facing screen for `phi_access_log` yet; the
   data is being collected and can be queried, but nobody can read it in the UI.

8. **No RAG assistant.** The reference books have not been uploaded, so nothing
   about ingestion — formats, editions, languages — can be specified yet. No AI
   feature states a diagnosis, now or later.

9. **Offline.** Still deferred. Revisit when a real clinic reports it blocking.

10. **Screenshots and a keyboard-only pass** are the two `SPEC.md` §8
    acceptance items never carried out; there is no browser in this environment
    to run them.

## Deliberate deviations from the original brief

- **The role stays `therapist`, not `clinician`.** The live database, every
  policy and the whole reception screen say `therapist`, and for a
  physiotherapy clinic it is the more accurate word. Renaming a live enum value
  to gain nothing is not worth the migration.
- **No shadcn/ui.** Six primitives were needed and are written against the
  design tokens. Installing a registry and its dependency tree to get six
  components we would restyle anyway is more code, not less.
- **A plan of care is a package, not a new table.** Twelve sessions sharing one
  `package_id` *are* the course of treatment, and the package already carries
  the total, the price and the credit counter.
- **Chinese medicine has no exam protocol.** `lib/exam-protocols.ts` covers
  physiotherapy, osteopathy, sports injury, movement analysis and nutrition.
  TCM is deliberately absent: its protocols need authoring by a TCM
  practitioner, and inventing them would be the one thing the brief forbids.
- **Platform admin sees no PHI.** It shows how the business runs, not who is
  being treated for what. See `docs/PLATFORM-ADMIN.md`; the legal research
  behind that call was cut short and a lawyer should confirm it before a second
  clinic signs.

## Applying the database

- **New Supabase project** — `supabase/deploy_all.sql`, one paste. Verified to
  produce a database identical to the migration path: 21 relations, 168 columns,
  34 policies, 233 functions, 208 constraints, 15 triggers, 25 enum labels and 6
  `security_invoker` views all match, and both SQL self-tests pass on it. That
  comparison is not decoration — it caught `deploy_all.sql` carrying a
  pre-fix copy of a guard trigger that the migration had already corrected.
- **Existing Phase 1 project** — `supabase/apply_pending.sql`, three pastes in
  order.
- **Source of truth is neither.** `supabase/schema.sql` and
  `supabase/migrations/*` are; the two paste files are convenience copies, and
  `tests/deploy-files.test.ts` fails if either falls behind.

## Docs

- `DESIGN.md` — the token system, with the verified contrast table
- `SPEC.md` — Phase 1 foundation, as specified at the time
- `docs/SPEC-01-reception.md` — the reception spec, as shipped
- `docs/SPEC-03-scheduling.md` — the scheduling spec, as shipped
- `COMPETITORS.md` — the competitive position and the positioning mandate
- `docs/PLATFORM-ADMIN.md` — why `/admin` is a separate surface, and what it withholds
- `docs/RESEARCH-GLOBAL-GAP.md` — what the global systems have that we don't,
  with a BUILD / LATER / NO verdict per feature for Egypt, the PDPL and ETA
  findings, and the WhatsApp cost model
- `DEPLOY.md` — first-run setup and the isolation checks
