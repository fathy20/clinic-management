import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Opts a route out of JwtAuthGuard. Authentication endpoints only. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
