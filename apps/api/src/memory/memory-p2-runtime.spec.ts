import { describe, expect, it, vi } from 'vitest';

import { MemoryP2RuntimeStoreAdapter } from './memory-p2-runtime.js';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const TRACE_ID = '44444444-4444-4444-8444-444444444444';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const GENERATION_ID = '66666666-6666-4666-8666-666666666666';
const DIGEST = 'a'.repeat(64);

describe('MemoryP2RuntimeStoreAdapter', () => {
  it('advances Trace lifecycle through the accepted DecisionTraceService backing', async () => {
    const startedAt = new Date('2026-08-22T00:00:00.000Z');
    const expiresAt = new Date('2026-08-23T00:00:00.000Z');
    const job = {
      id: JOB_ID,
      projectId: PROJECT_ID,
      requestedBy: SESSION_ID,
      requestId: REQUEST_ID,
      inputHash: DIGEST,
      attemptNo: 1,
      jobType: 'mid_final',
      status: 'running',
      retentionState: 'active',
      expiresAt,
      createdAt: startedAt,
      startedAt,
      policyRevision: 1,
      retentionPolicyVersion: 1,
      failureCode: null,
    };
    const projection = {
      aiJobId: JOB_ID,
      deletionScopeDigest: DIGEST,
      p2PolicyRevision: 'p2-policy-v1',
      p2RetentionPolicyVersion: 'p2-retention-v1',
      sourceFinalMidCheckpointId: null,
    };
    const semantic = {
      aiJobId: JOB_ID,
      traceId: TRACE_ID,
      sourceManifestHash: DIGEST,
      deletionScopeDigest: DIGEST,
      proposalDigest: null,
      planDigest: null,
      commitDigest: null,
    };
    const parent = {
      id: TRACE_ID,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      ownerActorId: SESSION_ID,
      requestId: REQUEST_ID,
      generationId: GENERATION_ID,
      inputHash: DIGEST,
      startedAt,
      createdAt: startedAt,
      status: 'running',
      stage: 'frozen',
    };
    const prisma = {
      aiJob: {
        findUnique: vi.fn(() => Promise.resolve(job)),
      },
      memoryP2JobProjection: {
        findUnique: vi.fn(() => Promise.resolve(projection)),
      },
      decisionTraceMemorySemantic: {
        findUnique: vi.fn(() => Promise.resolve(semantic)),
        update: vi.fn(({ data }: { data: Record<string, unknown> }) => {
          Object.assign(semantic, data);
          return Promise.resolve(semantic);
        }),
      },
      decisionTrace: {
        findUnique: vi.fn(() => Promise.resolve(parent)),
        updateMany: vi.fn(() => {
          parent.stage = parent.stage === 'frozen' ? 'proposed' : 'validated';
          return Promise.resolve({ count: 1 });
        }),
      },
      decisionTraceMemorySourceReference: {
        findMany: vi.fn(() =>
          Promise.resolve([
            {
              sourceKind: 'job',
              sourceJobId: JOB_ID,
              sourceCheckpointId: null,
              aiJobInputSegmentId: null,
              evidenceId: null,
              resolutionAuthorityId: null,
              sourceRevision: 1,
              membershipDigest: DIGEST,
              deletionScopeDigest: DIGEST,
              inputOrder: 0,
            },
          ]),
        ),
      },
      memoryEvolutionCheckpoint: {
        findFirst: vi.fn(() => Promise.resolve({ sourceSessionId: SESSION_ID })),
      },
      memoryLongJobProjection: {
        findUnique: vi.fn(() => Promise.resolve(null)),
      },
      aiJobSessionScope: {
        findFirst: vi.fn(() => Promise.resolve({ sessionId: SESSION_ID })),
      },
      $transaction: vi.fn((work: (tx: typeof prisma) => unknown): Promise<unknown> =>
        Promise.resolve(work(prisma)),
      ),
    };
    const adapter = new MemoryP2RuntimeStoreAdapter(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { now: (): Date => new Date('2026-08-22T01:00:00.000Z') },
    );

    await adapter.recordProgress({
      jobId: JOB_ID,
      proposalDigest: DIGEST,
      sourceManifestHash: DIGEST,
      stage: 'proposal_validated',
    });

    expect(parent.stage).toBe('validated');
    expect(semantic.proposalDigest).toBe(DIGEST);
    expect(prisma.decisionTrace.updateMany).toHaveBeenCalledTimes(2);
  });
});
