import { afterEach, describe, expect, it, vi } from 'vitest';

import { createInterviewApi, InterviewApiError } from './interview-api.js';

describe('Interview API error envelope', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retains plain-object details while hiding the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'NEXT_SESSION_ALREADY_EXISTS',
            details: {
              sequence_no: 3,
              session_id: '55555555-5555-4555-8555-555555555555',
            },
            message: 'secret server diagnostic',
          }),
          { headers: { 'Content-Type': 'application/json' }, status: 409 },
        ),
      ),
    );
    const error = await createInterviewApi('csrf')
      .createNextSession('11111111-1111-4111-8111-111111111111', {
        basis_session_id: '22222222-2222-4222-8222-222222222222',
        expected_basis_sequence_no: 1,
        request_id: '33333333-3333-4333-8333-333333333333',
        workflow_version: 'repeat-interview-v1',
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InterviewApiError);
    expect((error as InterviewApiError).details).toEqual({
      sequence_no: 3,
      session_id: '55555555-5555-4555-8555-555555555555',
    });
    expect((error as Error).message).not.toContain('secret');
  });

  it.each([null, [], 'invalid'])('rejects non-object details %j', async (details) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 'NEXT_SESSION_ALREADY_EXISTS', details }), {
          headers: { 'Content-Type': 'application/json' },
          status: 409,
        }),
      ),
    );
    const error = await createInterviewApi('csrf')
      .createNextSession('11111111-1111-4111-8111-111111111111', {
        basis_session_id: '22222222-2222-4222-8222-222222222222',
        expected_basis_sequence_no: 1,
        request_id: '33333333-3333-4333-8333-333333333333',
        workflow_version: 'repeat-interview-v1',
      })
      .catch((caught: unknown) => caught);
    expect((error as InterviewApiError).details).toEqual({});
  });
});
