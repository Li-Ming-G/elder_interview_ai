import { describe, expect, it, vi } from 'vitest';

import { effectiveTextDigest } from './ai-provenance.js';
import {
  DecisionTraceService,
  countDecisionTraceUsefulCharacters,
  decisionTraceMemoryTriggerInputHash,
  decisionTraceMemoryTriggerManifest,
  type DecisionTraceInput,
} from './decision-trace.service.js';

const trace = {
  id: '00000000-0000-4000-8000-000000000001',
  aiJobId: null,
  attemptId: null,
  contextDigest: null,
  requestId: '00000000-0000-4000-8000-000000000002',
  stage: null,
  stageTimingsJson: {},
  startedAt: new Date('2026-08-16T00:00:00.000Z'),
  status: 'running',
};

function input(): DecisionTraceInput {
  return {
    contextRevision: 1,
    decisionOutcome: 'unavailable' as const,
    directorInvoked: false,
    inputHash: 'a'.repeat(64),
    ownerActorId: '00000000-0000-4000-8000-000000000003',
    projectId: '00000000-0000-4000-8000-000000000004',
    requestId: trace.requestId,
    sessionId: '00000000-0000-4000-8000-000000000005',
    triggerType: 'manual_next',
    workingRevision: null,
    memoryMemberships: [
      {
        inputOrder: 0,
        layer: 'unknown',
        memoryId: 'memory-ref',
        membershipRole: 'unavailable',
        revision: null,
      },
    ],
  };
}

