import { describe, expect, it } from 'vitest';

import {
  validateAbandonEmptyCapture,
  validateConfirmCaptureActive,
  validateRecoverSession,
  validateReportCaptureInterrupted,
  validateStartSession,
  validateCorrectTranscriptSpeakerRole,
  validateExecuteSpeakerRemap,
  validateNextSession,
  validatePreviewSpeakerRemap,
} from './project.validation.js';

const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const STREAM_ID = '00000000-0000-4000-8000-000000000002';

describe('capture lifecycle validation', () => {
  it('accepts the stable start and generation payloads', () => {
    expect(
      validateStartSession({
        audio_stream_id: STREAM_ID,
        mime_type: 'audio/webm;codecs=opus',
        recording_reminder_version: 'recording-reminder-v1',
        request_id: REQUEST_ID,
      }),
    ).toEqual({
      audio_stream_id: STREAM_ID,
      mime_type: 'audio/webm;codecs=opus',
      recording_reminder_version: 'recording-reminder-v1',
      request_id: REQUEST_ID,
    });
    expect(
      validateConfirmCaptureActive({
        audio_stream_id: STREAM_ID,
        generation_no: 0,
        request_id: REQUEST_ID,
      }),
    ).toMatchObject({ generation_no: 0 });
    expect(
      validateReportCaptureInterrupted({
        audio_stream_id: STREAM_ID,
        generation_no: 1,
        reason: 'recorder_error',
        request_id: REQUEST_ID,
      }),
    ).toMatchObject({ reason: 'recorder_error' });
  });

  it('rejects missing MIME, invalid reasons, nonzero abandon claims, and regressing values', () => {
    expect(() =>
      validateStartSession({ audio_stream_id: STREAM_ID, request_id: REQUEST_ID }),
    ).toThrow();
    expect(
      validateStartSession({
        audio_stream_id: STREAM_ID,
        mime_type: 'audio/webm;codecs=opus',
        recording_reminder_version: 'recording-reminder-v0',
        request_id: REQUEST_ID,
      }).recording_reminder_version,
    ).toBe('recording-reminder-v0');
    expect(() =>
      validateReportCaptureInterrupted({
        audio_stream_id: STREAM_ID,
        generation_no: 0,
        reason: 'internal-detail',
        request_id: REQUEST_ID,
      }),
    ).toThrow();
    expect(() =>
      validateAbandonEmptyCapture({
        audio_stream_id: STREAM_ID,
        generation_no: 0,
        local_archive_chunk_count: 1,
        request_id: REQUEST_ID,
      }),
    ).toThrow();
    expect(() =>
      validateRecoverSession({
        action: 'resume_capture',
        audio_stream_id: STREAM_ID,
        local_archive_chunk_count: -1,
        local_archive_timeline_high_water_ms: 0,
        request_id: REQUEST_ID,
      }),
    ).toThrow();
  });

  it('requires the current reminder version and validates the frozen next-session basis', () => {
    expect(() =>
      validateStartSession({
        audio_stream_id: STREAM_ID,
        mime_type: 'audio/webm;codecs=opus',
        request_id: REQUEST_ID,
      }),
    ).toThrow();
    expect(
      validateNextSession({
        basis_session_id: STREAM_ID,
        expected_basis_sequence_no: 1,
        request_id: REQUEST_ID,
        workflow_version: 'repeat-interview-v1',
      }),
    ).toMatchObject({ basis_session_id: STREAM_ID, expected_basis_sequence_no: 1 });
    expect(() =>
      validateNextSession({
        basis_session_id: STREAM_ID,
        expected_basis_sequence_no: 0,
        request_id: REQUEST_ID,
        workflow_version: 'repeat-interview-v1',
      }),
    ).toThrow();
  });
});

describe('speaker correction validation', () => {
  it('accepts only the frozen single and batch request shapes', () => {
    expect(
      validateCorrectTranscriptSpeakerRole({
        corrected_speaker_role: 'unknown',
        expected_speaker_role_revision: 0,
        request_id: REQUEST_ID,
      }),
    ).toMatchObject({ corrected_speaker_role: 'unknown', expected_speaker_role_revision: 0 });
    expect(
      validatePreviewSpeakerRemap({
        corrected_speaker_role: 'elder',
        exclude_individual_corrections: true,
        request_id: REQUEST_ID,
        segment_end_id: '00000000-0000-4000-8000-000000000004',
        segment_start_id: '00000000-0000-4000-8000-000000000003',
        speaker_provider_id: 'speaker_1',
        speaker_stream_id: STREAM_ID,
      }),
    ).toMatchObject({ exclude_individual_corrections: true, speaker_provider_id: 'speaker_1' });
    expect(
      validateExecuteSpeakerRemap({
        preview_hash: 'a'.repeat(64),
        preview_id: '00000000-0000-4000-8000-000000000005',
        request_id: REQUEST_ID,
      }),
    ).toMatchObject({ preview_hash: 'a'.repeat(64) });
  });

  it('rejects unsupported roles, negative versions, disabled exclusion, and malformed hashes', () => {
    expect(() =>
      validateCorrectTranscriptSpeakerRole({
        corrected_speaker_role: 'provider_guess',
        expected_speaker_role_revision: 0,
        request_id: REQUEST_ID,
      }),
    ).toThrow();
    expect(() =>
      validateCorrectTranscriptSpeakerRole({
        corrected_speaker_role: 'elder',
        expected_speaker_role_revision: -1,
        request_id: REQUEST_ID,
      }),
    ).toThrow();
    expect(() =>
      validatePreviewSpeakerRemap({
        corrected_speaker_role: 'elder',
        exclude_individual_corrections: false,
        request_id: REQUEST_ID,
      }),
    ).toThrow();
    expect(() =>
      validateExecuteSpeakerRemap({
        preview_hash: 'not-a-hash',
        preview_id: '00000000-0000-4000-8000-000000000005',
        request_id: REQUEST_ID,
      }),
    ).toThrow();
  });
});
