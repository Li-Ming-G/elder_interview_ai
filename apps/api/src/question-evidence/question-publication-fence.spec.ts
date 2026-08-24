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
