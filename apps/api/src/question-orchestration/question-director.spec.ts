import { describe, expect, it } from 'vitest';

import type { InterviewDirectorContextV1 } from './question-director-contract.js';
import { LocalTestQuestionDirector } from './question-director.js';

describe('LocalTestQuestionDirector', () => {
  const director = new LocalTestQuestionDirector();
  const prompt = { system: 'system', task: 'task' };

  it('continues listening when both conversation context and references are empty', async () => {
    await expect(director.generate({ context: context(), prompt })).resolves.toMatchObject({
      continue_reason_code: 'insufficient_context',
      decision: 'continue_listening',
      question: null,
    });
  });

  it('generates from a trusted final without requiring a question-bank source', async () => {
    const segmentId = '11111111-1111-4111-8111-111111111111';
    const output = await director.generate({
      context: context({
        recent_transcript: [
          {
            segment_id: segmentId,
            start_ms: 100,
            text: '我小时候住在河边。',
            trusted_role: 'elder',
          },
        ],
      }),
      prompt,
    });

    expect(output).toMatchObject({
      decision: 'suggest',
      declared_bank_references: [],
      grounding: [{ id: segmentId, kind: 'segment' }],
    });
  });

  it('uses current memory as grounding without claiming a bank attribution', async () => {
    const memoryId = '22222222-2222-4222-8222-222222222222';
    const output = await director.generate({
      context: context({
        current_memories: [
          {
            authority: 'human_confirmed',
            memory_resolution_id: memoryId,
            memory_type: 'person',
            value: '林老师',
            value_kind: 'exact',
          },
        ],
      }),
      prompt,
    });

    expect(output).toMatchObject({
      decision: 'suggest',
      declared_bank_references: [],
      grounding: [{ id: memoryId, kind: 'memory' }],
    });
  });

  it('can declare an optional seen bank reference when no story context exists', async () => {
    const itemId = '33333333-3333-4333-8333-333333333333';
    const output = await director.generate({
      context: context({
        bank_references: [
          {
            bank: 'basic',
            purpose: 'detail',
            question_bank_item_id: itemId,
            question_text: '您小时候最喜欢在哪里玩？',
            sensitivity: 'low',
            topic: '童年',
          },
        ],
      }),
      prompt,
    });

    expect(output).toMatchObject({
      decision: 'suggest',
      declared_bank_references: [{ question_bank_item_id: itemId, usage: 'inspiration' }],
      question: '您小时候最喜欢在哪里玩？',
    });
  });
});

function context(overrides: Partial<InterviewDirectorContextV1> = {}): InterviewDirectorContextV1 {
  return {
    actual_asked: [],
    bank_references: [],
    boundaries: [],
    context_schema_version: 'interview-director-context-v1',
    current_memories: [],
    current_presentation: null,
    interview_state: {
      goal: '建立谈话节奏',
      journey_reason_codes: ['JOURNEY_RAPPORT_INITIAL'],
      journey_stage: 'rapport',
    },
    recent_transcript: [],
    recently_displayed: [],
    ...overrides,
  };
}
