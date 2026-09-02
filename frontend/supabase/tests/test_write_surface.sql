-- Proves the write surface is actually closed, per role, per verb.
--
-- Every assertion below is a thing that was possible before migration 0006
-- and must not be possible after it. Run this after applying 0006; it rolls
-- itself back. Needs at least one row in auth.users.
--
-- The pattern: `set local role authenticated` plus a jwt claim, attempt the
-- forbidden verb, and require it to fail. A policy-denied write raises
-- insufficient_privilege (42501); an UPDATE with no matching policy instead
-- affects zero rows, so those are checked by row count.

begin;

do $$
declare
  c uuid; c2 uuid; p uuid; owner_id uuid; ther_id uuid; rec_id uuid;
  pkg uuid; appt uuid; pay uuid; n int; blocked boolean;
begin
  -- ---------- fixtures ----------
  select id into owner_id from auth.users limit 1;
  if owner_id is null then raise exception 'sign up a user first'; end if;

  insert into auth.users (email) values ('wsg-ther@test.local') returning id into ther_id;
  insert into auth.users (email) values ('wsg-rec@test.local')  returning id into rec_id;

  insert into clinics (name) values ('write-surface') returning id into c;
  insert into clinics (name) values ('other')          returning id into c2;

  insert into memberships (user_id, clinic_id, role) values
    (owner_id, c, 'owner'), (ther_id, c, 'therapist'), (rec_id, c, 'reception');

  insert into patients (clinic_id, name, phone) values (c, 'Subject', '0100')
    returning id into p;
  insert into packages (clinic_id, patient_id, sessions_total, price)
    values (c, p, 10, 2000) returning id into pkg;
  insert into appointments (clinic_id, patient_id, therapist_id, during, price)
    values (c, p, ther_id, tstzrange('2031-01-01 10:00Z','2031-01-01 11:00Z'), 350)
    returning id into appt;
  insert into payments (clinic_id, patient_id, package_id, amount, method, taken_by)
    values (c, p, pkg, 500, 'cash', owner_id) returning id into pay;

  -- ================= payments are append-only =================
  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_id)::text, true);
  update payments set amount = 1 where id = pay;
  if found then raise exception 'FAIL: an owner amended a payment'; end if;

  delete from payments where id = pay;
  if found then raise exception 'FAIL: an owner deleted a payment'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', rec_id)::text, true);
  update payments set amount = 1 where id = pay;
  if found then raise exception 'FAIL: reception amended a payment'; end if;

  delete from payments where id = pay;
  if found then raise exception 'FAIL: reception deleted a payment'; end if;

  -- but taking a payment still works, or the product is broken
  begin
    insert into payments (clinic_id, patient_id, amount, method, taken_by)
      values (c, p, 100, 'cash', rec_id);
  exception when others then
    raise exception 'FAIL: reception can no longer take a payment (%)', sqlerrm;
  end;

  -- ================= refunds are append-only =================
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id)::text, true);
  insert into refunds (payment_id, amount, reason, taken_by)
    values (pay, 100, 'test correction', owner_id);

  delete from refunds where payment_id = pay;
  if found then raise exception 'FAIL: a refund was deleted'; end if;

  update refunds set amount = 1 where payment_id = pay;
  if found then raise exception 'FAIL: a refund was amended'; end if;

  -- ================= patients cannot be deleted =================
  -- This is the cascade that took payments with it.
  perform set_config('request.jwt.claims', json_build_object('sub', ther_id)::text, true);
  delete from patients where id = p;
  if found then raise exception 'FAIL: a therapist deleted a patient'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_id)::text, true);
  delete from patients where id = p;
  if found then raise exception 'FAIL: an owner deleted a patient'; end if;

  select count(*) into n from payments where patient_id = p;
  if n < 2 then raise exception 'FAIL: payments went missing (% left)', n; end if;

  -- ================= a therapist may change status and nothing else =========
  perform set_config('request.jwt.claims', json_build_object('sub', ther_id)::text, true);

  update appointments set status = 'attended' where id = appt;
  if not found then raise exception 'FAIL: a therapist cannot mark attendance'; end if;

  blocked := false;
  begin
    update appointments set price = 1 where id = appt;
  exception when others then
    blocked := sqlerrm like '%only change%';
  end;
  if not blocked then raise exception 'FAIL: a therapist changed a price'; end if;

  blocked := false;
  begin
    update appointments
      set during = tstzrange('2031-02-02 10:00Z','2031-02-02 11:00Z')
      where id = appt;
  exception when others then
    blocked := sqlerrm like '%only change%';
  end;
  if not blocked then raise exception 'FAIL: a therapist moved a session'; end if;

  delete from appointments where id = appt;
  if found then raise exception 'FAIL: an appointment was deleted'; end if;

  -- ================= reception may still move a session =================
  perform set_config('request.jwt.claims', json_build_object('sub', rec_id)::text, true);
  update appointments set status = 'booked' where id = appt;
  update appointments
    set during = tstzrange('2031-03-03 10:00Z','2031-03-03 11:00Z')
    where id = appt;
  if not found then raise exception 'FAIL: reception can no longer move a session'; end if;

  -- ================= an attended session keeps its package =================
  update appointments set status = 'attended' where id = appt;
  blocked := false;
  begin
    update appointments set package_id = pkg where id = appt;
  exception when others then
    blocked := sqlerrm like '%attended session%';
  end;
  if not blocked then
    raise exception 'FAIL: an attended session was moved to another package';
  end if;

  -- ================= packages =================
  perform set_config('request.jwt.claims', json_build_object('sub', rec_id)::text, true);
  update packages set price = 1 where id = pkg;
  if found then raise exception 'FAIL: reception repriced a package'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_id)::text, true);
  update packages set price = 2100 where id = pkg;
  if not found then raise exception 'FAIL: an owner cannot correct a package price'; end if;

  delete from packages where id = pkg;
  if found then raise exception 'FAIL: a package was deleted'; end if;

  -- ================= a therapist cannot book =================
  perform set_config('request.jwt.claims', json_build_object('sub', ther_id)::text, true);
  blocked := false;
  begin
    insert into appointments (clinic_id, patient_id, therapist_id, during)
      values (c, p, ther_id, tstzrange('2031-04-04 10:00Z','2031-04-04 11:00Z'));
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'FAIL: a therapist booked an appointment'; end if;

  -- ================= a payment settles one thing, not two =================
  reset role;
  blocked := false;
  begin
    insert into payments (clinic_id, patient_id, package_id, appointment_id, amount, method, taken_by)
      values (c, p, pkg, appt, 50, 'cash', owner_id);
  exception when check_violation then
    blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL: a payment settled both a package and a session';
  end if;

  -- ================= isolation still holds =================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id)::text, true);
  select count(*) into n from patients where clinic_id = c2;
  if n <> 0 then raise exception 'FAIL: cross-clinic read returned % rows', n; end if;

  reset role;
  raise notice 'write surface: all checks passed';
end $$;

rollback;
