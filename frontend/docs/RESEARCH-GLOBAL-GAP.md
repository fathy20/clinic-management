# What the global systems have that we don't — and whether it matters in Egypt

`COMPETITORS.md` answers *where we sit in the market*. This answers a different
question: **feature by feature, what do the international products do that we
cannot, and would each one actually help an Egyptian physiotherapy clinic?**

Researched August 2026. Sources are listed at the end and linked inline where a
claim rests on one. Two rules I held myself to:

- **Verified vs inferred is marked.** Vendor documentation and law are verified.
  Review-aggregator feature lists are marketing copy and are treated as claims,
  not facts.
- **A verdict is a decision, not a shrug.** Every row gets BUILD, LATER, or NO,
  with the reason. "Nice to have" is not a verdict — it is how a backlog grows
  until nothing in it ever ships.

---

## Part 0 — Three findings that outrank every feature on the list

These came out of the research and none of them is a feature. Two are legal
deadlines and one is a market fact. Any of them can matter more than everything
in Part 1.

### 0.1 Patient health data is stored outside Egypt, and enforcement starts 31 October 2026

Egypt's PDPL (Law 151/2020) **prohibits transferring personal data outside Egypt
without prior authorisation from the PDPC** — Article 16. There is no
self-certification route, no standard-contractual-clauses route, and no
adequacy-by-assertion route. The Executive Regulations (Ministerial Decree
816/2025) took effect 1 November 2025 with a one-year grace period, so **full
enforcement is expected 31 October 2026.**

Penalties for a cross-border transfer violation, and separately for processing
sensitive personal data without explicit consent: **imprisonment from 3 months
and/or a fine of EGP 500,000 to EGP 5,000,000.** Health data is explicitly
sensitive, and Article 14 requires **explicit written consent** for it.

Where our data actually sits: **Supabase has no Middle East region at all.** Its
regions are US, Canada, Ireland, London, Frankfurt, Mumbai, Singapore, Tokyo,
Seoul, Sydney, São Paulo. AWS has both `me-central-1` (UAE) and Bahrain;
Supabase offers neither. Our project resolves through Cloudflare, which tells us
nothing about storage — but it does not need to, because **none of the available
options is Egypt.**

So: today, an Egyptian clinic's patient health data on this product is outside
Egypt, and in roughly nine weeks that becomes an enforceable exposure for *the
clinic*, which is the data controller, as well as for us as processor.

**This is not a feature to schedule. It is a decision to take, and I am not a
lawyer — a lawyer has to confirm the reading.** The options, in the order I would
put them to one:

| Option | What it costs | What it buys |
|---|---|---|
| Apply to the PDPC for a cross-border transfer permit, keep Supabase | Legal fees, an unknown approval timeline, a dependency on a regulator's decision | Zero engineering change |
| Self-host Postgres + the Supabase stack on Egyptian infrastructure | Real work: we lose managed Auth/Storage/backups and take on ops | Removes the transfer question entirely |
| Egyptian/regional managed Postgres, keep the app | Migration work, vendor diligence | Removes the question, keeps most of the stack |
| Data residency split — identifiers and clinical data in Egypt, non-personal telemetry outside | The most engineering, the most ways to get subtly wrong | Compliance with a usable cloud |

There is a fifth option nobody should choose, which is to do nothing and hope the
grace period slips.

**What I can build regardless of which is chosen**, because all four need it:
explicit written consent captured and timestamped per patient with the purpose
recorded; a read audit log; breach-notification readiness; and data-subject
rights (access, export, erasure request). Those are in Part 1 and they are not
optional under the Regulations.

### 0.2 The e-receipt is a legal obligation with a fine, not a nicety

I built a numbered receipt (migration `0009`) and correctly labelled it *not a
statutory tax invoice*. Research says that label is the problem, not the
solution:

