import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

interface FixtureFile {
  cases: Array<{ expected_valid: boolean; instance: unknown; name: string }>;
}

describe('formal local-audio-archive-v1 fixtures', () => {
  it('mechanically accepts every positive case and rejects every contradictory case', async () => {
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const [schemaText, fixtureText] = await Promise.all([
      readFile(`${root}docs/contracts/local-audio-archive-v1.schema.json`, 'utf8'),
      readFile(`${root}docs/contracts/fixtures/local-audio-archive-v1.fixtures.json`, 'utf8'),
    ]);
    const AjvConstructor = Ajv2020 as unknown as new (options: {
      allErrors: boolean;
      strict: boolean;
      validateFormats: boolean;
    }) => { compile: (schema: unknown) => (instance: unknown) => boolean };
    const validate = new AjvConstructor({
      allErrors: true,
      strict: false,
      validateFormats: false,
    }).compile(JSON.parse(schemaText) as unknown);
    const fixtures = JSON.parse(fixtureText) as FixtureFile;

    for (const fixture of fixtures.cases) {
      expect(validate(fixture.instance), fixture.name).toBe(fixture.expected_valid);
    }
    expect(fixtures.cases.some((fixture) => fixture.expected_valid)).toBe(true);
    expect(fixtures.cases.some((fixture) => !fixture.expected_valid)).toBe(true);
  });
});
