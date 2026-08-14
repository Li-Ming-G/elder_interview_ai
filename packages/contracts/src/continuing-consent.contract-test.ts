import type {
  ConsentContinuationProjection,
  RepeatInterviewProjectActionProjection,
} from './index.js';

type AssertTrue<Value extends true> = Value;
type AssertFalse<Value extends false> = Value;
type IsAssignable<Candidate, Contract> = Candidate extends Contract ? true : false;

type Covered = {
  status: 'covered';
  reason: 'same_project_planned_interviews_covered';
  basis_consent_record_id: 'consent-1';
  basis_consent_text_version: 'consent-v2';
  required_consent_text_version: 'consent-v2';
  required_action: 'show_recording_reminder';
  workflow_version: 'continuing-consent-v1';
};

type Reauthorization = {
  status: 'reauthorization_required';
  reason: 'consent_text_version_incompatible';
  basis_consent_record_id: 'consent-1';
  basis_consent_text_version: 'consent-v1';
  required_consent_text_version: 'consent-v2';
  required_action: 'record_formal_consent';
  workflow_version: 'continuing-consent-v1';
};

type Unavailable = {
  status: 'unavailable';
  reason: 'policy_unavailable';
  basis_consent_record_id: null;
  basis_consent_text_version: null;
  required_consent_text_version: null;
  required_action: null;
  workflow_version: 'continuing-consent-v1';
};

export type CoveredCombinationIsAccepted = AssertTrue<
  IsAssignable<Covered, ConsentContinuationProjection>
>;
export type ReauthorizationCombinationIsAccepted = AssertTrue<
  IsAssignable<Reauthorization, ConsentContinuationProjection>
>;
export type UnavailableCombinationIsAccepted = AssertTrue<
  IsAssignable<Unavailable, ConsentContinuationProjection>
>;

export type CoveredCannotUseReauthorizationAction = AssertFalse<
  IsAssignable<
    Omit<Covered, 'required_action'> & { required_action: 'record_formal_consent' },
    ConsentContinuationProjection
  >
>;
export type MissingConsentCannotClaimBasis = AssertFalse<
  IsAssignable<
    Omit<Reauthorization, 'reason' | 'basis_consent_record_id'> & {
      reason: 'consent_missing';
      basis_consent_record_id: 'consent-1';
    },
    ConsentContinuationProjection
  >
>;
export type ExistingConsentReasonRequiresBasis = AssertFalse<
  IsAssignable<
    Omit<Reauthorization, 'basis_consent_record_id'> & { basis_consent_record_id: null },
    ConsentContinuationProjection
  >
>;
export type UnavailableCannotCarryVersions = AssertFalse<
  IsAssignable<
    Omit<Unavailable, 'required_consent_text_version'> & {
      required_consent_text_version: 'consent-v2';
    },
    ConsentContinuationProjection
  >
>;

type EligibleAction = {
  primary_action: 'start_next_session';
  reason: 'eligible';
  basis_session_id: 'session-1';
  basis_sequence_no: 1;
  next_sequence_no: 2;
  workflow_version: 'repeat-interview-v1';
  consent_continuation: Covered;
};

type SessionInProgressWithReauthorization = {
  primary_action: null;
  reason: 'session_in_progress';
  basis_session_id: null;
  basis_sequence_no: null;
  next_sequence_no: null;
  workflow_version: 'repeat-interview-v1';
  consent_continuation: Reauthorization;
};

type NoCompletedSessionWithReauthorization = Omit<
  SessionInProgressWithReauthorization,
  'reason'
> & {
  reason: 'no_completed_session';
};

export type EligibleCrossCombinationIsAccepted = AssertTrue<
  IsAssignable<EligibleAction, RepeatInterviewProjectActionProjection>
>;
export type SessionInProgressWinsOverReauthorization = AssertTrue<
  IsAssignable<SessionInProgressWithReauthorization, RepeatInterviewProjectActionProjection>
>;
export type NoCompletedSessionWinsOverReauthorization = AssertTrue<
  IsAssignable<NoCompletedSessionWithReauthorization, RepeatInterviewProjectActionProjection>
>;
export type EligibleCannotCarryReauthorization = AssertFalse<
  IsAssignable<
    Omit<EligibleAction, 'consent_continuation'> & { consent_continuation: Reauthorization },
    RepeatInterviewProjectActionProjection
  >
>;
export type ReauthorizationCannotBecomePrimaryWhileSessionInProgress = AssertFalse<
  IsAssignable<
    Omit<SessionInProgressWithReauthorization, 'primary_action'> & {
      primary_action: 'record_formal_consent';
    },
    RepeatInterviewProjectActionProjection
  >
>;
export type SessionInProgressCannotExposeSessionBasis = AssertFalse<
  IsAssignable<
    Omit<SessionInProgressWithReauthorization, 'basis_session_id'> & {
      basis_session_id: 'session-1';
    },
    RepeatInterviewProjectActionProjection
  >
>;
export type ReauthorizationActionCannotCarryCoveredConsent = AssertFalse<
  IsAssignable<
    {
      primary_action: 'record_formal_consent';
      reason: 'consent_reauthorization_required';
      basis_session_id: null;
      basis_sequence_no: null;
      next_sequence_no: null;
      workflow_version: 'repeat-interview-v1';
      consent_continuation: Covered;
    },
    RepeatInterviewProjectActionProjection
  >
>;
export type ConsentUnavailableRequiresUnavailableProjection = AssertFalse<
  IsAssignable<
    {
      primary_action: null;
      reason: 'consent_unavailable';
      basis_session_id: null;
      basis_sequence_no: null;
      next_sequence_no: null;
      workflow_version: 'repeat-interview-v1';
      consent_continuation: Reauthorization;
    },
    RepeatInterviewProjectActionProjection
  >
>;
