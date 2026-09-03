import { AsyncLocalStorage } from 'node:async_hooks';
import type { Tx } from './drizzle.service.js';

/**
 * The principal a request is acting as, plus the transaction its work runs in.
 *
 * Held in AsyncLocalStorage so a service never has to thread a transaction handle
 * through every call — and, more importantly, so no code path can accidentally
 * reach the pool directly and escape the tenant GUCs.
 */
export interface TenantContext {
  clinicId: string | null;
  userId: string | null;
  tx: Tx;
}

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function currentContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new Error(
      'No tenant context. Database work must run inside DrizzleService.runInTenantTransaction().',
    );
  }
  return ctx;
}
