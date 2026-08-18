import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  countMemoryMaintainerUsefulCharactersV12,
  decideMemoryMaintainerTriggerV12,
  type MemoryMaintainerV12NamespaceObservation,
  type MemoryMaintainerV12TriggerDisposition,
  type MemoryMaintainerV12TriggerGateInput,
  type MemoryProducerCutoverStateV12,
  normalizeMemoryMaintainerUsefulTextV12,
  validateMemoryMaintainerNamespacesV12,
  validateMemoryMaintainerV12SemanticPair,
  validateMemoryProducerCutoverV12,
} from './memory-maintainer-contract-v1-2.js';

interface FixtureCase {
  name: string;
  valid: boolean;
  value: unknown;
}

interface Fixtures {
  historical_v11_sha256: Record<string, string>;
  context_cases: FixtureCase[];
  output_cases: FixtureCase[];
  semantic_cases: {
    name: string;
    context_case: string;
    output_case: string;
    valid: boolean;
    expected_error: string | null;
  }[];
  trigger_fact_cases: {
    name: string;
    selected_new_segment_count: number;
    cumulative_useful_characters: number;
    minimum_useful_characters: number;
    duplicate_first_segment: boolean;
    valid: boolean;
    expected_error: string;
  }[];
  normalization_cases: {
    name: string;
    input: string;
    normalized: string;
    code_points: number;
  }[];
  trigger_gate_cases: {
    name: string;
    value: MemoryMaintainerV12TriggerGateInput;
    disposition: MemoryMaintainerV12TriggerDisposition;
  }[];
  namespace_cases: {
    name: string;
    valid: boolean;
    expected_error?: string;
    jobs: MemoryMaintainerV12NamespaceObservation[];
  }[];
  cutover_cases: {
    name: string;
    valid: boolean;
    value: MemoryProducerCutoverStateV12;
  }[];
}

describe('Memory Maintainer v1.2 forward machine contract', () => {
  const fixtures = readJson(
    'docs/contracts/fixtures/memory-maintainer-v1.2.fixtures.json',
  ) as Fixtures;

  it.each(Object.entries(fixtures.historical_v11_sha256))(
    'preserves accepted v1.1 bytes for %s',
    (path, expectedDigest) => {
      const content = readFileSync(join(findWorkspaceRoot(), path));
      expect(createHash('sha256').update(content).digest('hex')).toBe(expectedDigest);
    },
  );

  it.each(fixtures.context_cases)('validates v1.2 context fixture $name', ({ valid, value }) => {
    const validate = compile('docs/contracts/memory-maintainer-context-v1.2.schema.json');
    expect(validate(value), JSON.stringify(validate.errors)).toBe(valid);
  });

  it.each(fixtures.output_cases)('validates v1.2 output fixture $name', ({ valid, value }) => {
    const validate = compile('docs/contracts/memory-maintainer-output-v1.2.schema.json');
    expect(validate(value), JSON.stringify(validate.errors)).toBe(valid);
  });

  it.each(fixtures.semantic_cases)('validates v1.2 semantic fixture $name', (fixture) => {
    const context = fixtureByName(fixtures.context_cases, fixture.context_case);
    const output = fixtureByName(fixtures.output_cases, fixture.output_case);
    const result = validateMemoryMaintainerV12SemanticPair(context.value, output.value);
    expect(result.valid, result.errors.join(',')).toBe(fixture.valid);
    if (fixture.expected_error !== null) expect(result.errors).toContain(fixture.expected_error);
  });

  it.each(fixtures.trigger_fact_cases)(
    'recomputes selected-new trigger facts for $name',
    (fixture) => {
      const sourceContext = fixtureByName(
        fixtures.context_cases,
        'valid_fragmented_batch_without_tag',
      );
      const sourceOutput = fixtureByName(fixtures.output_cases, 'valid_boundary_is_independent');
      const context = structuredClone(sourceContext.value) as {
        trigger: {
          selected_new_segment_count: number;
          cumulative_useful_characters: number;
          minimum_useful_characters: number;
        };
        transcript_membership: Record<string, unknown>[];
      };
      context.trigger.selected_new_segment_count = fixture.selected_new_segment_count;
      context.trigger.cumulative_useful_characters = fixture.cumulative_useful_characters;
      context.trigger.minimum_useful_characters = fixture.minimum_useful_characters;
      if (fixture.duplicate_first_segment) {
        const first = context.transcript_membership[0];
        if (first === undefined) throw new Error('FIRST_TRANSCRIPT_FIXTURE_REQUIRED');
        context.transcript_membership.push(structuredClone(first));
      }

      const result = validateMemoryMaintainerV12SemanticPair(context, sourceOutput.value);
      expect(result.valid, result.errors.join(',')).toBe(fixture.valid);
      expect(result.errors).toContain(fixture.expected_error);
    },
  );

  it.each(fixtures.normalization_cases)(
    'normalizes and counts Unicode code points for $name',
    (fixture) => {
      expect(normalizeMemoryMaintainerUsefulTextV12(fixture.input)).toBe(fixture.normalized);
      expect(countMemoryMaintainerUsefulCharactersV12(fixture.input)).toBe(fixture.code_points);
    },
  );

  it.each(fixtures.trigger_gate_cases)('decides trigger gate $name', (fixture) => {
    expect(decideMemoryMaintainerTriggerV12(fixture.value)).toBe(fixture.disposition);
  });

  it.each(fixtures.namespace_cases)('validates namespace fixture $name', (fixture) => {
    const result = validateMemoryMaintainerNamespacesV12(fixture.jobs);
    expect(result.valid, result.errors.join(',')).toBe(fixture.valid);
    if (fixture.expected_error !== undefined) {
      expect(result.errors).toContain(fixture.expected_error);
    }
  });

  it.each(fixtures.cutover_cases)('validates v1.2 cutover fixture $name', (fixture) => {
    const result = validateMemoryProducerCutoverV12(fixture.value);
    expect(result.valid, result.errors.join(',')).toBe(fixture.valid);
  });
});

function fixtureByName(fixtures: FixtureCase[], name: string): FixtureCase {
  const fixture = fixtures.find((candidate) => candidate.name === name);
  if (fixture === undefined) throw new Error(`FIXTURE_NOT_FOUND:${name}`);
  return fixture;
}

function compile(path: string): {
  (value: unknown): boolean;
  errors?: unknown;
} {
  const AjvConstructor = Ajv2020 as unknown as new (options: object) => {
    compile(schema: object): {
      (value: unknown): boolean;
      errors?: unknown;
    };
  };
  const ajv = new AjvConstructor({ allErrors: true, strict: false });
  return ajv.compile(readJson(path) as object);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(findWorkspaceRoot(), path), 'utf8'));
}

function findWorkspaceRoot(): string {
  let current = process.cwd();
  while (!existsSync(join(current, 'pnpm-workspace.yaml'))) {
    const parent = join(current, '..');
    if (parent === current) throw new Error('WORKSPACE_ROOT_NOT_FOUND');
    current = parent;
  }
  return current;
}
