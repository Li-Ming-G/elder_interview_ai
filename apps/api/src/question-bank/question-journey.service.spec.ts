import { describe, expect, it } from 'vitest';

import {
  JOURNEY_POLICY_VERSION,
  QuestionJourneyService,
  type FrozenJourneyContext,
  type JourneyInputSignal,
} from './question-journey.service.js';

const digestA = 'a'.repeat(64);
const digestB = 'b'.repeat(64);

function context(
  signals: readonly JourneyInputSignal[],
  currentStage: FrozenJourneyContext['currentStage'] = 'life_outline',
): FrozenJourneyContext {
  return {
    boundaryPolicyRevision: 3,
    currentStage,
    memoryManifestHash: digestA,
    policyRevision: 7,
    signals,
    transcriptWatermarks: [
      {
        maxSegmentId: '11111111-1111-4111-8111-111111111111',
        maxSegmentStartMs: 1200,
        sessionId: '22222222-2222-4222-8222-222222222222',
        speakerRoleRevision: 2,
      },
    ],
    trustedRoleWatermarkHash: digestB,
  };
}

describe('journey_policy_v1', () => {
  const service = new QuestionJourneyService();

  it.each([
    [['safety.hard_block'], 'life_outline', ['safety.hard_block'], false, true],
    [['safety.conservative'], 'rapport', ['safety.conservative'], true, false],
    [['response.reluctant'], 'rapport', ['response.reluctant'], true, false],
    [['topic.exhausted'], 'rapport', ['topic.exhausted'], true, false],
    [['response.low_detail'], 'rapport', ['response.low_detail'], true, false],
    [
      ['engagement.continuous_narration'],
      'life_outline',
      ['engagement.continuous_narration'],
      true,
      true,
    ],
    [
      ['engagement.willing_to_deepen', 'response.concrete', 'context.choice'],
      'story_depth',
      ['engagement.willing_to_deepen', 'response.concrete', 'context.choice'],
      true,
      false,
    ],
    [['context.person'], 'life_outline', ['context.person'], true, false],
    [[], 'life_outline', ['stage.hold_no_decisive_signal'], true, false],
  ] as const)(
    'uses fixed priority for %j',
    (signals, stage, reasons, publicationAllowed, shouldContinueListening) => {
      expect(service.evaluate(context(signals), JOURNEY_POLICY_VERSION)).toMatchObject({
        publicationAllowed,
        reasonCodes: reasons,
        shouldContinueListening,
        stage,
      });
    },
  );

  it('retreats at most one stage and defaults missing history to rapport', () => {
    expect(
      service.evaluate(context(['response.low_detail'], 'story_depth'), JOURNEY_POLICY_VERSION),
    ).toMatchObject({ stage: 'life_outline' });
    expect(service.evaluate(context([], null), JOURNEY_POLICY_VERSION)).toMatchObject({
      reasonCodes: ['initial.default_rapport'],
      stage: 'rapport',
    });
    expect(
      service.evaluate(context(['engagement.continuous_narration'], null), JOURNEY_POLICY_VERSION),
    ).toMatchObject({ stage: 'rapport', shouldContinueListening: true });
  });

  it('lets higher-priority safety and retreat signals win conflicts', () => {
    const decision = service.evaluate(
      context([
        'engagement.willing_to_deepen',
        'response.concrete',
        'context.event',
        'topic.exhausted',
        'safety.conservative',
      ]),
      JOURNEY_POLICY_VERSION,
    );
    expect(decision).toMatchObject({ reasonCodes: ['safety.conservative'], stage: 'rapport' });
  });

  it('normalizes signal and watermark order and remains stable on repeat', () => {
    const first = context(['context.choice', 'response.concrete', 'engagement.willing_to_deepen']);
    const second = {
      ...first,
      signals: [
        'engagement.willing_to_deepen',
        'context.choice',
        'response.concrete',
        'context.choice',
      ],
    } satisfies FrozenJourneyContext;
    const left = service.evaluate(first, JOURNEY_POLICY_VERSION);
    const right = service.evaluate(second, JOURNEY_POLICY_VERSION);
    expect(left).toEqual(right);
    expect(service.evaluate(first, JOURNEY_POLICY_VERSION)).toEqual(left);
  });

  it('binds the hash to every frozen provenance input', () => {
    const baseline = service.evaluate(context([]), JOURNEY_POLICY_VERSION).basisHash;
    const changed = [
      { ...context([]), boundaryPolicyRevision: 4 },
      { ...context([]), policyRevision: 8 },
      { ...context([]), memoryManifestHash: 'c'.repeat(64) },
      { ...context([]), trustedRoleWatermarkHash: 'd'.repeat(64) },
      { ...context([]), transcriptWatermarks: [] },
    ];
    for (const value of changed) {
      expect(service.evaluate(value, JOURNEY_POLICY_VERSION).basisHash).not.toBe(baseline);
    }
  });

  it('does not admit question count or elapsed time into the policy basis', () => {
    const baseline = context([]);
    const withForbiddenTieBreakers = {
      ...baseline,
      elapsedMs: 999_999,
      questionCount: 99,
    } as FrozenJourneyContext;
    expect(service.evaluate(withForbiddenTieBreakers, JOURNEY_POLICY_VERSION)).toEqual(
      service.evaluate(baseline, JOURNEY_POLICY_VERSION),
    );
  });

  it('rejects unknown policy versions and malformed frozen inputs', () => {
    expect(() => service.evaluate(context([]), 'journey_policy_v2')).toThrow(
      'QUESTION_BANK_POLICY_UNAVAILABLE',
    );
    expect(() =>
      service.evaluate(
        { ...context([]), memoryManifestHash: 'not-a-hash' },
        JOURNEY_POLICY_VERSION,
      ),
    ).toThrow('QUESTION_BANK_POLICY_UNAVAILABLE');
  });
});
