import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, sql } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DrizzleService } from '../../database/drizzle.service.js';
import { currentContext } from '../../database/tenant-context.js';
import { refreshTokens, users } from '../../database/schema/index.js';
import type {
  AccessTokenPayload,
  AuthenticatedPrincipal,
  StaffRole,
  TokenPair,
} from './types.js';

/** `tx.execute<T>()` constrains T to Record<string, unknown>. */
type SqlRow<T> = T & Record<string, unknown>;

type FoundUser = SqlRow<{
  id: string;
  password_hash: string;
  is_active: boolean;
  full_name: string;
}>;

export interface ActiveMembership {
  clinicId: string;
  clinicName: string;
  role: StaffRole;
  branchId: string | null;
}

/**
 * `@node-rs/argon2` exports `Algorithm` as an ambient const enum, which
 * `isolatedModules` cannot read, so the variant is inlined. `argon2id.spec.ts`
 * asserts the produced hash actually carries the `$argon2id$` prefix — the
 * constant is checked against reality rather than trusted.
 */
const ARGON2ID = 2;

/** Argon2id (FR-IAM-01, NFR-SEC-04). OWASP-aligned parameters. */
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DrizzleService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  static hashPassword(plaintext: string): Promise<string> {
    return hash(plaintext, ARGON2_OPTIONS);
  }

  /** Refresh tokens are stored as SHA-256 hashes only, never in plaintext (FR-IAM-04). */
  private static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async login(
    identifier: string,
    password: string,
    requestedClinicId?: string,
  ): Promise<TokenPair & { principal: AuthenticatedPrincipal }> {
    const { tx } = currentContext();

    // The only read path permitted before a tenant context exists.
    const found = await tx.execute<FoundUser>(
      sql`select * from auth_find_user_by_identifier(${identifier.trim().toLowerCase()})`,
    );
    const user = found.rows[0];

    // Verify against a dummy hash when the user is absent, so that a missing
    // account and a wrong password take the same time to fail.
    const passwordHash = user?.password_hash ?? (await AuthService.dummyHash());
    const passwordOk = await verify(passwordHash, password).catch(() => false);

    if (!user || !passwordOk || !user.is_active) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // From here the actor is known, so the rest of the transaction runs with
    // app.user_id set and ordinary RLS applies.
    await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);

    const available = await this.activeMemberships(user.id);
    const membership = this.selectMembership(available, requestedClinicId);

    if (!membership && !(await this.isPlatformStaff(user.id))) {
      throw new UnauthorizedException(
        'This account has no active membership in any clinic',
      );
    }

    const principal: AuthenticatedPrincipal = {
      userId: user.id,
      clinicId: membership?.clinicId ?? null,
      role: membership?.role ?? null,
      branchId: membership?.branchId ?? null,
      isPlatformStaff: membership === null,
    };

    await tx
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    const tokens = await this.issueTokens(principal, randomUUID());
    return { ...tokens, principal };
  }

  /**
   * FR-IAM-02 — rotation with reuse detection. Presenting a token that has already
   * been redeemed revokes the entire family, on the assumption that the holder is
   * not the person the token was issued to.
   */
  async refresh(presentedToken: string): Promise<TokenPair> {
    const { tx } = currentContext();
    const tokenHash = AuthService.hashToken(presentedToken);

    const found = await tx.execute<
      SqlRow<{
        id: string;
        user_id: string;
        family_id: string;
        clinic_id: string | null;
        expires_at: string | Date;
        used_at: string | Date | null;
        revoked_at: string | Date | null;
      }>
    >(sql`select * from auth_find_refresh_token(${tokenHash})`);

    const row = found.rows[0];
    if (!row) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (row.used_at !== null) {
      // Deliberately outside this transaction: the UnauthorizedException below
      // would otherwise roll the revocation back and leave the family live.
      const revoked = await this.db.autonomous((db) =>
        db.execute<SqlRow<{ auth_revoke_token_family: number }>>(
          sql`select auth_revoke_token_family(${row.family_id})`,
        ),
      );
      this.logger.warn(
        `Refresh token reuse detected for family ${row.family_id}; revoked ${
          revoked.rows[0]?.auth_revoke_token_family ?? 0
        } token(s)`,
      );
      throw new UnauthorizedException('Refresh token has already been used');
    }

    if (
      row.revoked_at !== null ||
      new Date(row.expires_at).getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Refresh token is no longer valid');
    }

    await tx.execute(
      sql`select set_config('app.user_id', ${row.user_id}, true)`,
    );
    if (row.clinic_id) {
      await tx.execute(
        sql`select set_config('app.clinic_id', ${row.clinic_id}, true)`,
      );
    }

    await tx
      .update(refreshTokens)
      .set({ usedAt: new Date() })
      .where(eq(refreshTokens.id, row.id));

    const available = await this.activeMemberships(row.user_id);
    const membership = this.selectMembership(
      available,
      row.clinic_id ?? undefined,
    );

    return this.issueTokens(
      {
        userId: row.user_id,
        clinicId: membership?.clinicId ?? null,
        role: membership?.role ?? null,
        branchId: membership?.branchId ?? null,
        isPlatformStaff: membership === null,
      },
      row.family_id,
    );
  }

  async logout(presentedToken: string): Promise<void> {
    const { tx } = currentContext();
    const found = await tx.execute<SqlRow<{ family_id: string }>>(
      sql`select * from auth_find_refresh_token(${AuthService.hashToken(presentedToken)})`,
    );
    const familyId = found.rows[0]?.family_id;
    if (familyId) {
      await tx.execute(sql`select auth_revoke_token_family(${familyId})`);
    }
  }

  async activeMemberships(userId: string): Promise<ActiveMembership[]> {
    const { tx } = currentContext();
    const rows = await tx.execute<
      SqlRow<{
        clinic_id: string;
        clinic_name: string;
        role: StaffRole;
        branch_id: string | null;
      }>
    >(sql`
      select m.clinic_id, c.name as clinic_name, m.role, m.branch_id
        from memberships m
        join clinics c on c.id = m.clinic_id
       where m.user_id = ${userId} and m.revoked_at is null
    `);

    return rows.rows.map((r) => ({
      clinicId: r.clinic_id,
      clinicName: r.clinic_name,
      role: r.role,
      branchId: r.branch_id,
    }));
  }

  private selectMembership(
    available: ActiveMembership[],
    requestedClinicId?: string,
  ): ActiveMembership | null {
    if (available.length === 0) {
      return null;
    }
    if (requestedClinicId) {
      const match = available.find((m) => m.clinicId === requestedClinicId);
      if (!match) {
        throw new UnauthorizedException(
          'No active membership in the requested clinic',
        );
      }
      return match;
    }
    if (available.length > 1) {
      throw new BadRequestException({
        message: 'This account belongs to more than one clinic. Choose one.',
        clinics: available.map((m) => ({ id: m.clinicId, name: m.clinicName })),
      });
    }
    return available[0] ?? null;
  }

  private async isPlatformStaff(userId: string): Promise<boolean> {
    const { tx } = currentContext();
    const rows = await tx
      .select({ isPlatformStaff: users.isPlatformStaff })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.isActive, true)));
    return rows[0]?.isPlatformStaff === true;
  }

  private async issueTokens(
    principal: AuthenticatedPrincipal,
    familyId: string,
  ): Promise<TokenPair> {
    const { tx } = currentContext();

    const payload: AccessTokenPayload = {
      sub: principal.userId,
      cid: principal.clinicId,
      role: principal.role,
      bid: principal.branchId,
      pf: principal.isPlatformStaff,
    };

    const signOptions: JwtSignOptions = {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.getOrThrow<string>(
        'JWT_ACCESS_TTL',
      ) as JwtSignOptions['expiresIn'],
    };
    const accessToken = await this.jwt.signAsync(payload, signOptions);

    const refreshToken = randomBytes(48).toString('base64url');
    const ttlDays = AuthService.parseDays(
      this.config.getOrThrow<string>('JWT_REFRESH_TTL'),
    );

    await tx.insert(refreshTokens).values({
      userId: principal.userId,
      familyId,
      tokenHash: AuthService.hashToken(refreshToken),
      clinicId: principal.clinicId,
      expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
    });

    return { accessToken, refreshToken, expiresIn: 15 * 60 };
  }

  private static parseDays(ttl: string): number {
    const match = /^(\d+)d$/.exec(ttl);
    return match?.[1] ? Number(match[1]) : 30;
  }

  private static dummyHashCache: string | null = null;
  private static async dummyHash(): Promise<string> {
    AuthService.dummyHashCache ??= await hash(
      'physioflow-timing-equaliser',
      ARGON2_OPTIONS,
    );
    return AuthService.dummyHashCache;
  }
}
