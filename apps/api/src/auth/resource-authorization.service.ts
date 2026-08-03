import { ForbiddenException, Injectable } from '@nestjs/common';
import type { UserRole } from '@elder-interview/contracts';

import { PrismaService } from '../database/prisma.service.js';
import type { AuthPrincipal, DerivedResourceContext } from './auth.types.js';

@Injectable()
export class ResourceAuthorizationService {
  public constructor(private readonly prisma: PrismaService) {}

  public async assertRole(actor: AuthPrincipal, roles: readonly UserRole[]): Promise<void> {
    if (!roles.includes(actor.role)) await this.deny(actor, 'role');
  }

  public async assertResourceAccess(
    actor: AuthPrincipal,
    context: DerivedResourceContext,
  ): Promise<void> {
    if (context.restrictedToDataAdmin === true) {
      if (actor.role !== 'data_admin') await this.deny(actor, 'restricted_resource');
      return;
    }
    if (actor.role === 'data_admin') return;
    if (actor.role === 'admin') await this.deny(actor, 'resource');
    const allowed = context.ownerUserId === actor.id || context.assignedUserIds.includes(actor.id);
    if (!allowed) await this.deny(actor, 'resource');
  }

  private async deny(actor: AuthPrincipal, kind: string): Promise<never> {
    await this.prisma.auditLog.create({
      data: {
        action: 'auth.permission_denied',
        actorId: actor.id,
        actorType: 'user',
        entityId: actor.id,
        entityType: 'user',
        metadata: { kind },
      },
    });
    throw new ForbiddenException({ code: 'FORBIDDEN', details: {}, message: 'Access denied' });
  }
}
