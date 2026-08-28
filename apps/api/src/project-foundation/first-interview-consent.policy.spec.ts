import { describe, expect, it } from 'vitest';

import { isCurrentFirstInterviewConsentValid } from './first-interview-consent.policy.js';

const PROJECT_ID = '10000000-0000-4000-8000-000000000001';

describe('current first-interview consent policy', () => {
  it('accepts a current valid formal consent without interpreting its text version', () => {
    expect(
      isCurrentFirstInterviewConsentValid(
        {
          consentType: 'recording_transcription_ai',
          projectId: PROJECT_ID,
          revokedAt: null,
          status: 'valid',
        },
        PROJECT_ID,
      ),
    ).toBe(true);
  });

  it('rejects missing consent', () => {
    expect(isCurrentFirstInterviewConsentValid(null, PROJECT_ID)).toBe(false);
  });

  it.each([
    { consentType: 'other', projectId: PROJECT_ID, revokedAt: null, status: 'valid' },
    {
      consentType: 'recording_transcription_ai',
      projectId: '20000000-0000-4000-8000-000000000002',
      revokedAt: null,
      status: 'valid',
    },
    {
      consentType: 'recording_transcription_ai',
      projectId: PROJECT_ID,
      revokedAt: new Date('2026-08-27T00:00:00.000Z'),
      status: 'revoked',
    },
    {
      consentType: 'recording_transcription_ai',
      projectId: PROJECT_ID,
      revokedAt: null,
      status: 'pending',
    },
  ])('rejects invalid formal consent facts: %o', (consent) => {
    expect(isCurrentFirstInterviewConsentValid(consent, PROJECT_ID)).toBe(false);
  });
});
