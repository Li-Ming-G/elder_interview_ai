import { Injectable } from '@nestjs/common';

import { canonicalJson, sha256 } from './ai-provenance.js';

export interface FrozenProviderSegment {
  inputSegmentId: string;
  segmentId: string;
  sessionId: string;
  startMs: number;
  text: string;
  trustedRole: 'elder' | 'interviewer';
}

export interface StructuredMemoryClaim {
  canonicalKey: string;
  evidenceSegmentIds: readonly string[];
  explicitCorrection: boolean;
  memoryType:
    | 'person'
    | 'relationship'
    | 'place'
    | 'event'
    | 'time'
    | 'time_range'
    | 'important_choice'
    | 'reason_clue'
    | 'unfinished_story';
  value: unknown;
  valueKind: 'exact' | 'range' | 'unknown';
}

export interface StructuredActualQuestion {
  evidenceSegmentIds: readonly string[];
  questionText: string;
  sourceKind: 'interviewer_spontaneous';
  askedAtMs: number;
}

export abstract class StructuredAiProvider {
  public abstract extractMemory(
    segments: readonly FrozenProviderSegment[],
  ): Promise<readonly StructuredMemoryClaim[]>;

  public abstract extractActualQuestions(
    segments: readonly FrozenProviderSegment[],
  ): Promise<readonly StructuredActualQuestion[]>;
}

export class StructuredAiProviderUnavailableError extends Error {
  public constructor() {
    super('AI_PROVIDER_UNAVAILABLE');
  }
}

@Injectable()
export class UnavailableStructuredAiProvider extends StructuredAiProvider {
  public override extractMemory(): Promise<never> {
    return Promise.reject(new StructuredAiProviderUnavailableError());
  }
  public override extractActualQuestions(): Promise<never> {
    return Promise.reject(new StructuredAiProviderUnavailableError());
  }
}

/** Deterministic local/test fixture; never bound in staging or production. */
@Injectable()
export class LocalTestStructuredAiProvider extends StructuredAiProvider {
  public override extractMemory(
    segments: readonly FrozenProviderSegment[],
  ): Promise<readonly StructuredMemoryClaim[]> {
    return Promise.resolve(
      segments.flatMap((segment) => {
        const match =
          /^(更正)?记忆\[(person|relationship|place|event|time|time_range|important_choice|reason_clue|unfinished_story):(.+?)\x5d\s*=\s*(.+)$/u.exec(
            segment.text.trim(),
          );
        if (match === null) return [];
        const correction = match[1];
        const memoryType = match[2];
        const canonicalKey = match[3];
        const rawValue = match[4];
        if (memoryType === undefined || canonicalKey === undefined || rawValue === undefined)
          return [];
        const valueKind =
          rawValue === 'unknown' ? 'unknown' : rawValue.includes('..') ? 'range' : 'exact';
        const value =
          valueKind === 'range' ? rawValue.split('..') : valueKind === 'unknown' ? null : rawValue;
        return [
          {
            canonicalKey,
            evidenceSegmentIds: [segment.segmentId],
            explicitCorrection: correction !== undefined,
            memoryType: memoryType as StructuredMemoryClaim['memoryType'],
            value,
            valueKind,
          },
        ];
      }),
    );
  }

  public override extractActualQuestions(
    segments: readonly FrozenProviderSegment[],
  ): Promise<readonly StructuredActualQuestion[]> {
    return Promise.resolve(
      segments.flatMap((segment) => {
        const questions = segment.text.match(/[^。！？!?\n]*[?？]/gu) ?? [];
        return questions.map((questionText) => ({
          askedAtMs: segment.startMs,
          evidenceSegmentIds: [segment.segmentId],
          questionText: questionText.trim(),
          sourceKind: 'interviewer_spontaneous' as const,
        }));
      }),
    );
  }
}

export function structuredOutputHash(value: unknown): string {
  return sha256(canonicalJson(value));
}
