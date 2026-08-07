import { describe, expect, it } from 'vitest';

import { validateRecoverSession, validateStopSession } from './project.validation.js';

const request = {
  audio_object_id: '00000000-0000-4000-8000-000000000002',
  chunks: [
    {
      checksum: 'a'.repeat(64),
      end_ms: 5000,
      mime_type: 'audio/webm;codecs=opus',
      sequence_no: 0,
      size_bytes: 10,
      start_ms: 0,
    },
  ],
  expected_chunk_count: 1,
  request_id: '00000000-0000-4000-8000-000000000001',
};

describe('session finalization validation', () => {
  it('accepts frozen stop and finalize_interrupted payloads', () => {
    expect(validateStopSession(request)).toEqual(request);
    expect(validateRecoverSession({ ...request, action: 'finalize_interrupted' })).toEqual({
      ...request,
      action: 'finalize_interrupted',
    });
  });

  it('rejects malformed recovery actions and commitments', () => {
    expect(() =>
      validateRecoverSession({ action: 'expand', request_id: request.request_id }),
    ).toThrow();
    expect(() => validateStopSession({ ...request, chunks: 'not-an-array' })).toThrow();
  });
});
