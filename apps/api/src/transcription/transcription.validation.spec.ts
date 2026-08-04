import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { DeterministicAsrFake } from './testing/deterministic-asr.fake.js';
import type { NormalizedAsrResult } from './transcription.types.js';
import {
  canonicalProviderPayload,
  PROVIDER_PAYLOAD_MAX_BYTES,
  serializedProviderPayload,
  validateNormalizedResult,
} from './transcription.validation.js';
import { TranscriptIngestionService } from './transcript-ingestion.service.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { ApiConfigValue } from '../api-config.js';

const RESULT: NormalizedAsrResult = {
  endMs: 100,
  ingestKey: 'fixture-stream:segment-1',
  kind: 'final',
  providerPayload: { confidence: 0.9 },
  providerSegmentId: 'segment-1',
  sessionId: '00000000-0000-4000-8000-000000000001',
  source: 'fixture',
  speakerProviderId: 'speaker-1',
  startMs: 0,
  text: '完全虚构的测试转录',
};

describe('normalized ASR result boundary', () => {
  it('accepts a bounded provider-neutral result', () => {
    expect(() => {
      validateNormalizedResult(RESULT);
    }).not.toThrow();
  });

  it('uses serialized UTF-8 bytes for the private payload limit', () => {
    expect(() => serializedProviderPayload({ value: '中'.repeat(22_000) })).toThrow(
      BadRequestException,
    );
    expect(Buffer.byteLength(JSON.stringify({ value: 'x' }), 'utf8')).toBeLessThan(
      PROVIDER_PAYLOAD_MAX_BYTES,
    );
  });

  it('rejects malformed time ranges without echoing transcript or payload', () => {
    try {
      validateNormalizedResult({ ...RESULT, endMs: 0 });
      throw new Error('Expected validation to fail');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify(error)).not.toContain(RESULT.text);
      expect(JSON.stringify(error)).not.toContain('confidence');
    }
  });

  it('provides deterministic local/test results and explicit failure injection', async () => {
    const fake = new DeterministicAsrFake([RESULT]);
    await expect(fake.next()).resolves.toEqual(RESULT);
    await expect(fake.next()).resolves.toBeNull();
    await expect(new DeterministicAsrFake([RESULT], 0).next()).rejects.toThrow(
      'TEST_ONLY_ASR_FAILURE',
    );
  });

  it('canonicalizes JSON object key order for replay comparison', () => {
    expect(canonicalProviderPayload({ b: 2, nested: { y: 2, x: 1 }, a: 1 })).toBe(
      canonicalProviderPayload({ a: 1, nested: { x: 1, y: 2 }, b: 2 }),
    );
    expect(canonicalProviderPayload({ confidence: 0.9 })).not.toBe(
      canonicalProviderPayload({ confidence: 0.8 }),
    );
  });

  it('rejects fixture input outside local/test before touching persistence', async () => {
    const service = new TranscriptIngestionService(
      {} as PrismaService,
      { appEnv: 'production' } as ApiConfigValue,
    );
    await expect(service.ingest(RESULT)).rejects.toMatchObject({
      response: { code: 'ASR_FIXTURE_DISABLED' },
    });
  });
});
