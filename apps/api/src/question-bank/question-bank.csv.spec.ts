import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validateQuestionBankCsv } from './question-bank.csv.js';
import { QUESTION_BANK_HEADERS } from './question-bank.types.js';

const fixturePath = fileURLToPath(
  new URL(
    '../../../../docs/question-bank/question-bank-internal-demo.fixture.csv',
    import.meta.url,
  ),
);
const fixture = readFileSync(fixturePath);

function csv(rows: readonly (readonly string[])[]): Uint8Array {
  return new TextEncoder().encode(
    [QUESTION_BANK_HEADERS, ...rows]
      .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(','))
      .join('\n'),
  );
}

function row(
  overrides: Partial<Record<(typeof QUESTION_BANK_HEADERS)[number], string>> = {},
): string[] {
  const values: Record<(typeof QUESTION_BANK_HEADERS)[number], string> = {
    applicable_when: '',
    bank: 'basic',
    bank_version: 'unit-v1',
    enabled: 'true',
    inapplicable_when: '',
    license_reference: 'Project repository',
    license_status: 'project_original',
    purpose: 'detail',
    question_id: 'basic-1',
    question_text: 'Synthetic unit question?',
    sensitivity: 'low',
    source_reference: 'DEV-007A unit test',
    source_type: 'project_original',
    topic: 'synthetic',
    ...overrides,
  };
  return QUESTION_BANK_HEADERS.map((header) => values[header]);
}

function validProduct(
  overrides: Partial<Record<(typeof QUESTION_BANK_HEADERS)[number], string>> = {},
): Uint8Array {
  return csv([row(overrides), row({ bank: 'deep', question_id: 'deep-1', ...overrides })]);
}

describe('question bank strict CSV validator', () => {
  it('accepts the 14-column UTF-8 synthetic fixture only in demo-capable environments', () => {
    const result = validateQuestionBankCsv(fixture, 'test');
    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({
      bankVersion: 'fixture-2026.08.1',
      environmentScope: 'internal_demo',
      rowCount: 3,
    });
    for (const environment of ['formal_internal', 'production'] as const) {
      const blocked = validateQuestionBankCsv(fixture, environment);
      expect(blocked.ok).toBe(false);
      expect(blocked.errors.map(({ code }) => code)).toContain(
        'QUESTION_BANK_FIXTURE_ENVIRONMENT_BLOCKED',
      );
    }
  });

  it('rejects non-UTF-8 bytes and any header drift', () => {
    expect(validateQuestionBankCsv(Uint8Array.from([0xff]), 'test').errors).toEqual([
      { code: 'QUESTION_BANK_ENCODING_INVALID', row: 1 },
    ]);
    const wrongHeader = new TextEncoder().encode(
      `${QUESTION_BANK_HEADERS.slice(0, -1).join(',')}\n`,
    );
    expect(validateQuestionBankCsv(wrongHeader, 'test').errors).toEqual([
      { code: 'QUESTION_BANK_HEADER_INVALID', row: 1 },
    ]);
  });

  it('supports RFC-style quoted commas, newlines, and escaped quotes', () => {
    const result = validateQuestionBankCsv(
      validProduct({ question_text: 'A comma, a line\nand a "quote"?' }),
      'test',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows[0]?.questionText).toBe('A comma, a line\nand a "quote"?');
  });

  it.each([
    [
      'unknown condition',
      { applicable_when: 'context.unknown' },
      'QUESTION_BANK_CONDITION_UNKNOWN',
    ],
    ['empty token', { applicable_when: 'context.person;' }, 'QUESTION_BANK_CONDITION_EMPTY_TOKEN'],
    [
      'duplicate token',
      { applicable_when: 'context.person;context.person' },
      'QUESTION_BANK_CONDITION_DUPLICATE',
    ],
    [
      'cross-field contradiction',
      { applicable_when: 'context.person', inapplicable_when: 'context.person' },
      'QUESTION_BANK_CONDITION_CONTRADICTORY',
    ],
    ['unknown purpose', { purpose: 'free_form' }, 'QUESTION_BANK_PURPOSE_UNKNOWN'],
    ['missing purpose', { purpose: '' }, 'QUESTION_BANK_PURPOSE_REQUIRED'],
    [
      'bad license pair',
      { license_status: 'verified' },
      'QUESTION_BANK_LICENSE_COMBINATION_INVALID',
    ],
    ['unknown enum', { sensitivity: 'critical' }, 'QUESTION_BANK_ENUM_UNKNOWN'],
    ['bad enabled', { enabled: 'yes' }, 'QUESTION_BANK_ENABLED_INVALID'],
  ])('rejects %s with a stable row-level code', (_label, overrides, code) => {
    const result = validateQuestionBankCsv(validProduct(overrides), 'test');
    expect(result.ok).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(code);
    expect(result.errors.every(({ row: errorRow }) => Number.isInteger(errorRow))).toBe(true);
  });

  it('rejects duplicate IDs and mixed bank versions even when another row is invalid', () => {
    const duplicate = validateQuestionBankCsv(
      csv([
        row({ purpose: 'free_form', question_id: 'same' }),
        row({ bank: 'deep', question_id: 'same' }),
      ]),
      'test',
    );
    expect(duplicate.errors.map(({ code }) => code)).toContain(
      'QUESTION_BANK_QUESTION_ID_DUPLICATE',
    );
    const mixed = validateQuestionBankCsv(
      csv([row(), row({ bank: 'deep', bank_version: 'unit-v2', question_id: 'deep-1' })]),
      'test',
    );
    expect(mixed.errors.map(({ code }) => code)).toContain('QUESTION_BANK_BANK_VERSION_MIXED');
  });

  it('uses canonical content and raw-file digests for distinct purposes', () => {
    const withLf = validProduct();
    const withCrlf = new TextEncoder().encode(
      new TextDecoder().decode(withLf).replaceAll('\n', '\r\n'),
    );
    const left = validateQuestionBankCsv(withLf, 'test');
    const right = validateQuestionBankCsv(withCrlf, 'test');
    expect(left.ok && right.ok).toBe(true);
    expect(left.summary.contentDigest).toBe(right.summary.contentDigest);
    expect(left.summary.sourceFileDigest).not.toBe(right.summary.sourceFileDigest);
  });
});
