import { describe, expect, it, vi } from 'vitest';

import type { FrozenAiJob } from '../ai-runtime/ai-job-coordinator.service.js';
import {
  FinalizedTranscriptBuffer,
  QuestionOrchestrationService,
  directorMemoryType,
  inferDirectorJourneySignals,
} from './question-orchestration.service.js';

describe('FinalizedTranscriptBuffer', () => {
  it('coalesces rapid finalized segments into one deterministic batch', () => {
    const buffer = new FinalizedTranscriptBuffer();

    buffer.append('session-1', 'segment-2');
    buffer.append('session-1', 'segment-1');
    buffer.append('session-1', 'segment-2');

    expect(buffer.has('session-1')).toBe(true);
    expect(buffer.ids('session-1')).toEqual(['segment-1', 'segment-2']);
    expect(buffer.drain('session-1')).toEqual(['segment-1', 'segment-2']);
    expect(buffer.has('session-1')).toBe(false);
  });

  it('keeps buffers isolated by session and supports manual cancellation', () => {
    const buffer = new FinalizedTranscriptBuffer();

    buffer.append('session-1', 'segment-1');
    buffer.append('session-2', 'segment-2');
    buffer.clear('session-1');

    expect(buffer.has('session-1')).toBe(false);
    expect(buffer.drain('session-2')).toEqual(['segment-2']);
  });
});

describe('QuestionOrchestrationService automatic lane reservation', () => {
  it('does not overlap a second debounce while the first gate read is pending', async () => {
    const gateRead = deferred<readonly never[]>();
    const findMany = vi.fn().mockReturnValueOnce(gateRead.promise).mockResolvedValue([]);
    const findUnique = vi.fn().mockResolvedValue(null);
    const prepare = vi.fn().mockResolvedValue({ replayed: false });
    const complete = vi.fn().mockResolvedValue(undefined);
    const service = Object.create(
      QuestionOrchestrationService.prototype,
    ) as QuestionOrchestrationService;
    const internals = service as unknown as {
      automaticScheduledAt: Map<string, number>;
      automaticInFlight: Set<string>;
      complete: typeof complete;
      finalizedBuffer: FinalizedTranscriptBuffer;
      prepare: typeof prepare;
      prisma: {
        aiProviderCall: { findFirst: typeof findUnique };
        interviewSession: { findUnique: typeof findUnique };
        questionGenerationAttempt: { findMany: typeof findMany; findUnique: typeof findUnique };
      };
      presentations: { generationContext: typeof findUnique };
      timers: Map<string, ReturnType<typeof setTimeout>>;
    };
    internals.automaticInFlight = new Set();
    internals.automaticScheduledAt = new Map();
    internals.complete = complete;
    internals.finalizedBuffer = new FinalizedTranscriptBuffer();
    internals.prepare = prepare;
    internals.prisma = {
      aiProviderCall: { findFirst: findUnique },
      interviewSession: {
        findUnique: vi.fn().mockResolvedValue({ createdBy: 'actor-1', status: 'recording' }),
      },
      questionGenerationAttempt: { findMany, findUnique },
    };
    internals.presentations = {
      generationContext: vi.fn().mockResolvedValue({
        currentSnapshotId: null,
        presentationRevision: 0,
      }),
    };
    internals.timers = new Map();

    internals.finalizedBuffer.append('session-1', 'segment-1');
    const first = serviceRunAutomatic(service, 'session-1');
    await vi.waitFor(() => {
      expect(findMany).toHaveBeenCalledTimes(1);
    });

    internals.finalizedBuffer.append('session-1', 'segment-2');
    await serviceRunAutomatic(service, 'session-1');
    expect(prepare).not.toHaveBeenCalled();
    expect(internals.finalizedBuffer.ids('session-1')).toEqual(['segment-2']);

    gateRead.resolve([]);
    await first;
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(internals.finalizedBuffer.ids('session-1')).toEqual(['segment-2']);

    service.onModuleDestroy();
  });
});

