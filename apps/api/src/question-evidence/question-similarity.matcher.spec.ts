import { describe, expect, it } from 'vitest';

import {
  LocalTestQuestionSimilarityMatcher,
  normalizeQuestion,
  normalizeQuestionDigest,
  QUESTION_SIMILARITY_THRESHOLD,
} from './question-similarity.matcher.js';

describe('question-sim-v1', () => {
  const matcher = new LocalTestQuestionSimilarityMatcher();

  it('normalizes NFKC width, Unicode punctuation, case and whitespace before hashing', () => {
    expect(normalizeQuestion('  ＡＢＣ， 你好吗？ ')).toBe('abc 你好吗');
    expect(normalizeQuestionDigest('ＡＢＣ，你好吗？')).toBe(normalizeQuestionDigest('abc你好吗'));
  });

  it('matches the fixed Chinese semantic paraphrase above the versioned threshold', async () => {
    await expect(
      matcher.score('您小时候住在哪里？', '你的童年是在什么地方度过的？'),
    ).resolves.toBeGreaterThanOrEqual(QUESTION_SIMILARITY_THRESHOLD);
  });

  it('keeps negation, person and time-slot differences below the threshold', async () => {
    await expect(
      matcher.score('你小时候住在苏州吗？', '你小时候不住在苏州吗？'),
    ).resolves.toBeLessThan(QUESTION_SIMILARITY_THRESHOLD);
    await expect(
      matcher.score('你和父亲最难忘的事是什么？', '你和母亲最难忘的事是什么？'),
    ).resolves.toBeLessThan(QUESTION_SIMILARITY_THRESHOLD);
    await expect(
      matcher.score('你童年最难忘的事是什么？', '你退休后最难忘的事是什么？'),
    ).resolves.toBeLessThan(QUESTION_SIMILARITY_THRESHOLD);
  });
});
