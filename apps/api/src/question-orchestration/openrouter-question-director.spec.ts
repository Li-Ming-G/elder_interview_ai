import { loadCheckpointADirectorConfig, type ApiConfig } from '@elder-interview/config';
import { describe, expect, it, vi } from 'vitest';

import { assembleP4DirectorContextV2 } from './p4-context-v2-consumer.js';
import { QuestionDirectorContract } from './question-director-contract.js';
import {
  OpenRouterQuestionDirector,
  type OpenRouterFetch,
  type OpenRouterResponse,
} from './openrouter-question-director.js';
import type { QuestionDirectorRequest } from './question-director.js';
import { runQuestionDirectorEvidenceRound } from './question-director-evidence-round.js';
import type { InterviewDirectorContextV1 } from './question-director-contract.js';
import {
  EVIDENCE_CONTRACT_VERSION,
  type EvidenceRequestEnvelope,
  type EvidenceResultEnvelope,
} from '../evidence-drilldown/evidence-drilldown.types.js';

const secret = 'fictional-openrouter-secret';
const ids = {
  generation: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  project: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  segment: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  session: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};

describe('OpenRouterQuestionDirector', () => {
  it('sends the frozen prompt, context and exact Checkpoint A transport settings', async () => {
    const calls: Array<{ input: string; init: Parameters<OpenRouterFetch>[1] }> = [];
    const director = createDirector((input, init) => {
      calls.push({ init, input });
      return Promise.resolve(response(output('suggest')));
    });

    await expect(director.generate(request())).resolves.toMatchObject({ decision: 'suggest' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0]?.init).toMatchObject({
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    const body = JSON.parse(calls[0]?.init.body ?? '') as {
      model: string;
      messages: Array<{ content: string; role: string }>;
      provider: { allow_fallback: boolean; require_parameters: boolean };
      response_format: { type: string };
    };
    expect(body.model).toBe('stealth/ox-alpha');
    expect(body.provider).toEqual({ allow_fallback: false, require_parameters: true });
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages).toEqual([
      { content: 'frozen system', role: 'system' },
      { content: 'frozen task', role: 'user' },
      expect.objectContaining({ role: 'user' }),
    ]);
    expect(body.messages[2]?.content).toContain('interview-director-output-v1');
    expect(body.messages[2]?.content).toContain(ids.segment);
    expect(body.messages[2]?.content).toContain('P5 evidence JSON: none');
    expect(calls[0]?.init.body).not.toContain(secret);
  });

  it.each(['suggest', 'continue_listening'] as const)(
    'hands JSON %s to the local contract',
    async (decision) => {
      const director = createDirector(() => Promise.resolve(response(output(decision))));
      const contract = new QuestionDirectorContract();
      const context = validContext();

      const parsed = await director.generate({ ...request(), context });
      expect(contract.parseOutput(parsed, context)).toMatchObject({ decision });
    },
  );

  it('keeps one provider binding and one deadline across the optional evidence round', async () => {
    const calls: Array<{ init: Parameters<OpenRouterFetch>[1] }> = [];
    const director = createDirector((_input, init) => {
      calls.push({ init });
      return Promise.resolve(
        response(calls.length === 1 ? evidenceRequest() : output('continue_listening')),
      );
    });
    const p4Context = assembleP4DirectorContextV2({
      actualAsked: [],
      currentPresentation: null,
      displayed: [],
      goal: 'test',
      journeyReasonCodes: [],
      journeyStage: 'rapport',
      policyRevision: 1,
      projectId: ids.project,
      questionBank: [],
      recentTranscript: [],
      sessionId: ids.session,
    });

    await expect(
      runQuestionDirectorEvidenceRound({
        actorId: ids.project,
        context: validContext(),
        deadlineAt: Date.now() + 10_000,
        director,
        evidence: {
          getMemoryEvidence: vi.fn((value: unknown) =>
            Promise.resolve(evidenceResult(value as EvidenceRequestEnvelope)),
          ),
          searchTranscript: vi.fn((value: unknown) =>
            Promise.resolve(evidenceResult(value as EvidenceRequestEnvelope)),
          ),
        },
        generationId: ids.generation,
        onEvidenceCall: vi.fn().mockResolvedValue(undefined),
        p4Context,
        parseOutput: (value) => new QuestionDirectorContract().parseOutput(value, validContext()),
        prompt: request().prompt,
        requestId: ids.generation,
        scopeSessionIds: [ids.session],
      }),
    ).resolves.toMatchObject({ decision: 'continue_listening' });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.init.headers.Authorization).toBe(calls[1]?.init.headers.Authorization);
    expect(calls[1]?.init.body).toContain('P5 evidence JSON:');
  });

  const invalidResponses: Array<[string, () => OpenRouterResponse]> = [
    ['empty', (): OpenRouterResponse => responseText('')],
    ['non-JSON', (): OpenRouterResponse => responseText('not-json')],
    ['response-shape', (): OpenRouterResponse => responseText(JSON.stringify({ choices: [] }))],
    [
      'malformed output JSON',
      (): OpenRouterResponse =>
        responseText(JSON.stringify({ choices: [{ message: { content: '{' } }] })),
    ],
  ];
  it.each(invalidResponses)('fails closed for %s responses', async (_name, makeResponse) => {
    const director = createDirector(() => Promise.resolve(makeResponse()));

    await expect(director.generate(request())).rejects.toMatchObject({
      code: 'AI_OUTPUT_SCHEMA_INVALID',
      message: 'AI_OUTPUT_SCHEMA_INVALID',
    });
  });

  it('fails closed for HTTP and transport failures without exposing bodies or secrets', async () => {
    const providerBody = 'fictional-provider-body-with-sensitive-content';
    const director = createDirector(() =>
      Promise.resolve(responseText(providerBody, { ok: false, status: 502 })),
    );

    await expect(director.generate(request())).rejects.toMatchObject({
      code: 'AI_PROVIDER_UNAVAILABLE',
      message: 'AI_PROVIDER_UNAVAILABLE',
    });
    await expect(director.generate(request())).rejects.not.toThrow(providerBody);
    await expect(director.generate(request())).rejects.not.toThrow(secret);
  });

  it('aborts at the absolute deadline and does not return a late result', async () => {
    let aborted = false;
    const director = createDirector(
      (_input, init) =>
        new Promise<OpenRouterResponse>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    await expect(
      director.generate({ ...request(), deadlineAt: Date.now() + 10 }),
    ).rejects.toMatchObject({ code: 'AI_PROVIDER_TIMEOUT' });
    expect(aborted).toBe(true);
  });

  it('leaves schema and reference authority with QuestionDirectorContract', async () => {
    const director = createDirector(() =>
      Promise.resolve(
        response(
          output('suggest', {
            grounding: [{ id: '99999999-9999-4999-8999-999999999999', kind: 'segment' }],
          }),
        ),
      ),
    );
    const contract = new QuestionDirectorContract();

    const raw = await director.generate(request());
    expect(() => contract.parseOutput(raw, validContext())).toThrow(
      'AI_OUTPUT_REFERENCE_OUTSIDE_CONTEXT',
    );
  });
});

function createDirector(transport: OpenRouterFetch): OpenRouterQuestionDirector {
  const checkpointA = loadCheckpointADirectorConfig(
    { APP_ENV: 'local', OPENROUTER_API_KEY: secret },
    'checkpoint_a',
  );
  return new OpenRouterQuestionDirector({ checkpointA } as ApiConfig, transport);
}

function request(): QuestionDirectorRequest {
  return {
    context: validContext(),
    deadlineAt: Date.now() + 10_000,
    prompt: { system: 'frozen system', task: 'frozen task' },
  };
}

function validContext(): InterviewDirectorContextV1 {
  return {
    actual_asked: [],
    bank_references: [],
    boundaries: [],
    context_schema_version: 'interview-director-context-v1',
    current_memories: [],
    current_presentation: null,
    interview_state: {
      goal: 'test',
      journey_reason_codes: [],
      journey_stage: 'rapport',
    },
    recent_transcript: [
      { segment_id: ids.segment, start_ms: 0, text: 'fictional context', trusted_role: 'elder' },
    ],
    recently_displayed: [],
  };
}

function output(
  decision: 'suggest' | 'continue_listening',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return decision === 'suggest'
    ? {
        continue_reason_code: null,
        decision,
        declared_bank_references: [],
        grounding: [{ id: ids.segment, kind: 'segment' }],
        purpose: 'detail',
        question: '您愿意再讲讲吗？',
        reason: '顺着刚才的内容继续。',
        risk: 'low',
        ...overrides,
      }
    : {
        continue_reason_code: 'insufficient_context',
        decision,
        declared_bank_references: [],
        grounding: [],
        purpose: null,
        question: null,
        reason: '当前信息还不足。',
        risk: null,
        ...overrides,
      };
}

function evidenceRequest(): Record<string, unknown> {
  return {
    decision: 'request_evidence',
    evidence: {
      operation: 'search_transcript',
      request: { query: 'fictional query' },
    },
  };
}

function evidenceResult(request: EvidenceRequestEnvelope): EvidenceResultEnvelope {
  return {
    contract_version: EVIDENCE_CONTRACT_VERSION,
    diagnostics: {
      duration_ms: 1,
      error_code: 'NONE',
      reference_count: 0,
      result_count: 0,
      stage: 'evidence_drilldown',
    },
    message_type: 'result',
    operation: request.operation,
    request_id: request.request_id,
    result: {
      match_state: 'no_match',
      matches: [],
      query: 'fictional query',
      result_type: 'transcript_search',
    },
    round: {
      ...request.round,
    },
    scope: {
      ...request.scope,
    },
  };
}

function response(body: Record<string, unknown>): OpenRouterResponse {
  return responseText(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }),
  );
}

function responseText(
  body: string,
  overrides: Partial<OpenRouterResponse> = {},
): OpenRouterResponse {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
    ...overrides,
  };
}
