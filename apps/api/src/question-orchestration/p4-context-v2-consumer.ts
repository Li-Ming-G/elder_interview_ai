import type { QuestionPurpose } from '../question-evidence/question-presentation.types.js';
import {
  assembleP4ContextV2,
  validateP4ContextV2,
  type P4AssemblyInput,
  type P4ContextV2,
  type P4Presentation,
} from '../memory/p4-context-v2-assembly.js';
import {
  DIRECTOR_CONTEXT_SCHEMA_VERSION,
  type InterviewDirectorContextV1,
} from './question-director-contract.js';

/**
 * The production budget remains an opaque P4 seam. Numeric selection is not
 * part of this consumer handoff.
 */
export const P4_DIRECTOR_BUDGET_CONFIG_REF = 'runtime://p4/context-v2';
export const P4_DIRECTOR_POLICY_VERSION = 'p4-priority-budget-v1';

export interface P4DirectorTranscriptInput {
  effectiveTextDigest: string;
  inputOrder: number;
  segmentId: string;
  sessionId: string;
  speakerRoleRevision: number;
  startMs: number;
  text: string;
  textRevision: number;
  trustedRole: 'elder' | 'interviewer';
}

export interface P4DirectorActualQuestionInput {
  evidenceSegmentIds: readonly string[];
  inputOrder: number;
  normalizedDigest: string;
  questionText: string;
  source: 'interviewer_spontaneous' | 'matched_system_suggestion';
  questionId: string;
}

export interface P4DirectorDisplayedQuestionInput {
  displaySequence: number;
  inputOrder: number;
  normalizedQuestionDigest: string;
  questionText: string;
  snapshotId: string;
}

export interface P4DirectorQuestionBankInput {
  bank: 'basic' | 'deep';
  bankVersion: string;
  contentDigest: string;
  inputOrder: number;
  itemId: string;
  purpose: QuestionPurpose;
  questionText: string;
  sensitivity: 'low' | 'medium' | 'high';
  topic: string;
}

export interface P4DirectorPresentationInput {
  displaySequence: number;
  normalizedQuestionDigest: string;
  questionText: string;
  snapshotId: string;
}

export interface P4DirectorAssemblyInput {
  actualAsked: readonly P4DirectorActualQuestionInput[];
  currentPresentation: P4DirectorPresentationInput | null;
  displayed: readonly P4DirectorDisplayedQuestionInput[];
  goal: string;
  journeyReasonCodes: readonly string[];
  journeyStage: 'rapport' | 'life_outline' | 'story_depth';
  policyRevision: number;
  projectId: string;
  questionBank: readonly P4DirectorQuestionBankInput[];
  recentTranscript: readonly P4DirectorTranscriptInput[];
  sessionId: string;
}

