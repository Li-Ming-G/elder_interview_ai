import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ApiExceptionFilter } from './api-exception.filter.js';

describe('ApiExceptionFilter', () => {
  it('emits the common error envelope with the request id', () => {
    const json = vi.fn<(body: unknown) => void>();
    const status = vi.fn((statusCode: number): { json: typeof json } => {
      void statusCode;
      return { json };
    });
    const host = {
      switchToHttp: (): {
        getResponse: () => { locals: { requestId: string }; status: typeof status };
      } => ({
        getResponse: (): { locals: { requestId: string }; status: typeof status } => ({
          locals: { requestId: 'request-id' },
          status,
        }),
      }),
    };

    new ApiExceptionFilter().catch(
      new HttpException({ code: 'INVALID_INPUT', message: 'Invalid input', details: {} }, 422),
      host as never,
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({
      code: 'INVALID_INPUT',
      details: {},
      message: 'Invalid input',
      request_id: 'request-id',
    });
  });
});
