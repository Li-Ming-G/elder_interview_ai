import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { decodeClientMessage } from './realtime-codec.js';
import { parseStrictJson } from './strict-json.js';

describe('realtime strict JSON codec', () => {
  it('rejects duplicate decoded keys at any object depth', () => {
    expect(() => parseStrictJson('{"a":1,"\\u0061":2}')).toThrow('Duplicate JSON key');
    expect(() => parseStrictJson('{"payload":{"x":1,"x":2}}')).toThrow('Duplicate JSON key');
    expect(parseStrictJson('{"left":{"x":1},"right":{"x":2}}')).toEqual({
      left: { x: 1 },
      right: { x: 2 },
    });
  });

  it('limits original UTF-8 bytes before parsing and rejects unknown fields', () => {
    expect(() => decodeClientMessage(Buffer.from('"' + '界'.repeat(3000) + '"'))).toThrow(
      'INVALID_WS_MESSAGE',
    );
    expect(() =>
      decodeClientMessage(
        Buffer.from(
          JSON.stringify({
            event_id: randomUUID(),
            extra: true,
            payload: {},
            schema_version: '1.1',
            session_id: randomUUID(),
            type: 'heartbeat',
          }),
        ),
      ),
    ).toThrow('INVALID_WS_MESSAGE');
  });

  it('validates fixed PCM evidence and checksum', () => {
    const pcm = Buffer.alloc(3200, 7);
    const envelope = {
      event_id: randomUUID(),
      payload: {
        audio_stream_id: randomUUID(),
        channels: 1,
        encoding: 'pcm_s16le',
        end_ms: 100,
        pcm_base64: pcm.toString('base64'),
        pcm_sha256: createHash('sha256').update(pcm).digest('hex'),
        sample_count: 1600,
        sample_rate_hz: 16000,
        sequence_no: 0,
        start_ms: 0,
      },
      schema_version: '1.1',
      session_id: randomUUID(),
      type: 'audio.frame',
    };
    expect(decodeClientMessage(Buffer.from(JSON.stringify(envelope)))).toEqual(envelope);
    envelope.payload.pcm_sha256 = '0'.repeat(64);
    expect(() => decodeClientMessage(Buffer.from(JSON.stringify(envelope)))).toThrow(
      'INVALID_PCM_FRAME',
    );
  });

  it.each([
    ['format', { encoding: 'opus' }],
    ['length', { pcm_base64: Buffer.alloc(3199).toString('base64') }],
    ['base64', { pcm_base64: '***not-base64***' }],
    ['time', { end_ms: 101 }],
    ['sequence type', { sequence_no: '0' }],
    ['checksum type', { pcm_sha256: 123 }],
  ])('maps %s payload errors to INVALID_PCM_FRAME', (_label, override) => {
    const pcm = Buffer.alloc(3200, 3);
    const payload = {
      audio_stream_id: randomUUID(),
      channels: 1,
      encoding: 'pcm_s16le',
      end_ms: 100,
      pcm_base64: pcm.toString('base64'),
      pcm_sha256: createHash('sha256').update(pcm).digest('hex'),
      sample_count: 1600,
      sample_rate_hz: 16000,
      sequence_no: 0,
      start_ms: 0,
      ...override,
    };
    expect(() =>
      decodeClientMessage(
        Buffer.from(
          JSON.stringify({
            event_id: randomUUID(),
            payload,
            schema_version: '1.1',
            session_id: randomUUID(),
            type: 'audio.frame',
          }),
        ),
      ),
    ).toThrow('INVALID_PCM_FRAME');
  });

  it('keeps frame unknown fields and malformed parsing as INVALID_WS_MESSAGE', () => {
    const pcm = Buffer.alloc(3200);
    const envelope = {
      event_id: randomUUID(),
      payload: {
        audio_stream_id: randomUUID(),
        channels: 1,
        encoding: 'pcm_s16le',
        end_ms: 100,
        extra: true,
        pcm_base64: pcm.toString('base64'),
        pcm_sha256: createHash('sha256').update(pcm).digest('hex'),
        sample_count: 1600,
        sample_rate_hz: 16000,
        sequence_no: 0,
        start_ms: 0,
      },
      schema_version: '1.1',
      session_id: randomUUID(),
      type: 'audio.frame',
    };
    expect(() => decodeClientMessage(Buffer.from(JSON.stringify(envelope)))).toThrow(
      'INVALID_WS_MESSAGE',
    );
    expect(() => decodeClientMessage(Buffer.from('{"payload":'))).toThrow('INVALID_WS_MESSAGE');
  });
});