- The VAT and e-invoicing registration threshold **fell from EGP 500,000 to
  EGP 250,000** of annual revenue. Newly mandated taxpayers had to register by
  **31 March 2026**.
- **Clinics are explicitly in scope**: hospitals and clinics issue **e-receipts
  to patients (B2C)** and **e-invoices to insurers (B2B)**.
- B2C receipts must reach the ETA **within 72 hours** — down to **24 hours** for
  integrated POS.
- Technically: JSON or XML on the ETA schema, a **mandatory qualified digital
  signature** (e-seal, Class 2 or higher), TLS 1.2+, a registered ERP and each
  POS registered with API credentials. Common rejections: malformed UUID,
  invalid TRN, missing signature, schema violation.
- **Non-compliance: EGP 20,000 immediately plus EGP 1,000 per day**, escalating
  to suspension of the ability to issue valid invoices.

Do the arithmetic on the threshold: at a Cairo session price of EGP 300, **EGP
250,000 is about 834 sessions a year** — roughly 16 a week. A single busy
therapist clears it. **Effectively every real clinic we would sell to is in
scope.**

And the competitive angle is sharp. **Daftra already does ETA integration
including the e-signature and digital stamp** — but Daftra is an accounting
product with a clinic module bolted on. Tabbaba, the clinic-native benchmark,
advertises *invoices* and WhatsApp; I found no evidence it does ETA
transmission. **That is a wedge: clinic-native AND ETA-native.**

What I cannot do alone: the clinic's TRN, their ETA portal registration, and
their e-seal certificate. What I can do: make the receipt carry every field the
schema needs, and build the submission queue with retry and status so that the
day their certificate exists, it works.

### 0.3 Egyptian physio clinics DO bill insurers — my earlier cash-only assumption was wrong

I had positioned this product around a pure cash-and-package economy. That is
half the picture.

**GlobeMed Egypt's network is 4,000+ providers and explicitly includes
physiotherapy centres.** NeXtCare is Allianz's TPA; MedNet is a third. Named
insurers and TPAs operating in Egypt: Bupa Egypt, AXA Egypt, MetLife, Delta
Insurance, Arabian Shield, GlobeMed, NeXtCare, MedNet. GlobeMed's *i-Care*
portal does online eligibility, coverage certification, **prior approval in
about 10 minutes**, and full claims processing.

The workflow an Egyptian clinic actually performs, per a local vendor's own
published guidance: eligibility check against the national ID and policy number
recorded in the record; **pre-approval before service**; submission targeted
within 24 hours and a 30-day maximum window; supporting documents under 5 MB,
digitally signed, named to a convention like
`ClinicID_PatientID_YYYYMMDD.xml`; **co-payment collected at the point of
service** — a local competitor generates a **Paymob** checkout link and attaches
the transaction ID to the claim file; batch submission as **a ZIP of XMLs**; and
KPIs of **denial rate under 5%** and **approval time under 48 hours**.

Every part of that is absent from this product. A corporate-heavy clinic in New
Cairo or Sheikh Zayed cannot run on what we have. **This is the largest
functional hole in the product, and unlike the US-insurance depth of WebPT, it
is a hole that matters here.**

---

## Part 1 — The feature audit

Verdict key: **BUILD** = start now or next. **LATER** = real value, wrong time or
blocked. **NO** = we should deliberately never build it.

### Getting patients in the door

