import type { ConsentContinuationProjection } from '@elder-interview/contracts';
import { describe, expect, it } from 'vitest';

import { evaluateRepeatInterviewDecision } from './repeat-interview-decision.js';

const COVERED: ConsentContinuationProjection = {
  basis_consent_record_id: 'consent-1',
  basis_consent_text_version: 'fictional-test-continuing-consent-v1',
  reason: 'same_project_planned_interviews_covered',
  required_action: 'show_recording_reminder',
  required_consent_text_version: 'fictional-test-continuing-consent-v1',
  status: 'covered',
  workflow_version: 'continuing-consent-v1',
};

const REAUTHORIZATION: ConsentContinuationProjection = {
  basis_consent_record_id: 'consent-1',
  basis_consent_text_version: 'mvp-v1',
  reason: 'consent_text_version_incompatible',
  required_action: 'record_formal_consent',
  required_consent_text_version: 'fictional-test-continuing-consent-v1',
  status: 'reauthorization_required',
  workflow_version: 'continuing-consent-v1',
};

describe('evaluateRepeatInterviewDecision', () => {
  it('applies the fixed first-match priority', () => {
    expect(
      evaluateRepeatInterviewDecision({
        actionAccessAvailable: false,
        consentContinuation: COVERED,
        projectStatus: 'active',
        projectStateAvailable: false,
        sessions: [{ id: 's1', sequenceNo: 1, status: 'recording' }],
      }),
    ).toMatchObject({ reason: 'access_unavailable' });

    expect(
      evaluateRepeatInterviewDecision({
        actionAccessAvailable: true,
        consentContinuation: REAUTHORIZATION,
        projectStatus: 'active',
        projectStateAvailable: true,
        sessions: [{ id: 's1', sequenceNo: 1, status: 'recording' }],
      }),
    ).toEqual({
      basis_sequence_no: null,
      basis_session_id: null,
      consent_continuation: REAUTHORIZATION,
      next_sequence_no: null,
      primary_action: null,
      reason: 'session_in_progress',
      workflow_version: 'repeat-interview-v1',
    });

    expect(
      evaluateRepeatInterviewDecision({
        actionAccessAvailable: true,
        consentContinuation: REAUTHORIZATION,
        projectStatus: 'active',
        projectStateAvailable: true,
        sessions: [],
      }),
    ).toMatchObject({ primary_action: null, reason: 'no_completed_session' });
  });

  it('emits eligible only for a latest completed basis with covered continuation', () => {
    expect(
      evaluateRepeatInterviewDecision({
        actionAccessAvailable: true,
        consentContinuation: COVERED,
        projectStatus: 'active',
        projectStateAvailable: true,
        sessions: [{ id: 's2', sequenceNo: 2, status: 'completed' }],
      }),
    ).toEqual({
      basis_sequence_no: 2,
      basis_session_id: 's2',
      consent_continuation: COVERED,
      next_sequence_no: 3,
      primary_action: 'start_next_session',
      reason: 'eligible',
      workflow_version: 'repeat-interview-v1',
    });
  });

  it('fails closed for an unavailable policy and a larger terminal session', () => {
    const unavailable: ConsentContinuationProjection = {
      basis_consent_record_id: null,
      basis_consent_text_version: null,
      reason: 'policy_unavailable',
      required_action: null,
      required_consent_text_version: null,
      status: 'unavailable',
      workflow_version: 'continuing-consent-v1',
    };
    expect(
      evaluateRepeatInterviewDecision({
        actionAccessAvailable: true,
        consentContinuation: unavailable,
        projectStatus: 'active',
        projectStateAvailable: true,
        sessions: [{ id: 's1', sequenceNo: 1, status: 'completed' }],
      }),
    ).toMatchObject({ reason: 'consent_unavailable' });
    expect(
      evaluateRepeatInterviewDecision({
        actionAccessAvailable: true,
        consentContinuation: COVERED,
        projectStatus: 'active',
        projectStateAvailable: true,
        sessions: [
          { id: 's1', sequenceNo: 1, status: 'completed' },
          { id: 's2', sequenceNo: 2, status: 'failed' },
        ],
      }),
    ).toMatchObject({ reason: 'project_unavailable' });
  });
});
