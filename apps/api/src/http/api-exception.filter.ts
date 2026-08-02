import type { ApiErrorEnvelope } from '@elder-interview/contracts';
import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

interface KnownHttpError {
  code?: unknown;
  details?: unknown;
  message?: unknown;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = String(response.locals.requestId ?? 'unknown');
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const known = exception instanceof HttpException ? this.toKnownError(exception) : {};
    const envelope: ApiErrorEnvelope = {
      code:
        typeof known.code === 'string'
          ? known.code
          : status === 404
            ? 'NOT_FOUND'
            : 'INTERNAL_ERROR',
      details: this.toDetails(known.details),
      message:
        status === 404
          ? 'Resource not found'
          : status >= 500
            ? 'Internal server error'
            : typeof known.message === 'string'
              ? known.message
              : 'Request failed',
      request_id: requestId,
    };

    response.status(status).json(envelope);
  }

  private toDetails(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private toKnownError(exception: HttpException): KnownHttpError {
    const response = exception.getResponse();
    if (typeof response === 'string') {
      return { message: response };
    }
    return response;
  }
}
