import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../../modules/auth/types.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPrincipal => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user: AuthenticatedPrincipal }>();
    return request.user;
  },
);
