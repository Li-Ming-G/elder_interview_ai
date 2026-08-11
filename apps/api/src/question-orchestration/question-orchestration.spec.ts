import { describe, expect, it } from 'vitest';

import type { FrozenAiJob } from '../ai-runtime/ai-job-coordinator.service.js';
import { inferDirectorJourneySignals } from './question-orchestration.service.js';

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
