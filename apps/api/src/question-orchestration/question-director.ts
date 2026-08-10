import { Injectable } from '@nestjs/common';

import type { CurrentMemoryItem } from '../memory/memory.service.js';
import type {
  EligibleQuestionBankItem,
  JourneyStage,
} from '../question-bank/question-bank.types.js';
import type {
  QuestionCandidateResult,
  QuestionAttemptKind,
} from '../question-evidence/question-presentation.types.js';

export interface QuestionDirectorInput {
  attemptKind: QuestionAttemptKind;
  eligible: readonly EligibleQuestionBankItem[];
  journeyStage: JourneyStage;
  memories: readonly CurrentMemoryItem[];
}

export abstract class QuestionDirector {
  public abstract select(input: QuestionDirectorInput): Promise<QuestionCandidateResult | null>;
}

export class QuestionDirectorUnavailableError extends Error {
  public constructor() {
    super('AI_PROVIDER_UNAVAILABLE');
  }
}

@Injectable()
export class UnavailableQuestionDirector extends QuestionDirector {
  public override select(): Promise<never> {
    return Promise.reject(new QuestionDirectorUnavailableError());
  }
}

/** Explicit local/test fake. It only returns a selected bank item or a controlled v1 edit. */
@Injectable()
export class LocalTestQuestionDirector extends QuestionDirector {
  public override select(input: QuestionDirectorInput): Promise<QuestionCandidateResult | null> {
    const item = input.eligible[0];
    if (item === undefined) return Promise.resolve(null);
    const grounded =
      input.attemptKind === 'manual_next' && item.purpose === 'person'
        ? input.memories.find(
            ({ canonicalKey, memoryType, resolutionKind }) =>
              memoryType === 'person' &&
              resolutionKind === 'single' &&
              /(^|\.)(important|influence|mentor)(\.|$)/u.test(canonicalKey),
          )
        : undefined;
    const groundedValue = grounded === undefined ? null : firstString(grounded.resolvedValue);
    const canSurface =
      input.attemptKind === 'manual_next' &&
      item.questionText.startsWith('如果您愿意，可以先从') &&
      item.questionText.endsWith('讲起吗？');
    const selectionMode = groundedValue !== null || canSurface ? 'lightly_adapted' : 'verbatim';
    const adaptationReasonCode =
      groundedValue !== null ? 'grounded_slot_fill' : canSurface ? 'surface_wording' : null;
    const questionText =
      groundedValue !== null
        ? `您年轻时，${groundedValue}是不是一位对您影响很大的人？`
        : canSurface
          ? item.questionText
              .replace('如果您愿意，可以先从', '如果您愿意，能从')
              .replace('讲起吗？', '讲讲吗？')
          : item.questionText;
    return Promise.resolve({
      adaptationReasonCode,
      confidence: 1,
      evidenceSegmentIds: [],
      ...(groundedValue === null ? {} : { groundedSlotValue: groundedValue }),
      memoryResolutionIds: grounded === undefined ? [] : [grounded.id],
      purpose: item.purpose,
      questionText,
      reasonText: reasonFor(input.journeyStage),
      risk: item.sensitivity,
      selectionMode,
      selectionScore: stageScore(input.journeyStage),
      sourceBank: item.bank,
      sourceBankVersion: item.bankVersion,
      sourceQuestionBankItemId: item.itemId,
      sourceQuestionId: item.questionId,
    });
  }
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = firstString(item);
      if (nested !== null) return nested;
    }
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) {
      const nested = firstString(item);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function reasonFor(stage: JourneyStage): string {
  if (stage === 'story_depth') return '长者已经给出具体故事线索，可以顺着这一处继续深入。';
  if (stage === 'life_outline') return '长者已提到具体人物或经历，可以自然补全这段生平轮廓。';
  return '先用一个低压力的问题建立节奏，让长者按自己的步调展开。';
}

function stageScore(stage: JourneyStage): number {
  if (stage === 'story_depth') return 0.9;
  if (stage === 'life_outline') return 0.76;
  return 0.62;
}
