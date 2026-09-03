import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  closePools,
  ownerPool,
  seedClinic,
  type SeededClinic,
} from './helpers/db.js';

/**
 * Definition of Done, gate 1: Clinic A reading Clinic B returns zero rows via four
 * distinct access paths.
 *
 * Every query below runs on the application role. As the owner role these all
 * return rows, because a superuser bypasses RLS — which is exactly the trap this
 * suite exists to avoid falling into.
 */
describe('tenant isolation (FR-PLT-01, FR-PLT-02)', () => {
  let a: SeededClinic;
  let b: SeededClinic;

  beforeAll(async () => {
    a = await seedClinic('Clinic A');
    b = await seedClinic('Clinic B');
  });

  afterAll(async () => {
    await closePools();
  });

  it('path 1 — reads no other clinic through branches', async () => {
    const rows = await asTenant(
      { clinicId: a.clinicId, userId: a.ownerUserId },
      async (c) =>
        (
          await c.query('select id from branches where clinic_id = $1', [
            b.clinicId,
          ])
        ).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it('path 2 — reads no other clinic through memberships', async () => {
    const rows = await asTenant(
      { clinicId: a.clinicId, userId: a.ownerUserId },
      async (c) =>
        (
          await c.query('select id from memberships where clinic_id = $1', [
            b.clinicId,
          ])
        ).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it('path 3 — reads no other clinic through the clinics row itself', async () => {
    const rows = await asTenant(
      { clinicId: a.clinicId, userId: a.ownerUserId },
      async (c) =>
        (await c.query('select id from clinics where id = $1', [b.clinicId]))
          .rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("path 4 — reads no other clinic's staff through users", async () => {
    const rows = await asTenant(
      { clinicId: a.clinicId, userId: a.ownerUserId },
      async (c) =>
        (await c.query('select id from users where id = $1', [b.ownerUserId]))
          .rows,
    );
    expect(rows).toHaveLength(0);
  });

  it('an unscoped select sees only its own tenant, not everything', async () => {
    const rows = await asTenant(
      { clinicId: a.clinicId, userId: a.ownerUserId },
      async (c) => (await c.query('select clinic_id from branches')).rows,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.clinic_id === a.clinicId)).toBe(true);
  });

  it('cannot write a row into another tenant', async () => {
    await expect(
      asTenant({ clinicId: a.clinicId, userId: a.ownerUserId }, (c) =>
        c.query('insert into branches (clinic_id, name) values ($1, $2)', [
          b.clinicId,
          'Smuggled',
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('the same query as the owner role DOES return rows — proving RLS is what stops it', async () => {
    const { rows } = await ownerPool.query(
      'select id from branches where clinic_id = $1',
      [b.clinicId],
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('tenant context does not survive the transaction that set it', async () => {
    // set_config(..., true) is transaction-local. If this ever returns a clinic id,
    // a pooled connection is leaking one request's tenant into the next.
    await asTenant(
      { clinicId: a.clinicId, userId: a.ownerUserId },
      async (c) => {
        const inside = await c.query<{ v: string | null }>(
          `select nullif(current_setting('app.clinic_id', true), '') as v`,
        );
        expect(inside.rows[0]!.v).toBe(a.clinicId);
      },
    );

    const leaked = await asTenant(
      {},
      async (c) =>
        (
          await c.query<{ v: string | null }>(
            `select nullif(current_setting('app.clinic_id', true), '') as v`,
          )
        ).rows[0]!.v,
    );
    expect(leaked).toBeNull();
  });
});
