import type {
  CompleteAudioObjectRequest,
  CreateAudioObjectRequest,
} from '@elder-interview/contracts';
import { PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import type { Request } from 'express';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

export interface AudioChunkInput {
  checksum: string;
  endMs: number;
  mimeType: string;
  requestId: string;
  sequenceNo: number;
  startMs: number;
}

export function validateCreateAudioObject(body: Record<string, unknown>): CreateAudioObjectRequest {
  if (body.purpose !== 'consent' && body.purpose !== 'interview') throw validationError();
  const sessionId = body.session_id === null ? null : validateUuid(body.session_id);
  if (
    (body.purpose === 'consent' && sessionId !== null) ||
    (body.purpose === 'interview' && sessionId === null)
  ) {
    throw validationError();
  }
  return {
    mime_type: validateMimeType(body.mime_type),
    purpose: body.purpose,
    request_id: validateUuid(body.request_id),
    session_id: sessionId,
  };
}

export function validateCompleteAudioObject(
  body: Record<string, unknown>,
): CompleteAudioObjectRequest {
  if (
    typeof body.expected_chunk_count !== 'number' ||
    !Number.isSafeInteger(body.expected_chunk_count) ||
    body.expected_chunk_count < 1 ||
    body.expected_chunk_count > POSTGRES_INTEGER_MAX
  ) {
    throw validationError();
  }
  return {
    expected_chunk_count: body.expected_chunk_count,
    request_id: validateUuid(body.request_id),
  };
}

export function validateAudioChunkRequest(request: Request, sequence: string): AudioChunkInput {
  const sequenceNo = parseNonnegativeInteger(sequence);
  const startMs = parseNonnegativeInteger(header(request, 'x-chunk-start-ms'));
  const endMs = parseNonnegativeInteger(header(request, 'x-chunk-end-ms'));
  const checksum = header(request, 'x-chunk-sha256');
  if (endMs <= startMs || !SHA256.test(checksum)) throw validationError();
  return {
    checksum,
    endMs,
    mimeType: validateMimeType(header(request, 'content-type')),
    requestId: validateUuid(header(request, 'x-request-id')),
    sequenceNo,
    startMs,
  };
}

export async function readAudioBody(request: Request, maxBytes: number): Promise<Buffer> {
  const declared = request.headers['content-length'];
  if (
    typeof declared === 'string' &&
    Number.isFinite(Number(declared)) &&
    Number(declared) > maxBytes
  ) {
    throw new PayloadTooLargeException({
      code: 'AUDIO_CHUNK_TOO_LARGE',
      details: {},
      message: 'Audio chunk exceeds the configured limit',
    });
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += bytes.byteLength;
    if (size > maxBytes) {
      throw new PayloadTooLargeException({
        code: 'AUDIO_CHUNK_TOO_LARGE',
        details: {},
        message: 'Audio chunk exceeds the configured limit',
      });
    }
    chunks.push(bytes);
  }
  if (size === 0) throw validationError();
  return Buffer.concat(chunks, size);
}

export function validateUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw validationError();
  return value;
}

function header(request: Request, name: string): string {
  const value = request.headers[name];
  if (typeof value !== 'string') throw validationError();
  return value;
}

function parseNonnegativeInteger(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw validationError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > POSTGRES_INTEGER_MAX) throw validationError();
  return parsed;
}

function validateMimeType(value: unknown): string {
  if (typeof value !== 'string') throw validationError();
  const mimeType = value.trim();
  if (
    mimeType.length === 0 ||
    mimeType.length > 160 ||
    !/^audio\/[a-z0-9.+-]+(?:;[a-z0-9=.+_-]+)*$/i.test(mimeType)
  ) {
    throw validationError();
  }
  return mimeType;
}

function validationError(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'VALIDATION_ERROR',
    details: {},
    message: 'Request validation failed',
  });
}
