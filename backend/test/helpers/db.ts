import 'dotenv/config';
import pg from 'pg';
import { randomUUID } from 'node:crypto';

/**
 * Two connections, deliberately.
 *
 * `owner` is a superuser and therefore **bypasses RLS entirely** — it is used only
 * to seed fixtures. Every assertion about isolation runs on `app`, the non-superuser
 * role the API actually uses. A test suite that asserts isolation while connected as
 * the owner proves nothing: the policies are not even consulted.
 */
export const ownerPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
});

export const appPool = new pg.Pool({
  connectionString: process.env.DATABASE_APP_URL,
  max: 8,
});

export interface SeededClinic {
  clinicId: string;
  branchId: string;
  ownerUserId: string;
  receptionUserId: string;
}

/** Seeds an isolated clinic with an owner, a receptionist and one branch. */
export async function seedClinic(label: string): Promise<SeededClinic> {
  const suffix = randomUUID().slice(0, 8);
  const client = await ownerPool.connect();
  try {
    await client.query('begin');

    const plan = await client.query<{ id: string }>(
      `insert into plans (code, name, price_egp, max_branches)
       values ($1, $2, '900.00', 1)
       on conflict (code) do update set name = excluded.name
       returning id`,
      [`test_${suffix}`, `Test plan ${label}`],
    );

    const clinic = await client.query<{ id: string }>(
      `insert into clinics (name) values ($1) returning id`,
      [`${label} ${suffix}`],
    );
    const clinicId = clinic.rows[0]!.id;

    await client.query(
      `insert into subscriptions (clinic_id, plan_id, status) values ($1, $2, 'active')`,
      [clinicId, plan.rows[0]!.id],
    );

    const branch = await client.query<{ id: string }>(
      `insert into branches (clinic_id, name) values ($1, 'Main') returning id`,
      [clinicId],
    );

    const ownerUser = await client.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ($1, 'x', $2) returning id`,
      [`owner_${suffix}@example.test`, `${label} owner`],
    );
    const receptionUser = await client.query<{ id: string }>(
      `insert into users (email, password_hash, full_name)
       values ($1, 'x', $2) returning id`,
      [`reception_${suffix}@example.test`, `${label} reception`],
    );

    await client.query(
      `insert into memberships (clinic_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'reception')`,
      [clinicId, ownerUser.rows[0]!.id, receptionUser.rows[0]!.id],
    );

    await client.query('commit');

    return {
      clinicId,
      branchId: branch.rows[0]!.id,
      ownerUserId: ownerUser.rows[0]!.id,
      receptionUserId: receptionUser.rows[0]!.id,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Runs `fn` exactly as the API does: one transaction on the application role, with
 * the tenant GUCs set transaction-locally.
 */
export async function asTenant<T>(
  principal: { clinicId?: string | null; userId?: string | null },
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query('begin');
    await client.query(
      `select set_config('app.clinic_id', $1, true), set_config('app.user_id', $2, true)`,
      [principal.clinicId ?? '', principal.userId ?? ''],
    );
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function closePools(): Promise<void> {
  await Promise.all([ownerPool.end(), appPool.end()]);
}
