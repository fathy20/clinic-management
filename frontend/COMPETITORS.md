# Competitive position

Two tiers, and they do not overlap. That non-overlap is the whole opportunity.

## Global tier — clinically deep, locally blind

| Product | Price | Real strength | Real weakness |
|---|---|---|---|
| **WebPT** | ~$99+/provider/mo, add-ons à la carte | US market leader, Medicare documentation, PT-specific from day one | Repeated price rises, support complaints, reported outages, features unbundled and sold separately |
| **Jane App** | CAD $54–99/practitioner | Best UX in the category, strong booking and charting | Weak financial reporting, payments processor made mandatory in 2026, one-way calendar sync, per-practitioner pricing penalises growth |
| **Cliniko** | Flat, unlimited practitioners | Best value structure in the market | Shallow reporting, no package object at all |
| **SPRY** | ~$79–150/NPI | Aggressive on claim success rates | US-insurance-shaped; young |
| **Prompt / Practice Perfect / Power Diary / Pabau** | varies | Rehab or multi-specialty depth; **Pabau has a real commissions engine** | All assume Western insurance workflows |

Every one is built around US, Canadian, UK or Australian insurance billing. That is
simultaneously their moat and their blind spot. None handles Arabic RTL, a
cash-and-package economy, WhatsApp as the primary channel, or clinician payroll.

## MENA tier — locally fluent, clinically generic

| Product | Price | Strength | Weakness |
|---|---|---|---|
| **Tabbaba** (EG) | from EGP 599/mo **per clinic**, EGP 2,500 setup | The real benchmark: Arabic UI, WhatsApp booking and reminders, queue, invoices, per-clinic pricing | Generalist; no physio depth, no outcome measures, no payroll |
| **ClinicPro** (EG) | EGP 1,299/mo (≤4 reception users) or EGP 19,999 lifetime | Entrenched, Arabic | Generalist |
| **Daftra** (EG) | EGP 489–1,960/mo | Accounting-first, strong invoicing | Clinic module bolted onto an accounting product |
| **Easy Clinic / Pioneers** (EG) | licence | Familiar to older clinics | Desktop on a clinic LAN — a generation behind |
| **Medicakare** (EG) | free | No price objection | Free software is not trusted with money |
| **Abra HMS, Mdad** (EG) | project pricing | Hospital-scale | **Built for hospitals; overweight for a clinic** |
| **Vezeeta** (EG/KSA/UAE) | rev-share | Enormous patient reach, $200M+ raised | Booking-led marketplace; clinic operations are not the product |
| **Clinicy, Cura, Nabed** (KSA) | varies | NPHIES/ZATCA-ready | Saudi-specific, generalist |

## The gap

Global tools: clinically deep, locally blind. MENA tools: locally fluent, clinically
generic. **Nobody occupies: physiotherapy-specific + Arabic-native + cash/package
economy + WhatsApp-first + clinician payroll.**

## What the research actually established

Verified from vendor documentation, not inferred:

- **Jane forbids part-paid packages.** "A package must be fully paid for it to be
  available for redemption." Egyptian clinics take a deposit. This product does not
  have that limit.
- **Jane punts real payroll outside itself.** "If your clinic uses a different
  compensation model like tiered, hourly or flat rates, those commissions will need to
  be calculated outside of Jane." Jane Payroll is Canada-only and does not link to the
  compensation report.
- **Cliniko has no package object.** Its documented workaround is patient cases plus
  account credit, linked by hand.
- **WriteUpp is explicit:** "There is no explicit functionality in WriteUpp to deal
  with packages." The suggested workaround is naming appointment types "1/5", "2/5".
- **Nobody models deferred revenue** as a liability that unwinds per delivered session.
  Nookal's pass "nominal value" is the closest near-miss.
- **Two ship a leak report:** Cliniko's "uninvoiced appointments" and Nookal's
  "Uninvoiced Bookings". So lead with the instalment and liability half, not the report.
