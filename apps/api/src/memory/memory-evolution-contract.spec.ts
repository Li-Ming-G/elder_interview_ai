import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  runtimeAssertionsPending,
  sha256Canonical,
  sha256CanonicalJson,
  validateDecisionTraceV11,
  validateLongConsolidationPair,
  validateMemoryEvolutionPair,
} from './memory-evolution-contract.js';
import { loadDecisionTraceV11Contract } from './decision-trace-v1-1.contract.js';

type Case = {
  name: string;
  valid: boolean;
  path?: string;
  value?: unknown;
  expected_error?: string;
};

describe('Memory Evolution P2-A machine contracts', () => {
  const evolution = readJson('docs/contracts/fixtures/memory-evolution-v1.fixtures.json') as {
    evolution_cases: Array<{ name: string; valid: boolean; context: unknown; output: unknown }>;
    semantic_cases: Array<Case & { base: string }>;
  };
  const baseEvolution = evolution.evolution_cases[0];
  const long = readJson('docs/contracts/fixtures/long-memory-consolidation-v1.fixtures.json') as {
    context: unknown;
    output: unknown;
    semantic_cases: Array<Case>;
  };
  const trace = readJson('docs/contracts/fixtures/decision-trace-v1.1.fixtures.json') as {
    base: unknown;
    cases: Array<Case>;
  };

  it('keeps the canonical empty-array golden digest stable', () => {
    expect(sha256Canonical([])).toBe(
      '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
    );
  });

  it('validates evolution schema and semantic pair', () => {
    expect(baseEvolution.valid).toBe(true);
    expect(
      compile('docs/contracts/memory-evolution-context-v1.schema.json')(baseEvolution.context),
    ).toBe(true);
    expect(
      compile('docs/contracts/memory-evolution-output-v1.schema.json')(baseEvolution.output),
    ).toBe(true);
    expect(validateMemoryEvolutionPair(baseEvolution.context, baseEvolution.output).valid).toBe(
      true,
    );
  });

  it.each(evolution.semantic_cases)('rejects evolution semantic case $name', (fixture) => {
    const context = structuredClone(baseEvolution.context);
    const output = structuredClone(baseEvolution.output);
    if (fixture.path === undefined) throw new Error('EVOLUTION_FIXTURE_PATH_REQUIRED');
    const target = fixture.path.startsWith('context.') ? context : output;
    setPath(target, fixture.path.replace(/^(context|output)\./, ''), fixture.value);
    const result = validateMemoryEvolutionPair(context, output);
    expect(result.valid).toBe(fixture.valid);
    if (fixture.expected_error) expect(result.errors).toContain(fixture.expected_error);
  });

  it('validates Long reference-only schema and pair', () => {
    expect(
      compile('docs/contracts/long-memory-consolidation-context-v1.schema.json')(long.context),
    ).toBe(true);
    expect(
      compile('docs/contracts/long-memory-consolidation-output-v1.schema.json')(long.output),
    ).toBe(true);
    expect(validateLongConsolidationPair(long.context, long.output).valid).toBe(true);
  });

  it('allows explicit cross-session Long input while retaining one completion session', () => {
    const context = structuredClone(long.context) as {
      source_session_ids: string[];
      mid_manifest: { revision_manifest_hash: string; revisions: Array<Record<string, unknown>> };
    };
    const output = structuredClone(long.output) as {
      long_job: { source_mid_manifest_hash: string };
    };
    const sourceSessionId = '99999999-9999-4999-8999-999999999999';
    context.source_session_ids = [sourceSessionId];
    context.mid_manifest.revisions[0].source_session_id = sourceSessionId;
    const row = context.mid_manifest.revisions[0];
    const manifest = sha256CanonicalJson([
      [
        row.layer_revision_id,
        row.layer_identity_id,
        row.resolution_id,
        row.resolution_revision,
        row.semantic_status,
        row.boundary_status,
        row.membership_digest,
        row.input_order,
        row.source_job_id,
        row.source_session_id,
      ],
    ]);
    context.mid_manifest.revision_manifest_hash = manifest;
    output.long_job.source_mid_manifest_hash = manifest;
    expect(validateLongConsolidationPair(context, output).valid).toBe(true);
  });

  it('schema-gates terminal references', () => {
    const evolutionContext = structuredClone(baseEvolution.context) as {
      checkpoint: { source_p1_final_status: string; source_p1_final_job_id: string | null };
    };
    evolutionContext.checkpoint.source_p1_final_status = 'succeeded';
    evolutionContext.checkpoint.source_p1_final_job_id = null;
    expect(
      compile('docs/contracts/memory-evolution-context-v1.schema.json')(evolutionContext),
    ).toBe(false);
    const longOutput = structuredClone(long.output) as {
      long_job: { terminal_status: string };
    };
    longOutput.long_job.terminal_status = 'failed';
    expect(
      compile('docs/contracts/long-memory-consolidation-output-v1.schema.json')(longOutput),
    ).toBe(false);
  });

  it.each(long.semantic_cases)('rejects Long semantic case $name', (fixture) => {
    const context = structuredClone(long.context);
    const output = structuredClone(long.output);
    if (fixture.path === undefined) throw new Error('LONG_FIXTURE_PATH_REQUIRED');
    const target = fixture.path.startsWith('context.') ? context : output;
    setPath(target, fixture.path.replace(/^(context|output)\./, ''), fixture.value);
    const result = validateLongConsolidationPair(context, output);
    expect(result.valid).toBe(fixture.valid);
    expect(result.errors).toContain(fixture.expected_error);
  });

  it('validates trace v1.1 and rejects non-reference roots', () => {
    expect(compile('docs/contracts/decision-trace-v1.1.schema.json')(trace.base)).toBe(true);
    expect(validateDecisionTraceV11(trace.base).valid).toBe(true);
  });

  it('loads trace v1.1 with raw schema digest and strict formats', () => {
    const loader = loadDecisionTraceV11Contract(
      join(findRoot(), 'docs/contracts/decision-trace-v1.1.schema.json'),
    );
    expect(loader.loaded_version).toBe('decision-trace-v1.1');
    expect(loader.schema_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(loader.validate(trace.base).valid).toBe(true);
    const invalid = structuredClone(trace.base) as Record<string, unknown>;
    (invalid.roots as Record<string, unknown>).source_working_snapshot = {
      ...((invalid.roots as Record<string, unknown>).source_working_snapshot as Record<
        string,
        unknown
      >),
      snapshot_id: 'not-a-uuid',
    };
    expect(loader.validate(invalid).valid).toBe(false);
    const invalidDate = structuredClone(trace.base) as Record<string, unknown>;
    const invalidRoots = invalidDate.roots as Record<string, unknown>;
    const invalidCheckpoint = invalidRoots.checkpoint as Record<string, unknown>;
    invalidCheckpoint.completed_at = '2026-02-30T00:00:00.000Z';
    expect(loader.validate(invalidDate).valid).toBe(false);
  });

  it.each(trace.cases)('checks trace case $name', (fixture) => {
    const value = structuredClone(trace.base);
    if (fixture.path) setPath(value, fixture.path, fixture.value);
    const result = validateDecisionTraceV11(value);
    expect(result.valid).toBe(fixture.valid);
    if (fixture.expected_error) expect(result.errors).toContain(fixture.expected_error);
  });

  it('marks concurrency/replay/late/transaction assertions pending runtime', () => {
    expect(runtimeAssertionsPending()).toEqual({
      valid: true,
      errors: [],
      verification: 'pending_runtime',
    });
  });
});

function compile(path: string): (value: unknown) => boolean {
  const ajv = new (
    Ajv2020 as unknown as new (options: object) => {
      addFormat(name: string, format: RegExp): void;
      compile(schema: object): (value: unknown) => boolean;
    }
  )({ allErrors: true, strict: true, validateFormats: true });
  ajv.addFormat(
    'uuid',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  return ajv.compile(readJson(path) as object);
}
function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(findRoot(), path), 'utf8'));
}
function findRoot(): string {
  return process.cwd().endsWith('apps/api') ? join(process.cwd(), '..', '..') : process.cwd();
}
function setPath(value: unknown, path: string, replacement: unknown): void {
  const parts = path.split('.');
  let cursor = value as Record<string, unknown>;
  for (let index = 0; index < parts.length - 1; index += 1)
    cursor = cursor[parts[index]] as Record<string, unknown>;
  cursor[parts[parts.length - 1]] = replacement;
}
