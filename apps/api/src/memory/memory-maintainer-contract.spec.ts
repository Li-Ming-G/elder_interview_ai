import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

interface FixtureCase {
  name: string;
  valid: boolean;
  value: unknown;
}

interface Fixtures {
  context_cases: FixtureCase[];
  output_cases: FixtureCase[];
}

describe('Memory Maintainer V1 machine contracts', () => {
  const fixtures = readJson(
    'docs/contracts/fixtures/memory-maintainer-v1.fixtures.json',
  ) as Fixtures;

  it.each(fixtures.context_cases)('validates context fixture $name', ({ valid, value }) => {
    const validate = compile('docs/contracts/memory-maintainer-context-v1.schema.json');
    expect(validate(value), JSON.stringify(validate.errors)).toBe(valid);
  });

  it.each(fixtures.output_cases)('validates output fixture $name', ({ valid, value }) => {
    const validate = compile('docs/contracts/memory-maintainer-output-v1.schema.json');
    expect(validate(value), JSON.stringify(validate.errors)).toBe(valid);
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
