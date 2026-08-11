import { describe, expect, it } from 'vitest';

import type { FrozenProviderSegment } from '../ai-runtime/structured-ai.provider.js';
import { latestSubstantiveElderAnswer, scoreQuestionSelectionV1 } from './question-selection.js';

describe('question-select-v1', () => {
  const segments = [
    segment(0, '以前的一段回答。', 'elder'),
    segment(100, '后来呢？', 'interviewer'),
    segment(200, '后来我搬到了河边。', 'elder'),
    segment(300, '院子里还有一棵桂花树。', 'elder'),
  ];

  it('is deterministic and gives a material advantage to latest-answer grounding', () => {
    const firstSegment = segments[0];
    const latestSegment = segments[3];
    if (firstSegment === undefined || latestSegment === undefined)
      throw new Error('FIXTURE_INVALID');
    const current = scoreQuestionSelectionV1({
      grounding: [{ id: firstSegment.segmentId, kind: 'segment' }],
      purpose: 'detail',
      risk: 'low',
      segments,
      stage: 'story_depth',
    });
    const candidateFacts = {
      grounding: [{ id: latestSegment.segmentId, kind: 'segment' as const }],
      purpose: 'detail' as const,
      risk: 'low' as const,
      segments,
      stage: 'story_depth' as const,
    };
    const candidate = scoreQuestionSelectionV1(candidateFacts);

    expect(scoreQuestionSelectionV1(candidateFacts)).toBe(candidate);
    expect(candidate - current).toBeGreaterThanOrEqual(0.12);
  });

  it('bounds the journey answer after the latest interviewer segment', () => {
    expect(latestSubstantiveElderAnswer(segments).map(({ startMs }) => startMs)).toEqual([
      200, 300,
    ]);
  });
});

function segment(
  startMs: number,
  text: string,
  trustedRole: 'elder' | 'interviewer',
): FrozenProviderSegment {
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
