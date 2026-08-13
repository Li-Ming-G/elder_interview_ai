import { describe, expect, it } from 'vitest';

import { sessionProjection } from './project-session-list.service.js';

const NONE = { hasFinalization: false, manifestChecksum: null, uploadStatus: null } as const;
const COMPLETE = {
  hasFinalization: true,
  manifestChecksum: 'a'.repeat(64),
  uploadStatus: 'complete',
} as const;

describe('sessionProjection', () => {
  it.each([
    ['created', null, NONE, 'preparation_required', 'continue_preparation', 'unavailable'],
    ['device_check', null, NONE, 'preparation_required', 'continue_preparation', 'unavailable'],
    ['recording', null, NONE, 'interview_active', 'return_to_interview', 'unavailable'],
    ['reconnecting', null, NONE, 'interview_active', 'return_to_interview', 'unavailable'],
    ['interrupted', null, NONE, 'interview_interrupted', 'resolve_interruption', 'unavailable'],
    ['stopping', null, NONE, 'saving_audio', 'view_save_progress', 'unavailable'],
    ['processing', null, COMPLETE, 'transcript_processing', 'view_review', 'read_only'],
    ['completed', null, NONE, 'review_ready', 'view_review', 'read_only'],
    ['failed', 'NO_AUDIO_CAPTURED', NONE, 'no_audio_captured', 'view_save_facts', 'unavailable'],
    ['failed', null, COMPLETE, 'saved_with_warning', 'view_review', 'read_only'],
  ] as const)(
    'maps %s to the server-owned home projection',
    (status, failure, finalization, homeState, action, reviewAccess) => {
      expect(sessionProjection(status, failure, finalization)).toEqual({
        homeState,
        primaryAction: action,
        reviewAccess,
      });
    },
  );

  it.each([
    ['processing', { ...COMPLETE, manifestChecksum: null }],
    ['processing', { ...COMPLETE, uploadStatus: 'verifying' as const }],
    ['failed', { ...COMPLETE, manifestChecksum: null }],
  ] as const)('fails an unproven %s combination closed to save facts', (status, finalization) => {
    expect(sessionProjection(status, null, finalization)).toEqual({
      homeState: 'save_failed',
      primaryAction: 'view_save_facts',
      reviewAccess: 'unavailable',
    });
  });
});
