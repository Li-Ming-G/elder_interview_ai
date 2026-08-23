import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';

type FixtureCase = { name: string; message: Record<string, unknown>; expected_error?: string };
type FixtureDocument = { valid: FixtureCase[]; invalid: FixtureCase[] };

const root = join(process.cwd(), '..', '..');

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(root, path), 'utf8')) as unknown;
}

function compileSchema(schema: object): (value: unknown) => boolean {
  const AjvConstructor = Ajv2020 as unknown as new (options: object) => {
    compile: (schema: object) => (value: unknown) => boolean;
  };
  return new AjvConstructor({ allErrors: true, strict: false, validateFormats: false }).compile(
    schema,
  );
}

describe('P5 Evidence Drill-down V1 contract', () => {
  it('accepts valid envelopes and rejects malformed/second-round fixtures', async () => {
    const schema = (await readJson('docs/contracts/evidence-drilldown-v1.schema.json')) as object;
    const fixtures = (await readJson(
      'docs/contracts/fixtures/evidence-drilldown-v1/fixtures.json',
    )) as FixtureDocument;
    const validate = compileSchema(schema);

    for (const fixture of fixtures.valid) {
      expect(validate(fixture.message), fixture.name).toBe(true);
    }
    for (const fixture of fixtures.invalid) {
      expect(validate(fixture.message), fixture.name).toBe(false);
    }
  });

  it('keeps diagnostics safe and fixes every message to one evidence round', async () => {
    const fixtures = (await readJson(
      'docs/contracts/fixtures/evidence-drilldown-v1/fixtures.json',
    )) as FixtureDocument;

    for (const fixture of fixtures.valid) {
      const message = fixture.message;
      const round = message.round as Record<string, unknown>;
      expect(round.evidence_round, fixture.name).toBe(1);
      expect(round.max_evidence_rounds, fixture.name).toBe(1);
      if (message.message_type === 'error') {
        expect((message.error as Record<string, unknown>).generation_outcome, fixture.name).toBe(
          'SYSTEM_ERROR',
        );
      }
      const diagnostics = message.diagnostics as Record<string, unknown> | undefined;
      if (diagnostics) {
        expect(Object.keys(diagnostics).sort(), fixture.name).toEqual([
          'duration_ms',
          'error_code',
          'reference_count',
          'result_count',
          'stage',
        ]);
      }
    }
  });
});
