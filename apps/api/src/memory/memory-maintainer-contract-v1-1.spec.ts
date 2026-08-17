import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  isTranscriptSegmentPendingForMaintainer,
  type JobDedupeObservation,
  type ProducerCutoverState,
  type RevisionParityInput,
  validateMemoryMaintainerJobDedupe,
  validateMemoryMaintainerRevisionParity,
  validateMemoryMaintainerV11SemanticPair,
  validateMemoryProducerCutover,
  validateWorkingConsumptions,
  type WorkingConsumptionObservation,
} from './memory-maintainer-contract-v1-1.js';

interface FixtureCase {
  name: string;
  valid: boolean;
  value: unknown;
}

interface Fixtures {
  historical_v1_sha256: Record<string, string>;
  context_cases: FixtureCase[];
  output_cases: FixtureCase[];
  semantic_cases: {
    name: string;
    context_case: string;
    output_case: string;
    valid: boolean;
  }[];
  disputed_target_cases: {
    name: string;
    target_resolution_id: string;
    expected_resolution_revision: number;
    duplicate_second_claim_identity: boolean;
    expected_error: string;
    valid: boolean;
  }[];
  revision_cases: { name: string; valid: boolean; value: RevisionParityInput }[];
  dedupe_cases: { name: string; valid: boolean; jobs: JobDedupeObservation[] }[];
  consumption_cases: {
    name: string;
    valid: boolean;
    transcript_segment_id: string;
    pending: boolean;
    consumptions: WorkingConsumptionObservation[];
  }[];
  cutover_cases: { name: string; valid: boolean; value: ProducerCutoverState }[];
}

describe('Memory Maintainer v1.1 forward machine contract', () => {
  const fixtures = readJson(
    'docs/contracts/fixtures/memory-maintainer-v1.1.fixtures.json',
  ) as Fixtures;

  it.each(Object.entries(fixtures.historical_v1_sha256))(
    'preserves accepted v1 bytes for %s',
    (path, expectedDigest) => {
      const content = readFileSync(join(findWorkspaceRoot(), path));
      expect(createHash('sha256').update(content).digest('hex')).toBe(expectedDigest);
    },
  );

  it.each(fixtures.context_cases)('validates v1.1 context fixture $name', ({ valid, value }) => {
    const validate = compile('docs/contracts/memory-maintainer-context-v1.1.schema.json');
    expect(validate(value), JSON.stringify(validate.errors)).toBe(valid);
  });

  it.each(fixtures.output_cases)('validates v1.1 output fixture $name', ({ valid, value }) => {
    const validate = compile('docs/contracts/memory-maintainer-output-v1.1.schema.json');
    expect(validate(value), JSON.stringify(validate.errors)).toBe(valid);
  });

  it.each(fixtures.semantic_cases)('validates v1.1 semantic fixture $name', (fixture) => {
    const context = fixtures.context_cases.find(({ name }) => name === fixture.context_case);
    const output = fixtures.output_cases.find(({ name }) => name === fixture.output_case);
    expect(context).toBeDefined();
    expect(output).toBeDefined();
    const result = validateMemoryMaintainerV11SemanticPair(context?.value, output?.value);
    expect(result.valid, result.errors.join(',')).toBe(fixture.valid);
  });

  it.each(['NEW', 'BRANCH', 'RELATED'] as const)(
    'rejects %s with disputed semantic status',
    (kind) => {
      const context = fixtures.context_cases.find(
        ({ name }) => name === 'valid_zero_revision_and_independent_statuses',
      );
      const source = fixtures.output_cases.find(
        ({ name }) => name === 'valid_disputed_existing_update',
      );
      expect(context).toBeDefined();
      expect(source).toBeDefined();
      const output = structuredClone(source?.value) as {
        operations: Record<string, unknown>[];
      };
      const operation = output.operations[0];
      expect(operation).toBeDefined();
      if (operation === undefined) throw new Error('DISPUTED_OPERATION_FIXTURE_REQUIRED');
      operation.kind = kind;
      operation.target_resolution_id = null;
      operation.expected_resolution_revision = null;

      const result = validateMemoryMaintainerV11SemanticPair(context?.value, output);
      expect(result.valid, result.errors.join(',')).toBe(false);
      expect(result.errors).toContain('MEMORY_DISPUTED_REQUIRES_EXISTING_TARGET_OPERATION');
    },
  );

  it.each(fixtures.disputed_target_cases)('validates disputed target fixture $name', (fixture) => {
    const context = fixtures.context_cases.find(
      ({ name }) => name === 'valid_zero_revision_and_independent_statuses',
    );
    const source = fixtures.output_cases.find(
      ({ name }) => name === 'valid_disputed_existing_update',
    );
    expect(context).toBeDefined();
    expect(source).toBeDefined();
    const output = structuredClone(source?.value) as {
      operations: {
        target_resolution_id: string;
        expected_resolution_revision: number;
        proposed_state: { claims: Record<string, unknown>[] };
      }[];
    };
    const operation = output.operations[0];
    expect(operation).toBeDefined();
    if (operation === undefined) throw new Error('DISPUTED_OPERATION_FIXTURE_REQUIRED');
    operation.target_resolution_id = fixture.target_resolution_id;
    operation.expected_resolution_revision = fixture.expected_resolution_revision;
    if (fixture.duplicate_second_claim_identity) {
      const firstClaim = operation.proposed_state.claims[0];
      const secondClaim = operation.proposed_state.claims[1];
      expect(firstClaim).toBeDefined();
      expect(secondClaim).toBeDefined();
      if (firstClaim === undefined || secondClaim === undefined) {
        throw new Error('TWO_DISPUTED_CLAIM_FIXTURES_REQUIRED');
      }
      secondClaim.claim_id = firstClaim.claim_id;
    }

    const result = validateMemoryMaintainerV11SemanticPair(context?.value, output);
    expect(result.valid, result.errors.join(',')).toBe(fixture.valid);
    expect(result.errors).toContain(fixture.expected_error);
  });

  it.each(fixtures.revision_cases)('validates exact revision fixture $name', (fixture) => {
    const result = validateMemoryMaintainerRevisionParity(fixture.value);
    expect(result.valid, result.errors.join(',')).toBe(fixture.valid);
  });

  it.each(fixtures.dedupe_cases)('validates retry/dedupe fixture $name', (fixture) => {
    const result = validateMemoryMaintainerJobDedupe(fixture.jobs);
    expect(result.valid, result.errors.join(',')).toBe(fixture.valid);
  });

  it.each(fixtures.consumption_cases)(
    'validates transcript-owned consumption fixture $name',
    (fixture) => {
      const result = validateWorkingConsumptions(fixture.consumptions);
      expect(result.valid, result.errors.join(',')).toBe(fixture.valid);
      expect(
        isTranscriptSegmentPendingForMaintainer(
          fixture.transcript_segment_id,
          fixture.consumptions,
        ),
      ).toBe(fixture.pending);
    },
  );

  it.each(fixtures.cutover_cases)('validates producer cutover fixture $name', (fixture) => {
    const result = validateMemoryProducerCutover(fixture.value);
    expect(result.valid, result.errors.join(',')).toBe(fixture.valid);
  });
});

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
