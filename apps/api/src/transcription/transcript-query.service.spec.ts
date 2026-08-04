import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AuthPrincipal } from '../auth/auth.types.js';
import type { PrismaService } from '../database/prisma.service.js';
import type {
  ProjectAccessService,
  ResourceAccessAuthorizer,
} from '../project-foundation/project-access.service.js';
import { TranscriptQueryService } from './transcript-query.service.js';

const ACTOR: AuthPrincipal = {
  displayName: 'Synthetic listener',
  id: '00000000-0000-4000-8000-000000000001',
  role: 'interviewer',
  sessionId: '00000000-0000-4000-8000-000000000002',
  sessionTokenHash: 'test-only-session-token-hash',
  status: 'active',
};

describe('TranscriptQueryService', () => {
  it('fails closed for an assigned non-data-admin when the project is restricted', async () => {
    const findMany = vi.fn();
    const prisma = {
      interviewSession: {
        findUnique: vi.fn().mockResolvedValue({
          projectId: '00000000-0000-4000-8000-000000000003',
        }),
      },
      transcriptSegment: { findMany },
    } as unknown as PrismaService;
    const access = {
      assertCanAccess: vi.fn().mockResolvedValue({
        assignedUserIds: [ACTOR.id],
        createdBy: ACTOR.id,
        deletedAt: null,
        projectId: '00000000-0000-4000-8000-000000000003',
        status: 'restricted',
      }),
    } as unknown as ProjectAccessService;
    const authorization = {
      assertResourceAccess: vi.fn().mockRejectedValue(new ForbiddenException()),
    } as unknown as ResourceAccessAuthorizer;

    await expect(
      new TranscriptQueryService(prisma, access, authorization).listFinalSegments(
        ACTOR,
        '00000000-0000-4000-8000-000000000004',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findMany).not.toHaveBeenCalled();
  });
});