describe('QuestionOrchestrationService automatic status projection', () => {
  it('projects sanitized failure, completion, and waiting state without mutating runtime state', async () => {
    vi.useFakeTimers();
    try {
      const service = statusService({
        attempt: {
          completedAt: new Date('2026-09-06T10:00:05.000Z'),
          failureCode: 'RAW_PROVIDER_BODY_AND_SECRET',
          id: 'attempt-1',
          status: 'failed',
        },
        providerStartedAt: new Date('2026-09-06T10:00:00.000Z'),
      });
      const buffer = (service as unknown as { finalizedBuffer: FinalizedTranscriptBuffer })
        .finalizedBuffer;
      const timers = (service as unknown as { timers: Map<string, unknown> }).timers;
      buffer.append('session-1', 'segment-1');
      const beforeIds = buffer.ids('session-1');
      const beforeTimerCount = timers.size;

      vi.setSystemTime(new Date('2026-09-06T10:00:10.000Z'));
      const status = await service.automaticStatus('session-1');

      expect(status).toEqual({
        latest_attempt: {
          attempt_id: 'attempt-1',
          completed_at: '2026-09-06T10:00:05.000Z',
          failure_code: 'AI_UNAVAILABLE',
          outcome: 'failed',
        },
        waiting: {
          next_attempt_at: '2026-09-06T10:00:20.000Z',
          reason: 'minimum_interval',
        },
      });
      expect(buffer.ids('session-1')).toEqual(beforeIds);
      expect(timers.size).toBe(beforeTimerCount);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['succeeded', 'succeeded', null, new Date('2026-09-06T10:00:05.000Z')],
    ['pending', 'in_flight', null, null],
    ['running', 'in_flight', null, null],
  ] as const)(
    'projects %s automatic attempts',
    async (databaseStatus, outcome, failureCode, completedAt) => {
      const service = statusService({
        attempt: {
          completedAt,
          failureCode,
          id: 'attempt-1',
          status: databaseStatus,
        },
        providerStartedAt: null,
      });

      await expect(service.automaticStatus('session-1')).resolves.toMatchObject({
        latest_attempt: {
          attempt_id: 'attempt-1',
          completed_at: completedAt?.toISOString() ?? null,
          failure_code: null,
          outcome,
        },
      });
    },
  );

  it('reports open interval and no finalized conversation as waiting for new conversation', async () => {
    const service = statusService({
      attempt: null,
      providerStartedAt: new Date('2026-09-06T09:00:00.000Z'),
    });

    await expect(service.automaticStatus('session-1')).resolves.toEqual({
      latest_attempt: null,
      waiting: { next_attempt_at: null, reason: 'new_conversation' },
    });
  });

  it('reports a scheduled debounce instant when finalized conversation is pending', async () => {
    const service = statusService({ attempt: null, providerStartedAt: null, pending: true });
    const internals = service as unknown as {
      automaticScheduledAt: Map<string, number>;
      finalizedBuffer: FinalizedTranscriptBuffer;
    };
    internals.automaticScheduledAt.set('session-1', Date.parse('2026-09-06T10:00:01.500Z'));
    internals.finalizedBuffer.append('session-1', 'segment-1');

    await expect(service.automaticStatus('session-1')).resolves.toEqual({
      latest_attempt: null,
      waiting: {
        next_attempt_at: '2026-09-06T10:00:01.500Z',
        reason: 'debounce',
      },
    });
  });
});

describe('inferDirectorJourneySignals', () => {
  it('makes reluctance, continuous narration and willingness reachable from runtime input', () => {
    const job = {
      segments: [
        {
          inputSegmentId: '11111111-1111-4111-8111-111111111111',
          segmentId: '22222222-2222-4222-8222-222222222222',
          sessionId: '33333333-3333-4333-8333-333333333333',
          startMs: 0,
          text: '我不太想说。后来还是愿意讲，那件事让我印象很深，然后我们接着去了河边。',
          trustedRole: 'elder' as const,
        },
      ],
    } as FrozenAiJob;

    expect(inferDirectorJourneySignals(job, [])).toEqual(
      expect.arrayContaining([
        'engagement.continuous_narration',
        'engagement.willing_to_deepen',
        'response.concrete',
        'response.reluctant',
      ]),
    );
  });

  it('uses only the current elder answer after the latest interviewer final', () => {
    const job = {
      segments: [
        segment(0, '我不想说。后来然后还有很多事。', 'elder'),
        segment(100, '我们换一个轻松的话题，可以吗？', 'interviewer'),
        segment(200, '可以，我小时候住在河边。', 'elder'),
      ],
    } as FrozenAiJob;

    const signals = inferDirectorJourneySignals(job, []);
    expect(signals).toContain('response.concrete');
    expect(signals).not.toContain('response.reluctant');
    expect(signals).not.toContain('engagement.continuous_narration');
  });
});

describe('directorMemoryType', () => {
  it('uses the optional tag when present and the core semantic kind when absent', () => {
    expect(directorMemoryType({ memoryType: 'event', semanticKind: 'fact' })).toBe('event');
    expect(directorMemoryType({ memoryType: null, semanticKind: 'episode' })).toBe('episode');
  });

  it('fails closed when neither legacy type nor P1 semantic identity exists', () => {
    expect(() => directorMemoryType({ memoryType: null, semanticKind: null })).toThrow(
      'AI_MEMORY_SEMANTIC_IDENTITY_UNAVAILABLE',
    );
  });
});

function segment(
  startMs: number,
  text: string,
  trustedRole: 'elder' | 'interviewer',
): FrozenAiJob['segments'][number] {
  const suffix = String(startMs).padStart(12, '0');
  return {
    inputSegmentId: `11111111-1111-4111-8111-${suffix}`,
    segmentId: `22222222-2222-4222-8222-${suffix}`,
    sessionId: '33333333-3333-4333-8333-333333333333',
    startMs,
    text,
    trustedRole,
  };
}

function serviceRunAutomatic(
  service: QuestionOrchestrationService,
  sessionId: string,
): Promise<void> {
  return (service as unknown as { runAutomatic(id: string): Promise<void> }).runAutomatic(
    sessionId,
  );
}

function statusService(input: {
  attempt: {
    completedAt: Date | null;
    failureCode: string | null;
    id: string;
    status: string;
  } | null;
  pending?: boolean;
  providerStartedAt: Date | null;
}): QuestionOrchestrationService {
  const service = Object.create(
    QuestionOrchestrationService.prototype,
  ) as QuestionOrchestrationService;
  const finalizedBuffer = new FinalizedTranscriptBuffer();
  if (input.pending === true) finalizedBuffer.append('session-1', 'pending-segment');
  const internals = service as unknown as {
    automaticScheduledAt: Map<string, number>;
    finalizedBuffer: FinalizedTranscriptBuffer;
    prisma: {
      aiProviderCall: { findFirst: ReturnType<typeof vi.fn> };
      questionGenerationAttempt: {
        findFirst: ReturnType<typeof vi.fn>;
        findMany: ReturnType<typeof vi.fn>;
      };
    };
    timers: Map<string, unknown>;
  };
  internals.automaticScheduledAt = new Map();
  internals.finalizedBuffer = finalizedBuffer;
  internals.prisma = {
    aiProviderCall: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          input.providerStartedAt === null ? null : { startedAt: input.providerStartedAt },
        ),
    },
    questionGenerationAttempt: {
      findFirst: vi.fn().mockResolvedValue(input.attempt),
      findMany: vi.fn().mockResolvedValue(input.attempt === null ? [] : [{ aiJobId: 'job-1' }]),
    },
  };
  internals.timers = new Map();
  return service;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
