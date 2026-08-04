import { describe, expect, it } from 'vitest';

import { evaluateInterviewStartGate } from './interview-start-policy.js';

describe('evaluateInterviewStartGate', () => {
  it.each(['ready', 'active'] as const)(
    'allows %s only when service explanation and all required consents are valid',
    (projectStatus) => {
      expect(
        evaluateInterviewStartGate({
          allRequiredConsentsValid: true,
          projectStatus,
          serviceExplanationConfirmed: true,
          sessionStatus: 'device_check',
        }),
      ).toEqual({ allowed: true });
    },
  );

  it.each(['draft', 'completed', 'restricted', 'deleted'] as const)(
    'rejects a %s project first',
    (projectStatus) => {
      expect(
        evaluateInterviewStartGate({
          allRequiredConsentsValid: false,
          projectStatus,
          serviceExplanationConfirmed: false,
          sessionStatus: 'created',
        }),
      ).toEqual({ allowed: false, reason: 'project_not_startable' });
    },
  );

  it.each([
    'created',
    'recording',
    'reconnecting',
    'stopping',
    'processing',
    'completed',
    'interrupted',
    'failed',
  ] as const)(
    'requires device_check before start instead of bypassing the session state machine',
    (sessionStatus) => {
      expect(
        evaluateInterviewStartGate({
          allRequiredConsentsValid: true,
          projectStatus: 'ready',
          serviceExplanationConfirmed: true,
          sessionStatus,
        }),
      ).toEqual({ allowed: false, reason: 'session_not_startable' });
    },
  );

  it('requires a confirmed service explanation before evaluating consent', () => {
    expect(
      evaluateInterviewStartGate({
        allRequiredConsentsValid: false,
        projectStatus: 'ready',
        serviceExplanationConfirmed: false,
        sessionStatus: 'device_check',
      }),
    ).toEqual({ allowed: false, reason: 'service_explanation_required' });
  });

  it('requires the caller-defined complete valid consent set', () => {
    expect(
      evaluateInterviewStartGate({
        allRequiredConsentsValid: false,
        projectStatus: 'ready',
        serviceExplanationConfirmed: true,
        sessionStatus: 'device_check',
      }),
    ).toEqual({ allowed: false, reason: 'consent_required' });
  });
});
