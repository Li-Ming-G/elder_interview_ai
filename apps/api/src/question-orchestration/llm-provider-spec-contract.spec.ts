import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type {
  LlmModelConfigManifestV1,
  LlmProviderCallReceiptV1,
  LlmProviderRegistryV1,
} from '@elder-interview/contracts';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  assessEqualEffectiveConfigV1,
  canonicalizeLlmModelConfigV1,
  digestLlmModelConfigV1,
  validateLlmProviderRegistrySemanticsV1,
} from './llm-provider-registry-semantics.js';
import { QuestionDirectorContract } from './question-director-contract.js';

interface SyntheticEvaluationSet {
  data_class: 'synthetic';
  contains_real_personal_data: false;
  publish_targets: string[];
  prohibited_publish_targets: string[];
  cases: Array<{ case_id: string; context: unknown }>;
}

interface ModelConfigFixtures {
  golden_vectors: Array<{
    case_id: string;
    manifest: LlmModelConfigManifestV1;
    canonical_json: string;
    sha256: string;
  }>;
  schema_cases: Array<{ case_id: string; expected_valid: boolean; manifest: unknown }>;
}

type JsonPatch =
  | { op: 'add' | 'replace'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'copy'; from: string; path: string };

interface RegistrySemanticFixtures {
  base_registry: LlmProviderRegistryV1;
  cases: Array<{
    case_id: string;
    patches: JsonPatch[];
    expected_error_codes: string[];
  }>;
}

interface ReceiptFixtures {
  base_receipt: LlmProviderCallReceiptV1;
  cases: Array<{
    case_id: string;
    patches: JsonPatch[];
    expected_valid: boolean;
  }>;
}

