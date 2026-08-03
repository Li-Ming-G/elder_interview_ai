import type { UserRole, UserStatus } from '@elder-interview/contracts';
import type { Request } from 'express';

export interface AuthPrincipal {
  id: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  sessionId: string;
  sessionTokenHash: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthPrincipal;
}

export interface DerivedResourceContext {
  ownerUserId: string | null;
  assignedUserIds: readonly string[];
  restrictedToDataAdmin?: boolean;
}
