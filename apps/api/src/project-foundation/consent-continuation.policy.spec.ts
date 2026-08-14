import { describe, expect, it } from 'vitest';

import {
  FICTIONAL_CONTINUING_CONSENT_VERSION,
  SyntheticConsentContinuationPolicyReader,
  UnavailableConsentContinuationPolicyReader,
} from './consent-continuation.policy.js';

describe('consent continuation policy reader', () => {
  it('keeps the production default unavailable even for an exact valid legacy version', async () => {
    await expect(
      new UnavailableConsentContinuationPolicyReader().evaluate({
        id: 'consent-1',
        revokedAt: null,
        status: 'valid',
        textVersion: 'mvp-v1',
      }),
    ).resolves.toEqual({
      basis_consent_record_id: null,
      basis_consent_text_version: null,
      reason: 'policy_unavailable',
      required_action: null,
      required_consent_text_version: null,
      status: 'unavailable',
      workflow_version: 'continuing-consent-v1',
    });
  });

  it('allows only the explicitly injected fictional fixture to reach covered', async () => {
    const policy = new SyntheticConsentContinuationPolicyReader();
    await expect(
      policy.evaluate({
        id: 'consent-2',
        revokedAt: null,
        status: 'valid',
        textVersion: FICTIONAL_CONTINUING_CONSENT_VERSION,
      }),
    ).resolves.toMatchObject({
      basis_consent_record_id: 'consent-2',
      reason: 'same_project_planned_interviews_covered',
      required_action: 'show_recording_reminder',
      status: 'covered',
    });
  });

  it('does not fall back to an older record for missing, revoked, or incompatible current facts', async () => {
    const policy = new SyntheticConsentContinuationPolicyReader();
    await expect(policy.evaluate(null)).resolves.toMatchObject({
      basis_consent_record_id: null,
      reason: 'consent_missing',
      status: 'reauthorization_required',
    });
    await expect(
      policy.evaluate({
        id: 'consent-3',
        revokedAt: new Date('2026-08-14T00:00:00.000Z'),
        status: 'revoked',
        textVersion: FICTIONAL_CONTINUING_CONSENT_VERSION,
      }),
    ).resolves.toMatchObject({ reason: 'consent_revoked', status: 'reauthorization_required' });
    await expect(
      policy.evaluate({
        id: 'consent-4',
        revokedAt: null,
        status: 'valid',
        textVersion: 'mvp-v1',
      }),
    ).resolves.toMatchObject({
      reason: 'consent_text_version_incompatible',
      status: 'reauthorization_required',
    });
  });
});
