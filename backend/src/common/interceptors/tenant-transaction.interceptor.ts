import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { DrizzleService } from '../../database/drizzle.service.js';
import type { AuthenticatedPrincipal } from '../../modules/auth/types.js';

/**
 * Runs every request inside one tenant-scoped transaction.
 *
 * Guards run before interceptors, so `request.user` is already resolved here. A
 * public route (login) opens the transaction with a null principal — RLS then
 * admits only rows a principal owns outright, and the pre-auth lookups go through
 * SECURITY DEFINER functions.
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(private readonly db: DrizzleService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedPrincipal }>();

    return from(
      this.db.runInTenantTransaction(
        {
          clinicId: user?.clinicId ?? null,
          userId: user?.userId ?? null,
        },
        () => lastValueFrom(next.handle()),
      ),
    );
  }
}
