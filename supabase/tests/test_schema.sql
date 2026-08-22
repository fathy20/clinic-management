-- Paste into the Supabase SQL editor after schema.sql AND
-- migrations/0001_phase1_reception.sql have both been applied. Rolls itself back.
-- Needs at least one row in auth.users (sign up once first).
begin;

do $$
declare
  c uuid; p uuid; t uuid; k uuid; a uuid; a3 uuid; n int;
  k2 uuid; pay1 uuid; pay2 uuid; bal numeric; owed numeric;
  c2 uuid; p2 uuid; p3 uuid; k3 uuid;
begin
  select id into t from auth.users limit 1;
  if t is null then raise exception 'sign up a user first'; end if;

  insert into clinics (name) values ('test') returning id into c;
  insert into patients (clinic_id, name, phone) values (c, 'Ali', '0100') returning id into p;
  insert into packages (clinic_id, patient_id, sessions_total, price)
    values (c, p, 10, 1000) returning id into k;

  -- 1. double booking must be refused by the database
  insert into appointments (clinic_id, patient_id, therapist_id, during)
    values (c, p, t, tstzrange('2030-01-01 10:00Z','2030-01-01 11:00Z'));
  begin
    insert into appointments (clinic_id, patient_id, therapist_id, during)
      values (c, p, t, tstzrange('2030-01-01 10:30Z','2030-01-01 11:30Z'));
    raise exception 'FAIL: overlapping appointment was accepted';
  exception when exclusion_violation then null;
  end;

  -- 2. attending a package session decrements it; reverting gives it back
  insert into appointments (clinic_id, patient_id, therapist_id, during, package_id)
    values (c, p, t, tstzrange('2030-01-02 10:00Z','2030-01-02 11:00Z'), k)
    returning id into a;

  update appointments set status = 'attended' where id = a;
  select sessions_used into n from packages where id = k;
  if n <> 1 then raise exception 'FAIL: package not decremented (got %)', n; end if;

  update appointments set status = 'no_show' where id = a;
  select sessions_used into n from packages where id = k;
  if n <> 0 then raise exception 'FAIL: package credit not restored (got %)', n; end if;

  -- pay off package k in full so it doesn't show up as owed money below —
  -- this package exists to test session-consumption, not billing.
  insert into payments (clinic_id, patient_id, package_id, amount, method, taken_by)
    values (c, p, k, 1000, 'cash', t);

  -- 3. an attended, unpaid, package-less session must surface as a leak,
  --    amount-matched against payments linked to it via appointment_id —
  --    not "does some payment exist," which let one trivial unrelated
  --    payment erase an unlimited amount of real debt.
  insert into appointments (clinic_id, patient_id, therapist_id, during, price, status)
    values (c, p, t, tstzrange('2030-01-03 10:00Z','2030-01-03 11:00Z'), 300, 'attended')
    returning id into a3;
  select amount_owed into owed from leaking_sessions where appointment_id = a3;
  if owed <> 300 then raise exception 'FAIL: leak amount_owed expected 300, got %', owed; end if;

  insert into payments (clinic_id, patient_id, appointment_id, amount, method, taken_by)
    values (c, p, a3, 100, 'cash', t) returning id into pay1;
  select amount_owed into owed from leaking_sessions where appointment_id = a3;
  if owed <> 200 then raise exception 'FAIL: leak amount_owed after partial payment expected 200, got %', owed; end if;

  -- 4. a refund exceeding its payment must be rejected
  begin
    insert into refunds (payment_id, amount, reason, taken_by)
      values (pay1, 101, 'test', t);
    raise exception 'FAIL: over-refund was accepted';
  exception when others then
    if sqlerrm not like 'refund exceeds payment%' then raise; end if;
  end;

  -- a valid partial refund must correctly re-inflate the amount owed, and
  -- refund_guard must derive clinic_id from the payment (never trusted from
  -- the caller, since it isn't supplied here at all)
  insert into refunds (payment_id, amount, reason, taken_by) values (pay1, 30, 'goodwill', t);
  select count(*) into n from refunds where payment_id = pay1 and clinic_id = c;
  if n <> 1 then raise exception 'FAIL: refund_guard did not derive clinic_id from the payment'; end if;
  select amount_owed into owed from leaking_sessions where appointment_id = a3;
  if owed <> 230 then raise exception 'FAIL: leak amount_owed after refund expected 230, got %', owed; end if;

  -- 5. a package paid in two partial payments nets to a zero balance
  insert into packages (clinic_id, patient_id, sessions_total, price)
    values (c, p, 5, 500) returning id into k2;
  insert into payments (clinic_id, patient_id, package_id, amount, method, taken_by)
    values (c, p, k2, 200, 'cash', t) returning id into pay2;
  insert into payments (clinic_id, patient_id, package_id, amount, method, taken_by)
    values (c, p, k2, 300, 'card', t);
  select balance into bal from package_balances where package_id = k2;
  if bal <> 0 then raise exception 'FAIL: package_balances expected 0, got %', bal; end if;

  -- 6. patient_balances aggregates the partially-paid-and-refunded plain
  --    session (step 3/4) plus one underpaid package
  insert into packages (clinic_id, patient_id, sessions_total, price)
    values (c, p, 5, 500) returning id into k2;
  insert into payments (clinic_id, patient_id, package_id, amount, method, taken_by)
    values (c, p, k2, 150, 'cash', t);
  -- expected owed: 230 (step 3/4's session, after partial pay + partial refund)
  --              + 350 (500 - 150 underpaid package)
  select amount_owed into owed from patient_balances where patient_id = p;
  if owed <> 580 then raise exception 'FAIL: patient_balances expected 580, got %', owed; end if;

  -- 7. cross-tenant linkage is refused: an appointment/payment cannot
  --    attach a patient or package that belongs to a different clinic
  insert into clinics (name) values ('other clinic') returning id into c2;
  insert into patients (clinic_id, name, phone) values (c2, 'Someone Else', '0200') returning id into p2;

  begin
    insert into appointments (clinic_id, patient_id, therapist_id, during)
      values (c, p2, t, tstzrange('2030-01-04 10:00Z','2030-01-04 11:00Z'));
    raise exception 'FAIL: appointment accepted a cross-clinic patient';
  exception when others then
    if sqlerrm not like 'appointment patient belongs to a different clinic%' then raise; end if;
  end;

  begin
    insert into packages (clinic_id, patient_id, sessions_total, price)
      values (c, p2, 5, 500);
    raise exception 'FAIL: package accepted a cross-clinic patient';
  exception when others then
    if sqlerrm not like 'package patient belongs to a different clinic%' then raise; end if;
  end;

  -- same clinic, wrong patient: package_id must belong to the same patient
  -- as the appointment/payment referencing it, not just the same clinic
  insert into patients (clinic_id, name, phone) values (c, 'Sara', '0300') returning id into p3;
  insert into packages (clinic_id, patient_id, sessions_total, price)
    values (c, p3, 5, 500) returning id into k3;
  begin
    insert into appointments (clinic_id, patient_id, therapist_id, during, package_id)
      values (c, p, t, tstzrange('2030-01-05 10:00Z','2030-01-05 11:00Z'), k3);
    raise exception 'FAIL: appointment accepted a package belonging to a different patient';
  exception when others then
    if sqlerrm not like 'appointment package belongs to a different patient%' then raise; end if;
  end;

  raise notice 'all checks passed';
end $$;

rollback;
