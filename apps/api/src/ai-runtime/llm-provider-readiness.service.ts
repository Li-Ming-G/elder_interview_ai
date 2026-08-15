import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { LlmProviderActiveBindingV1, LlmProviderRegistryV1 } from '@elder-interview/contracts';
import { Injectable } from '@nestjs/common';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';

import { validateLlmProviderRegistrySemanticsV1 } from '../question-orchestration/llm-provider-registry-semantics.js';

export interface LlmProviderRegistryValidationV1 {
  valid: boolean;
  structural_errors: Array<{ instance_path: string; keyword: string }>;
  semantic_errors: Array<{ code: string; path: string }>;
}

export function validateLlmProviderRegistryV1(
  registry: LlmProviderRegistryV1,
  schemaRoot = findRepositoryRoot(),
): LlmProviderRegistryValidationV1 {
  const validate = compileRegistry(schemaRoot);
  const structurallyValid = validate(registry);
  const structuralErrors = structurallyValid ? [] : sanitizeAjvErrors(validate.errors ?? []);
  const semantic = structurallyValid
    ? validateLlmProviderRegistrySemanticsV1(registry)
    : { errors: [], valid: false };
  return {
    semantic_errors: semantic.errors,
    structural_errors: structuralErrors,
    valid: structurallyValid && semantic.valid,
  };
}

@Injectable()
export class LlmProviderReadinessService {
  private readonly registry: LlmProviderRegistryV1;

  public constructor() {
    const root = findRepositoryRoot();
    this.registry = readJson(
      join(root, 'docs/contracts/llm-provider-registry.default.json'),
    ) as LlmProviderRegistryV1;
    const validation = validateLlmProviderRegistryV1(this.registry, root);
    if (!validation.valid) throw new Error('LLM_PROVIDER_REGISTRY_INVALID');
  }

  public snapshot(): Readonly<LlmProviderRegistryV1> {
    return this.registry;
  }

  public requireActiveBinding(): LlmProviderActiveBindingV1 {
    const binding = this.registry.routing.active_binding;
    if (binding === null) throw new Error('AI_PROVIDER_UNAVAILABLE');
    return binding;
  }
}

function compileRegistry(root: string): ValidateFunction {
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
  ajv.addSchema(
    readJson(join(root, 'docs/contracts/llm-model-config-v1.schema.json')),
    'https://elder-interview.example/schemas/llm-model-config-v1.schema.json',
  );
  return ajv.compile(readJson(join(root, 'docs/contracts/llm-provider-registry-v1.schema.json')));
}

function sanitizeAjvErrors(
  errors: readonly ErrorObject[],
): Array<{ instance_path: string; keyword: string }> {
  return errors
    .map((error) => ({ instance_path: error.instancePath, keyword: error.keyword }))
    .sort(
      (left, right) =>
        left.instance_path.localeCompare(right.instance_path) ||
        left.keyword.localeCompare(right.keyword),
    );
}

function readJson(path: string): object {
  return JSON.parse(readFileSync(path, 'utf8')) as object;
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
