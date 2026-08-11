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
});
