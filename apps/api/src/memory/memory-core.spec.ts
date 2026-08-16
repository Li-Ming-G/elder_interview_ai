import { describe, expect, it } from 'vitest';

import { LocalTestStructuredAiProvider } from '../ai-runtime/structured-ai.provider.js';
import {
  MemoryContextAssemblyService,
  MemoryRetrievalService,
} from './memory-context-assembly.service.js';
import { MemoryAwareNextQuestionPipeline } from './memory-next-question.pipeline.js';
import { evidenceFromSegment, type MaintainerTranscriptSegment } from './memory-core.contract.js';
import {
  WorkingMemoryMaintainerService,
  WorkingMemoryOperationApplier,
  workingMemoryTrigger,
} from './working-memory-maintainer.service.js';

describe('MEMORY-T2-T4-CORE-001 memory core and thin P3/P4 seam', () => {
  const provider = new LocalTestStructuredAiProvider();
  const maintainer = new WorkingMemoryMaintainerService(provider);
  const applier = new WorkingMemoryOperationApplier();
  const assembler = new MemoryContextAssemblyService(new MemoryRetrievalService());

  it('uses a hybrid trigger and keeps a not-ready batch idle', () => {
    expect(
      workingMemoryTrigger({
        finalizedSinceLastRun: 0,
        oldestUnprocessedAtMs: null,
        nowMs: 20_000,
        minimumUsefulContent: false,
      }),
    ).toBe('not_ready');
    expect(
      workingMemoryTrigger({
        finalizedSinceLastRun: 3,
        oldestUnprocessedAtMs: null,
        nowMs: 20_000,
        minimumUsefulContent: false,
      }),
    ).toBe('batch_threshold');
    expect(
      workingMemoryTrigger({
        finalizedSinceLastRun: 1,
        oldestUnprocessedAtMs: 0,
        nowMs: 20_000,
        minimumUsefulContent: false,
      }),
    ).toBe('time_threshold');
  });

  it('proposes duplicate, supplement, uncertain and boundary operations with evidence', async () => {
    const existing = {
      id: 'memory-existing',
      canonicalKey: 'childhood.place',
      memoryType: 'place',
      value: '洛阳',
      valueKind: 'exact' as const,
      layer: 'working' as const,
      status: 'current' as const,
      revision: 1,
      threadId: 'thread-a',
      evidence: [],
    };
    const segments = [
      segment('s1', '记忆[place:childhood.place] = 洛阳'),
      segment('s2', '更正记忆[place:childhood.place] = 苏州'),
      segment('s3', '记忆[event:unknown.event] = unknown'),
      segment('s4', '不要再问家庭关系'),
    ];
    const result = await maintainer.propose({
      activeThread: { id: 'thread-a', revision: 1, status: 'active', topicKey: 'childhood' },
      currentWorking: [existing],
      finalizedTranscript: segments,
      sessionMidIndex: [],
    });
    expect(result.operations.map(({ kind }) => kind)).toEqual([
      'DUPLICATE',
      'SUPPLEMENT',
      'UNCERTAIN',
    ]);
    expect(result.operations.every(({ evidence }) => evidence.length > 0)).toBe(true);
    expect(result.operations.at(-1)?.reasonCode).toBe('uncertain_value');
    expect(result.boundaryCandidates[0]).toMatchObject({
      status: 'active',
      code: 'elder_explicit_boundary',
    });
  });

  it('assembles working memory before candidate memories and produces one grounded next question', async () => {
    const currentWorking = [
      {
        id: 'memory-1',
        canonicalKey: 'event.factory',
        memoryType: 'event',
        value: '在工厂工作',
        valueKind: 'exact' as const,
        layer: 'working' as const,
        status: 'current' as const,
        revision: 2,
        threadId: 'thread-a',
        evidence: [evidenceFromSegment(segment('seed', '记忆[event:factory] = 在工厂工作'), 0)],
      },
    ];
    const pipeline = new MemoryAwareNextQuestionPipeline(maintainer, applier, assembler);
    const result = await pipeline.run({
      activeThread: { id: 'thread-a', revision: 2, status: 'active', topicKey: 'work' },
      currentWorking,
      finalizedTranscript: [segment('s5', '后来我去了洛阳的工厂工作。')],
      midLongIndex: [
        {
          id: 'long-1',
          layer: 'long',
          revision: 3,
          status: 'current',
          canonicalKey: 'life.place',
          membershipDigest: 'd'.repeat(64),
        },
      ],
    });
    expect(result.decision).toBe('suggest');
    expect(result.question).toContain('经历');
    expect(result.context.context_schema_version).toBe('interview-director-context-v2-candidate');
    expect(result.context.current_working_memory[0]?.id).toBe('memory-1');
    expect(result.context.memory_candidates.map(({ id }) => id)).toContain('long-1');
    expect(result.grounding.some(({ kind, id }) => kind === 'segment' && id === 's5')).toBe(true);
    expect(result.context.membership_digest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('applies a P1 candidate before P3/P4 and respects an explicit boundary', async () => {
    const pipeline = new MemoryAwareNextQuestionPipeline(maintainer, applier, assembler);
    const created = await pipeline.run({
      activeThread: null,
      currentWorking: [],
      finalizedTranscript: [segment('s6', '记忆[event:first.job] = 在工厂工作')],
    });
    expect(created.decision).toBe('suggest');
    expect(created.operations[0]?.kind).toBe('NEW');
    expect(created.context.current_working_memory).toHaveLength(1);
    expect(created.grounding.some(({ kind }) => kind === 'memory')).toBe(true);

    const blocked = await pipeline.run({
      activeThread: null,
      currentWorking: [],
      finalizedTranscript: [segment('s7', '不要再问家庭关系')],
    });
    expect(blocked.decision).toBe('continue_listening');
    expect(blocked.context.boundaries[0]).toMatchObject({ status: 'active' });
  });

  function segment(segmentId: string, text: string): MaintainerTranscriptSegment {
    return {
      effectiveTextDigest: `${segmentId}-digest`,
      segmentId,
      sessionId: 'session-1',
      speakerRoleRevision: 1,
      startMs: 100,
      text,
      textRevision: 1,
      trustedRole: 'elder',
    };
  }
});
