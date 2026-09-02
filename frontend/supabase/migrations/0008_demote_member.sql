-- Demoting a member, with the last-owner guard inside the write.
--
-- The application used to count owners and then update, which is a race: two
-- owners demoting each other in the same moment both read a count of 2, both
-- proceed, and the clinic is left with nobody who can administer it. Recovery
-- from that needs direct SQL access.
--
-- Doing the count and the update in one statement makes Postgres resolve it:
-- the second transaction sees the first one's effect and its own guard fails.
create or replace function demote_member(
  p_clinic uuid,
  p_user   uuid,
  p_role   clinic_role
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed int;
begin
  -- Security definer, so the caller's own privileges are bypassed — which
  -- means this function must check them itself. Only an owner OF THIS CLINIC
  -- may demote anyone in it.
  -- `is distinct from`, not `<>`. my_role() returns NULL for someone with no
  -- membership in this clinic at all, and `NULL <> 'owner'` is NULL, not true
  -- — so plain inequality let a complete stranger through this check. They
  -- then updated nothing and got a plain `false` back, which reads as "last
  -- owner" rather than "not yours". A live harness caught it.
  if my_role(p_clinic) is distinct from 'owner' then
    raise exception 'only an owner can change a role in this clinic';
  end if;

  if p_role = 'owner' then
    raise exception 'demote_member is for removing owner, not granting it';
  end if;

  with owners as (
    select user_id from memberships
    where clinic_id = p_clinic and role = 'owner'
    for update
  )
  update memberships m
     set role = p_role
   where m.clinic_id = p_clinic
     and m.user_id = p_user
     -- the row survives only if it is not the clinic's last owner
     and (m.role <> 'owner' or (select count(*) from owners) > 1);

  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

-- The function is the only way in, so revoke the blanket EXECUTE Postgres
-- grants to PUBLIC on every new function. A security definer function in a
-- schema the API exposes is otherwise a public endpoint.
revoke all on function demote_member(uuid, uuid, clinic_role) from public;
grant execute on function demote_member(uuid, uuid, clinic_role) to authenticated;
