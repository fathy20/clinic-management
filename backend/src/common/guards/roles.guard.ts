import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type {
  AuthenticatedPrincipal,
  StaffRole,
} from '../../modules/auth/types.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedPrincipal }>();

    // An explicit allow-list check. `user.role` may legitimately be null for
    // platform staff, and null must fail closed rather than slip through.
    if (!user?.role || !required.includes(user.role)) {
      throw new ForbiddenException(
        'This account does not hold a role permitted for this action',
      );
    }
    return true;
  }
}
