import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { QuestionDirectorContract } from './question-director-contract.js';

interface SyntheticEvaluationSet {
  data_class: 'synthetic';
  contains_real_personal_data: false;
  publish_targets: string[];
  prohibited_publish_targets: string[];
  cases: Array<{ case_id: string; context: unknown }>;
}

describe('SPEC-LLM-PROVIDER-001 candidate contracts', () => {
  const root = findRepositoryRoot();

  it('validates the fail-closed default registry with no provider or active binding', () => {
    const validate = compile('docs/contracts/llm-provider-registry-v1.schema.json');
    const registry = readJson('docs/contracts/llm-provider-registry.default.json') as {
      providers: unknown[];
      routing: { active_binding: unknown; fallback_enabled: boolean; gateway_enabled: boolean };
      safety: { real_interview_data_default: string };
      sdk: { max_retries: number };
    };

    expect(validate(registry), JSON.stringify(validate.errors)).toBe(true);
    expect(registry.providers).toEqual([]);
    expect(registry.routing).toMatchObject({
      active_binding: null,
      fallback_enabled: false,
      gateway_enabled: false,
    });
    expect(registry.safety.real_interview_data_default).toBe('deny');
    expect(registry.sdk.max_retries).toBe(0);
  });

  it('keeps SDK-generated response identity separate from provider request identity', () => {
    const validate = compile('docs/contracts/llm-provider-call-receipt-v1.schema.json');
    const receipt = providerReceipt();
    expect(validate(receipt), JSON.stringify(validate.errors)).toBe(true);

    const masquerading = {
      ...receipt,
      provider_request_id_source: 'sdk_generated',
    };
    expect(validate(masquerading)).toBe(false);
  });

  it('requires an exact model allowlist and review evidence before real interview use', () => {
    const validate = compile('docs/contracts/llm-provider-registry-v1.schema.json');
    const registry = readJson('docs/contracts/llm-provider-registry.default.json') as Record<
      string,
      unknown
    >;
    const syntheticOnlyProfile = {
      provider_id: 'contract-fixture-provider',
      provider_package: '@ai-sdk/contract-fixture',
      provider_package_version: '1.0.0',
      model_allowlist: [
        {
          provider_model_id: 'contract-fixture-model',
          model_configs: [
            {
              model_config_version: 'contract-fixture-config-v1',
              model_config_digest: 'd'.repeat(64),
            },
          ],
        },
      ],
      endpoint_origins: ['https://contract-fixture.invalid'],
      processing_regions: [{ data_region: 'synthetic-test-region', jurisdiction: 'foreign' }],
      secret_references: ['CONTRACT_FIXTURE_API_KEY'],
      environment_scopes: ['test'],
      allowed_data_classes: ['synthetic'],
      real_interview_policy: {
        allowed: false,
        authorization_policy_version: null,
        provider_terms_review_id: null,
        data_retention_review_id: null,
        training_use: 'deny',
        foreign_processing_allowed: false,
        cross_border_decision_id: null,
      },
    };
    const syntheticRegistry = {
      ...registry,
      routing: {
        ...(registry.routing as Record<string, unknown>),
        active_binding: {
          provider_id: 'contract-fixture-provider',
          provider_model_id: 'contract-fixture-model',
          model_config_version: 'contract-fixture-config-v1',
          model_config_digest: 'd'.repeat(64),
          endpoint_origin: 'https://contract-fixture.invalid',
          data_region: 'synthetic-test-region',
          secret_reference: 'CONTRACT_FIXTURE_API_KEY',
          data_class: 'synthetic',
          environment_scope: 'test',
        },
      },
      providers: [syntheticOnlyProfile],
    };
    expect(validate(syntheticRegistry), JSON.stringify(validate.errors)).toBe(true);

    const unreviewedRealInterviewProfile = {
      ...syntheticOnlyProfile,
      allowed_data_classes: ['synthetic', 'real_interview'],
      real_interview_policy: {
        ...syntheticOnlyProfile.real_interview_policy,
        allowed: true,
      },
    };
    expect(validate({ ...syntheticRegistry, providers: [unreviewedRealInterviewProfile] })).toBe(
      false,
    );
  });

  it('validates every fixed synthetic context and forbids business publication targets', () => {
    const evaluation = readJson(
      'docs/evaluations/interview-director/synthetic-v1/cases.json',
    ) as SyntheticEvaluationSet;
    const director = new QuestionDirectorContract();

    expect(evaluation.data_class).toBe('synthetic');
    expect(evaluation.contains_real_personal_data).toBe(false);
    expect(evaluation.publish_targets).toEqual(['isolated_evaluation_artifact']);
    expect(evaluation.prohibited_publish_targets).toEqual(['question_current', 'question_history']);
    expect(evaluation.cases.length).toBeGreaterThanOrEqual(4);
    for (const fixture of evaluation.cases) {
      expect(() => {
        director.assertContext(fixture.context);
      }, fixture.case_id).not.toThrow();
    }
  });

  it('continues to load formal v1 rather than the editable v2 draft', () => {
    const director = new QuestionDirectorContract();
    expect(director.prompt.system).toContain('# Interview Director System v1');
    expect(director.prompt.task).toContain('# Interview Director Task v1');
    expect(director.prompt.system).not.toContain('DRAFT / NEVER LOAD IN RUNTIME');
  });

  function compile(path: string): ValidateFunction {
    const AjvConstructor = Ajv2020 as unknown as new (options: {
      allErrors: boolean;
      strict: boolean;
    }) => {
      addFormat(name: string, format: RegExp): void;
      compile(schema: object): ValidateFunction;
    };
    const ajv = new AjvConstructor({ allErrors: true, strict: false });
    ajv.addFormat('uri', /^https:\/\/[^\s]+$/u);
    ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u);
    return ajv.compile(readJson(path) as object);
  }

  function readJson(path: string): unknown {
    return JSON.parse(readFileSync(join(root, path), 'utf8')) as unknown;
  }
});

function providerReceipt(): Record<string, unknown> {
  return {
    schema_version: 'llm-provider-call-receipt-v1',
    provider_id: 'synthetic-provider',
    provider_model_id: 'synthetic-model',
    model_config_version: 'synthetic-config-v1',
    model_config_digest: 'a'.repeat(64),
    sdk_core_package: 'ai',
    sdk_core_version: '7.0.65',
    sdk_provider_package: '@ai-sdk/synthetic',
    sdk_provider_package_version: '1.0.0',
    connection_mode: 'direct_vendor',
    endpoint_origin: 'https://synthetic.invalid',
    data_region: 'synthetic-test-region',
    provider_request_id: 'provider-request-1',
    provider_request_id_source: 'provider',
    sdk_response_id: 'sdk-response-1',
    token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    latency_ms: 123,
    status: 'succeeded',
    error_code: null,
    started_at: '2026-08-14T00:00:00.000Z',
    completed_at: '2026-08-14T00:00:00.123Z',
    input_digest: 'b'.repeat(64),
    output_digest: 'c'.repeat(64),
  };
}

function findRepositoryRoot(): string {
  let current = resolve(process.cwd());
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, 'docs/contracts/llm-provider-registry-v1.schema.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('LLM_PROVIDER_SPEC_ARTIFACTS_NOT_FOUND');
}