| Global feature | Who has it | We have | Egypt verdict |
|---|---|---|---|
| Patient self-booking online | Jane, Cliniko, Nookal, Tabbaba | ✗ | **BUILD.** No dependency on anyone else, and the local benchmark already has it. Reception phone time is the cost it removes. |
| Automated reminders with confirm/cancel | everyone; Tabbaba does WhatsApp | ✗ | **BUILD.** See the economics below — this is nearly free in Egypt and it is the single highest-ROI thing on the list. |
| Waitlist / cancellation backfill | Jane, Cliniko | ✗ | **BUILD, small.** A cancelled 45-minute slot in a packages economy is unrecoverable revenue. It is a query plus a message, not a subsystem. |
| Deposit / card-on-file / no-show fee | Jane, WebPT, SimplePractice | ✗ | **LATER.** High value against no-shows, but needs a Paymob or Fawry merchant account per clinic. Build once one clinic asks and has one. |
| Reviews and reputation | Jane (Ratings & Reviews) | ✗ | **NO, for now.** Vezeeta owns patient-facing reputation in Egypt with a marketplace we will not out-reach. Competing there is a different company. |
| Clinic website + SEO | Jane (Jane Websites, Jane SEO) | ✗ | **NO.** Not our product. A clinic that needs a website has cheaper options than their practice software. |
| Recall / reactivation campaigns | Cliniko, Nookal, Pabau | ✗ | **LATER.** Real value — a lapsed patient is the cheapest revenue there is. But marketing-category WhatsApp costs 15× utility, so this needs a cost model before it needs code. |

### The clinical record

| Global feature | Who has it | We have | Egypt verdict |
|---|---|---|---|
| SOAP notes, templates | everyone | ✓ (6 templates) | — |
| Discipline-specific exam protocols | WebPT (US-shaped) | ✓ (7 regions × 5 disciplines) | **We are ahead here.** No competitor ships an Arabic exam protocol set. |
| Outcome measures | WebPT, Jane, Nookal | ✓ staff-entered (NPRS, PSFS, ODI, DASH, BERG, 6MWT) | — |
| **PROMs sent to the patient to fill in** | Physitrack, Jane forms | ✗ — we only collect at the desk | **BUILD.** The portal already exists. This is the cheapest clinical depth available to us and it makes the recovery trend real instead of sporadic. |
| Body chart / pain diagram | WebPT, most PT-specific tools | ✗ (Phase 6 in `SPEC.md`, unbuilt) | **BUILD, small.** Physio-defining, entirely ours to build, no dependency. |
| Home exercise programme | Physitrack (**18,000+ videos**), WebPT HEP | ✓ prescriptions with a URL | **Partial — BUILD the half we can.** We will never license 18,000 videos. We *can* let a clinic build its own library and reuse it, which is worth more in Arabic anyway. |
| **Exercise adherence + patient pain logging** | Physitrack (peer-reviewed on adherence) | ✗ | **BUILD.** Patient ticks the exercise, logs pain and difficulty; therapist sees it next visit. Cheap, and it is the feature Physitrack charges separately for. |
| Document and imaging storage | everyone | ✗ | **BUILD, after 0.1 is decided.** An Egyptian physio patient arrives with an MRI report and an ortho referral letter. Not storing them means they live in WhatsApp. But files are PHI and the residency question decides where they may live. |
| AI scribe / ambient documentation | **Jane ships one now** | ✗ | **LATER, and carefully.** Newly viable in Arabic: a peer-reviewed bilingual Arabic-English ambient scribe (Sahl AI) was evaluated across dialects including Egyptian. Hard rule if we build it — it transcribes and structures, it **never states a diagnosis** (`CLAUDE.md`). |
| Telehealth video | Jane, Cliniko, Physitrack | ✗ | **LATER, low.** Physiotherapy is hands-on. Real for exercise review and triage, not for treatment. |
| ICD/CPT coding, Medicare, MIPS, faxing | WebPT, SPRY, TheraOffice | ✗ | **NO.** US regulatory scaffolding. Building it would be building someone else's country. |

### Money

