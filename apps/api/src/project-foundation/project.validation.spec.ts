import { describe, expect, it } from 'vitest';

import {
  validateAbandonEmptyCapture,
  validateConfirmCaptureActive,
  validateRecoverSession,
  validateReportCaptureInterrupted,
  validateStartSession,
} from './project.validation.js';

const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const STREAM_ID = '00000000-0000-4000-8000-000000000002';

describe('capture lifecycle validation', () => {
  it('accepts the stable start and generation payloads', () => {
    expect(
      validateStartSession({
        audio_stream_id: STREAM_ID,
        mime_type: 'audio/webm;codecs=opus',
        request_id: REQUEST_ID,
      }),
    ).toEqual({
      audio_stream_id: STREAM_ID,
      mime_type: 'audio/webm;codecs=opus',
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
});
