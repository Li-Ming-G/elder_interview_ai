import { describe, expect, it, vi } from 'vitest';

import type { FrozenAiJob } from '../ai-runtime/ai-job-coordinator.service.js';
import type { QuestionGenerationAttempt } from '../generated/prisma/client.js';
import {
  assertQuestionGenerationBinding,
  questionPublicationFence,
  QuestionPresentationService,
} from './question-presentation.service.js';

const ids = {
  actor: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  job: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  request: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  session: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  snapshot: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
};

describe('question publication fence', () => {
  it('supersedes an automatic result after manual-next advances the basis', () => {
    expect(
      questionPublicationFence(
        {
          attemptKind: 'automatic',
          basisPresentationRevision: 0,
          basisSnapshotId: null,
          manualIntentSequence: 0,
        },
        { currentSnapshotId: null, manualIntentSequence: 1, presentationRevision: 0 },
      ),
    ).toBe('superseded_by_manual');
  });

  it('fences a result from a different presentation basis', () => {
    expect(
      questionPublicationFence(
        {
          attemptKind: 'automatic',
          basisPresentationRevision: 1,
          basisSnapshotId: ids.snapshot,
          manualIntentSequence: 0,
        },
        { currentSnapshotId: null, manualIntentSequence: 0, presentationRevision: 0 },
      ),
    ).toBe('stale_basis');
  });

  it('does not map a stale continue-listening result to current presentation state', async () => {
    const attempt = generationAttempt({
      attemptKind: 'automatic',
      basisPresentationRevision: 0,
      basisSnapshotId: null,
      manualIntentSequence: 0,
      resultKind: null,
      status: 'running',
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = presentationService({
      attempt,
      state: { currentSnapshotId: null, manualIntentSequence: 1, presentationRevision: 0 },
      updateMany,
    });

    const result = await service.publishAttemptResult(
      {
        attemptId: attempt.id,
        candidate: null,
        deadlineAt: Date.now() + 1_000,
        job: job(),
        resultKind: 'continue_listening',
        sessionId: ids.session,
      },
      { actorId: ids.actor, kind: 'actor' },
      ids.request,
    );

    expect(result.publicationOutcome).toBe('superseded_by_manual');
    const call = updateMany.mock.calls[0]?.[0] as
      | {
          data: { resultKind: string; status: string };
          where: { id: string; status: { in: string[] } };
        }
      | undefined;
    expect(call?.data).toMatchObject({ resultKind: 'unavailable', status: 'cancelled' });
    expect(call?.where).toEqual({
      id: attempt.id,
      status: { in: ['pending', 'running'] },
    });
  });

  it('replays a terminal publication without reapplying the fence or writing history', async () => {
    const attempt = generationAttempt({
      attemptKind: 'manual_next',
      basisPresentationRevision: 0,
      basisSnapshotId: null,
      publicationOutcome: 'published',
      resultKind: 'suggestion',
      status: 'succeeded',
    });
    const updateMany = vi.fn();
    const service = presentationService({
      attempt,
      state: { currentSnapshotId: ids.snapshot, manualIntentSequence: 1, presentationRevision: 1 },
      updateMany,
    });

    await expect(
      service.publishAttemptResult(
        {
          attemptId: attempt.id,
          candidate: null,
          deadlineAt: Date.now() + 1_000,
          job: job(),
          resultKind: 'suggestion',
          sessionId: ids.session,
        },
        { actorId: ids.actor, kind: 'actor' },
        ids.request,
      ),
    ).resolves.toMatchObject({ publicationOutcome: 'published' });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('fails closed when an idempotency identity is rebound to another actor or session', () => {
    expect(() => {
      assertQuestionGenerationBinding({
        actorId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        attempt: {
          aiJobId: ids.job,
          attemptKind: 'manual_next',
          requestId: ids.request,
          sessionId: ids.session,
        },
        jobId: ids.job,
        jobRequestedBy: ids.actor,
        requestId: ids.request,
        sessionId: ids.session,
      });
    }).toThrow();
  });

  it('retries terminalization when the attempt committed before the job update', async () => {
    const attempt = generationAttempt({ status: 'pending' });
    const failedAttempt = generationAttempt({ status: 'failed' });
    const findUnique = vi.fn().mockResolvedValueOnce(attempt).mockResolvedValue(failedAttempt);
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      questionEvidenceEvent: { create: vi.fn().mockResolvedValue({}) },
      questionGenerationAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const failOrphanedSystemJob = vi
      .fn()
      .mockRejectedValueOnce(new Error('TRANSIENT_JOB_UPDATE_FAILURE'))
      .mockResolvedValue(undefined);
    const service = Object.create(
      QuestionPresentationService.prototype,
    ) as QuestionPresentationService;
    const internals = service as unknown as {
      coordinator: { failOrphanedSystemJob: typeof failOrphanedSystemJob };
      prisma: {
        $transaction: (callback: (value: typeof tx) => unknown) => Promise<unknown>;
        questionGenerationAttempt: { findUnique: typeof findUnique };
      };
    };
    internals.coordinator = { failOrphanedSystemJob };
    internals.prisma = {
      $transaction: vi.fn((callback: (value: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
      questionGenerationAttempt: { findUnique },
    };

    await expect(service.failAttempt(attempt.id, 'AI_UNAVAILABLE')).rejects.toThrow(
      'TRANSIENT_JOB_UPDATE_FAILURE',
    );
    await expect(service.failAttempt(attempt.id, 'AI_UNAVAILABLE')).resolves.toBeUndefined();
    expect(failOrphanedSystemJob).toHaveBeenCalledTimes(2);
  });

  it('rebuilds one unavailable attempt and trace after a rolled-back terminalization', async () => {
    const requestId = ids.request;
    const command = {
      attemptKind: 'manual_next',
      basisPresentationRevision: 0,
      basisSnapshotId: null,
      contextBuilderDigest: 'context-digest',
      contextBuilderVersion: 'context-v1',
      contextSchemaDigest: 'context-schema-digest',
      contextSchemaVersion: 'context-schema-v1',
      failureCode: 'SYSTEM_COORDINATOR_RESTARTED',
      interviewContextSnapshotId: null,
      job: job(),
      journeyBasisHash: 'journey-hash',
      journeyPolicyVersion: 'journey-v1',
      journeyReasonCodes: ['stage.hold_no_decisive_signal'],
      journeyStage: 'rapport',
      modelConfigDigest: 'model-digest',
      modelConfigVersion: 'model-v1',
      outputSchemaDigest: 'output-digest',
      outputSchemaVersion: 'output-v1',
      promptBundleDigest: 'prompt-digest',
      promptBundleVersion: 'prompt-v1',
      selectionPolicyVersion: 'selection-v1',
      sessionId: ids.session,
      similarityPolicyVersion: 'similarity-v1',
    } as Parameters<QuestionPresentationService['recordSystemUnavailableAttempt']>[0];
    const state = {
      currentSnapshotId: null,
      manualIntentSequence: 0,
      presentationRevision: 0,
    };
    const attempt = generationAttempt({
      attemptKind: 'manual_next',
      failureCode: 'SYSTEM_COORDINATOR_RESTARTED',
      publicationOutcome: 'policy_blocked',
      requestId,
      resultKind: 'unavailable',
      status: 'failed',
    });
    let persistedAttempt: QuestionGenerationAttempt | null = null;
    let jobStatus: 'failed' | 'running' = 'running';
    const traceCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error('TRACE_WRITE_FAILED'))
      .mockImplementationOnce(() => undefined);
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      aiJob: {
        findUnique: vi.fn().mockImplementation(() => ({
          ...job(),
          requestId,
          requestedBy: ids.actor,
          status: jobStatus,
          expiresAt: new Date(),
        })),
        findUniqueOrThrow: vi.fn().mockImplementation(() => ({
          ...job(),
          expiresAt: new Date(),
        })),
        updateMany: vi.fn().mockImplementation(() => {
          jobStatus = 'failed';
          return { count: 1 };
        }),
      },
      aiJobInputMemory: { findMany: vi.fn().mockResolvedValue([]) },
      aiJobInputSegment: { findMany: vi.fn().mockResolvedValue([]) },
      aiJobSessionScope: { findMany: vi.fn().mockResolvedValue([]) },
      decisionTrace: {
        create: traceCreate,
        findUnique: vi.fn().mockResolvedValue(null),
      },
      interviewSession: {
        findUnique: vi.fn().mockResolvedValue({ projectId: command.job.projectId }),
      },
      questionDisplayState: { upsert: vi.fn().mockResolvedValue(state) },
      questionEvidenceEvent: { create: vi.fn().mockResolvedValue({}) },
      questionGenerationAttempt: {
        create: vi.fn().mockImplementation(() => {
          persistedAttempt = attempt;
          return attempt;
        }),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockImplementation(() => persistedAttempt),
      },
      questionDisplaySnapshot: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const service = Object.create(
      QuestionPresentationService.prototype,
    ) as QuestionPresentationService;
    const internals = service as unknown as {
      prisma: {
        $transaction: (callback: (value: typeof tx) => unknown) => Promise<unknown>;
      };
    };
    internals.prisma = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => {
        const previousAttempt = persistedAttempt;
        const previousStatus = jobStatus;
        try {
          return await callback(tx);
        } catch (error) {
          persistedAttempt = previousAttempt;
          jobStatus = previousStatus;
          throw error;
        }
      }),
    };

    await expect(service.recordSystemUnavailableAttempt(command, requestId)).rejects.toThrow(
      'TRACE_WRITE_FAILED',
    );
    await expect(service.recordSystemUnavailableAttempt(command, requestId)).resolves.toBe(
      attempt.id,
    );
    expect(jobStatus).toBe('failed');
    expect(persistedAttempt?.resultKind).toBe('unavailable');
    expect(tx.questionEvidenceEvent.create).toHaveBeenCalledTimes(1);
  });
});

function presentationService(input: {
  attempt: ReturnType<typeof generationAttempt>;
  state: {
    currentSnapshotId: string | null;
    manualIntentSequence: number;
    presentationRevision: number;
  };
  updateMany: ReturnType<typeof vi.fn>;
}): QuestionPresentationService {
  const tx = {
    questionDisplayState: {
      upsert: vi.fn().mockResolvedValue(input.state),
    },
    questionGenerationAttempt: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(input.attempt),
      updateMany: input.updateMany,
    },
  };
  const service = Object.create(
    QuestionPresentationService.prototype,
  ) as QuestionPresentationService;
  const internals = service as unknown as {
    coordinator: { writeBack: ReturnType<typeof vi.fn> };
    currentByActorId: ReturnType<typeof vi.fn>;
  };
  internals.coordinator = {
    writeBack: vi.fn((_job: FrozenAiJob, write: (value: typeof tx) => unknown) =>
      Promise.resolve(write(tx)),
    ),
  };
  internals.currentByActorId = vi.fn().mockResolvedValue({});
  return service;
}

function generationAttempt(
  overrides: Partial<QuestionGenerationAttempt> = {},
): QuestionGenerationAttempt {
  return {
    aiJobId: ids.job,
    attemptKind: 'automatic',
    basisPresentationRevision: 0,
    basisSnapshotId: null,
    id: '11111111-1111-4111-8111-111111111111',
    manualIntentSequence: 0,
    requestId: ids.request,
    sessionId: ids.session,
    ...overrides,
  } as unknown as QuestionGenerationAttempt;
}

function job(): FrozenAiJob {
  return {
    actualQuestions: [],
    deletionFenceRevision: -1,
    deletionScopeDigest: '',
    id: ids.job,
    inputHash: 'a'.repeat(64),
    memories: [],
    policyRevision: 1,
    projectId: '99999999-9999-4999-8999-999999999999',
    replayed: false,
    requestedBy: ids.actor,
    retentionPolicyVersion: 1,
    segments: [],
    sessionIds: [ids.session],
    status: 'running',
  };
}
