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