- **Pabau already ships tiered, collected-basis commissions** and markets to
  physiotherapists at ~$62/user/mo. Payroll is a beatable gap, **not an empty one.**

## Pricing

Egyptian vendors price flat per clinic; per-practitioner is not viable here. Foreign
tools are priced out: Cliniko ≈ EGP 4,800–5,000 for 2–5 practitioners, Jane ≈ EGP
6,500+ for 3 — against Cairo physio session prices of EGP 300–1,000.

**Defensible: EGP 1,000–2,500/month per clinic, centred ~1,300.** Three independent
Egyptian vendors converge there. That is 2–4 sessions a month.

## The five wedges

1. **Package economics as the core object, not an add-on.** Credits, instalments,
   expiry, refunds on abandonment. Every competitor looks like a workaround.
2. **The payroll engine — the moat.** Once an owner's payroll depends on you, switching
   cost stops being data migration and becomes their staff not getting paid. Scope it to
   five rule types and refuse the sixth.
3. **Per-clinic pricing, never per-seat.** Adding a fifth therapist must cost nothing.
4. **The money-leak report as the headline.** Not buried in a menu — the first thing the
   owner sees. It is the entire sales pitch: the product pays for itself on one
   recovered session.
5. **Clinical depth the local tier cannot match, in Arabic.** Outcome measures with
   recovery curves, home exercise programmes, red-flag screening. Tabbaba cannot follow
   without becoming a physiotherapy company; WebPT cannot follow without becoming an
   Arabic one.

## What NOT to compete on

- **US/Canadian insurance billing.** WebPT and Jane's moat, five years of work, worth
  nothing here. Never build the 8-minute rule.
- **Vezeeta's game.** Patient demand generation is a capital business.
- **Being cheapest.** Medicakare is free. Price above Tabbaba and justify it with payroll
  and the leak report.
- **Hospital scope.** Abra and Mdad already serve hospitals and are overweight for a
  clinic. Widening to hospital workflows trades the one defensible position — physio
  depth in Arabic — for a fight against entrenched incumbents on their ground.

## Outside Egypt

The Gulf, not the West. The entry tickets are NPHIES and ZATCA Phase 2, quoted at SAR
45,000–80,000 to bolt onto an existing system. Build it in year two — but **one decision
has to be taken now: currency, tax rules and invoice format are per-clinic configuration
from the first migration, never hardcoded.** Retrofitting that is a rewrite.

---

## The positioning mandate

Before building any feature, check it against the position:

1. **Would WebPT, Jane or Cliniko do this better?** Then build the minimum that works
   and move on. Their strengths are scheduling, charting and Western insurance billing.
   Do not try to beat them there.
2. **Would Tabbaba or Daftra already do this?** Match it, do not exceed it. Parity is
   enough. Their strengths are Arabic UI, WhatsApp and general clinic admin.
3. **Does this land in the gap** — physiotherapy depth, package economics, clinician
   payroll, money-leak visibility, Arabic-native clinical tooling? Then it is a
   differentiator and deserves real effort, real design and a test suite.

**Category 3 gets 70% of the effort. Categories 1 and 2 get the smallest thing that
works.**

Three rules that follow and are not negotiable:

- **Pricing is per clinic, never per practitioner.** Never build seat counting or
  per-seat billing. Adding a therapist must cost the owner nothing.
- **Currency, tax rules and invoice format are per-clinic configuration** read from the
  database. Never hardcode EGP, a tax rate, or an invoice layout.
- **Every clinic can export everything** — patients, appointments, notes, payments,
  payroll — as CSV and JSON, on demand, without contacting support. Lock-in is the
  category's loudest complaint; freedom to leave is a sales weapon.

**The owner's home screen opens on the money-leak report.** Not charts, not a welcome
message: sessions delivered this period with no payment and no package credit, total in
currency at the top. That screen is the product's argument for its own subscription.
