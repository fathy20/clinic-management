/**
 * Development seed. Creates one clinic with an owner who can actually log in.
 *
 * Runs as the OWNER role because bootstrapping the first clinic is the one write
 * that cannot have a tenant context yet — there is no tenant.
 */
import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

const ARGON2ID = 2;
const PASSWORD = 'physioflow-dev-password';

async function main(): Promise<void> {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  const client = await pool.connect();

  try {
    await client.query('begin');

    const plan = await client.query<{ id: string }>(
      `insert into plans (code, name, price_egp, max_branches, features)
       values ('growth', 'Growth', '1600.00', 2, '{"portal":true,"hep":true}'::jsonb)
       on conflict (code) do update set name = excluded.name
       returning id`,
    );

    const clinic = await client.query<{ id: string }>(
      `insert into clinics (name, timezone) values ('مركز النيل للعلاج الطبيعي', 'Africa/Cairo')
       returning id`,
    );
    const clinicId = clinic.rows[0]!.id;

    await client.query(
      `insert into subscriptions (clinic_id, plan_id, status, current_period_end)
       values ($1, $2, 'active', now() + interval '30 days')`,
      [clinicId, plan.rows[0]!.id],
    );

    await client.query(
      `insert into branches (clinic_id, name, phone) values ($1, 'المعادي', '+20225551234')`,
      [clinicId],
    );

    const passwordHash = await hash(PASSWORD, {
      algorithm: ARGON2ID,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    const user = await client.query<{ id: string }>(
      `insert into users (email, phone, password_hash, full_name)
       values ('owner@physioflow.test', '+201000000001', $1, 'أحمد المالك')
       returning id`,
      [passwordHash],
    );

    await client.query(
      `insert into memberships (clinic_id, user_id, role) values ($1, $2, 'owner')`,
      [clinicId, user.rows[0]!.id],
    );

    await client.query('commit');

    console.log('seeded clinic', clinicId);
    console.log('login: owner@physioflow.test /', PASSWORD);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
