import type {
  SuggestionPresentationChangedPayload,
  SuggestionPresentationResponse,
} from '@elder-interview/contracts';

import type { FrozenAiJob } from '../ai-runtime/ai-job-coordinator.service.js';
import type { JourneyStage } from '../question-bank/question-bank.types.js';
import type { JourneyReasonCode } from '../question-bank/question-journey.service.js';

export type QuestionAttemptKind = 'automatic' | 'manual_next' | 'second_session_opening';
export type QuestionResultKind = 'suggestion' | 'continue_listening' | 'unavailable';
export type QuestionSelectionMode = 'verbatim' | 'lightly_adapted';
export type QuestionAdaptationReason = 'surface_wording' | 'grounded_slot_fill';

export interface BeginQuestionGenerationCommand {
  attemptKind: QuestionAttemptKind;
  basisPresentationRevision: number;
  basisSnapshotId: string | null;
  job: FrozenAiJob;
  journeyBasisHash: string;
  journeyPolicyVersion: string;
  journeyReasonCodes: readonly JourneyReasonCode[];
  journeyStage: JourneyStage;
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
}

export interface QuestionCandidateResult {
  adaptationReasonCode: QuestionAdaptationReason | null;
  confidence: number;
  evidenceSegmentIds: readonly string[];
  groundedSlotValue?: string;
  memoryResolutionIds: readonly string[];
  purpose: string;
  questionText: string;
  reasonText: string;
  risk: 'low' | 'medium' | 'high';
  selectionMode: QuestionSelectionMode;
  selectionScore: number;
  sourceBank: 'basic' | 'deep';
  sourceBankVersion: string;
  sourceQuestionBankItemId: string;
  sourceQuestionId: string;
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
