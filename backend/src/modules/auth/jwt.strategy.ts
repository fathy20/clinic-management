import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AccessTokenPayload, AuthenticatedPrincipal } from './types.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  /**
   * Tenant context is derived exclusively from the signed token (FR-PLT-02).
   * Nothing here reads a header, a query parameter, or a body field.
   */
  validate(payload: AccessTokenPayload): AuthenticatedPrincipal {
    if (!payload?.sub) {
      throw new UnauthorizedException('Malformed token');
    }
    return {
      userId: payload.sub,
      clinicId: payload.cid ?? null,
      role: payload.role ?? null,
      branchId: payload.bid ?? null,
      isPlatformStaff: payload.pf === true,
    };
  }
}
