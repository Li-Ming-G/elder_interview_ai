import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../database/prisma.service.js';
import { effectiveTextDigest } from '../ai-runtime/ai-provenance.js';
import { PrismaEvidenceDrilldownReader } from './evidence-drilldown.reader.js';

const IDS = {
  authority: '11111111-1111-4111-8111-111111111111',
  claim: '22222222-2222-4222-8222-222222222222',
  evidence: '33333333-3333-4333-8333-333333333333',
  input: '44444444-4444-4444-8444-444444444444',
  project: '55555555-5555-4555-8555-555555555555',
  resolution: '66666666-6666-4666-8666-666666666666',
  revision: '77777777-7777-4777-8777-777777777777',
  segment: '88888888-8888-4888-8888-888888888888',
  session: '99999999-9999-4999-8999-999999999999',
  stableIdentity: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

describe('PrismaEvidenceDrilldownReader', () => {
  it('resolves stable identity IDs and rejects resolution-row IDs', async () => {
    const text = 'Stable identity evidence.';
    const identity = { id: IDS.stableIdentity, projectId: IDS.project };
    const revision = {
      id: IDS.revision,
      identityId: IDS.stableIdentity,
      layer: 'mid',
      lifecycleStatus: 'current',
      memberManifestHash: 'a'.repeat(64),
      projectId: IDS.project,
      resolutionAuthorityId: IDS.authority,
      resolutionRevision: 2,
      revisionNo: 2,
      semanticStatus: 'current',
      resolutionRowId: IDS.resolution,
    };
    const resolution = {
      id: IDS.resolution,
      authorityId: IDS.authority,
      p2Write: true,
      projectId: IDS.project,
      resolutionRevision: 2,
      semanticKind: 'episode',
      semanticStatus: 'current',
      status: 'current',
    };
    const authority = {
      authorityRevision: 1,
      effectiveTextDigest: effectiveTextDigest(text),
      evidenceId: IDS.evidence,
      membershipDigest: 'b'.repeat(64),
      projectId: IDS.project,
      sessionId: IDS.session,
      sourceId: IDS.segment,
      sourceKind: 'transcript_segment',
      speakerRoleRevision: 1,
      transcriptTextRevision: 1,
    };
    const prisma = {
      aiJobInputSegment: {
        findMany: vi.fn().mockResolvedValue([
          {
            contentKind: 'conversation',
            effectiveTextDigest: effectiveTextDigest(text),
            id: IDS.input,
            sessionId: IDS.session,
            speakerRoleRevision: 1,
            textRevision: 1,
            transcriptSegmentId: IDS.segment,
          },
        ]),
      },
      memoryClaimEvidence: {
        findMany: vi.fn().mockResolvedValue([
          {
            aiJobInputSegmentId: IDS.input,
            authorityRevision: 1,
            evidenceId: IDS.evidence,
            evidenceOrder: 0,
            memoryClaimId: IDS.claim,
            transcriptSegmentId: IDS.segment,
          },
        ]),
      },
      memoryEvidenceAuthority: { findMany: vi.fn().mockResolvedValue([authority]) },
      memoryEvidenceBridge: {
        findMany: vi.fn().mockResolvedValue([
          {
            aiJobInputSegmentId: IDS.input,
            authorityRevision: 1,
            claimId: IDS.claim,
            evidenceId: IDS.evidence,
          },
        ]),
      },
      memoryLayerIdentity: {
        findUnique: vi.fn((args: { where: { id: string } }) =>
          Promise.resolve(args.where.id === IDS.stableIdentity ? identity : null),
        ),
      },
      memoryLayerRevision: { findFirst: vi.fn().mockResolvedValue(revision) },
      memoryLayerRevisionMember: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ claimRevision: 1, inputOrder: 0, memoryClaimId: IDS.claim }]),
      },
      memoryResolution: { findUnique: vi.fn().mockResolvedValue(resolution) },
    } as unknown as PrismaService;
    const reader = new PrismaEvidenceDrilldownReader(prisma);

    const stableResult = await reader.readMemory(IDS.stableIdentity, IDS.project);
    expect(stableResult?.memory).toMatchObject({
      memory_id: IDS.stableIdentity,
      resolution_authority_id: IDS.authority,
      revision_id: IDS.revision,
      revision_no: 2,
    });
    await expect(reader.readMemory(IDS.resolution, IDS.project)).resolves.toBeNull();
  });
});
