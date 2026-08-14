import type {
  ConsentContinuationProjection,
  RepeatInterviewProjectActionProjection,
} from '@elder-interview/contracts';

import type {
  InterviewSessionOperationalStatus,
  ProjectOperationalStatus,
} from './interview-start-policy.js';

export interface RepeatInterviewSessionFact {
  id: string;
  sequenceNo: number;
  status: InterviewSessionOperationalStatus;
}

export interface RepeatInterviewDecisionInput {
  actionAccessAvailable: boolean;
  consentContinuation: ConsentContinuationProjection;
  projectStateAvailable: boolean;
  projectStatus: ProjectOperationalStatus;
  sessions: readonly RepeatInterviewSessionFact[];
}

const NONTERMINAL = new Set<InterviewSessionOperationalStatus>([
  'created',
  'device_check',
  'recording',
  'reconnecting',
  'interrupted',
  'stopping',
  'processing',
]);

export function evaluateRepeatInterviewDecision(
  input: RepeatInterviewDecisionInput,
): RepeatInterviewProjectActionProjection {
  if (!input.actionAccessAvailable) return unavailable('access_unavailable');
  const completed = input.sessions
    .filter((session) => session.status === 'completed')
    .sort((left, right) => right.sequenceNo - left.sequenceNo)[0];
  const largestTerminalSequence = Math.max(
    0,
    ...input.sessions
      .filter((session) => !NONTERMINAL.has(session.status))
      .map(({ sequenceNo }) => sequenceNo),
  );
  if (
    !input.projectStateAvailable ||
    input.projectStatus !== 'active' ||
    (completed !== undefined && largestTerminalSequence > completed.sequenceNo)
  ) {
    return unavailable('project_unavailable');
  }
  if (input.sessions.some((session) => NONTERMINAL.has(session.status))) {
    return sessionBlocked('session_in_progress', input.consentContinuation);
  }
  if (completed === undefined) {
    return sessionBlocked('no_completed_session', input.consentContinuation);
  }
  if (input.consentContinuation.status === 'unavailable') {
    return {
      basis_sequence_no: null,
      basis_session_id: null,
      consent_continuation: input.consentContinuation,
      next_sequence_no: null,
      primary_action: null,
      reason: 'consent_unavailable',
      workflow_version: 'repeat-interview-v1',
    };
  }
  if (input.consentContinuation.status === 'reauthorization_required') {
    return {
      basis_sequence_no: null,
      basis_session_id: null,
      consent_continuation: input.consentContinuation,
      next_sequence_no: null,
      primary_action: 'record_formal_consent',
      reason: 'consent_reauthorization_required',
      workflow_version: 'repeat-interview-v1',
    };
  }
  return {
    basis_sequence_no: completed.sequenceNo,
    basis_session_id: completed.id,
    consent_continuation: input.consentContinuation,
    next_sequence_no: completed.sequenceNo + 1,
    primary_action: 'start_next_session',
    reason: 'eligible',
    workflow_version: 'repeat-interview-v1',
  };
}

function unavailable(
  reason: 'access_unavailable' | 'project_unavailable',
): RepeatInterviewProjectActionProjection {
  return {
    basis_sequence_no: null,
    basis_session_id: null,
    consent_continuation: null,
    next_sequence_no: null,
    primary_action: null,
    reason,
    workflow_version: 'repeat-interview-v1',
  };
}

function sessionBlocked(
  reason: 'no_completed_session' | 'session_in_progress',
  consentContinuation: ConsentContinuationProjection,
): RepeatInterviewProjectActionProjection {
  return {
    basis_sequence_no: null,
    basis_session_id: null,
    consent_continuation: consentContinuation,
    next_sequence_no: null,
    primary_action: null,
    reason,
    workflow_version: 'repeat-interview-v1',
  };
}
