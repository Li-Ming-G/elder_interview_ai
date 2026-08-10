import { describe, expect, it } from 'vitest';

import { EMPTY_MANIFEST_HASH, effectiveTextDigest, manifestHash, sha256 } from './ai-provenance.js';
import {
  AiPolicyUnavailableError,
  LocalTestDeletionScopeFixtureReader,
  UnavailableDeletionScopeReader,
} from './deletion-scope.reader.js';
import { LocalTestStructuredAiProvider } from './structured-ai.provider.js';

describe('DEV-006 provenance and fail-closed runtime ports', () => {
  it('uses canonical empty and ordered manifests without normalizing evidence text', () => {
    expect(EMPTY_MANIFEST_HASH).toBe(sha256('[]'));
    expect(manifestHash(['b', 'a'])).not.toBe(manifestHash(['a', 'b']));
    expect(effectiveTextDigest(' A\r\nＢ ')).toBe(sha256(' A\nＢ '));
    expect(effectiveTextDigest(' A\r\nＢ ')).not.toBe(sha256('A\nB'));
  });

  it('keeps the production deletion reader unavailable and the local fixture explicit', async () => {
    await expect(
      new UnavailableDeletionScopeReader().assertNoActiveScope('p', []),
    ).rejects.toBeInstanceOf(AiPolicyUnavailableError);
    const fixture = new LocalTestDeletionScopeFixtureReader();
    await expect(fixture.assertNoActiveScope('p', ['s'])).resolves.toBeUndefined();
    fixture.blockSession('s');
    await expect(fixture.assertNoActiveScope('p', ['s'])).rejects.toThrow('AI_POLICY_UNAVAILABLE');
  });

  it('extracts only explicit fictional memory markers and actual question punctuation', async () => {
    const provider = new LocalTestStructuredAiProvider();
    const segments = [
      {
        inputSegmentId: 'i1',
        segmentId: 's1',
        sessionId: 'session',
        startMs: 100,
        text: '更正记忆[place:故乡]=无锡',
      },
      {
        inputSegmentId: 'i2',
        segmentId: 's2',
        sessionId: 'session',
        startMs: 200,
        text: '后来发生了什么？我们继续听。',
      },
    ];
    await expect(provider.extractMemory(segments)).resolves.toEqual([
      expect.objectContaining({
        canonicalKey: '故乡',
        evidenceSegmentIds: ['s1'],
        explicitCorrection: true,
        memoryType: 'place',
        value: '无锡',
      }),
    ]);
    await expect(provider.extractActualQuestions(segments)).resolves.toEqual([
      expect.objectContaining({ evidenceSegmentIds: ['s2'], questionText: '后来发生了什么？' }),
    ]);
  });
});
