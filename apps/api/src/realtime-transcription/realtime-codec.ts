import { createHash } from 'node:crypto';
import {
  INTERVIEW_PCM_FRAME_BYTES,
  INTERVIEW_PCM_FRAME_DURATION_MS,
  INTERVIEW_PCM_SAMPLE_COUNT,
  INTERVIEW_PCM_SAMPLE_RATE_HZ,
  INTERVIEW_WS_MAX_MESSAGE_BYTES,
  INTERVIEW_WS_SCHEMA_VERSION,
  type InterviewWsClientMessage,
} from '@elder-interview/contracts';

import { parseStrictJson } from './strict-json.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const BASE_ENVELOPE = ['event_id', 'payload', 'schema_version', 'session_id', 'type'];

export class RealtimeCodecError extends Error {
  public constructor(public readonly code: 'INVALID_PCM_FRAME' | 'INVALID_WS_MESSAGE') {
    super(code);
  }
}

export function decodeClientMessage(raw: Buffer): InterviewWsClientMessage {
  if (raw.byteLength > INTERVIEW_WS_MAX_MESSAGE_BYTES) throw invalidMessage();
  const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  let value: unknown;
  try {
    value = parseStrictJson(text);
  } catch {
    throw invalidMessage();
  }
  const envelope = object(value);
  exactKeys(envelope, BASE_ENVELOPE);
  string(envelope.event_id, UUID);
  string(envelope.session_id, UUID);
  if (envelope.schema_version !== INTERVIEW_WS_SCHEMA_VERSION) throw invalidMessage();
  const payload = object(envelope.payload);
  switch (envelope.type) {
    case 'session.join': {
      const resume = 'event_stream_id' in payload || 'resume_after_server_sequence' in payload;
      exactKeys(
        payload,
        resume
          ? ['audio_stream_id', 'csrf_token', 'event_stream_id', 'resume_after_server_sequence']
          : ['audio_stream_id', 'csrf_token'],
      );
      string(payload.audio_stream_id, UUID);
      string(payload.csrf_token);
      if (resume) {
        string(payload.event_stream_id, UUID);
        nonNegativeInteger(payload.resume_after_server_sequence);
      }
      return value as InterviewWsClientMessage;
    }
    case 'audio.frame':
      validateFrame(payload);
      return value as InterviewWsClientMessage;
    case 'event.ack':
      exactKeys(payload, ['server_sequence']);
      nonNegativeInteger(payload.server_sequence);
      return value as InterviewWsClientMessage;
    case 'heartbeat':
      exactKeys(payload, []);
      return value as InterviewWsClientMessage;
    default:
      throw invalidMessage();
  }
}

function validateFrame(payload: Record<string, unknown>): void {
  exactKeys(payload, [
    'audio_stream_id',
    'channels',
    'encoding',
    'end_ms',
    'pcm_base64',
    'pcm_sha256',
    'sample_count',
    'sample_rate_hz',
    'sequence_no',
    'start_ms',
  ]);
  frameString(payload.audio_stream_id, UUID);
  frameNonNegativeInteger(payload.sequence_no);
  if (
    payload.encoding !== 'pcm_s16le' ||
    payload.sample_rate_hz !== INTERVIEW_PCM_SAMPLE_RATE_HZ ||
    payload.channels !== 1 ||
    payload.sample_count !== INTERVIEW_PCM_SAMPLE_COUNT ||
    payload.start_ms !== payload.sequence_no * INTERVIEW_PCM_FRAME_DURATION_MS ||
    payload.end_ms !== payload.start_ms + INTERVIEW_PCM_FRAME_DURATION_MS
  )
    throw invalidFrame();
  frameString(payload.pcm_sha256, SHA256);
  frameString(payload.pcm_base64);
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(payload.pcm_base64)
  ) {
    throw invalidFrame();
  }
  const decoded = Buffer.from(payload.pcm_base64, 'base64');
  if (
    decoded.byteLength !== INTERVIEW_PCM_FRAME_BYTES ||
    createHash('sha256').update(decoded).digest('hex') !== payload.pcm_sha256
  )
    throw invalidFrame();
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalidMessage();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw invalidMessage();
  }
}

function string(value: unknown, pattern?: RegExp): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw invalidMessage();
  }
}

function nonNegativeInteger(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw invalidMessage();
}

function frameString(value: unknown, pattern?: RegExp): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    throw invalidFrame();
  }
}

function frameNonNegativeInteger(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw invalidFrame();
}

function invalidMessage(): RealtimeCodecError {
  return new RealtimeCodecError('INVALID_WS_MESSAGE');
}

function invalidFrame(): RealtimeCodecError {
  return new RealtimeCodecError('INVALID_PCM_FRAME');
}
