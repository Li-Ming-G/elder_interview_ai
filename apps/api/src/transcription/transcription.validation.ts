import { BadRequestException } from '@nestjs/common';

import type { NormalizedAsrResult } from './transcription.types.js';

export const PROVIDER_PAYLOAD_MAX_BYTES = 64 * 1024;

export function validateNormalizedResult(result: unknown): asserts result is NormalizedAsrResult {
  if (typeof result !== 'object' || result === null) invalidResult();
  const candidate = result as Record<string, unknown>;
  if (
    typeof candidate.sessionId !== 'string' ||
    typeof candidate.kind !== 'string' ||
    typeof candidate.source !== 'string' ||
    typeof candidate.ingestKey !== 'string' ||
    typeof candidate.startMs !== 'number' ||
    typeof candidate.endMs !== 'number' ||
    typeof candidate.text !== 'string'
  ) {
    invalidResult();
  }
  const sessionId = candidate.sessionId;
  const kind = candidate.kind;
  const source = candidate.source;
  const ingestKey = candidate.ingestKey;
  const startMs = candidate.startMs;
  const endMs = candidate.endMs;
  const text = candidate.text;
  const providerSegmentId = candidate.providerSegmentId;
  const speakerProviderId = candidate.speakerProviderId;
  if (
    (providerSegmentId !== undefined &&
      providerSegmentId !== null &&
      typeof providerSegmentId !== 'string') ||
    (speakerProviderId !== undefined &&
      speakerProviderId !== null &&
      typeof speakerProviderId !== 'string')
  ) {
    invalidResult();
  }
  if (!isUuid(sessionId)) invalidResult();
  if (kind !== 'final' && kind !== 'interim') invalidResult();
  if (source !== 'realtime' && source !== 'backfill' && source !== 'fixture') {
    invalidResult();
  }
  if (ingestKey.length < 1 || ingestKey.length > 240) invalidResult();
  if (!Number.isSafeInteger(startMs) || startMs < 0) invalidResult();
  if (!Number.isSafeInteger(endMs) || endMs <= startMs) invalidResult();
  if (text.length < 1) invalidResult();
  validateOptionalIdentifier(providerSegmentId);
  validateOptionalIdentifier(speakerProviderId);
  serializedProviderPayload(candidate.providerPayload);
}

export function serializedProviderPayload(payload: unknown): string | null {
  if (payload === undefined || payload === null) return null;
  let serializedResult: unknown;
  try {
    serializedResult = JSON.stringify(payload);
  } catch {
    throw providerPayloadInvalid();
  }
  if (typeof serializedResult !== 'string') throw providerPayloadInvalid();
  const serialized = serializedResult;
  if (Buffer.byteLength(serialized, 'utf8') > PROVIDER_PAYLOAD_MAX_BYTES) {
    throw new BadRequestException({
      code: 'ASR_PROVIDER_PAYLOAD_TOO_LARGE',
      details: {},
      message: 'ASR provider payload exceeds the allowed size',
    });
  }
  return serialized;
}

export function canonicalProviderPayload(payload: unknown): string {
  const serialized = serializedProviderPayload(payload);
  return serialized === null ? 'null' : canonicalJson(JSON.parse(serialized) as unknown);
}

function validateOptionalIdentifier(value: string | null | undefined): void {
  if (value !== undefined && value !== null && (value.length < 1 || value.length > 200)) {
    invalidResult();
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function invalidResult(): never {
  throw new BadRequestException({
    code: 'INVALID_ASR_RESULT',
    details: {},
    message: 'ASR result is invalid',
  });
}

function providerPayloadInvalid(): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_ASR_PROVIDER_PAYLOAD',
    details: {},
    message: 'ASR provider payload is invalid',
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}
