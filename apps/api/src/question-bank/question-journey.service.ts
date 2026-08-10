import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { JOURNEY_STAGES, type JourneyStage, QuestionBankError } from './question-bank.types.js';

export const JOURNEY_POLICY_VERSION = 'journey_policy_v1';

export const JOURNEY_INPUT_SIGNALS = [
  'safety.hard_block',
  'safety.conservative',
  'response.reluctant',
  'response.low_detail',
  'topic.exhausted',
  'engagement.continuous_narration',
  'engagement.willing_to_deepen',
  'response.concrete',
  'context.person',
  'context.event',
  'context.choice',
  'context.turning_point',
  'context.emotion',
  'context.unfinished_story',
] as const;

export const JOURNEY_REASON_CODE_ORDER = [
  'initial.default_rapport',
  ...JOURNEY_INPUT_SIGNALS,
  'stage.hold_no_decisive_signal',
] as const;

export type JourneyInputSignal = (typeof JOURNEY_INPUT_SIGNALS)[number];
export type JourneyReasonCode = (typeof JOURNEY_REASON_CODE_ORDER)[number];

export interface JourneyTranscriptWatermark {
  maxSegmentId: string | null;
  maxSegmentStartMs: number | null;
  sessionId: string;
  speakerRoleRevision: number;
}

export interface FrozenJourneyContext {
  boundaryPolicyRevision: number;
  currentStage: JourneyStage | null;
  memoryManifestHash: string;
  policyRevision: number;
  signals: readonly JourneyInputSignal[];
  transcriptWatermarks: readonly JourneyTranscriptWatermark[];
  trustedRoleWatermarkHash: string;
}

export interface JourneyDecision {
  basisHash: string;
  journeyPolicyVersion: typeof JOURNEY_POLICY_VERSION;
  publicationAllowed: boolean;
  reasonCodes: readonly JourneyReasonCode[];
  shouldContinueListening: boolean;
  stage: JourneyStage;
}

const knownSignals = new Set<string>(JOURNEY_INPUT_SIGNALS);
const reasonOrder = new Map<string, number>(
  JOURNEY_REASON_CODE_ORDER.map((reason, index) => [reason, index]),
);
const storyAnchors = [
  'context.person',
  'context.event',
  'context.choice',
  'context.turning_point',
  'context.emotion',
  'context.unfinished_story',
] as const satisfies readonly JourneyInputSignal[];

@Injectable()
export class QuestionJourneyService {
  public evaluate(
    frozenContext: FrozenJourneyContext,
    journeyPolicyVersion: string,
  ): JourneyDecision {
    if (journeyPolicyVersion !== JOURNEY_POLICY_VERSION) {
      throw new QuestionBankError('QUESTION_BANK_POLICY_UNAVAILABLE');
    }
    const normalized = normalizeContext(frozenContext);
    const signals = new Set<JourneyInputSignal>(normalized.signals);
    const current = normalized.currentStage ?? 'rapport';
    let stage: JourneyStage;
    let reasonCodes: JourneyReasonCode[];
    let publicationAllowed = true;
    let shouldContinueListening = false;

    if (signals.has('safety.hard_block')) {
      stage = current;
      reasonCodes = ['safety.hard_block'];
      publicationAllowed = false;
      shouldContinueListening = true;
    } else if (signals.has('safety.conservative')) {
      stage = 'rapport';
      reasonCodes = ['safety.conservative'];
    } else if (signals.has('response.reluctant')) {
      stage = 'rapport';
      reasonCodes = ['response.reluctant'];
    } else if (signals.has('response.low_detail') || signals.has('topic.exhausted')) {
      stage = retreatOneStage(current);
      reasonCodes = selected(signals, ['response.low_detail', 'topic.exhausted']);
    } else if (signals.has('engagement.continuous_narration')) {
      stage = current;
      reasonCodes = ['engagement.continuous_narration'];
      shouldContinueListening = true;
    } else if (
      signals.has('engagement.willing_to_deepen') &&
      signals.has('response.concrete') &&
      storyAnchors.some((anchor) => signals.has(anchor))
    ) {
      stage = 'story_depth';
      reasonCodes = selected(signals, [
        'engagement.willing_to_deepen',
        'response.concrete',
        ...storyAnchors,
      ]);
    } else if (
      signals.has('response.concrete') ||
      signals.has('context.person') ||
      signals.has('context.event')
    ) {
      stage = current === 'rapport' ? 'life_outline' : current;
      reasonCodes = selected(signals, ['response.concrete', 'context.person', 'context.event']);
    } else {
      stage = current;
      reasonCodes =
        normalized.currentStage === null
          ? ['initial.default_rapport']
          : ['stage.hold_no_decisive_signal'];
    }

    return {
      basisHash: sha256(JSON.stringify({ context: normalized, journeyPolicyVersion })),
      journeyPolicyVersion: JOURNEY_POLICY_VERSION,
      publicationAllowed,
      reasonCodes: sortReasons(reasonCodes),
      shouldContinueListening,
      stage,
    };
  }
}