| Global feature | Who has it | We have | Egypt verdict |
|---|---|---|---|
| Packages with credit tracking | badly, everywhere (see `COMPETITORS.md`) | ✓ first-class, part-payable | **We are ahead.** Jane requires a package be fully paid before redemption; Cliniko has no package object; WriteUpp says outright it has none. |
| Deferred revenue / earned-vs-collected | nobody | ✓ | **We are alone here.** |
| Money-leak report | Cliniko, Nookal (uninvoiced bookings) | ✓ first element on the page | — |
| Numbered receipt | everyone | ✓ (`0009`) | — |
| **ETA e-receipt transmission** | **Daftra** (accounting-first) | ✗ | **BUILD — highest priority.** See 0.2. Legal, dated, fined. |
| **TPA eligibility / pre-approval / claims** | WebPT etc. for US; **GlobeMed i-Care, local vendors** for Egypt | ✗ | **BUILD — second priority.** See 0.3. |
| Price list / service catalogue | everyone | ✗ — reception types the price | **BUILD, small.** Cheap, and every other feature that quotes a price needs it. |
| Online payment | Jane Payments, Stripe integrations | ✗ | **LATER.** Paymob/Fawry per clinic. Pairs with deposits. |
| **Payroll / commissions** | Pabau ships tiered collected-basis commissions; **Jane explicitly punts it** | ✗ | **BUILD — the moat.** Jane's own words: other compensation models "will need to be calculated outside of Jane". Scope to five rule types and refuse the sixth. |
| Inventory / retail | Cliniko, Pabau | ✗ | **LATER, low.** Clinics do sell bands and braces, but it is a small line. |
| Memberships / recurring billing | Jane, Pabau | ✗ | **NO, for now.** A cash-and-package economy does not run subscriptions. Packages already do this job. |
| Gift cards | Jane | ✗ | **NO.** |

### Running the business

| Global feature | Who has it | We have | Egypt verdict |
|---|---|---|---|
| Roles and permissions | everyone | ✓ 4 roles, RLS-enforced | — |
| KPI dashboard | WebPT Analytics, Pabau | partial (finance only) | **LATER.** Owners ask for utilisation, new-vs-returning, therapist load. Cheap once the data is there. |
| **Read audit log** | hospital systems; not most clinic tools | ✗ — we log writes only | **BUILD.** Required for PDPL accountability, and it is a known gap already in `STATUS.md`. |
| **Explicit written consent + intake forms** | everyone | partial (`consent_at` only) | **BUILD.** PDPL Article 14 wants explicit written consent for health data, purpose-specific. A timestamp with no recorded purpose is thin. |
| Data-subject rights (access/export/erasure) | GDPR-era tools | export ✓, rights workflow ✗ | **BUILD, small.** The Regulations give data subjects mechanisms; someone has to be able to action a request. |
| Clinician absence / roster | Jane, Cliniko | ✗ | **BUILD, small.** Known gap. A therapist calls in sick and reception moves every appointment by hand. |
| Group classes | Cliniko, Jane, Pabau | ✗ | **LATER.** Cairo clinics do run rehab and Pilates groups; not the first ten things. |
| Room / resource booking | Cliniko, Nookal | ✗ | **LATER.** Matters once a clinic has a hydrotherapy pool or two gyms. |
| Multi-location under one owner | Jane, Cliniko | a second branch is a second clinic row | **LATER.** Fine until an owner wants one P&L across branches. |
| Two-way patient messaging | Jane Secure Messaging | ✗ | **LATER.** WhatsApp is where this conversation already happens; competing with it inside our app is a losing fight. |
| Referral source attribution | Pabau, WebPT | ✗ | **LATER, small.** Cheap and it answers "where do patients come from", which owners do ask. |

---

## Part 2 — The economics that decide the messaging question

Meta's official WhatsApp Business Platform rates for Egypt, per message:

| Category | Rate | EGP (at ~48/USD) | What it is for |
|---|---|---|---|
| **Utility** | **$0.0073** | **≈ EGP 0.35** | appointment reminders, confirmations, receipts |
| Authentication | $0.0130 | ≈ EGP 0.62 | one-time codes |
| **Marketing** | **$0.1073** | **≈ EGP 5.15** | recalls, offers, reactivation |
| Service (patient-initiated, 24h window) | free | free | replies |

