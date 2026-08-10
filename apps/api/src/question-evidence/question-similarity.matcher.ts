import { Injectable } from '@nestjs/common';

import { sha256 } from '../ai-runtime/ai-provenance.js';

export const QUESTION_SIMILARITY_VERSION = 'question-sim-v1';
export const QUESTION_SIMILARITY_THRESHOLD = 0.88;

export abstract class QuestionSimilarityMatcher {
  public abstract score(left: string, right: string): Promise<number>;
}

export class QuestionSimilarityUnavailableError extends Error {
  public constructor() {
    super('AI_QUESTION_MATCHER_UNAVAILABLE');
  }
}

@Injectable()
export class UnavailableQuestionSimilarityMatcher extends QuestionSimilarityMatcher {
  public override score(): Promise<never> {
    return Promise.reject(new QuestionSimilarityUnavailableError());
  }
}

/** Versioned deterministic fixture for local/test; it is not a production matcher choice. */
@Injectable()
export class LocalTestQuestionSimilarityMatcher extends QuestionSimilarityMatcher {
  public override score(left: string, right: string): Promise<number> {
    const normalizedLeft = normalizeQuestion(left);
    const normalizedRight = normalizeQuestion(right);
    if (normalizedLeft === normalizedRight) return Promise.resolve(1);
    if (hasNegation(normalizedLeft) !== hasNegation(normalizedRight)) return Promise.resolve(0.2);
    if (hasConflictingSlot(normalizedLeft, normalizedRight)) return Promise.resolve(0.35);
    const canonicalLeft = semanticFixtureCanonical(normalizedLeft);
    const canonicalRight = semanticFixtureCanonical(normalizedRight);
    if (canonicalLeft === canonicalRight) return Promise.resolve(0.95);
    return Promise.resolve(
      diceCoefficient(characterBigrams(canonicalLeft), characterBigrams(canonicalRight)),
    );
  }
}

export function normalizeQuestion(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replaceAll(/\p{P}+/gu, '')
    .trim()
    .replaceAll(/\s+/gu, ' ');
}

export function normalizeQuestionDigest(value: string): string {
  return sha256(normalizeQuestion(value));
}

function semanticFixtureCanonical(value: string): string {
  return value
    .replaceAll(/如果您愿意|可以先从|能从|讲起吗|讲讲吗/gu, '')
    .replaceAll('您', '你')
    .replaceAll(/请问|能不能|能否|可以|方便|愿意/gu, '')
    .replaceAll(/小时候|童年时期/gu, '童年')
    .replaceAll(/住在哪里|在哪里长大|在什么地方长大|在什么地方度过|哪里长大/gu, '成长地点')
    .replaceAll(/什么地方|哪里|何处/gu, '地点')
    .replaceAll(/度过|成长|长大/gu, '成长')
    .replaceAll(/印象最深刻|印象最深|最难忘/gu, '难忘')
    .replaceAll(/为什么|什么原因|为何/gu, '原因')
    .replaceAll(/的|了|是|在|曾经|一下|说说/gu, '')
    .replaceAll(/\s+/gu, '');
}

function hasNegation(value: string): boolean {
  return /不|没|无|未|别/u.test(value);
}

function hasConflictingSlot(left: string, right: string): boolean {
  const people = ['父亲', '母亲', '爷爷', '奶奶', '外公', '外婆', '哥哥', '姐姐'];
  const leftPeople = people.filter((slot) => left.includes(slot));
  const rightPeople = people.filter((slot) => right.includes(slot));
  if (
    leftPeople.length > 0 &&
    rightPeople.length > 0 &&
    leftPeople.join('|') !== rightPeople.join('|')
  ) {
    return true;
  }
  const timeSlot = (value: string): string | null => {
    if (/小时候|童年/u.test(value)) return 'childhood';
    if (value.includes('青年')) return 'youth';
    if (value.includes('结婚后')) return 'after_marriage';
    if (value.includes('退休后')) return 'after_retirement';
    return null;
  };
  const leftTime = timeSlot(left);
  const rightTime = timeSlot(right);
  return leftTime !== null && rightTime !== null && leftTime !== rightTime;
}

function characterBigrams(value: string): readonly string[] {
  const characters = [
    ...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(value),
  ].map(({ segment }) => segment);
  if (characters.length < 2) return characters;
  return characters.slice(0, -1).map((character, index) => {
    const next = characters[index + 1];
    return next === undefined ? character : `${character}${next}`;
  });
}

function diceCoefficient(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const remaining = [...right];
  let intersection = 0;
  for (const item of left) {
    const index = remaining.indexOf(item);
    if (index === -1) continue;
    intersection += 1;
    remaining.splice(index, 1);
  }
  return (2 * intersection) / (left.length + right.length);
}
