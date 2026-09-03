import { SetMetadata } from '@nestjs/common';
import type { StaffRole } from '../../modules/auth/types.js';

export const ROLES_KEY = 'roles';

/**
 * An explicit allow-list. Never expressed as "everyone except X" — a null role
 * satisfies a negation and passes (PRD §10.1 acceptance criteria).
 */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);