Egypt's marketing rate was **cut on 1 January 2026**; utility and authentication
get volume discounts at scale, **marketing gets none at any volume.**

Two conclusions, and they are design constraints rather than opinions:

1. **Reminders are effectively free.** A clinic sending 1,000 reminders a month
   pays about **EGP 350** — roughly one session. Against Cairo no-show rates
   this pays for itself many times over, and it is why every reminder,
   confirmation and receipt notification must be sent as a **utility** template.
2. **Recall campaigns cost 15× more.** Blasting 1,000 lapsed patients is
   ≈ **EGP 5,150**. That is not "send to everyone" money. Any recall feature has
   to show the owner the cost before sending, and target rather than broadcast.

---

## Part 3 — What I recommend building, in order, and why that order

Ordered by *consequence of not having it*, not by how interesting it is.

**Blocked on a decision only you can take**

0. **PDPL data residency.** A lawyer, then an architecture choice. Nine weeks to
   full enforcement. Nothing on this list matters if the product cannot legally
   hold Egyptian health data.

**Ready to build now, no external dependency**

1. **PDPL groundwork** — explicit purpose-recorded consent, read audit log,
   data-subject request handling. Needed under every residency option, so it is
   never wasted work.
2. **Price list / service catalogue.** Small, and half the list depends on it.
3. **Appointment reminders + confirmations** (utility templates), **waitlist
   backfill**, **patient self-booking.** Needs a Meta WABA number from you; the
   scheduling and messaging logic does not.
4. **Patient-side PROMs and exercise adherence** through the portal that already
   exists. Cheapest clinical depth we can buy, and Physitrack charges for it.
5. **Body chart.** Small, physio-defining, entirely ours.
6. **Payroll engine.** The moat. Needs its own spec first — five rule types,
   and refuse the sixth.

**Ready to design now, blocked on your paperwork to finish**

7. **ETA e-receipt.** I can make the receipt schema-complete and build the
   submission queue with retry and status. To actually transmit I need the
   clinic's **TRN**, their **ETA portal registration**, and their **e-seal
   certificate**.
8. **TPA claims.** Eligibility, pre-approval reference, co-pay split, document
   attachment, batch export, denial tracking. To build it against reality I need
   **one real insurer's actual forms and one real claim file** — GlobeMed,
   NeXtCare or MedNet. Building this from a blog post would produce something
   that fails on first contact with a real claim.

**Deliberately not building**

US insurance scaffolding (ICD/CPT-for-billing, Medicare, MIPS), faxing, gift
cards, recurring memberships, clinic websites and SEO, reviews and reputation, a
licensed 18,000-video exercise library, and an in-app messaging channel to
compete with WhatsApp.

---

## Sources

