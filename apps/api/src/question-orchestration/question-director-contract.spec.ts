import { describe, expect, it } from 'vitest';

import {
  loadInterviewDirectorPromptBundle,
  QuestionDirectorContract,
} from './question-director-contract.js';

describe('QuestionDirectorContract', () => {
  const contract = new QuestionDirectorContract();
  const segmentId = '11111111-1111-4111-8111-111111111111';
  const itemId = '22222222-2222-4222-8222-222222222222';
  const context = {
    actual_asked: [],
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
    boundaries: [],
    context_schema_version: 'interview-director-context-v1' as const,
    current_memories: [],
    current_presentation: null,
    interview_state: {
      goal: '建立谈话节奏',
      journey_reason_codes: ['JOURNEY_RAPPORT_INITIAL'],
      journey_stage: 'rapport' as const,
    },
    recent_transcript: [
      { segment_id: segmentId, start_ms: 0, text: '我住在河边。', trusted_role: 'elder' as const },
    ],
    recently_displayed: [],
  };

  it('uses the formal schemas and accepts free generation without a bank attribution', () => {
    contract.assertContext(context);
    expect(
      contract.parseOutput(
        {
          continue_reason_code: null,
          decision: 'suggest',
          declared_bank_references: [],
          grounding: [{ id: segmentId, kind: 'segment' }],
          purpose: 'detail',
          question: '愿意再讲讲那时的生活吗？',
          reason: '顺着刚才的内容继续。',
          risk: 'low',
        },
        context,
      ),
    ).toMatchObject({ decision: 'suggest', declared_bank_references: [] });
  });

  it('rejects grounding and declared attribution outside the frozen Context', () => {
    expect(() =>
      contract.parseOutput(
        {
          continue_reason_code: null,
          decision: 'suggest',
          declared_bank_references: [
            {
              question_bank_item_id: '33333333-3333-4333-8333-333333333333',
              usage: 'inspiration',
            },
          ],
          grounding: [],
          purpose: 'detail',
          question: '愿意讲讲吗？',
          reason: '测试',
          risk: 'low',
        },
        context,
      ),
    ).toThrow('AI_OUTPUT_REFERENCE_OUTSIDE_CONTEXT');
  });

  it('rejects parallel or partial output shapes through the formal Output Schema', () => {
    expect(() =>
      contract.parseOutput({ decision: 'suggest', question: '缺少正式字段' }, context),
    ).toThrow('AI_OUTPUT_SCHEMA_INVALID');
  });

  it('rejects the editable v2 draft as a runtime prompt bundle', () => {
    expect(() => loadInterviewDirectorPromptBundle('v2-draft')).toThrow(
      'AI_PROMPT_BUNDLE_NOT_FORMAL',
    );
    expect(loadInterviewDirectorPromptBundle('interview-director-prompt-v1').system).toContain(
      '# Interview Director System v1',
    );
  });
});
