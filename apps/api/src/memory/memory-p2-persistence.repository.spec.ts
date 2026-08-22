import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../database/prisma.service.js';
import { MemoryP2PersistenceRepository } from './memory-p2-persistence.repository.js';
import {
  MemoryP2PersistenceError,
  memoryP2CheckpointManifestHash,
  memoryP2ClaimEvidenceManifestHash,
  memoryP2LayerMemberManifestHash,
  type MemoryP2FreezeCheckpointInput,
} from './memory-p2-persistence.types.js';

const IDS = {
  authority: '11111111-1111-4111-8111-111111111111',
  checkpoint: '22222222-2222-4222-8222-222222222222',
  claim: '33333333-3333-4333-8333-333333333333',
  evidence: '44444444-4444-4444-8444-444444444444',
  input: '55555555-5555-4555-8555-555555555555',
  job: '66666666-6666-4666-8666-666666666666',
  project: '77777777-7777-4777-8777-777777777777',
  resolution: '88888888-8888-4888-8888-888888888888',
  session: '99999999-9999-4999-8999-999999999999',
  thread: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  threadRevision: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  trace: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  user: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  working: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
} as const;

describe('MemoryP2PersistenceRepository', () => {
  it('binds checkpoint, evidence and layer order into canonical manifests', () => {
    const member = {
      boundaryStatus: 'none',
      claimCount: 1,
      inputOrder: 0,
      membershipDigest: '1'.repeat(64),
      resolutionAuthorityId: IDS.authority,
      resolutionRevision: 1,
      resolutionRowId: IDS.resolution,
      semanticStatus: 'current' as const,
    };
    const evidence = {
      authorityRevision: 1 as const,
      effectiveTextDigest: '2'.repeat(64),
      evidenceId: IDS.evidence,
      inputOrder: 0,
      inputSegmentId: IDS.input,
      membershipDigest: '3'.repeat(64),
      sourceId: IDS.evidence,
      speakerRoleRevision: 1,
      textRevision: 0,
    };
    const claim = {
      canonicalKey: 'episode:school',
      evidences: [evidence],
      explicitCorrection: false,
      memoryType: null,
      normalizedValueDigest: '4'.repeat(64),
      role: 'primary' as const,
      semanticKind: 'episode' as const,
      valueJson: { value: 'semantic-owner-only' },
      valueKind: 'exact' as const,
    };
    expect(memoryP2CheckpointManifestHash([member])).toMatch(/^[0-9a-f]{64}$/);
    expect(
      memoryP2CheckpointManifestHash([member, { ...member, inputOrder: 1, resolutionRevision: 2 }]),
    ).not.toBe(
      memoryP2CheckpointManifestHash([
        { ...member, inputOrder: 0, resolutionRevision: 2 },
        { ...member, inputOrder: 1 },
      ]),
    );
    expect(memoryP2ClaimEvidenceManifestHash([evidence], IDS.project, IDS.session)).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(
      memoryP2LayerMemberManifestHash([
        {
          claimId: IDS.claim,
          evidenceMembershipDigest: memoryP2ClaimEvidenceManifestHash(
            [evidence],
            IDS.project,
            IDS.session,
          ),
          inputOrder: 0,
          role: claim.role,
        },
      ]),
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rolls back before physical writes when the frozen member manifest is invalid', async () => {
    const create = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      aiJob: {
        findUnique: vi.fn().mockResolvedValue({
          expiresAt: new Date('2030-01-01T00:00:00.000Z'),
          jobType: 'mid_online',
          policyRevision: 1,
          projectId: IDS.project,
          retentionPolicyVersion: 1,
          retentionState: 'active',
          status: 'running',
          triggerDedupeKey: `memory-p2-v1:${IDS.session}`,
        }),
      },
      memoryEvolutionCheckpoint: { create, findUnique: vi.fn().mockResolvedValue(null) },
      memoryP2MigrationManifest: {
        findFirst: vi.fn().mockResolvedValue({ status: 'completed' }),
      },
      memoryResolutionMember: {
        findMany: vi.fn().mockResolvedValue([{ memoryResolutionId: IDS.resolution }]),
      },
    };
    const prisma = {
      $transaction: vi.fn((operation: (client: typeof tx) => unknown) => operation(tx)),
    } as unknown as PrismaService;
    const repository = new MemoryP2PersistenceRepository(prisma);
    await expect(repository.freezeCheckpoint(freezeInput('0'.repeat(64)))).rejects.toMatchObject({
      code: 'MEMORY_P2_MANIFEST_INVALID',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('exposes stable error codes without leaking database details', () => {
    expect(new MemoryP2PersistenceError('MEMORY_P2_AUTHORITY_CAS_MISMATCH')).toMatchObject({
      code: 'MEMORY_P2_AUTHORITY_CAS_MISMATCH',
      message: 'MEMORY_P2_AUTHORITY_CAS_MISMATCH',
      name: 'MemoryP2PersistenceError',
    });
  });
});

function freezeInput(memberManifestHash: string): MemoryP2FreezeCheckpointInput {
  return {
    aiJobId: IDS.job,
    aiPolicyRevision: 1,
    checkpointId: IDS.checkpoint,
    deletionScopeDigest: '5'.repeat(64),
    deletionScopePolicyRevision: 1,
    evidenceManifestHash: '6'.repeat(64),
    lease: {
      epoch: 1,
      expiresAt: new Date('2029-01-01T00:00:00.000Z'),
      owner: 'unit-test-worker',
    },
    expectedMemberCount: 1,
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
    memberManifestHash,
    members: [
      {
        boundaryStatus: 'none',
        claimCount: 1,
        inputOrder: 0,
        membershipDigest: '7'.repeat(64),
        resolutionAuthorityId: IDS.authority,
        resolutionRevision: 1,
        resolutionRowId: IDS.resolution,
        semanticStatus: 'current',
      },
    ],
    midExpectedCount: 0,
    midManifestHash: null,
    ownerActorId: IDS.user,
    p2PolicyContractRevision: 'p2-contract-v1',
    p2PolicyRevision: 'p2-policy-v1',
    p2RetentionContractVersion: 'p2-retention-contract-v1',
    p2RetentionPolicyVersion: 'p2-retention-v1',
    projectId: IDS.project,
    retentionPolicyVersion: 1,
    rootIdentity: '8'.repeat(64),
    sourceBoundaryManifestHash: '9'.repeat(64),
    sourceCurrentExpectedCount: 0,
    sourceCurrentManifestHash: null,
    sourceP1TerminalJobId: null,
    sourceP1TerminalOutcome: null,
    sourceP1TerminalStatus: null,
    sourceResolutionManifestHash: 'a'.repeat(64),
    sourceRevisionDigest: 'b'.repeat(64),
    sourceSessionId: IDS.session,
    sourceSetKind: 'working_checkpoint',
    sourceThreadId: IDS.thread,
    sourceThreadManifestHash: 'c'.repeat(64),
    sourceThreadRevision: 1,
    sourceThreadRevisionId: IDS.threadRevision,
    sourceThreadStatus: 'active',
    sourceTraceReferences: [],
    sourceWorkingSnapshotContractVersion: 'memory-maintainer-v1.2',
    sourceWorkingSnapshotId: IDS.working,
    targetSlotDigest: 'd'.repeat(64),
    traceGenerationId: IDS.trace,
    traceId: IDS.trace,
    traceRequestId: IDS.trace,
    triggerIdentity: `memory-p2-v1:${IDS.session}:online`,
    triggerIdentityHash: 'e'.repeat(64),
    triggerKind: 'capacity_checkpoint',
  };
}
