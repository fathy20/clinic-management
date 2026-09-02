-- The four settings that cannot be retrofitted.
--
-- Gulf expansion needs ZATCA (Saudi) or the UAE equivalent, and both are
-- invoice-format-and-tax problems before they are anything else. Egypt needs
-- ETA e-invoicing, whose registration threshold fell to EGP 250,000 of annual
-- revenue — a three-therapist clinic clears that on roughly 800 sessions a
-- year, so this is a live obligation, not a future one.
--
-- Currency arrived in 0002. Timezone, tax and locale join it here, because
-- every one of them is currently a constant in the code and each becomes a
-- rewrite the day a clinic outside Cairo signs. The application already reads
-- all four through lib/clinic-context.ts with fallbacks, so applying this
-- changes behaviour for new clinics without breaking existing ones.

-- IANA name, not an offset. Egypt reinstated DST in 2023; a stored "+02:00"
-- is wrong for half the year and silently files late-evening appointments
-- under the wrong day.
alter table clinics
  add column timezone text not null default 'Africa/Cairo'
    check (length(timezone) > 0);

-- The UI language, and with it the text direction. Per clinic rather than per
-- deployment, so one instance can serve an Arabic clinic in Cairo and an
-- English one in Dubai.
alter table clinics
  add column locale char(2) not null default 'ar'
    check (locale in ('ar', 'en'));

-- Tax as a rate plus a label, not a hardcoded VAT. Egypt applies no VAT to
-- most private medical services today, Saudi applies 15%, the UAE 5% — and a
-- clinic that becomes taxable must be able to say so without a deploy.
-- numeric(5,4) holds 0.1500 exactly; a float would not.
alter table clinics
  add column tax_rate numeric(5,4) not null default 0
    check (tax_rate >= 0 and tax_rate <= 1);

alter table clinics
  add column tax_label text not null default '';

-- Which statutory e-invoicing regime this clinic files under. 'none' until a
-- clinic crosses a threshold; the integration itself is a later phase, but
-- the column has to exist before invoices are numbered, because retro-fitting
-- a regime onto issued invoices is not possible.
create type invoice_regime as enum ('none', 'eta_eg', 'zatca_sa', 'uae');

alter table clinics
  add column invoice_regime invoice_regime not null default 'none';

-- Sequential per clinic, because every regime requires gapless numbering
-- scoped to the issuer. Kept on the clinic row rather than derived from a
-- count so that a deleted or voided invoice cannot reuse a number.
alter table clinics
  add column next_invoice_number bigint not null default 1
    check (next_invoice_number > 0);
