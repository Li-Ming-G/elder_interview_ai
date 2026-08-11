import { Injectable } from '@nestjs/common';

import type {
  InterviewDirectorContextV1,
  InterviewDirectorOutputV1,
} from './question-director-contract.js';

export interface QuestionDirectorRequest {
  context: InterviewDirectorContextV1;
  prompt: { system: string; task: string };
}

/** One provider-neutral Director call. It has no database or tool access. */
export abstract class QuestionDirector {
  public abstract generate(request: QuestionDirectorRequest): Promise<unknown>;
}

export class QuestionDirectorUnavailableError extends Error {
  public constructor() {
    super('AI_PROVIDER_UNAVAILABLE');
  }
}

@Injectable()
export class UnavailableQuestionDirector extends QuestionDirector {
  public override generate(): Promise<never> {
    return Promise.reject(new QuestionDirectorUnavailableError());
  }
}

/** Deterministic local/test fake. It can generate without a bank reference. */
@Injectable()
export class LocalTestQuestionDirector extends QuestionDirector {
  public override generate({
    context,
  }: QuestionDirectorRequest): Promise<InterviewDirectorOutputV1> {
    const latestElder = [...context.recent_transcript]
      .reverse()
      .find(({ trusted_role }) => trusted_role === 'elder');
    if (latestElder !== undefined) {
      return Promise.resolve({
        continue_reason_code: null,
        decision: 'suggest',
        declared_bank_references: [],
        grounding: [{ id: latestElder.segment_id, kind: 'segment' }],
        purpose: context.interview_state.journey_stage === 'story_depth' ? 'detail' : 'timeline',
        question: '您愿意顺着刚才提到的这段经历，再讲讲当时发生了什么吗？',
        reason: '顺着长者刚刚表达的内容继续，不急着跳到新的主题。',
        risk: 'low',
      });
    }
    const memory = context.current_memories[0];
    if (memory !== undefined) {
      return Promise.resolve({
        continue_reason_code: null,
        decision: 'suggest',
        declared_bank_references: [],
        grounding: [{ id: memory.memory_resolution_id, kind: 'memory' }],
        purpose: 'transition',
        question: '如果您愿意，我们可以从一段您印象较深的经历慢慢讲起吗？',
        reason: '用开放问题承接已有线索，同时避免把不确定信息说成事实。',
        risk: 'low',
      });
    }
    const bank = context.bank_references[0];
    if (bank !== undefined) {
      return Promise.resolve({
        continue_reason_code: null,
        decision: 'suggest',
        declared_bank_references: [
          { question_bank_item_id: bank.question_bank_item_id, usage: 'inspiration' },
        ],
        grounding: [],
        purpose: bank.purpose,
        question: bank.question_text,
        reason: '当前事实线索较少，先参考低压力题目帮助建立谈话节奏。',
        risk: bank.sensitivity,
      });
    }
    return Promise.resolve({
      continue_reason_code: 'insufficient_context',
      decision: 'continue_listening',
      declared_bank_references: [],
      grounding: [],
      purpose: null,
      question: null,
      reason: '当前信息还不足以提出自然且有帮助的新问题。',
      risk: null,
    });
  }
}
