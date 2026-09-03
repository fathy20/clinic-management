import { defineConfig } from 'drizzle-kit';

/**
 * Migrations are generated and applied as the OWNER role. The application connects
 * as a separate non-superuser role (FR-PLT-04) — see `DATABASE_APP_URL`.
 */
export default defineConfig({
  schema: './src/database/schema/index.ts',
  out: './src/database/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://physioflow_owner:local_dev_only@localhost:55432/physioflow',
  },
  verbose: true,
  strict: true,
});
