import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';
import { tenantStorage } from './tenant-context.js';

export type DbClient = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DbClient['transaction']>[0]>[0];

export interface Principal {
  clinicId: string | null;
  userId: string | null;
}

/**
 * The only way this application touches PostgreSQL.
 *
 * Every unit of work runs inside a transaction that first sets `app.clinic_id` and
 * `app.user_id` as **transaction-scoped** settings. The `true` third argument to
 * set_config is the difference between safe and catastrophic: a session-scoped
 * setting outlives the request and leaks to whoever borrows that pooled connection
 * next (PRD §15.4).
 */
@Injectable()
export class DrizzleService implements OnModuleDestroy {
  private readonly logger = new Logger(DrizzleService.name);
  private readonly pool: pg.Pool;
  private readonly db: DbClient;

  constructor(config: ConfigService) {
    const connectionString = config.getOrThrow<string>('DATABASE_APP_URL');
    this.pool = new pg.Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: 'physioflow-api',
    });
    this.db = drizzle(this.pool, { schema });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Run `fn` inside a transaction scoped to a tenant and an actor.
   *
   * A null clinic is a deliberate, narrow case — authentication, which happens
   * before any tenant is known. RLS then admits only the rows a principal owns
   * outright, and the pre-auth lookups go through SECURITY DEFINER functions.
   */
  async runInTenantTransaction<T>(
    principal: Principal,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        select
          set_config('app.clinic_id', ${principal.clinicId ?? ''}, true),
          set_config('app.user_id',   ${principal.userId ?? ''}, true)
      `);

      return tenantStorage.run({ ...principal, tx }, () => fn(tx));
    });
  }

  /**
   * Runs outside the request transaction, on its own connection, so the write
   * commits even when the caller then throws.
   *
   * Exists for exactly one case: refresh-token reuse detection. Revoking the token
   * family and then rejecting the request are both required, and doing them in one
   * transaction means the rejection rolls back the revocation — leaving a stolen
   * token family live. Do not reach for this anywhere else; it deliberately has no
   * tenant context, so callers must use SECURITY DEFINER functions.
   */
  async autonomous<T>(fn: (db: DbClient) => Promise<T>): Promise<T> {
    return fn(this.db);
  }

  /** Liveness only. Does not open a tenant transaction and reads no tenant data. */
  async ping(): Promise<boolean> {
    const result = await this.db.execute<{ ok: number }>(sql`select 1 as ok`);
    return result.rows[0]?.ok === 1;
  }
}