Vendor and product documentation:
- [Jane App — feature guide index](https://jane.app/guide)
- [Jane App — electronic charting](https://jane.app/landing/charting)
- [Jane App — what's new, summer 2026](https://jane.app/guide/whats-new-summer-guide)
- [Physitrack — features](https://www.physitrack.com/features)
- [Physitrack](https://www.physitrack.com/)
- [Tabbaba — cloud clinic management (Egypt)](https://tabbaba.com/en/)
- [Daftra — integrating with the Egyptian Tax Authority](https://docs.daftra.com/en/user_manual/integrating-daftra-with-the-egyptian-tax-authority-eta/)
- [Daftra — electronic invoice software, Egypt](https://www.daftra.com/en/egy-electronic-invoice/)
- [Clinit — TPA insurance claims management for Egyptian clinics](https://clinit.app/blog/tpa-insurance-claims-management)
- [GlobeMed Egypt — solutions](https://globemedegypt.com/en/solutions)
- [GlobeMed Egypt — services (i-Care)](https://support.globemedegypt.com/en/support/solutions/articles/2044000000541-globemed-its-services)
- [Mednet — insurers](https://www.mednet.com/insurers)
- [Supabase — available regions](https://supabase.com/docs/guides/platform/regions)
- [Supabase — which regions can I deploy in](https://github.com/orgs/supabase/discussions/4815)

Egypt e-invoicing and e-receipt:
- [Egypt e-invoicing compliance guide (ETA, 2026)](https://orchidatax.com/countries-compliance/egypt-e-invoicing-compliance/)
- [ETA e-invoicing FAQ and integration guide](https://orchidatax.com/eta-e-invoicing-egypt-faq/)
- [e-Invoicing in Egypt: compliance and e-receipt expansion](https://www.2b-cs.com/blog/2b-1/e-invoicing-egypt-compliance-guide-39)
- [Egypt e-invoicing 2026: ETA compliance guide for SMEs](https://datavalue.solutions/egypt-e-invoicing-eta-2026-sme-guide/)
- [Egypt's e-receipt system compliance checklist (Wafeq)](https://www.wafeq.com/en-eg/tax-and-reporting/e-receipt-system)
- [Egypt B2C e-receipt mandate](https://www.flick.network/en-eg/egypt-b2c-e-receipt-mandate)
- [Egypt e-receipt requirements 2026](https://invoicedataextraction.com/blog/egypt-e-receipt-requirements)

Egypt data protection (PDPL, Law 151/2020):
- [Law No. 151 of 2020 — full text (ACC)](https://www.acc.com/sites/default/files/program-materials/upload/Data%20Protection%20Law%20-%20Egypt%20-%20EN%20-%20MBH.PDF)
- [Egypt's PDPL — the compliance countdown has begun (Kennedys)](https://www.kennedyslaw.com/en/thought-leadership/article/2026/egypt-s-personal-data-protection-law-the-compliance-countdown-has-begun/)
- [A first look at Egypt's PDPL Executive Regulations (Chambers)](https://chambers.com/articles/a-first-look-at-egypt-s-personal-data-protection-executive-regulations)
- [A first look at the Executive Regulations (GLA & Company)](https://www.glaco.com/blog/a-first-look-at-egypts-personal-data-protection-executive-regulations/)
- [Egypt data protection law (PwC Middle East)](https://www.pwc.com/m1/en/services/consulting/technology/cyber-security/navigating-data-privacy-regulations/egypt-data-protection-law.html)
- [Egypt regulatory update on data privacy (Clyde & Co)](https://www.clydeco.com/en/insights/2026/01/egypt-regulatory-update-on-data-privacy)
- [Data protection laws in Egypt (DLA Piper)](https://www.dlapiperdataprotection.com/?t=law&c=EG)

WhatsApp messaging economics:
- [WhatsApp Business Platform pricing (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [WhatsApp API pricing in Egypt 2026](https://ominiflow.com/whatsapp-api-pricing/egypt)
- [WhatsApp API pricing — Egypt, UAE, Saudi](https://quali-d.com/whatsapp-api-pricing)
- [WhatsApp Business API pricing 2026: categories and costs](https://blueticks.co/blog/whatsapp-business-api-pricing-2026)

Arabic clinical AI:
- [A bilingual Arabic-English ambient AI scribe for clinical documentation — prospective evaluation (JMIR Medical Informatics, 2026)](https://medinform.jmir.org/2026/1/e83335)

Market context (treated as claims, not verified facts):
- [WebPT features and pricing overview](https://softwarefinder.com/emr-software/webpt)
- [Best physical therapy EMR software 2026 (SPRY)](https://www.sprypt.com/blog/best-emr-physical-therapy-buyers-guide)
- [Best physical therapy EMR software 2026 (Pabau)](https://pabau.com/blog/physical-therapy-emr-software/)
- [Best clinic management software Egypt 2026](https://clinicgateway.ae/blog/best-clinic-management-software-egypt-2025/)
- [Best health insurance companies in Egypt (Amanleek)](https://amanleek.com/en/best-health-insurance-egypt/)
