# Physio SaaS

Multi-tenant clinic management for physiotherapy clinics in Egypt. Solo maintainer.

## Stack
Next.js (App Router) + TypeScript + Supabase (Postgres/Auth/RLS/Storage) + Tailwind.
No ORM — `supabase-js` and SQL. No state library — server components + `useState`.

## Commands
- `npm run dev` / `npm run build`
- `npm test` — Vitest
- `npx supabase db push` — apply migrations
- `npx supabase db reset && psql $DB -f supabase/tests/test_schema.sql` — schema self-check

## NON-NEGOTIABLE — data isolation
YOU MUST follow these. A breach here ends the product.
1. Every new table with clinic data has `clinic_id uuid not null references clinics`,
   `enable row level security`, and a policy gated on `clinic_id in (select my_clinics())`.
   A table without a policy is invisible, which looks like a bug and gets "fixed" by disabling RLS. Never disable RLS.
2. Every view over tenant data sets `security_invoker = on`. Views bypass RLS by default.
3. `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never in a client component, never in `NEXT_PUBLIC_*`.
4. Money mutations (package decrement, invoice totals, price) happen in Postgres
   triggers/functions or server actions — never computed client-side and trusted.
5. Patient health data is "sensitive" under Egypt Law 151/2020. No PHI in logs,
   no PHI in error messages sent to third parties, no PHI in analytics events.

## Conventions
- Read `supabase/migrations/` before proposing schema changes. Never edit an applied migration; add a new one.
- Prefer a DB constraint over app-level validation (see the `exclude using gist` on appointments).
- Arabic-first UI, `dir="rtl"`, but code/comments/commits in English.
- Prices are `numeric(12,2)`, never float. Currency is EGP.

## Scope discipline
Build the smallest thing that works. No abstraction with one caller, no config for a
constant, no "for later" scaffolding. If a feature isn't in the current SPEC.md, ask
before building it.

## Definition of done
Not done until you show evidence: the test output, the command you ran and what it
returned. "Should work" is not done.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
