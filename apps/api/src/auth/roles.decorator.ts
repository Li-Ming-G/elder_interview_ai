import type { UserRole } from '@elder-interview/contracts';
import { SetMetadata } from '@nestjs/common';

export const AUTH_ROLES = 'auth_roles';
export const Roles = (...roles: UserRole[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(AUTH_ROLES, roles);
