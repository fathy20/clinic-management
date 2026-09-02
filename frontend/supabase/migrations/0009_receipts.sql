-- A NUMBERED RECEIPT FOR MONEY ALREADY TAKEN.
--
-- 0004 added tax_rate, tax_label, invoice_regime and next_invoice_number, and
-- nothing read them. A clinic could take cash and hand the patient nothing.
--
-- This is a receipt, not a statutory e-invoice. It does not claim ETA, ZATCA or
-- UAE compliance and does not transmit anything to a tax authority — those are
-- separate integrations per regime. What it does is the part that cannot be
-- retrofitted: allocate a gapless per-clinic number and freeze the tax basis at
-- the moment of issue.
--
-- Why the numbers and amounts are frozen on the row rather than read live:
-- every regime requires that an issued document never changes. A clinic that
-- becomes taxable next year, or corrects its tax label, must not silently
-- rewrite the tax on receipts already handed to patients. So currency, rate,
-- label and regime are copied here at issue time. That duplication is the
-- point, not an oversight.

create table receipts (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references clinics on delete cascade,
  patient_id  uuid not null references patients on delete cascade,

  -- One receipt per payment. A double-clicked button must not produce two
  -- documents for the same money, and it must not burn a number either — see
  -- issue_receipt below, which returns the existing row instead of inserting.
  payment_id  uuid not null references payments on delete cascade unique,

  -- Gapless within the clinic. Allocated by incrementing the clinic row under
  -- its own lock, never by counting receipts: a count reuses a number the
  -- moment anything is voided.
  number      bigint not null check (number > 0),

  issued_at   timestamptz not null default now(),
  issued_by   uuid references auth.users,

  -- total is what the patient actually paid. subtotal + tax_amount = total,
  -- exactly, enforced below.
  subtotal    numeric(12,2) not null check (subtotal >= 0),
  tax_amount  numeric(12,2) not null check (tax_amount >= 0),
  total       numeric(12,2) not null check (total > 0),

  -- The basis, frozen. Not a join to clinics.
  currency    char(3) not null check (currency ~ '^[A-Z]{3}$'),
  tax_rate    numeric(5,4) not null check (tax_rate >= 0 and tax_rate <= 1),
  tax_label   text not null default '',
  regime      invoice_regime not null default 'none',

  constraint receipt_number_unique_per_clinic unique (clinic_id, number),

  -- The arithmetic is a constraint, not a convention. A receipt whose parts do
  -- not add up is worse than no receipt.
  constraint receipt_adds_up check (subtotal + tax_amount = total)
);

create index receipts_clinic_number on receipts (clinic_id, number desc);
create index receipts_patient on receipts (clinic_id, patient_id);

alter table receipts enable row level security;

-- Money roles only. A therapist has no business in the till, and the receipt
-- carries an amount.
create policy receipts_read on receipts for select
  using (clinic_id in (select my_clinics())
         and my_role(clinic_id) in ('owner','reception','accountant'));

-- No insert policy, no update policy, no delete policy — deliberately.
--
-- Issuing goes through issue_receipt() below, which is the only way a row can
-- appear. That keeps number allocation and the tax snapshot in one place
-- instead of trusting whatever the application sends. An issued financial
-- document is never updated and never deleted; a mistake is corrected by a
-- refund, which is itself an append-only record.

-- A receipt must not point at another clinic's payment or patient. The same
-- guard shape as appointments, packages and payments already use.
-- security definer, and NOT optional. Without it the function runs with the
-- caller's own RLS, so the lookup below cannot SEE another clinic's patient row
-- and returns NULL — making the comparison NULL rather than true, and letting
-- exactly the row this guard exists to refuse straight through. A live harness
-- caught it: every earlier guard in this schema is definer for the same reason.
-- `is distinct from` rather than `<>` so a NULL can never read as "no problem".
create or replace function check_receipt_clinic()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select clinic_id from payments where id = new.payment_id)
     is distinct from new.clinic_id then
    raise exception 'receipt payment belongs to a different clinic';
  end if;
  if (select clinic_id from patients where id = new.patient_id)
     is distinct from new.clinic_id then
    raise exception 'receipt patient belongs to a different clinic';
  end if;
  return new;
end;
$$;

create trigger receipt_clinic_guard
  before insert or update on receipts
  for each row execute function check_receipt_clinic();

-- ============================================================
-- Issuing.
--
-- security definer because it writes the clinic's invoice counter and inserts
-- into a table with no insert policy. That means it must check the caller
-- itself, which it does — `my_role` reads auth.uid(), so this is the caller's
-- own role, not the definer's.
-- ============================================================

create or replace function issue_receipt(p_payment uuid)
returns receipts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pay      payments;
  cl       clinics;
  existing receipts;
  out_row  receipts;
  n        bigint;
  gross    numeric(12,2);
  net      numeric(12,2);
  vat      numeric(12,2);
begin
  select * into pay from payments where id = p_payment;
  if pay.id is null then
    raise exception 'no such payment';
  end if;

  -- The caller's role in the payment's OWN clinic. No clinic is accepted as an
  -- argument, so there is no clinic for a caller to name but theirs.
  --
  -- coalesce, not a bare `not in`: my_role returns NULL for someone with no
  -- membership in this clinic, and `NULL not in (...)` is NULL rather than
  -- true, so a plain check lets a complete stranger straight through. That
  -- exact mistake was caught by a live harness in 0008.
  if coalesce(my_role(pay.clinic_id)::text, '') not in ('owner', 'reception', 'accountant') then
    raise exception 'only the till can issue a receipt in this clinic';
  end if;

  -- Idempotent. A double-clicked button returns the document that already
  -- exists rather than issuing a second one for the same money — and, just as
  -- importantly, without consuming another number.
  select * into existing from receipts where payment_id = p_payment;
  if existing.id is not null then
    return existing;
  end if;

  -- The clinic row is locked for the duration, which is what makes the number
  -- gapless under concurrency: two receptionists issuing at once serialise
  -- here instead of both reading the same next_invoice_number.
  select * into cl from clinics where id = pay.clinic_id for update;

  n := cl.next_invoice_number;
  update clinics set next_invoice_number = n + 1 where id = cl.id;

  -- The amount collected is the gross: it is what the patient handed over. So
  -- tax is extracted from it rather than added to it.
  --
  -- The tax is computed as the REMAINDER after rounding the net, not rounded
  -- independently. Rounding both and hoping they sum is how a receipt ends up
  -- a piastre short of the money in the drawer, and the receipt_adds_up
  -- constraint would then reject it.
  gross := pay.amount;
  net   := round(gross / (1 + cl.tax_rate), 2);
  vat   := gross - net;

  insert into receipts (
    clinic_id, patient_id, payment_id, number, issued_by,
    subtotal, tax_amount, total,
    currency, tax_rate, tax_label, regime
  ) values (
    pay.clinic_id, pay.patient_id, pay.id, n, auth.uid(),
    net, vat, gross,
    cl.currency, cl.tax_rate, cl.tax_label, cl.invoice_regime
  )
  returning * into out_row;

  return out_row;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on every new function, and this one is
-- security definer in a schema the API exposes — so the default grant would
-- make it a public endpoint.
revoke all on function issue_receipt(uuid) from public;
grant execute on function issue_receipt(uuid) to authenticated;

revoke all on function check_receipt_clinic() from public;
