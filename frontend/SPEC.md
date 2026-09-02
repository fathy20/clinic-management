# SPEC — Phase 1: Foundation

Phase 1 of the Clinic OS plan is *Foundation: tenancy, auth, roles, RLS, design tokens,
base components.* Most of the data half already exists and is verified against the live
Supabase project — see `DEPLOY.md` for the 17 checks that passed. This spec covers only
the real gaps.

**Read `DESIGN.md` before touching any component.** It is the source of truth for every
colour, type and spacing decision, and it explains which rules cannot be bent.

---

## 1. What already exists (do not rebuild)

Verified live, not assumed:

- `clinics`, `memberships`, `patients`, `packages`, `appointments`, `payments`,
  `refunds`, `profiles` — all with `clinic_id`, RLS on, and a policy.
- Cross-tenant isolation: clinic A reading clinic B's patients/payments returns zero
  rows, four different ways.
- `therapist` role excluded from `payments` / `packages` / `refunds`; writes rejected
  with RLS 42501.
- Double-booking refused by the DB (`exclude using gist`).
- Cross-clinic **and** cross-patient linkage guards on appointments/packages/payments.
- `consume_package` and `refund_guard` as `security definer`, so package credit moves
  correctly even when a therapist marks attendance.
- `leaking_sessions` amount-matched via `payments.appointment_id`; `patient_balances`
  aggregating session debt + unpaid package balance.
- Working reception screen: today's column, attendance, split-tender payment, refunds,
  debt badge. Role-gated money actions.

## 2. The actual gaps this phase closes

| Gap | Why it's Phase 1 and not later |
|---|---|
| No design token layer | Every screen built before this exists has to be restyled after. Doing it now is the cheapest it will ever be. |
| No base component set | Seven screens are coming. Without shared primitives each one invents its own row, chip, and button. |
| `accountant` role missing | Roles are in an enum and in RLS policies. Adding a role after finance ships means revisiting every policy. |
| Currency hardcoded to EGP | The brief sells to Cairo, London and Dubai. A currency column added later means backfilling every money display. |
| No keyboard operation | `/` to search, `Esc`, arrows, Enter. Retrofitting focus management across finished screens is far worse than building it in. |

## 3. Deliberate deviations from the brief

**Role stays `therapist`, not `clinician`.** The brief uses "clinician" throughout. The
live database, every policy, `memberships.role`, and the whole reception screen say
`therapist` — and for a physiotherapy clinic that is the more accurate word anyway.
Renaming a live enum value to gain nothing is not worth the migration. `accountant` is
added; `therapist` stays.

**No shadcn/ui install.** The brief names it as the component base. We need six
primitives (row, chip, button, arc, sheet, field), all of which are already written
against the token system in `design/reception-preview.html`. Installing a registry plus
its dependency tree to get six components we'd restyle to the tokens anyway is more
code, not less. 21st.dev is connected and will be used to pull specific components when
one is genuinely non-trivial — a command palette, a virtualised table, a date range
picker. Its generic "stat card" components are exactly the look `DESIGN.md` §9 warns
against.

## 4. Data model changes

New migration: `supabase/migrations/0002_foundation.sql`.

```sql
-- currency per clinic. ISO 4217, so formatting can be derived rather than mapped.
alter table clinics
  add column currency char(3) not null default 'EGP'
    check (currency ~ '^[A-Z]{3}$');

-- accountant: all finance, no clinical notes. Added now so finance-phase
-- policies don't require revisiting every existing policy later.
alter type clinic_role add value 'accountant';
```

`alter type ... add value` cannot run inside a transaction block that later uses the new
value, and Supabase's SQL editor wraps statements — so this migration is two statements
and the policy updates that *use* `'accountant'` go in `0003`, not here. Getting this
wrong produces `unsafe use of new value of enum type`, which reads like a syntax error
and isn't.

Then, in `supabase/migrations/0003_accountant_policies.sql`:

```sql
-- accountant sees the till but never a clinical note (clinical tables land in
-- a later phase; this is the policy shape they will follow).
drop policy tenant on packages;
create policy tenant on packages for all
  using (my_role(clinic_id) in ('owner','reception','accountant'))
  with check (my_role(clinic_id) in ('owner','reception','accountant'));

drop policy tenant on payments;
create policy tenant on payments for all
  using (my_role(clinic_id) in ('owner','reception','accountant'))
  with check (my_role(clinic_id) in ('owner','reception','accountant'));

drop policy tenant on refunds;
create policy tenant on refunds for all
  using (my_role(clinic_id) in ('owner','reception','accountant'))
  with check (my_role(clinic_id) in ('owner','reception','accountant'));
```

## 5. Files

