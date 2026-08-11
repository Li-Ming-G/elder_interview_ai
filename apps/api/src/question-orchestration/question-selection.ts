import type { FrozenProviderSegment } from '../ai-runtime/structured-ai.provider.js';
import type {
  QuestionCandidateResult,
  QuestionPurpose,
} from '../question-evidence/question-presentation.types.js';

export const QUESTION_SELECTION_POLICY_VERSION = 'question-select-v1';

type Grounding = QuestionCandidateResult['grounding'];

export interface QuestionSelectionFacts {
  grounding: Grounding;
  purpose: QuestionPurpose;
  risk: 'low' | 'medium' | 'high';
  segments: readonly FrozenProviderSegment[];
  stage: 'rapport' | 'life_outline' | 'story_depth';
}

/**
 * The bounded answer used by journey response signals and question selection.
 * Older session text and memory never become response/engagement signals.
 */
export function latestSubstantiveElderAnswer(
  segments: readonly FrozenProviderSegment[],
): readonly FrozenProviderSegment[] {
  const ordered = [...segments].sort(
    (left, right) => left.startMs - right.startMs || left.segmentId.localeCompare(right.segmentId),
  );
  let lastInterviewerIndex = -1;
  for (const [index, segment] of ordered.entries()) {
    if (segment.trustedRole === 'interviewer') lastInterviewerIndex = index;
  }
  return ordered
    .slice(lastInterviewerIndex + 1)
    .filter(({ text, trustedRole }) => trustedRole === 'elder' && text.trim().length >= 2)
    .slice(-3);
}

/** Deterministic backend comparator. It consumes no model-provided score. */
export function scoreQuestionSelectionV1(facts: QuestionSelectionFacts): number {
  const answer = latestSubstantiveElderAnswer(facts.segments);
  const answerIds = answer.map(({ segmentId }) => segmentId);
  const groundedSegments = new Set(
    facts.grounding
      .filter((item): item is { id: string; kind: 'segment' } => item.kind === 'segment')
      .map(({ id }) => id),
  );
  const hasMemoryGrounding = facts.grounding.some(({ kind }) => kind === 'memory');
  const latestAnswerId = answer.at(-1)?.segmentId;
  const answerGroundedCount = answerIds.filter((id) => groundedSegments.has(id)).length;
  const hasAnySegmentGrounding = groundedSegments.size > 0;

  const groundingFreshness =
    latestAnswerId !== undefined && groundedSegments.has(latestAnswerId)
      ? 1
      : answerGroundedCount > 0
        ? 0.65
        : hasAnySegmentGrounding
          ? 0.25
          : hasMemoryGrounding
            ? 0.2
            : 0;
  const latestAnswerCoverage =
    answerIds.length > 0 ? answerGroundedCount / answerIds.length : hasMemoryGrounding ? 0.5 : 0;
  const stagePurposeFit = purposeFitsStage(facts.stage, facts.purpose) ? 1 : 0.5;
  const riskFit = facts.risk === 'low' ? 1 : facts.risk === 'medium' ? 0.5 : 0;

  return round3(
    0.55 * groundingFreshness + 0.2 * latestAnswerCoverage + 0.15 * stagePurposeFit + 0.1 * riskFit,
  );
}

function purposeFitsStage(
  stage: QuestionSelectionFacts['stage'],
  purpose: QuestionPurpose,
): boolean {
  const compatible: Record<QuestionSelectionFacts['stage'], readonly QuestionPurpose[]> = {
    life_outline: ['person', 'scene', 'timeline', 'clarify', 'transition'],
    rapport: ['person', 'scene', 'timeline', 'transition'],
    story_depth: ['detail', 'cause', 'emotion', 'choice', 'conflict', 'turning_point', 'clarify'],
  };
  return compatible[stage].includes(purpose);
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