export function assembleP4DirectorContextV2(input: P4DirectorAssemblyInput): P4ContextV2 {
  const assemblyInput: P4AssemblyInput = {
    project_id: input.projectId,
    current_session_id: input.sessionId,
    interview_state: {
      goal: input.goal,
      journey_reason_codes: [...input.journeyReasonCodes],
      journey_stage: input.journeyStage,
    },
    // P1 working memory, P3 retrieval candidates, thread memory, and control
    // boundaries are not owned by this legacy Director seam. Empty sections
    // keep the V2 membership manifest explicit without inventing evidence.
    working_memory: [],
    active_memory: emptyThreadMemory(),
    resumed_memory: emptyThreadMemory(),
    recent_transcript: input.recentTranscript.map((segment) => ({
      input_order: segment.inputOrder,
      source_membership_digest: segment.effectiveTextDigest,
      value: {
        content_kind: 'conversation_final' as const,
        effective_text_digest: segment.effectiveTextDigest,
        segment_id: segment.segmentId,
        session_id: segment.sessionId,
        speaker_role_revision: segment.speakerRoleRevision,
        start_ms: segment.startMs,
        text: segment.text,
        text_revision: segment.textRevision,
        trusted_role: segment.trustedRole,
      },
    })),
    memory_candidates: [],
    boundaries: [],
    actual_asked: input.actualAsked.map((question) => ({
      input_order: question.inputOrder,
      source_membership_digest: question.normalizedDigest,
      value: {
        actual_question_id: question.questionId,
        evidence_segment_ids: [...question.evidenceSegmentIds],
        source: question.source,
        text: question.questionText,
      },
    })),
    displayed: input.displayed.map((question) => ({
      input_order: question.inputOrder,
      source_membership_digest: question.normalizedQuestionDigest,
      value: {
        actual_question_id: null,
        display_sequence: question.displaySequence,
        outcome: 'unjudged' as const,
        snapshot_id: question.snapshotId,
        text: question.questionText,
      },
    })),
    question_bank: input.questionBank.map((question) => ({
      input_order: question.inputOrder,
      source_membership_digest: question.contentDigest,
      value: {
        bank: question.bank,
        bank_version: question.bankVersion,
        purpose: question.purpose,
        question_bank_item_id: question.itemId,
        question_text: question.questionText,
        sensitivity: question.sensitivity,
        topic: question.topic,
      },
    })),
    current_presentation:
      input.currentPresentation === null
        ? null
        : {
            input_order: input.currentPresentation.displaySequence,
            source_membership_digest: input.currentPresentation.normalizedQuestionDigest,
            value: {
              display_sequence: input.currentPresentation.displaySequence,
              snapshot_id: input.currentPresentation.snapshotId,
              text: input.currentPresentation.questionText,
            },
          },
    budget: {
      config_ref: P4_DIRECTOR_BUDGET_CONFIG_REF,
      policy_version: P4_DIRECTOR_POLICY_VERSION,
    },
    policy_revision: String(input.policyRevision),
  };
  return assembleP4ContextV2(assemblyInput);
}

export function projectP4ContextV2ToDirectorV1(
  context: P4ContextV2,
  currentMemories: InterviewDirectorContextV1['current_memories'],
): InterviewDirectorContextV1 {
  validateP4ContextV2(context);
  return {
    context_schema_version: DIRECTOR_CONTEXT_SCHEMA_VERSION,
    current_presentation: projectPresentation(context.current_presentation),
    interview_state: {
      goal: context.interview_state.goal,
      journey_reason_codes: [...context.interview_state.journey_reason_codes],
      journey_stage: context.interview_state.journey_stage,
    },
    recent_transcript: context.recent_transcript.map((segment) => ({
      segment_id: segment.segment_id,
      start_ms: segment.start_ms,
      text: segment.text,
      trusted_role: segment.trusted_role,
    })),
    // current_memories predates P4's seven-field projection list. Preserve it
    // from the already-authorized legacy builder so the V1 Director contract
    // and its grounding IDs remain unchanged during this handoff.
    current_memories: currentMemories.map((memory) => ({ ...memory })),
    actual_asked: context.actual_asked.map(({ actual_question_id, text }) => ({
      actual_question_id,
      text,
    })),
    recently_displayed: context.displayed.map(({ snapshot_id, text }) => ({
      snapshot_id,
      text,
    })),
    bank_references: context.question_bank.map((reference) => ({
      bank: reference.bank,
      purpose: reference.purpose as QuestionPurpose,
      question_bank_item_id: reference.question_bank_item_id,
      question_text: reference.question_text,
      sensitivity: reference.sensitivity,
      topic: reference.topic,
    })),
    boundaries: context.boundaries.map(({ abstract_scope, code }) => ({
      abstract_scope,
      code,
    })),
  };
}

function emptyThreadMemory(): P4AssemblyInput['active_memory'] {
  return {
    items: [],
    source_session_id: null,
    state: 'empty' as const,
    thread_id: null,
    thread_revision: null,
  };
}

function projectPresentation(
  presentation: P4Presentation | null,
): InterviewDirectorContextV1['current_presentation'] {
  return presentation === null
    ? null
    : { snapshot_id: presentation.snapshot_id, text: presentation.text };
}