function normalizeContext(context: FrozenJourneyContext): FrozenJourneyContext {
  if (context.currentStage !== null && !JOURNEY_STAGES.includes(context.currentStage)) {
    throw new QuestionBankError('QUESTION_BANK_POLICY_UNAVAILABLE');
  }
  if (
    !Number.isInteger(context.boundaryPolicyRevision) ||
    context.boundaryPolicyRevision < 0 ||
    !Number.isInteger(context.policyRevision) ||
    context.policyRevision < 0 ||
    !isDigest(context.memoryManifestHash) ||
    !isDigest(context.trustedRoleWatermarkHash)
  ) {
    throw new QuestionBankError('QUESTION_BANK_POLICY_UNAVAILABLE');
  }
  if (!Array.isArray(context.signals) || !Array.isArray(context.transcriptWatermarks)) {
    throw new QuestionBankError('QUESTION_BANK_POLICY_UNAVAILABLE');
  }
  const signalValues: unknown[] = context.signals;
  const signals = [...new Set(signalValues)];
  if (signals.some((signal) => typeof signal !== 'string' || !knownSignals.has(signal))) {
    throw new QuestionBankError('QUESTION_BANK_POLICY_UNAVAILABLE');
  }
  const normalizedSignals = signals as JourneyInputSignal[];
  const watermarkValues: unknown[] = context.transcriptWatermarks;
  const watermarks = watermarkValues.map((value): JourneyTranscriptWatermark => {
    if (!isRecord(value)) throw new QuestionBankError('QUESTION_BANK_POLICY_UNAVAILABLE');
    const pairIsNull = value.maxSegmentId === null && value.maxSegmentStartMs === null;
    const pairIsPresent =
      typeof value.maxSegmentId === 'string' &&
      isUuid(value.maxSegmentId) &&
      Number.isInteger(value.maxSegmentStartMs) &&
      typeof value.maxSegmentStartMs === 'number' &&
      value.maxSegmentStartMs >= 0;
    if (
      typeof value.sessionId !== 'string' ||
      !isUuid(value.sessionId) ||
      (!pairIsNull && !pairIsPresent) ||
      !Number.isInteger(value.speakerRoleRevision) ||
      typeof value.speakerRoleRevision !== 'number' ||
      value.speakerRoleRevision < 0
    ) {
      throw new QuestionBankError('QUESTION_BANK_POLICY_UNAVAILABLE');
    }
    return {
      maxSegmentId: value.maxSegmentId as string | null,
      maxSegmentStartMs: value.maxSegmentStartMs as number | null,
      sessionId: value.sessionId,
      speakerRoleRevision: value.speakerRoleRevision,
    };
  });
  watermarks.sort(
    (left, right) =>
      left.sessionId.localeCompare(right.sessionId) ||
      (left.maxSegmentStartMs ?? -1) - (right.maxSegmentStartMs ?? -1) ||
      (left.maxSegmentId ?? '').localeCompare(right.maxSegmentId ?? ''),
  );
  if (new Set(watermarks.map(({ sessionId }) => sessionId)).size !== watermarks.length) {
    throw new QuestionBankError('QUESTION_BANK_POLICY_UNAVAILABLE');
  }
  return {
    boundaryPolicyRevision: context.boundaryPolicyRevision,
    currentStage: context.currentStage,
    memoryManifestHash: context.memoryManifestHash,
    policyRevision: context.policyRevision,
    signals: normalizedSignals.sort(),
    transcriptWatermarks: watermarks,
    trustedRoleWatermarkHash: context.trustedRoleWatermarkHash,
  };
}

function selected(
  signals: ReadonlySet<JourneyInputSignal>,
  candidates: readonly JourneyInputSignal[],
): JourneyReasonCode[] {
  return candidates.filter((candidate) => signals.has(candidate));
}

function sortReasons(reasons: JourneyReasonCode[]): JourneyReasonCode[] {
  return [...reasons].sort(
    (left, right) => (reasonOrder.get(left) ?? 99) - (reasonOrder.get(right) ?? 99),
  );
}

function retreatOneStage(stage: JourneyStage): JourneyStage {
  if (stage === 'story_depth') return 'life_outline';
  return 'rapport';
}

function isDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