```
app/
  globals.css                 -- REWRITE: the full token system from DESIGN.md,
                                 both themes, on bare :root first
  layout.tsx                  -- EDIT: load Almarai + IBM Plex Sans Arabic +
                                 IBM Plex Mono; keep dir="rtl"
components/ui/
  Button.tsx                  -- variants: primary | quiet | money | danger.
                                 `money` and `danger` are visually distinct from
                                 the rest by design — see DESIGN.md §5
  Chip.tsx                    -- owes | package | risk | new
  Row.tsx                     -- the patient row: time, identity, meta, actions
  Arc.tsx                     -- the signature. props: value, max, size,
                                 tone. 220deg sweep, pathLength=100
  Sheet.tsx                   -- bottom sheet on mobile, centred dialog >=720px.
                                 focus trap, Esc to close, restores focus
  Field.tsx                   -- text/number/select, 44px, tabular for amounts
  Money.tsx                   -- the ONLY component allowed to emit --money.
                                 formats from the clinic's currency, tabular
lib/
  money.ts                    -- format(amount, currency) via Intl.NumberFormat,
                                 Western digits, always 2 decimals
  useHotkeys.ts               -- `/` focus search, Esc close, arrows move queue
app/reception/
  *.tsx                       -- RESTYLE against the tokens + primitives. No
                                 logic changes; the money path is already tested
supabase/migrations/
  0002_foundation.sql
  0003_accountant_policies.sql
tests/
  design-tokens.test.ts       -- every token in globals.css is defined on bare
                                 :root, and every token redefined in a dark block
                                 also exists there; contrast floors hold
  money-format.test.ts        -- EGP/GBP/AED format with Western digits and 2dp
  accountant-role.test.ts     -- accountant sees payments; therapist does not
```

## 5a. Built, and two deviations from the file list above

- `Row.tsx` was not created. The patient row is `app/reception/PatientRow.tsx`
  and reception is its only caller; a second copy in `components/ui/` would be
  an abstraction with one caller. It moves to `components/ui/` the first time
  a second screen needs a row.
- `useHotkeys.ts` was not created. The `/`-Esc-arrows-Enter handling lives in
  `DayBoard.tsx`, which is still its only caller. Same reasoning; extract it
  when the scheduling screen needs the same keys.
- `Field.tsx` was created and exports `Field` + `SelectField`. Every labelled
  control in the three sheets and the login form goes through it. The one
  exception is the queue search input in `DayBoard.tsx`, which needs a ref for
  `/` to focus it.
- `lib/roles.ts` was added (not in the list above): `MONEY_ROLES` /
  `canSeeMoney`, the app-side mirror of the money policies, so the SQL and the
  UI can be asserted to agree instead of drifting.

## 6. Out of scope for this phase

**This list is a record of what Phase 1 deliberately excluded, not a statement
about what exists today.** Several items below were subsequently asked for
directly and are built: clinical records, SOAP and outcome measures (Phase 6),
the examination screen, and the patient portal (Phase 8). `STATUS.md` is the
current picture; this section stays as written so the phase boundary is legible.
Payroll, the RAG assistant, offline and multi-branch are still unbuilt.

Ask before building any of these:

- Scheduling week view, drag-to-move, clinician absence (Phase 3).
- Payroll engine (Phase 4) — including the `compensation_rules` table. It is the
  biggest differentiator in the brief and the most expensive thing to get wrong; it
  gets its own phase and its own spec.
- Finance dashboard, referral attribution (Phase 5).
- Clinical records, SOAP, outcome measures, body chart (Phase 6).
- RAG assistant, `pgvector`, book ingestion (Phase 7). **The books have not been
  uploaded yet** — nothing about ingestion can be specified until the actual formats,
  editions and languages are known.
- Patient portal (Phase 8).
- Any AI feature. Any diagnosis output, ever.
- Offline support. Still deferred; revisit only when a real clinic reports it blocking.
- Multi-branch. `clinics` is already the tenant boundary, so a second branch is a
  second clinic row — a branch *group* is a Phase 5+ question.
- Staff invite UI. Still the manual SQL step flagged in `DEPLOY.md`, and still the
  right thing to fix before a second paying clinic — but it is not Foundation.

## 7. The invariant this phase must not break

> Restyling must not change a single money value, and the money path stays covered.

The reception screen's logic is already tested and verified against the live project.
This phase touches presentation. `npm test` must stay green throughout, and the
`payment-path` and `reception-actions` suites must not be modified to accommodate a
styling change. If a test needs editing to make a restyle pass, the restyle is wrong.

Second, narrower invariant, enforced by `design-tokens.test.ts`:

> No colour may be defined only inside a `@media (prefers-color-scheme)` or
> `[data-theme]` block.

That is the bug that renders one theme's text on the other theme's ground for every
viewer on the default "system" setting — the majority of them.

## 8. Verification

Every item shows real output, not a claim.

1. `npm run build` passes.
2. `npm test` passes, including the three new suites.
3. `0002` then `0003` apply cleanly to the live project; `supabase/tests/test_schema.sql`
   still prints `all checks passed`.
4. **Isolation still holds after the role change.** Re-run the live checks from
   `DEPLOY.md`: clinic A reading clinic B returns zero rows; `therapist` returns zero
   rows from `payments`/`packages`/`refunds`; and the new `accountant` returns rows from
   `payments` but zero from any clinical table. Paste the results.
5. Contrast floors hold: `money on ground >= 4.5` in both themes, computed in the test,
   not eyeballed.
6. Screenshots of the restyled reception screen at **390px** and **1440px**, in **both
   themes**, RTL — matched against `design/reception-preview.html`.
7. Keyboard-only pass: `/` focuses search, arrows move the queue selection, Enter marks
   arrived, `Esc` closes the payment sheet, and focus returns to the row that opened it.
