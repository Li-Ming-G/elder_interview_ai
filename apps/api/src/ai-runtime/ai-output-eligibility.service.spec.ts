import { describe, expect, it, vi } from 'vitest';

import type { AiPolicyService } from './ai-policy.service.js';
import { AiOutputEligibilityService } from './ai-output-eligibility.service.js';
import type { PrismaService } from '../database/prisma.service.js';

const IDS = {
  actor: '11111111-1111-4111-8111-111111111111',
  authority: '22222222-2222-4222-8222-222222222222',
  identity: '33333333-3333-4333-8333-333333333333',
  project: '44444444-4444-4444-8444-444444444444',
  resolution: '55555555-5555-4555-8555-555555555555',
  revision: '66666666-6666-4666-8666-666666666666',
  root: '77777777-7777-4777-8777-777777777777',
};

describe('AiOutputEligibilityService memory identity retention', () => {
  it('resolves stable identity retention through the actual resolution row', async () => {
    let resolution = {
      authority: 'human_confirmed',
      authorityId: IDS.authority,
      canonicalKey: 'synthetic-key',
      id: IDS.resolution,
      memoryRetentionRootId: IDS.root,
      projectId: IDS.project,
      provenanceState: null as 'detached_session' | null,
      resolutionRevision: 2,
      semanticStatus: 'current',
      status: 'current',
    };
    const prisma = {
      memoryLayerIdentity: {
        findUnique: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === IDS.identity ? { id: IDS.identity, projectId: IDS.project } : null,
          ),
        ),
      },
      memoryLayerRevision: {
        findFirst: vi.fn().mockResolvedValue({
          identityId: IDS.identity,
          layer: 'mid',
          projectId: IDS.project,
          resolutionAuthorityId: IDS.authority,
          resolutionRevision: 2,
          resolutionRowId: IDS.resolution,
          revisionNo: 2,
          semanticStatus: 'current',
        }),
      },
      memoryResolution: {
        findUnique: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === IDS.resolution ? resolution : null),
        ),
      },
      memoryRetentionRoot: {
        findUnique: vi.fn().mockResolvedValue({
          expiresAt: new Date(Date.now() + 60_000),
          retentionState: 'active',
        }),
      },
    } as unknown as PrismaService;
    const policy = {
      assertAllowed: vi.fn().mockResolvedValue({ blockedCanonicalKeys: [] }),
    } as unknown as AiPolicyService;
    const eligibility = new AiOutputEligibilityService(prisma, policy);

    await expect(
      eligibility.isMemoryIdentityEligible(IDS.actor, IDS.project, IDS.identity),
    ).resolves.toBe(true);
    await expect(
      eligibility.isMemoryIdentityEligible(IDS.actor, IDS.project, IDS.resolution),
    ).resolves.toBe(false);

    resolution = { ...resolution, provenanceState: 'detached_session' };
    await expect(
      eligibility.isMemoryIdentityEligible(IDS.actor, IDS.project, IDS.identity),
    ).resolves.toBe(false);
  });
});