describe('SPEC-LLM-PROVIDER-001 candidate contracts', () => {
  const root = findRepositoryRoot();

  it('validates the fail-closed default registry structurally and semantically', () => {
    const validate = compileRegistry();
    const registry = readJson(
      'docs/contracts/llm-provider-registry.default.json',
    ) as LlmProviderRegistryV1;

    expect(validate(registry), JSON.stringify(validate.errors)).toBe(true);
    expect(registry.providers).toEqual([]);
    expect(registry.model_config_manifests).toEqual([]);
    expect(registry.routing.active_binding).toBeNull();
    expect(registry.routing.fallback_enabled).toBe(false);
    expect(registry.routing.gateway_enabled).toBe(false);
    expect(registry.safety.real_interview_data_default).toBe('deny');
    expect(registry.sdk.max_retries).toBe(0);
    expect(validateLlmProviderRegistrySemanticsV1(registry)).toEqual({
      semantic_contract_version: 'llm-provider-registry-semantics-v1',
      valid: true,
      errors: [],
    });
  });

  it('matches the canonical model-config golden vector byte-for-byte', () => {
    const fixtures = readJson(
      'docs/contracts/fixtures/llm-model-config-v1.fixtures.json',
    ) as ModelConfigFixtures;
    expect(fixtures.golden_vectors.length).toBeGreaterThan(0);
    for (const vector of fixtures.golden_vectors) {
      expect(canonicalizeLlmModelConfigV1(vector.manifest), vector.case_id).toBe(
        vector.canonical_json,
      );
      expect(digestLlmModelConfigV1(vector.manifest), vector.case_id).toBe(vector.sha256);
    }
  });

  it('changes the model-config digest when any effective generation input changes', () => {
    const fixtures = readJson(
      'docs/contracts/fixtures/llm-model-config-v1.fixtures.json',
    ) as ModelConfigFixtures;
    const baseline = fixtures.golden_vectors[0];
    if (!baseline) throw new Error('MODEL_CONFIG_GOLDEN_VECTOR_REQUIRED');
    const changes: Array<{ case_id: string; patches: JsonPatch[] }> = [
      {
        case_id: 'temperature',
        patches: [{ op: 'replace', path: '/generation/temperature', value: 0.3 }],
      },
      {
        case_id: 'max-output',
        patches: [{ op: 'replace', path: '/generation/max_output_tokens', value: 257 }],
      },
      {
        case_id: 'reasoning',
        patches: [
          { op: 'replace', path: '/generation/reasoning/mode', value: 'effort' },
          { op: 'replace', path: '/generation/reasoning/effort', value: 'low' },
        ],
      },
      {
        case_id: 'seed',
        patches: [{ op: 'replace', path: '/generation/seed', value: 43 }],
      },
      {
        case_id: 'stop',
        patches: [{ op: 'add', path: '/generation/stop_sequences/-', value: '<END>' }],
      },
      {
        case_id: 'provider-options',
        patches: [
          {
            op: 'add',
            path: '/provider_options/synthetic',
            value: { responseDetail: 'minimal' },
          },
        ],
      },
    ];

    for (const change of changes) {
      const changed = applyPatches(baseline.manifest, change.patches);
      expect(digestLlmModelConfigV1(changed), change.case_id).not.toBe(baseline.sha256);
    }
  });

  it('mechanically rejects incomplete or contradictory model-config manifests', () => {
    const validate = compile('docs/contracts/llm-model-config-v1.schema.json');
    const fixtures = readJson(
      'docs/contracts/fixtures/llm-model-config-v1.fixtures.json',
    ) as ModelConfigFixtures;
    for (const fixture of fixtures.schema_cases) {
      expect(validate(fixture.manifest), fixture.case_id).toBe(fixture.expected_valid);
    }
  });

  it('applies every deterministic registry semantic fixture with exact error codes', () => {
    const validate = compileRegistry();
    const fixtures = readJson(
      'docs/contracts/fixtures/llm-provider-registry-semantics-v1.fixtures.json',
    ) as RegistrySemanticFixtures;

    for (const fixture of fixtures.cases) {
      const registry = applyPatches(fixtures.base_registry, fixture.patches);
      expect(validate(registry), `${fixture.case_id}: ${JSON.stringify(validate.errors)}`).toBe(
        true,
      );
      const result = validateLlmProviderRegistrySemanticsV1(registry);
      expect(
        [...new Set(result.errors.map((error) => error.code))].sort(),
        fixture.case_id,
      ).toEqual([...fixture.expected_error_codes].sort());
      expect(result.valid, fixture.case_id).toBe(fixture.expected_error_codes.length === 0);
    }
  });

  it('keeps requested model, observed model, provider request and SDK response identities distinct', () => {
    const validate = compile('docs/contracts/llm-provider-call-receipt-v1.schema.json');
    const receipt = providerReceipt();
    expect(validate(receipt), JSON.stringify(validate.errors)).toBe(true);

    expect(
      validate({
        ...receipt,
        observed_response_model_id_source: 'unavailable',
      }),
    ).toBe(false);
    expect(
      validate({
        ...receipt,
        provider_request_id_source: 'unavailable',
      }),
    ).toBe(false);
    expect(
      validate({
        ...receipt,
        provider_request_id: null,
        provider_request_id_source: 'sdk_generated',
      }),
    ).toBe(false);
    expect(
      validate({
        ...receipt,
        sdk_response_id: 'sdk-generated-1',
        sdk_response_id_source: 'sdk_generated',
      }),
    ).toBe(true);
    expect(
      validate({
        ...receipt,
        sdk_response_id_source: 'unavailable',
      }),
    ).toBe(false);
  });

  it('validates warning/status and identity-source fixtures', () => {
    const validate = compile('docs/contracts/llm-provider-call-receipt-v1.schema.json');
    const fixtures = readJson(
      'docs/contracts/fixtures/llm-provider-call-receipt-v1.fixtures.json',
    ) as ReceiptFixtures;
    for (const fixture of fixtures.cases) {
      const receipt = applyPatches(fixtures.base_receipt, fixture.patches);
      expect(validate(receipt), `${fixture.case_id}: ${JSON.stringify(validate.errors)}`).toBe(
        fixture.expected_valid,
      );
    }
  });

  it('does not classify a warning or unknown model as equal effective config', () => {
    const first = providerReceipt() as LlmProviderCallReceiptV1;
    const second = {
      ...providerReceipt(),
      requested_provider_id: 'synthetic-provider-b',
      requested_provider_model_id: 'synthetic-model-b',
    } as LlmProviderCallReceiptV1;
    expect(assessEqualEffectiveConfigV1([first, second])).toEqual({
      equal_effective_config: true,
      reason_codes: [],
    });

    const warningReceipt = {
      ...second,
      config_application_status: 'diverged',
      warnings: [
        {
          classification: 'ignored_setting',
          setting_path: '/generation/seed',
          sanitized_code: 'SEED_IGNORED',
        },
      ],
    } as LlmProviderCallReceiptV1;
    expect(assessEqualEffectiveConfigV1([first, warningReceipt])).toEqual({
      equal_effective_config: false,
      reason_codes: ['CONFIG_DIVERGED', 'WARNING_PRESENT'],
    });
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

  function compileRegistry(): ValidateFunction {
    const ajv = createAjv();
    ajv.addSchema(
      readJson('docs/contracts/llm-model-config-v1.schema.json') as object,
      'https://elder-interview.example/schemas/llm-model-config-v1.schema.json',
    );
    return ajv.compile(readJson('docs/contracts/llm-provider-registry-v1.schema.json') as object);
  }

  function compile(path: string): ValidateFunction {
    return createAjv().compile(readJson(path) as object);
  }

  function createAjv(): {
    addFormat(name: string, format: RegExp): void;
    addSchema(schema: object, key?: string): void;
    compile(schema: object): ValidateFunction;
  } {
    const AjvConstructor = Ajv2020 as unknown as new (options: {
      allErrors: boolean;
      strict: boolean;
    }) => {
      addFormat(name: string, format: RegExp): void;
      addSchema(schema: object, key?: string): void;
      compile(schema: object): ValidateFunction;
    };
    const ajv = new AjvConstructor({ allErrors: true, strict: false });
    ajv.addFormat('uri', /^https:\/\/[^\s]+$/u);
    ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u);
    return ajv;
  }

  function readJson(path: string): unknown {
    return JSON.parse(readFileSync(join(root, path), 'utf8')) as unknown;
  }
});

function providerReceipt(): Record<string, unknown> {
  return {
    schema_version: 'llm-provider-call-receipt-v1',
    requested_provider_id: 'synthetic-provider',
    requested_provider_model_id: 'synthetic-requested-model',
    observed_response_model_id: 'synthetic-observed-model-revision',
    observed_response_model_id_source: 'provider_origin',
    model_config_schema_version: 'llm-model-config-v1',
    model_config_version: 'synthetic-comparison-v1',
    model_config_digest: 'eb9639c9ae5dd8e76547d8756c402717df75fb5b310f316babb5715ad6c583d0',
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
    sdk_response_id_source: 'provider_origin',
    config_application_status: 'as_requested',
    warnings: [],
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

function applyPatches<T>(base: T, patches: readonly JsonPatch[]): T {
  const document = structuredClone(base) as unknown;
  for (const patch of patches) {
    if (patch.op === 'copy') {
      setPointer(document, patch.path, structuredClone(getPointer(document, patch.from)), 'add');
    } else if (patch.op === 'remove') {
      removePointer(document, patch.path);
    } else {
      setPointer(document, patch.path, structuredClone(patch.value), patch.op);
    }
  }
  return document as T;
}

function getPointer(document: unknown, pointer: string): unknown {
  let current = document;
  for (const token of pointerTokens(pointer)) {
    if (Array.isArray(current)) current = current[Number(token)];
    else current = (current as Record<string, unknown>)[token];
  }
  return current;
}

function setPointer(
  document: unknown,
  pointer: string,
  value: unknown,
  operation: 'add' | 'replace',
): void {
  const tokens = pointerTokens(pointer);
  const key = tokens.pop();
  if (key === undefined) throw new Error('FIXTURE_ROOT_PATCH_NOT_SUPPORTED');
  let parent = document;
  for (const token of tokens) {
    parent = Array.isArray(parent)
      ? parent[Number(token)]
      : (parent as Record<string, unknown>)[token];
  }
  if (Array.isArray(parent)) {
    if (key === '-') parent.push(value);
    else if (operation === 'add') parent.splice(Number(key), 0, value);
    else parent[Number(key)] = value;
  } else {
    (parent as Record<string, unknown>)[key] = value;
  }
}

function removePointer(document: unknown, pointer: string): void {
  const tokens = pointerTokens(pointer);
  const key = tokens.pop();
  if (key === undefined) throw new Error('FIXTURE_ROOT_PATCH_NOT_SUPPORTED');
  let parent = document;
  for (const token of tokens) {
    parent = Array.isArray(parent)
      ? parent[Number(token)]
      : (parent as Record<string, unknown>)[token];
  }
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else Reflect.deleteProperty(parent as Record<string, unknown>, key);
}

function pointerTokens(pointer: string): string[] {
  if (!pointer.startsWith('/')) throw new Error('INVALID_FIXTURE_JSON_POINTER');
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
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
