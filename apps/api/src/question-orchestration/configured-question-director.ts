import type { ApiConfig, CheckpointAConfiguredDirectorConfig } from '@elder-interview/config';
import { Inject, Injectable } from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';
import { canonicalJson } from '../ai-runtime/ai-provenance.js';
import { DIRECTOR_OUTPUT_SCHEMA_VERSION } from './question-director-contract.js';
import {
  QuestionDirector,
  QuestionDirectorUnavailableError,
  type QuestionDirectorRequest,
} from './question-director.js';

export const CONFIGURED_DIRECTOR_FETCH = Symbol('CONFIGURED_DIRECTOR_FETCH');

export const CONFIGURED_DIRECTOR_FIRST_CALL_SCHEMA_INSTRUCTION = `Output schema instruction: return exactly one JSON object matching InterviewDirectorOutputV1 (${DIRECTOR_OUTPUT_SCHEMA_VERSION}), or the exact bounded internal request_evidence envelope. The request_evidence envelope must be exactly {"decision":"request_evidence","evidence":{"operation":"get_memory_evidence"|"search_transcript","request":{"memory_id":"UUID"}|{"query":"1-240 character string"}}} with no additional fields; memory_id must be a UUID and query must be 1-240 characters. Do not include Markdown or explanatory text outside the JSON object.`;

export const CONFIGURED_DIRECTOR_EVIDENCE_CALL_SCHEMA_INSTRUCTION = `Output schema instruction: this call carries one accepted P5 evidence result; return exactly one JSON object matching InterviewDirectorOutputV1 (${DIRECTOR_OUTPUT_SCHEMA_VERSION}) only. The request_evidence envelope is not permitted on this call. Do not include Markdown or explanatory text outside the JSON object.`;

export interface ConfiguredDirectorResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type ConfiguredDirectorFetch = (
  input: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<ConfiguredDirectorResponse>;

export class ConfiguredQuestionDirectorError extends Error {
  public constructor(
    public readonly code:
      'AI_OUTPUT_SCHEMA_INVALID' | 'AI_PROVIDER_TIMEOUT' | 'AI_PROVIDER_UNAVAILABLE',
  ) {
    super(code);
  }
}

@Injectable()
export class ConfiguredQuestionDirector extends QuestionDirector {
  private readonly config: CheckpointAConfiguredDirectorConfig;

  public constructor(
    @Inject(API_CONFIG) config: ApiConfig,
    @Inject(CONFIGURED_DIRECTOR_FETCH) private readonly transport: ConfiguredDirectorFetch,
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
      throw new ConfiguredQuestionDirectorError('AI_PROVIDER_TIMEOUT');
    }

    const controller = new AbortController();
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const fetchPromise = this.transport(this.config.endpoint, {
        body: JSON.stringify(buildRequestBody(request, this.config)),
        headers: buildHeaders(this.config),
        method: 'POST',
        signal: controller.signal,
      });
      const deadlinePromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true;
          controller.abort();
          reject(new ConfiguredQuestionDirectorError('AI_PROVIDER_TIMEOUT'));
        }, remainingMs);
      });
      const response = await Promise.race([fetchPromise, deadlinePromise]);
      assertBeforeDeadline(request.deadlineAt, expired);
      if (!response.ok) {
        throw new ConfiguredQuestionDirectorError('AI_PROVIDER_UNAVAILABLE');
      }
      const body = await Promise.race([response.text(), deadlinePromise]);
      assertBeforeDeadline(request.deadlineAt, expired);
      return parseConfiguredDirectorBody(body, this.config.apiProfile);
    } catch (error) {
      if (error instanceof ConfiguredQuestionDirectorError) throw error;
      if (isAbortError(error) || Date.now() >= request.deadlineAt) {
        throw new ConfiguredQuestionDirectorError('AI_PROVIDER_TIMEOUT');
      }
      throw new ConfiguredQuestionDirectorError('AI_PROVIDER_UNAVAILABLE');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

function buildRequestBody(
  request: QuestionDirectorRequest,
  config: CheckpointAConfiguredDirectorConfig,
): Record<string, unknown> {
  const schemaAndContext = [
    request.evidence === undefined
      ? CONFIGURED_DIRECTOR_FIRST_CALL_SCHEMA_INSTRUCTION
      : CONFIGURED_DIRECTOR_EVIDENCE_CALL_SCHEMA_INSTRUCTION,
    `Context JSON: ${canonicalJson(request.context)}`,
    `P5 evidence JSON: ${request.evidence === undefined ? 'none' : canonicalJson(request.evidence)}`,
  ].join('\n\n');
  if (config.apiProfile === 'anthropic_messages') {
    return {
      max_tokens: 4096,
      messages: [
        { content: request.prompt.task, role: 'user' },
        { content: schemaAndContext, role: 'user' },
      ],
      model: config.model,
      system: request.prompt.system,
    };
  }
  const body: Record<string, unknown> = {
    messages: [
      { content: request.prompt.system, role: 'system' },
      { content: request.prompt.task, role: 'user' },
      { content: schemaAndContext, role: 'user' },
    ],
    model: config.model,
    response_format: { type: config.responseFormat },
  };
  if (config.apiProfile === 'openrouter_chat_completions') {
    body.provider = {
      allow_fallbacks: config.allowFallback,
      require_parameters: config.requireParameters,
    };
  }
  return body;
}

function buildHeaders(config: CheckpointAConfiguredDirectorConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    ...(config.apiProfile === 'anthropic_messages' ? { 'anthropic-version': '2023-06-01' } : {}),
  };
}

function parseConfiguredDirectorBody(
  body: string,
  apiProfile: CheckpointAConfiguredDirectorConfig['apiProfile'],
): unknown {
  if (body.trim().length === 0) {
    throw new ConfiguredQuestionDirectorError('AI_OUTPUT_SCHEMA_INVALID');
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(body) as unknown;
  } catch {
    throw new ConfiguredQuestionDirectorError('AI_OUTPUT_SCHEMA_INVALID');
  }
  if (!isRecord(envelope)) {
    throw new ConfiguredQuestionDirectorError('AI_OUTPUT_SCHEMA_INVALID');
  }
  const content =
    apiProfile === 'anthropic_messages'
      ? parseAnthropicText(envelope)
      : parseOpenAiCompatibleText(envelope);
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new ConfiguredQuestionDirectorError('AI_OUTPUT_SCHEMA_INVALID');
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new ConfiguredQuestionDirectorError('AI_OUTPUT_SCHEMA_INVALID');
  }
}

function parseAnthropicText(envelope: Record<string, unknown>): unknown {
  if (!Array.isArray(envelope.content)) return undefined;
  const text = envelope.content
    .filter(
      (block): block is { text: string; type: 'text' } =>
        isRecord(block) && block.type === 'text' && typeof block.text === 'string',
    )
    .map((block) => block.text)
    .join('');
  return text.length > 0 ? text : undefined;
}

function parseOpenAiCompatibleText(envelope: Record<string, unknown>): unknown {
  if (!Array.isArray(envelope.choices)) return undefined;
  return (envelope.choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content;
}

function assertBeforeDeadline(deadlineAt: number, expired: boolean): void {
  if (expired || Date.now() >= deadlineAt) {
    throw new ConfiguredQuestionDirectorError('AI_PROVIDER_TIMEOUT');
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
