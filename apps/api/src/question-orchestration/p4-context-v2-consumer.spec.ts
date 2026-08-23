import { describe, expect, it } from 'vitest';

import {
  assembleP4DirectorContextV2,
  projectP4ContextV2ToDirectorV1,
} from './p4-context-v2-consumer.js';
import { QuestionDirectorContract } from './question-director-contract.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const SEGMENT_ID = '33333333-3333-4333-8333-333333333333';
const ACTUAL_ID = '44444444-4444-4444-8444-444444444444';
const SNAPSHOT_ID = '55555555-5555-4555-8555-555555555555';
const BANK_ITEM_ID = '66666666-6666-4666-8666-666666666666';
const DIGEST = 'a'.repeat(64);

describe('P4 Context V2 Director consumer handoff', () => {
  it('projects assembled V2 fields into the existing V1 contract', () => {
    const context = assembleP4DirectorContextV2({
      actualAsked: [
        {
          evidenceSegmentIds: [SEGMENT_ID],
          inputOrder: 0,
          normalizedDigest: DIGEST,
          questionId: ACTUAL_ID,
          questionText: '你当时和谁一起去的？',
          source: 'interviewer_spontaneous',
        },
      ],
      currentPresentation: {
        displaySequence: 1,
        normalizedQuestionDigest: DIGEST,
        questionText: '你当时和谁一起去的？',
        snapshotId: SNAPSHOT_ID,
      },
      displayed: [
        {
          displaySequence: 1,
          inputOrder: 0,
          normalizedQuestionDigest: DIGEST,
          questionText: '你当时和谁一起去的？',
          snapshotId: SNAPSHOT_ID,
        },
      ],
      goal: '沿着当前故事主线深入一个具体片段。',
      journeyReasonCodes: ['current_thread'],
      journeyStage: 'story_depth',
      policyRevision: 7,
      projectId: PROJECT_ID,
      questionBank: [
        {
          bank: 'deep',
          bankVersion: 'synthetic-1',
          contentDigest: DIGEST,
          inputOrder: 0,
          itemId: BANK_ITEM_ID,
          purpose: 'detail',
          questionText: '那段经历中最清楚的画面是什么？',
          sensitivity: 'low',
          topic: '具体细节',
        },
      ],
      recentTranscript: [
        {
          effectiveTextDigest: DIGEST,
          inputOrder: 0,
          segmentId: SEGMENT_ID,
          sessionId: SESSION_ID,
          speakerRoleRevision: 1,
          startMs: 1200,
          text: '我记得那天和邻居一起去了河边。',
          textRevision: 1,
          trustedRole: 'elder',
        },
      ],
      sessionId: SESSION_ID,
    });

    const projected = projectP4ContextV2ToDirectorV1(context, [
      {
        authority: 'automatic',
        memory_resolution_id: '77777777-7777-4777-8777-777777777777',
        memory_type: 'event',
        value_kind: 'exact',
        value: '河边',
      },
    ]);
    new QuestionDirectorContract().assertContext(projected);

    expect(projected).toEqual({
      context_schema_version: 'interview-director-context-v1',
      current_memories: [
        {
          authority: 'automatic',
          memory_resolution_id: '77777777-7777-4777-8777-777777777777',
          memory_type: 'event',
          value_kind: 'exact',
          value: '河边',
        },
      ],
      current_presentation: { snapshot_id: SNAPSHOT_ID, text: '你当时和谁一起去的？' },
      interview_state: {
        goal: '沿着当前故事主线深入一个具体片段。',
        journey_reason_codes: ['current_thread'],
        journey_stage: 'story_depth',
      },
      recent_transcript: [
        {
          segment_id: SEGMENT_ID,
          start_ms: 1200,
          text: '我记得那天和邻居一起去了河边。',
          trusted_role: 'elder',
        },
      ],
      actual_asked: [{ actual_question_id: ACTUAL_ID, text: '你当时和谁一起去的？' }],
      recently_displayed: [{ snapshot_id: SNAPSHOT_ID, text: '你当时和谁一起去的？' }],
      bank_references: [
        {
          bank: 'deep',
          purpose: 'detail',
          question_bank_item_id: BANK_ITEM_ID,
          question_text: '那段经历中最清楚的画面是什么？',
          sensitivity: 'low',
          topic: '具体细节',
        },
      ],
      boundaries: [],
    });
  });

  it('does not infer displayed publication as actual evidence', () => {
    const context = assembleP4DirectorContextV2({
      actualAsked: [],
      currentPresentation: null,
      displayed: [
        {
          displaySequence: 1,
          inputOrder: 0,
          normalizedQuestionDigest: DIGEST,
          questionText: '系统展示的问题',
          snapshotId: SNAPSHOT_ID,
        },
      ],
      goal: '建立信任和谈话节奏。',
      journeyReasonCodes: [],
      journeyStage: 'rapport',
      policyRevision: 7,
      projectId: PROJECT_ID,
      questionBank: [],
      recentTranscript: [],
      sessionId: SESSION_ID,
    });

    const projected = projectP4ContextV2ToDirectorV1(context, []);

    expect(projected.actual_asked).toEqual([]);
    expect(projected.recently_displayed).toEqual([
      { snapshot_id: SNAPSHOT_ID, text: '系统展示的问题' },
    ]);
  });
});
