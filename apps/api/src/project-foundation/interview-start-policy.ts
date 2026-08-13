export type ProjectOperationalStatus =
  'draft' | 'ready' | 'active' | 'completed' | 'restricted' | 'deleted';

export interface InterviewStartGateInput {
  allRequiredConsentsValid: boolean;
  projectStatus: ProjectOperationalStatus;
  sessionStatus: InterviewSessionOperationalStatus;
}

export type InterviewStartBlockReason =
  'project_not_startable' | 'session_not_startable' | 'consent_required';

export type InterviewStartGateResult =
  { allowed: true } | { allowed: false; reason: InterviewStartBlockReason };

export type InterviewSessionOperationalStatus =
  | 'created'
  | 'device_check'
  | 'recording'
  | 'reconnecting'
  | 'stopping'
  | 'processing'
  | 'completed'
  | 'interrupted'
  | 'failed';

/**
 * Pure domain policy for the formal interview start gate.
 *
 * The caller must aggregate consent validity according to the eventual formal
 * consent-type contract. Keeping that aggregation outside this policy prevents
 * the current contract gap from becoming an accidental enum or API decision.
 */
export function evaluateInterviewStartGate(
  input: InterviewStartGateInput,
): InterviewStartGateResult {
  if (input.projectStatus !== 'ready' && input.projectStatus !== 'active') {
    return { allowed: false, reason: 'project_not_startable' };
  }
  if (input.sessionStatus !== 'device_check') {
    return { allowed: false, reason: 'session_not_startable' };
  }
  if (!input.allRequiredConsentsValid) {
    return { allowed: false, reason: 'consent_required' };
  }
  return { allowed: true };
}
