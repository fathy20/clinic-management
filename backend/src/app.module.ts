import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { validateEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { TenantTransactionInterceptor } from './common/interceptors/tenant-transaction.interceptor.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';

/**
 * Modular monolith. One deployable, one database, module boundaries enforced by
 * imports rather than by network calls (PRD §15.1).
 *
 * Order matters: JwtAuthGuard resolves the principal, RolesGuard checks it, and
 * only then does TenantTransactionInterceptor open the transaction that carries
 * the tenant GUCs. Guards always run before interceptors in NestJS.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
  ],
})
export class AppModule {}
