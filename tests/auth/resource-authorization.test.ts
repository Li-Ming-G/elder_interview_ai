import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ResourceAuthorizationService } from '../../apps/api/src/auth/resource-authorization.service.js';
import type { AuthPrincipal } from '../../apps/api/src/auth/auth.types.js';
import type { PrismaService } from '../../apps/api/src/database/prisma.service.js';

const actor: AuthPrincipal = {
  displayName: '虚构倾听员 A',
  id: 'listener-a',
  role: 'interviewer',
  sessionId: 'session',
  sessionTokenHash: 'hash',
  status: 'active',
};

describe('ResourceAuthorizationService', () => {
  const auditCreate = vi.fn().mockResolvedValue({});
  const prisma = { auditLog: { create: auditCreate } } as unknown as PrismaService;
  const authorization = new ResourceAuthorizationService(prisma);

  beforeEach(() => {
    auditCreate.mockClear();
  });

  it('accepts persistence-derived ownership or assignment context', async () => {
    await expect(
      authorization.assertResourceAccess(actor, {
        assignedUserIds: [],
        ownerUserId: actor.id,
      }),
    ).resolves.toBeUndefined();
    await expect(
      authorization.assertResourceAccess(actor, {
        assignedUserIds: [actor.id],
        ownerUserId: null,
      }),
    ).resolves.toBeUndefined();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('rejects and audits cross-user access without an isAllowed boolean', async () => {
    await expect(
      authorization.assertResourceAccess(actor, {
        assignedUserIds: ['listener-b'],
        ownerUserId: 'listener-b',
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(auditCreate).toHaveBeenCalledOnce();
  });

  it('keeps admin out of content and restricts sensitive context to data_admin', async () => {
    await expect(
      authorization.assertResourceAccess(
        { ...actor, role: 'admin' },
        {
          assignedUserIds: [actor.id],
          ownerUserId: actor.id,
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      authorization.assertResourceAccess(actor, {
        assignedUserIds: [actor.id],
        ownerUserId: actor.id,
        restrictedToDataAdmin: true,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(auditCreate).toHaveBeenCalledTimes(2);
  });
});