describe('DecisionTraceService', () => {
  it('uses the frozen reference-only membership for useful-count and manifest facts', () => {
    const membership = {
      effectiveTextDigest: 'a'.repeat(64),
      inputOrder: 0,
      speakerRoleRevision: 2,
      textRevision: 1,
      transcriptSegmentId: '00000000-0000-4000-8000-000000000010',
      usefulCharacterCount: 2,
    };
    expect(countDecisionTraceUsefulCharacters('Ａ \u3000😀')).toBe(2);
    expect(decisionTraceMemoryTriggerManifest([membership])).toMatch(/^[0-9a-f]{64}$/);
    expect(decisionTraceMemoryTriggerManifest([{ ...membership, textRevision: 2 }])).not.toBe(
      decisionTraceMemoryTriggerManifest([membership]),
    );
    expect(
      decisionTraceMemoryTriggerManifest([{ ...membership, effectiveTextDigest: 'b'.repeat(64) }]),
    ).not.toBe(decisionTraceMemoryTriggerManifest([membership]));
    expect(
      decisionTraceMemoryTriggerManifest([{ ...membership, usefulCharacterCount: 3 }]),
    ).not.toBe(decisionTraceMemoryTriggerManifest([membership]));
    expect(decisionTraceMemoryTriggerManifest([{ ...membership, inputOrder: 1 }])).not.toBe(
      decisionTraceMemoryTriggerManifest([membership]),
    );
  });

  it('uses the caller transaction so an outer rollback removes the trace write', async () => {
    const rows: unknown[] = [];
    const create = vi.fn((args: { data: unknown }) => {
      rows.push(args.data);
      return Promise.resolve(trace);
    });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      decisionTrace: { create, findUnique: vi.fn().mockResolvedValue(null) },
    };
    const nestedTransaction = vi.fn();
    const service = new DecisionTraceService({ $transaction: nestedTransaction } as never);
    const externalTransaction = async (work: () => Promise<void>): Promise<void> => {
      const checkpoint = rows.length;
      try {
        await work();
      } catch (error) {
        rows.splice(checkpoint);
        throw error;
      }
    };

    await expect(
      externalTransaction(async () => {
        await service.beginInTransaction(tx as never, input());
        throw new Error('OUTER_TRANSACTION_ROLLBACK');
      }),
    ).rejects.toThrow('OUTER_TRANSACTION_ROLLBACK');
    expect(rows).toHaveLength(0);
    expect(create).toHaveBeenCalledTimes(1);
    expect(nestedTransaction).not.toHaveBeenCalled();
  });

  it('replays the same supplied-transaction request and rejects changed observation facts', async () => {
    const membership = {
      effectiveTextDigest: 'a'.repeat(64),
      inputOrder: 0,
      speakerRoleRevision: 1,
      textRevision: 0,
      transcriptSegmentId: '00000000-0000-4000-8000-000000000021',
      usefulCharacterCount: 1,
    };
    const observation = {
      aiJobId: '00000000-0000-4000-8000-000000000022',
      cumulativeUsefulCharacters: 1,
      minimumUsefulCharacters: 1,
      selectedNewMemberships: [membership],
      selectedNewSegmentCount: 1,
      triggerIdentity: `memory-p1-v1.2:${input().sessionId}:stable`,
      triggerKind: 'batch_threshold' as const,
    };
    const replay = {
      ...trace,
      aiJobId: observation.aiJobId,
      memoryTriggerObservation: {
        ...observation,
        observationVersion: 'decision-trace-memory-trigger-v1',
        selectedNewManifestHash: decisionTraceMemoryTriggerManifest([membership]),
        usefulCharacterPolicyVersion: 'memory-useful-characters-nfkc-ws-codepoint-v1',
      },
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      decisionTrace: { findUnique: vi.fn().mockResolvedValue(replay) },
    };
    const service = new DecisionTraceService({ $transaction: vi.fn() } as never);
    const request = {
      ...input(),
      aiJobId: observation.aiJobId,
      memoryTriggerObservation: observation,
      triggerType: 'working_memory_maintain',
    } satisfies DecisionTraceInput;

    await expect(service.beginInTransaction(tx as never, request)).resolves.toBe(replay);
    await expect(
      service.beginInTransaction(tx as never, {
        ...request,
        memoryTriggerObservation: {
          ...observation,
          selectedNewMemberships: [{ ...membership, effectiveTextDigest: 'b'.repeat(64) }],
        },
      }),
    ).rejects.toThrow('DECISION_TRACE_REQUEST_CONFLICT');
  });

  it('atomically records a terminal low-content memory trigger observation', async () => {
    const segmentId = '00000000-0000-4000-8000-000000000011';
    const jobId = '00000000-0000-4000-8000-000000000012';
    const triggerMembership = {
      effectiveTextDigest: effectiveTextDigest('嗯'),
      inputOrder: 0,
      speakerRoleRevision: 1,
      textRevision: 0,
      transcriptSegmentId: segmentId,
      usefulCharacterCount: 1,
    };
    const triggerIdentity = `memory-p1-v1.2:${input().sessionId}:final-unjudged:${decisionTraceMemoryTriggerManifest([triggerMembership]).slice(0, 32)}`;
    const inputHash = decisionTraceMemoryTriggerInputHash({
      contextBuilderVersion: 'memory-maintainer-v1.2',
      jobType: 'working_memory_maintain',
      projectId: input().projectId,
      selectedNewManifestHash: decisionTraceMemoryTriggerManifest([triggerMembership]),
      sessionId: input().sessionId,
      triggerIdentity,
    });
    const create = vi.fn().mockResolvedValue({ ...trace, status: 'unavailable' });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      aiJob: {
        findUnique: vi.fn().mockResolvedValue({
          failureCode: 'MEMORY_UNJUDGED',
          id: jobId,
          inputHash,
          jobType: 'working_memory_maintain',
          projectId: input().projectId,
          status: 'cancelled',
          triggerDedupeKey: triggerIdentity,
        }),
      },
      aiJobInputSegment: {
        findMany: vi.fn().mockResolvedValue([
          {
            effectiveTextDigest: triggerMembership.effectiveTextDigest,
            id: 'input-segment',
            inputOrder: 0,
            sessionId: input().sessionId,
            speakerRoleRevision: 1,
            textRevision: 0,
            transcriptSegmentId: segmentId,
          },
        ]),
      },
      aiProviderCall: { count: vi.fn().mockResolvedValue(0) },
      decisionTrace: { create, findUnique: vi.fn().mockResolvedValue(null) },
      memoryMaintenanceInputSegment: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValue([
            {
              aiJobInputSegmentId: 'input-segment',
              inputOrder: 0,
              membershipKind: 'new',
              transcriptSegmentId: segmentId,
            },
          ]),
      },
      aiJobSessionScope: {
        findMany: vi.fn().mockResolvedValue([
          {
            eligibleSegmentCount: 1,
            segmentManifestHash: decisionTraceMemoryTriggerManifest([triggerMembership]),
            sessionId: input().sessionId,
          },
        ]),
      },
      transcriptSegment: {
        findMany: vi.fn().mockResolvedValue([
          {
            contentKind: 'conversation',
            correctedSpeakerRole: null,
            correctedText: null,
            id: segmentId,
            originalRoleAuthority: 'user_confirmed',
            originalSpeakerRole: 'elder',
            originalText: '嗯',
            sessionId: input().sessionId,
            speakerRoleRevision: 1,
            textRevision: 0,
          },
        ]),
      },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as never;
    const terminalInput: DecisionTraceInput = {
      ...input(),
      aiJobId: jobId,
      inputHash,
      memoryTriggerObservation: {
        aiJobId: jobId,
        cumulativeUsefulCharacters: 1,
        minimumUsefulCharacters: 2,
        selectedNewMemberships: [triggerMembership],
        selectedNewSegmentCount: 1,
        triggerIdentity,
        triggerKind: 'session_final_flush',
      },
      triggerType: 'working_memory_maintain',
    };
    const service = new DecisionTraceService(prisma);
    await expect(
      service.recordTerminal(terminalInput, {
        decisionOutcome: 'unavailable',
        errorCode: 'MEMORY_UNJUDGED',
        status: 'unavailable',
      }),
    ).rejects.toThrow('DECISION_TRACE_MEMORY_TRIGGER_JOB_MEMBERSHIP_INVALID');
    expect(create).not.toHaveBeenCalled();
    await service.recordTerminal(terminalInput, {
      decisionOutcome: 'unavailable',
      errorCode: 'MEMORY_UNJUDGED',
      status: 'unavailable',
    });
    const call = create.mock.calls[0]?.[0] as
      | {
          data: {
            memoryTriggerObservation: {
              create: {
                aiJobId: string;
                selectedNewMemberships: { create: Array<{ inputOrder: number }> };
                selectedNewSegmentCount: number;
              };
            };
            status: string;
          };
        }
      | undefined;
    expect(call?.data.status).toBe('unavailable');
    expect(call?.data.memoryTriggerObservation.create.aiJobId).toBe(jobId);
    expect(call?.data.memoryTriggerObservation.create.selectedNewSegmentCount).toBe(1);
    expect(
      call?.data.memoryTriggerObservation.create.selectedNewMemberships.create[0]?.inputOrder,
    ).toBe(0);
  });

  it('rejects a final-low identity that does not match the selected manifest', async () => {
    const jobId = '00000000-0000-4000-8000-000000000032';
    const membership = {
      effectiveTextDigest: 'a'.repeat(64),
      inputOrder: 0,
      speakerRoleRevision: 1,
      textRevision: 0,
      transcriptSegmentId: '00000000-0000-4000-8000-000000000031',
      usefulCharacterCount: 1,
    };
    const transaction = vi.fn();
    await expect(
      new DecisionTraceService({ $transaction: transaction } as never).recordTerminal(
        {
          ...input(),
          aiJobId: jobId,
          memoryTriggerObservation: {
            aiJobId: jobId,
            cumulativeUsefulCharacters: 1,
            minimumUsefulCharacters: 2,
            selectedNewMemberships: [membership],
            selectedNewSegmentCount: 1,
            triggerIdentity: `memory-p1-v1.2:${input().sessionId}:final-unjudged:${'0'.repeat(32)}`,
            triggerKind: 'session_final_flush',
          },
          triggerType: 'working_memory_maintain',
        },
        {
          decisionOutcome: 'unavailable',
          errorCode: 'MEMORY_UNJUDGED',
          status: 'unavailable',
        },
      ),
    ).rejects.toThrow('DECISION_TRACE_MEMORY_TRIGGER_IDENTITY_INVALID');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('is idempotent by request and terminalizes exactly once', async () => {
    const create = vi.fn().mockResolvedValue(trace);
    const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(trace);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      aiProviderCall: { count: vi.fn().mockResolvedValue(0) },
      decisionTrace: { findUnique, create, updateMany },
    };
    const prisma = {
      decisionTrace: { findUnique, create, updateMany },
      $transaction: vi.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as never;
    const service = new DecisionTraceService(prisma);
    await expect(service.begin(input())).resolves.toBe(trace);
    await expect(service.begin(input())).resolves.toBe(trace);
    expect(create).toHaveBeenCalledTimes(1);
    await expect(
      service.finalize(trace.id, { status: 'succeeded', decisionOutcome: 'continue_listening' }),
    ).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: trace.id, status: 'running' } }),
    );
  });

  it('rejects late finalization and reference attachment after terminal state', async () => {
    const terminal = { ...trace, status: 'succeeded' };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      decisionTrace: { findUnique: vi.fn().mockResolvedValue(terminal) },
    };
    const prisma = {
      decisionTrace: {
        findUnique: vi.fn().mockResolvedValue(terminal),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: vi.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as never;
    const service = new DecisionTraceService(prisma);
    await expect(service.finalize(trace.id, { status: 'failed' })).rejects.toThrow(
      'DECISION_TRACE_TERMINAL_OR_MISSING',
    );
    await expect(service.attachReferences(trace.id, { p4Memberships: [] })).rejects.toThrow(
      'DECISION_TRACE_TERMINAL_OR_MISSING',
    );
  });

  it.each([
    'published',
    'not_better',
    'duplicate_filtered',
    'stale_basis',
    'superseded_by_manual',
    'policy_blocked',
    'not_applicable',
  ])('persists the raw %s publication outcome', async (publicationOutcome) => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const current = { ...trace, aiJobId: 'job' };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      aiProviderCall: { count: vi.fn().mockResolvedValue(0) },
      decisionTrace: { findUnique: vi.fn().mockResolvedValue(current), updateMany },
    };
    const prisma = {
      decisionTrace: {
        findUnique: vi.fn().mockResolvedValue(current),
        updateMany,
      },
      $transaction: vi.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as never;
    await new DecisionTraceService(prisma).finalize(trace.id, {
      directorInvoked: true,
      publicationOutcome,
      status: 'succeeded',
    });
    const call = updateMany.mock.calls[0]?.[0] as
      | {
          data: {
            directorInvoked: boolean;
            gateReason: string | null;
            publicationOutcome: string;
          };
        }
      | undefined;
    expect(call?.data).toMatchObject({
      directorInvoked: false,
      gateReason: publicationOutcome === 'published' ? null : publicationOutcome,
      publicationOutcome,
    });
  });

  it('derives Director invocation from persisted provider calls instead of caller guesses', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const current = { ...trace, aiJobId: 'job' };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      aiProviderCall: { count: vi.fn().mockResolvedValue(1) },
      decisionTrace: { findUnique: vi.fn().mockResolvedValue(current), updateMany },
    };
    const prisma = {
      decisionTrace: {
        findUnique: vi.fn().mockResolvedValue(current),
        updateMany,
      },
      $transaction: vi.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as never;
    await new DecisionTraceService(prisma).finalize(trace.id, {
      directorInvoked: false,
      status: 'failed',
    });
    const call = updateMany.mock.calls[0]?.[0] as
      { data: { directorInvoked: boolean } } | undefined;
    expect(call?.data.directorInvoked).toBe(true);
  });

  it('reconciles stale running traces with a deterministic terminal state', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const prisma = {
      decisionTrace: {
        findMany: vi.fn().mockResolvedValue([{ id: trace.id, attemptId: null }]),
        updateMany,
      },
    } as never;
    await expect(new DecisionTraceService(prisma).reconcileRunning()).resolves.toBe(1);
    const call = updateMany.mock.calls[0]?.[0] as
      { data: { status: string; errorCode: string }; where: { status: string } } | undefined;
    expect(call?.data.status).toBe('unavailable');
    expect(call?.data.errorCode).toBe('SYSTEM_COORDINATOR_RESTARTED');
    expect(call?.where.status).toBe('running');
  });
});
