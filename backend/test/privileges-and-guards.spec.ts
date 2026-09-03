import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  closePools,
  ownerPool,
  seedClinic,
  type SeededClinic,
} from './helpers/db.js';

/** Functions this project owns. Extension functions are not ours to configure. */
const OUR_FUNCTIONS = [
  'app_current_clinic_id',
  'app_current_user_id',
  'assert_tenant_writable',
  'auth_find_refresh_token',
  'auth_find_user_by_identifier',
  'auth_revoke_token_family',
  'guard_last_owner',
  'guard_membership_branch',
];

afterAll(async () => {
  await closePools();
});

describe('privilege-level immutability (NFR-SEC-09, DoD gate 9)', () => {
  it('the application role holds no DELETE on any table', async () => {
    const { rows } = await ownerPool.query<{ table_name: string }>(
      `select table_name from information_schema.role_table_grants
        where grantee = 'physioflow_app' and privilege_type = 'DELETE'`,
    );
    expect(rows).toEqual([]);
  });

  it('a DELETE attempt is refused by the database, not by the application', async () => {
    const clinic = await seedClinic('Delete probe');
    await expect(
      asTenant({ clinicId: clinic.clinicId, userId: clinic.ownerUserId }, (c) =>
        c.query('delete from branches where clinic_id = $1', [clinic.clinicId]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('the application role is not a superuser and cannot bypass RLS', async () => {
    const { rows } = await ownerPool.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `select rolsuper, rolbypassrls from pg_roles where rolname = 'physioflow_app'`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('every table carrying clinic_id has row-level security forced and at least one policy', async () => {
    const { rows } = await ownerPool.query<{
      table: string;
      forced: boolean;
      policies: string;
    }>(
      `select c.relname as table, c.relforcerowsecurity as forced,
              (select count(*) from pg_policies p where p.tablename = c.relname) as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and exists (
            select 1 from information_schema.columns col
             where col.table_name = c.relname and col.column_name = 'clinic_id'
          )`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.forced, `${row.table} must force RLS`).toBe(true);
      expect(
        Number(row.policies),
        `${row.table} must have a policy`,
      ).toBeGreaterThan(0);
    }
  });
});

describe('cross-reference guards (FR-PLT-05, DoD gate 2)', () => {
  let a: SeededClinic;
  let b: SeededClinic;

  beforeAll(async () => {
    a = await seedClinic('Guard A');
    b = await seedClinic('Guard B');
  });

  it('every function that reads another table is SECURITY DEFINER with a pinned search_path', async () => {
    const { rows } = await ownerPool.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
    }>(
      `select p.proname, p.prosecdef, p.proconfig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1)`,
      [OUR_FUNCTIONS],
    );

    expect(rows.map((r) => r.proname).sort()).toEqual(
      [...OUR_FUNCTIONS].sort(),
    );

    for (const fn of rows) {
      expect(
        fn.proconfig?.join(','),
        `${fn.proname} must pin search_path`,
      ).toMatch(/search_path=/);
    }

    // The guards and pre-auth lookups read rows RLS exists to hide. Without DEFINER
    // the lookup returns NULL, the comparison is NULL rather than true, and the guard
    // admits exactly the row it was written to reject.
    const mustBeDefiner = rows.filter(
      (r) =>
        r.proname.startsWith('guard_') ||
        r.proname.startsWith('auth_') ||
        r.proname === 'assert_tenant_writable',
    );
    expect(mustBeDefiner.length).toBe(6);
    for (const fn of mustBeDefiner) {
      expect(fn.prosecdef, `${fn.proname} must be SECURITY DEFINER`).toBe(true);
    }
  });

  it("rejects a membership pointing at another clinic's branch", async () => {
    const stranger = await ownerPool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ($1, 'x', 'Stranger') returning id`,
      [`stranger_${Date.now()}@example.test`],
    );

    await expect(
      asTenant({ clinicId: a.clinicId, userId: a.ownerUserId }, (c) =>
        c.query(
          `insert into memberships (clinic_id, user_id, role, branch_id)
           values ($1, $2, 'reception', $3)`,
          [a.clinicId, stranger.rows[0]!.id, b.branchId],
        ),
      ),
    ).rejects.toThrow(/does not belong to clinic/i);
  });
});

describe('subscription read-only mode (FR-PLT-07, review F15)', () => {
  it('an expired subscription refuses writes in the database and still permits reads', async () => {
    const clinic = await seedClinic('Expiring');

    await ownerPool.query(
      `update subscriptions set status = 'expired' where clinic_id = $1`,
      [clinic.clinicId],
    );

    await expect(
      asTenant({ clinicId: clinic.clinicId, userId: clinic.ownerUserId }, (c) =>
        c.query('insert into branches (clinic_id, name) values ($1, $2)', [
          clinic.clinicId,
          'Second site',
        ]),
      ),
    ).rejects.toThrow(/read-only/i);

    const rows = await asTenant(
      { clinicId: clinic.clinicId, userId: clinic.ownerUserId },
      async (c) => (await c.query('select id from branches')).rows,
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('last-owner protection (FR-IAM-08, DoD gate 10)', () => {
  it('two concurrent demotions leave exactly one owner standing', async () => {
    const clinic = await seedClinic('Two owners');

    const second = await ownerPool.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ($1, 'x', 'Second owner') returning id`,
      [`owner2_${Date.now()}@example.test`],
    );
    await ownerPool.query(
      `insert into memberships (clinic_id, user_id, role) values ($1, $2, 'owner')`,
      [clinic.clinicId, second.rows[0]!.id],
    );

    const owners = await ownerPool.query<{ id: string }>(
      `select id from memberships
        where clinic_id = $1 and role = 'owner' and revoked_at is null order by created_at`,
      [clinic.clinicId],
    );
    expect(owners.rows).toHaveLength(2);

    const demote = (membershipId: string) =>
      asTenant({ clinicId: clinic.clinicId, userId: clinic.ownerUserId }, (c) =>
        c.query('update memberships set revoked_at = now() where id = $1', [
          membershipId,
        ]),
      );

    const results = await Promise.allSettled([
      demote(owners.rows[0]!.id),
      demote(owners.rows[1]!.id),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded).toHaveLength(1);

    const remaining = await ownerPool.query(
      `select id from memberships
        where clinic_id = $1 and role = 'owner' and revoked_at is null`,
      [clinic.clinicId],
    );
    expect(remaining.rows).toHaveLength(1);
  });
});
