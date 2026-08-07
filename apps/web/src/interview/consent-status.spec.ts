import { describe, expect, it } from 'vitest';
import type { ConsentResponse } from '@elder-interview/contracts';

import { hasCurrentValidConsent, latestConsent } from './consent-status.js';

function consent(overrides: Partial<ConsentResponse>): ConsentResponse {
  return {
    consent_audio_object_id: null,
    consent_method: 'electronic',
    consent_text_version: 'mvp-v1',
    consent_type: 'recording_transcription_ai',
    consented_at: '2026-08-07T00:00:00.000Z',
    created_at: '2026-08-07T00:00:00.000Z',
    created_by: 'user-1',
    id: 'consent-1',
    project_id: 'project-1',
    revoked_at: null,
    status: 'valid',
    ...overrides,
  };
}

describe('latestConsent', () => {
  it('uses the latest record rather than any historical valid record', () => {
    const historical = consent({ id: 'a', created_at: '2026-08-06T00:00:00.000Z' });
    const revoked = consent({
      id: 'b',
      created_at: '2026-08-07T00:00:00.000Z',
      revoked_at: '2026-08-07T01:00:00.000Z',
      status: 'revoked',
    });
    expect(latestConsent([historical, revoked])).toEqual(revoked);
    expect(hasCurrentValidConsent([historical, revoked])).toBe(false);
  });
});
