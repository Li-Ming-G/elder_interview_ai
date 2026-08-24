import type { ApiConfig, CheckpointAOpenRouterConfig } from '@elder-interview/config';
import { Inject, Injectable } from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';
import { canonicalJson } from '../ai-runtime/ai-provenance.js';
import { DIRECTOR_OUTPUT_SCHEMA_VERSION } from './question-director-contract.js';
import {
  QuestionDirector,
  QuestionDirectorUnavailableError,
  type QuestionDirectorRequest,
} from './question-director.js';

export const OPENROUTER_FETCH = Symbol('OPENROUTER_FETCH');

export const OPENROUTER_FIRST_CALL_SCHEMA_INSTRUCTION = `Output schema instruction: return exactly one JSON object matching InterviewDirectorOutputV1 (${DIRECTOR_OUTPUT_SCHEMA_VERSION}), or the exact bounded internal request_evidence envelope. The request_evidence envelope must be exactly {"decision":"request_evidence","evidence":{"operation":"get_memory_evidence"|"search_transcript","request":{"memory_id":"UUID"}|{"query":"1-240 character string"}}} with no additional fields; memory_id must be a UUID and query must be 1-240 characters. Do not include Markdown or explanatory text outside the JSON object.`;

export const OPENROUTER_EVIDENCE_CALL_SCHEMA_INSTRUCTION = `Output schema instruction: this call carries one accepted P5 evidence result; return exactly one JSON object matching InterviewDirectorOutputV1 (${DIRECTOR_OUTPUT_SCHEMA_VERSION}) only. The request_evidence envelope is not permitted on this call. Do not include Markdown or explanatory text outside the JSON object.`;

export interface OpenRouterResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type OpenRouterFetch = (
  input: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<OpenRouterResponse>;

export class OpenRouterQuestionDirectorError extends Error {
  public constructor(
    public readonly code:
      'AI_OUTPUT_SCHEMA_INVALID' | 'AI_PROVIDER_TIMEOUT' | 'AI_PROVIDER_UNAVAILABLE',
  ) {
    super(code);
  }
}

@Injectable()
export class OpenRouterQuestionDirector extends QuestionDirector {
  private readonly config: CheckpointAOpenRouterConfig;

  public constructor(
    @Inject(API_CONFIG) config: ApiConfig,
    @Inject(OPENROUTER_FETCH) private readonly transport: OpenRouterFetch,
  ) {
    super();
    if (config.checkpointA.mode !== 'checkpoint_a') {
      throw new QuestionDirectorUnavailableError();
    }
    this.config = config.checkpointA;
  }

  public override async generate(request: QuestionDirectorRequest): Promise<unknown> {
    const remainingMs = request.deadlineAt - Date.now();
    if (remainingMs <= 0 || !Number.isFinite(remainingMs)) {
      throw new OpenRouterQuestionDirectorError('AI_PROVIDER_TIMEOUT');
    }

    const controller = new AbortController();
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const fetchPromise = this.transport(this.config.endpoint, {
        body: JSON.stringify(buildRequestBody(request, this.config)),
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      });
      const deadlinePromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true;
          controller.abort();
          reject(new OpenRouterQuestionDirectorError('AI_PROVIDER_TIMEOUT'));
        }, remainingMs);
      });
      const response = await Promise.race([fetchPromise, deadlinePromise]);
      assertBeforeDeadline(request.deadlineAt, expired);
      if (!response.ok) {
        throw new OpenRouterQuestionDirectorError('AI_PROVIDER_UNAVAILABLE');
      }
      const body = await Promise.race([response.text(), deadlinePromise]);
      assertBeforeDeadline(request.deadlineAt, expired);
      return parseOpenRouterBody(body);
    } catch (error) {
      if (error instanceof OpenRouterQuestionDirectorError) throw error;
      if (isAbortError(error) || Date.now() >= request.deadlineAt) {
        throw new OpenRouterQuestionDirectorError('AI_PROVIDER_TIMEOUT');
      }
      throw new OpenRouterQuestionDirectorError('AI_PROVIDER_UNAVAILABLE');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

function buildRequestBody(
  request: QuestionDirectorRequest,
  config: CheckpointAOpenRouterConfig,
): Record<string, unknown> {
  return {
    messages: [
      { content: request.prompt.system, role: 'system' },
      { content: request.prompt.task, role: 'user' },
      {
        content: [
          request.evidence === undefined
            ? OPENROUTER_FIRST_CALL_SCHEMA_INSTRUCTION
            : OPENROUTER_EVIDENCE_CALL_SCHEMA_INSTRUCTION,
          `Context JSON: ${canonicalJson(request.context)}`,
          `P5 evidence JSON: ${request.evidence === undefined ? 'none' : canonicalJson(request.evidence)}`,
        ].join('\n\n'),
        role: 'user',
      },
    ],
    model: config.model,
    provider: {
      allow_fallbacks: config.allowFallback,
      require_parameters: config.requireParameters,
    },
    response_format: { type: config.responseFormat },
  };
}

function parseOpenRouterBody(body: string): unknown {
  if (body.trim().length === 0) {
    throw new OpenRouterQuestionDirectorError('AI_OUTPUT_SCHEMA_INVALID');
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(body) as unknown;
  } catch {
    throw new OpenRouterQuestionDirectorError('AI_OUTPUT_SCHEMA_INVALID');
  }
  if (!isRecord(envelope) || !Array.isArray(envelope.choices)) {
    throw new OpenRouterQuestionDirectorError('AI_OUTPUT_SCHEMA_INVALID');
  }
  const content = (envelope.choices[0] as { message?: { content?: unknown } } | undefined)?.message
    ?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new OpenRouterQuestionDirectorError('AI_OUTPUT_SCHEMA_INVALID');
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new OpenRouterQuestionDirectorError('AI_OUTPUT_SCHEMA_INVALID');
  }
}

function assertBeforeDeadline(deadlineAt: number, expired: boolean): void {
  if (expired || Date.now() >= deadlineAt) {
    throw new OpenRouterQuestionDirectorError('AI_PROVIDER_TIMEOUT');
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message === 'AI_PROVIDER_TIMEOUT')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
