import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')) as unknown;
}

describe('decision-trace-v1 proposal contract', () => {
  const schema = readJson('docs/contracts/decision-trace-v1.schema.json');
  const fixtures = readJson('docs/contracts/fixtures/decision-trace-v1.fixtures.json') as {
    valid: unknown[];
    invalid: unknown[];
  };
  const validate = new (Ajv2020 as unknown as new (options: object) => { compile: (value: object) => (input: unknown) => boolean })({
    allErrors: true,
    strict: false,
  }).compile(schema as object);

  it('accepts bounded decision outcomes, including no-Director decisions', () => {
    for (const fixture of fixtures.valid) expect(validate(fixture)).toBe(true);
  });

  it('rejects raw context or other undeclared payload fields', () => {
    for (const fixture of fixtures.invalid) expect(validate(fixture)).toBe(false);
  });
});
