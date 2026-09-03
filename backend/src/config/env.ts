import { z } from 'zod';

/**
 * Fail at boot, not at the first request. A missing secret is a deployment bug and
 * should look like one.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  /** Owner role. Runs migrations, owns the schema, never used at runtime. */
  DATABASE_URL: z.string().min(1),
  /** Application role: non-superuser, RLS applies, no DELETE (FR-PLT-04, NFR-SEC-09). */
  DATABASE_APP_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).optional(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  /** FR-IAM-02: 15 minutes, and refresh tokens rotate with reuse detection. */
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  return parsed.data;
}
