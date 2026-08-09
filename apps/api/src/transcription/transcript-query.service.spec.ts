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
          project: { consents: [{ revokedAt: null, status: 'valid' }] },
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

  it('uses only the stable (start_ms,id) cursor and returns projected DTOs', async () => {
    const firstId = '00000000-0000-4000-8000-000000000010';
    const secondId = '00000000-0000-4000-8000-000000000011';
    const findMany = vi
      .fn()
      .mockResolvedValue([
        segment(firstId, 'elder', 'unconfirmed'),
        segment(secondId, 'elder', 'user_confirmed'),
      ]);
    const prisma = {
      interviewSession: {
        findUnique: vi.fn().mockResolvedValue({
          project: { consents: [{ revokedAt: null, status: 'valid' }] },
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
        status: 'active',
      }),
    } as unknown as ProjectAccessService;
    const authorization = {} as ResourceAccessAuthorizer;
    const service = new TranscriptQueryService(prisma, access, authorization);

    const first = await service.listFinalSegments(ACTOR, randomSessionId(), {
      cursor: null,
      limit: 1,
    });
    expect(first.items[0]).toMatchObject({
      effective_speaker_role: 'elder',
      original_speaker_role: 'elder',
      trusted_effective_speaker_role: 'unknown',
    });
    expect(first.next_cursor).not.toBeNull();

    findMany.mockResolvedValueOnce([segment(secondId, 'elder', 'user_confirmed')]);
    const second = await service.listFinalSegments(ACTOR, randomSessionId(), {
      cursor: first.next_cursor,
      limit: 1,
    });
    expect(second.items[0]).toMatchObject({
      effective_speaker_role: 'elder',
      trusted_effective_speaker_role: 'elder',
    });
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({
      orderBy: [{ startMs: 'asc' }, { id: 'asc' }],
      where: {
        OR: [{ startMs: { gt: 100 } }, { id: { gt: firstId }, startMs: 100 }],
      },
    });
  });
});

function randomSessionId(): string {
  return '00000000-0000-4000-8000-000000000004';
}

function segment(
  id: string,
  role: 'elder' | 'interviewer' | 'unknown',
  authority: 'unconfirmed' | 'user_confirmed',
): Record<string, unknown> {
  return {
    contentKind: 'conversation',
    correctedAt: null,
    correctedBy: null,
    correctedSpeakerRole: null,
    correctedText: null,
    createdAt: new Date('2026-08-09T00:00:00.000Z'),
    endMs: 200,
    id,
    ingestKey: id,
    originalRoleAuthority: authority,
    originalSpeakerRole: role,
    originalText: 'synthetic evidence',
    providerPayload: null,
    providerSegmentId: null,
    sessionId: randomSessionId(),
    source: 'fixture',
    speakerProviderId: 'speaker_1',
    speakerRoleRevision: 0,
    speakerStreamId: '00000000-0000-4000-8000-000000000005',
    startMs: 100,
  };
}
