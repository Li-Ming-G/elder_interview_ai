import type {
  SuggestionPresentationChangedPayload,
  SuggestionPresentationResponse,
} from '@elder-interview/contracts';

import type { FrozenAiJob } from '../ai-runtime/ai-job-coordinator.service.js';
import type { JourneyStage } from '../question-bank/question-bank.types.js';
import type { JourneyReasonCode } from '../question-bank/question-journey.service.js';

export type QuestionAttemptKind = 'automatic' | 'manual_next' | 'second_session_opening';
export type QuestionResultKind = 'suggestion' | 'continue_listening' | 'unavailable';
export type QuestionPurpose =
  | 'detail'
  | 'cause'
  | 'person'
  | 'scene'
  | 'emotion'
  | 'choice'
  | 'conflict'
  | 'turning_point'
  | 'clarify'
  | 'timeline'
  | 'transition';

export interface QuestionBankInputReference {
  bank: 'basic' | 'deep';
  bankVersion: string;
  contentDigest: string;
  itemId: string;
  licenseStatus: 'project_original' | 'verified' | 'fixture_only';
  purpose: QuestionPurpose;
  questionId: string;
  questionText: string;
  sensitivity: 'low' | 'medium' | 'high';
  topic: string;
}

export interface BeginQuestionGenerationCommand {
  attemptKind: QuestionAttemptKind;
  basisPresentationRevision: number;
  basisSnapshotId: string | null;
  job: FrozenAiJob;
  journeyBasisHash: string;
  journeyPolicyVersion: string;
  journeyReasonCodes: readonly JourneyReasonCode[];
  journeyStage: JourneyStage;
  bankReferences: readonly QuestionBankInputReference[];
  promptBundleVersion: string;
  promptBundleDigest: string;
  contextSchemaVersion: string;
  contextSchemaDigest: string;
  outputSchemaVersion: string;
  outputSchemaDigest: string;
  contextBuilderVersion: string;
  contextBuilderDigest: string;
  modelConfigVersion: string;
  modelConfigDigest: string;
  selectionPolicyVersion: string;
  sessionId: string;
  similarityPolicyVersion: string;
}

export interface QuestionAttemptReceipt {
  attemptId: string;
  acceptedPresentationRevision: number;
  manualIntentSequence: number;
  replayed: boolean;
  status: 'pending' | 'running';
  frozenInputHash: string;
}

export interface QuestionCandidateResult {
  declaredBankReferences: readonly {
    questionBankItemId: string;
    usage: 'inspiration' | 'adapted' | 'verbatim';
  }[];
  grounding: readonly ({ kind: 'segment'; id: string } | { kind: 'memory'; id: string })[];
  purpose: QuestionPurpose;
  questionText: string;
  reasonText: string;
  risk: 'low' | 'medium' | 'high';
  selectionScore: number;
}

export interface PublishQuestionAttemptCommand {
  attemptId: string;
  candidate: QuestionCandidateResult | null;
  job: FrozenAiJob;
  resultKind: QuestionResultKind;
  sessionId: string;
}

export interface QuestionPublicationResult {
  change: SuggestionPresentationChangedPayload | null;
  current: SuggestionPresentationResponse;
  publicationOutcome:
    | 'published'
    | 'not_better'
    | 'duplicate_filtered'
    | 'stale_basis'
    | 'superseded_by_manual'
    | 'policy_blocked'
    | 'not_applicable';
}

export interface WithdrawQuestionPresentationCommand {
  projectId: string;
  reason:
    | 'restricted'
    | 'do_not_ask'
    | 'deletion_active'
    | 'consent_revoked'
    | 'access_revoked'
    | 'policy_unavailable';
  sessionId: string;
}
