import { createHash } from 'node:crypto';

import {
  QUESTION_BANK_HEADERS,
  QUESTION_BANK_VALIDATOR_VERSION,
  QUESTION_CONDITION_CODES,
  QUESTION_PURPOSES,
  type QuestionBankEnvironment,
  type QuestionBankHeader,
  type QuestionBankScope,
  type QuestionBankValidationError,
  type QuestionBankValidationResult,
  type QuestionConditionCode,
  type QuestionLicenseStatus,
  type QuestionSourceType,
  type ValidatedQuestionBankRow,
} from './question-bank.types.js';

interface CsvRow {
  fields: readonly string[];
  row: number;
}

const knownConditions = new Set<string>(QUESTION_CONDITION_CODES);
const knownPurposes = new Set<string>(QUESTION_PURPOSES);
const knownBanks = new Set(['basic', 'deep']);
const knownSensitivities = new Set(['low', 'medium', 'high']);
const knownSources = new Set([
  'project_original',
  'licensed_external',
  'public_domain',
  'synthetic_fixture',
]);
const knownLicenses = new Set(['project_original', 'verified', 'unverified', 'fixture_only']);

export function validateQuestionBankCsv(
  bytes: Uint8Array,
  environment: QuestionBankEnvironment,
): QuestionBankValidationResult {
  const sourceFileDigest = sha256(bytes);
  const emptySummary = {
    bankVersion: null,
    contentDigest: null,
    environmentScope: null,
    rowCount: 0,
    sourceFileDigest,
    validatorVersion: QUESTION_BANK_VALIDATOR_VERSION,
  } as const;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return failure([{ code: 'QUESTION_BANK_ENCODING_INVALID', row: 1 }], emptySummary);
  }

  let csvRows: readonly CsvRow[];
  try {
    csvRows = parseCsv(text);
  } catch (error: unknown) {
    const row = error instanceof CsvSyntaxError ? error.row : 1;
    return failure([{ code: 'QUESTION_BANK_CSV_MALFORMED', row }], emptySummary);
  }
  if (csvRows.length === 0 || !headerMatches(csvRows[0]?.fields ?? [])) {
    return failure([{ code: 'QUESTION_BANK_HEADER_INVALID', row: 1 }], emptySummary);
  }

  const dataRows = csvRows.slice(1);
  const errors: QuestionBankValidationError[] = [];
  const rows: ValidatedQuestionBankRow[] = [];
  const questionIds = new Set<string>();
  const bankVersions = new Set<string>();

  for (const csvRow of dataRows) {
    if (csvRow.fields.length !== QUESTION_BANK_HEADERS.length) {
      errors.push({ code: 'QUESTION_BANK_ROW_COLUMN_COUNT', row: csvRow.row });
      continue;
    }
    const fields = Object.fromEntries(
      QUESTION_BANK_HEADERS.map((header, index) => [header, csvRow.fields[index]?.trim() ?? '']),
    ) as Record<QuestionBankHeader, string>;
    const rowErrors: QuestionBankValidationError[] = [];
    const required = (
      column: QuestionBankHeader,
      code: QuestionBankValidationError['code'] = 'QUESTION_BANK_FIELD_REQUIRED',
    ): string => {
      const value = fields[column];
      if (value.length === 0) rowErrors.push({ code, column, row: csvRow.row });
      return value;
    };

    const questionId = required('question_id');
    const bank = required('bank');
    const topic = required('topic');
    const questionText = required('question_text');
    const purpose = required('purpose', 'QUESTION_BANK_PURPOSE_REQUIRED');
    const sensitivity = required('sensitivity');
    const sourceType = required('source_type');
    const sourceReference = required('source_reference', 'QUESTION_BANK_SOURCE_REFERENCE_REQUIRED');
    const licenseStatus = required('license_status');
    const licenseReference = required(
      'license_reference',
      'QUESTION_BANK_LICENSE_REFERENCE_REQUIRED',
    );
    const bankVersion = required('bank_version');
    const enabled = required('enabled');

    if (bankVersion.length > 0) bankVersions.add(bankVersion);

    if (questionId.length > 0 && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(questionId)) {
      rowErrors.push({
        code: 'QUESTION_BANK_FIELD_INVALID',
        column: 'question_id',
        row: csvRow.row,
      });
    } else if (questionIds.has(questionId)) {
      rowErrors.push({
        code: 'QUESTION_BANK_QUESTION_ID_DUPLICATE',
        column: 'question_id',
        row: csvRow.row,
      });
    }
    if (questionId.length > 0) questionIds.add(questionId);
    if (bank.length > 0 && !knownBanks.has(bank)) {
      rowErrors.push({ code: 'QUESTION_BANK_ENUM_UNKNOWN', column: 'bank', row: csvRow.row });
    }
    if (topic.length > 120 || questionText.length > 2_000 || bankVersion.length > 80) {
      rowErrors.push({ code: 'QUESTION_BANK_FIELD_INVALID', row: csvRow.row });
    }
    if (purpose.length > 0 && !knownPurposes.has(purpose)) {
      rowErrors.push({
        code: 'QUESTION_BANK_PURPOSE_UNKNOWN',
        column: 'purpose',
        row: csvRow.row,
      });
    }
    if (sensitivity.length > 0 && !knownSensitivities.has(sensitivity)) {
      rowErrors.push({
        code: 'QUESTION_BANK_ENUM_UNKNOWN',
        column: 'sensitivity',
        row: csvRow.row,
      });
    }
    if (sourceType.length > 0 && !knownSources.has(sourceType)) {
      rowErrors.push({
        code: 'QUESTION_BANK_ENUM_UNKNOWN',
        column: 'source_type',
        row: csvRow.row,
      });
    }
    if (licenseStatus.length > 0 && !knownLicenses.has(licenseStatus)) {
      rowErrors.push({
        code: 'QUESTION_BANK_ENUM_UNKNOWN',
        column: 'license_status',
        row: csvRow.row,
      });
    }
    if (enabled.length > 0 && !['true', 'false'].includes(enabled)) {
      rowErrors.push({
        code: 'QUESTION_BANK_ENABLED_INVALID',
        column: 'enabled',
        row: csvRow.row,
      });
    }
    if (sourceReference.length > 500 || licenseReference.length > 500) {
      rowErrors.push({ code: 'QUESTION_BANK_FIELD_INVALID', row: csvRow.row });
    }

    const applicable = parseConditions(fields.applicable_when, 'applicable_when', csvRow.row);
    const inapplicable = parseConditions(fields.inapplicable_when, 'inapplicable_when', csvRow.row);
    rowErrors.push(...applicable.errors, ...inapplicable.errors);
    if (applicable.values.some((condition) => inapplicable.values.includes(condition))) {
      rowErrors.push({ code: 'QUESTION_BANK_CONDITION_CONTRADICTORY', row: csvRow.row });
    }
    if (
      knownSources.has(sourceType) &&
      knownLicenses.has(licenseStatus) &&
      !licenseCombinationAllowed(
        sourceType as QuestionSourceType,
        licenseStatus as QuestionLicenseStatus,
      )
    ) {
      rowErrors.push({ code: 'QUESTION_BANK_LICENSE_COMBINATION_INVALID', row: csvRow.row });
    }

    errors.push(...rowErrors);
    if (rowErrors.length === 0) {
      rows.push({
        applicableConditionCodes: applicable.values,
        bank: bank as ValidatedQuestionBankRow['bank'],
        bankVersion,
        enabled: enabled === 'true',
        inapplicableConditionCodes: inapplicable.values,
        licenseReference,
        licenseStatus: licenseStatus as QuestionLicenseStatus,
        purpose: purpose as ValidatedQuestionBankRow['purpose'],
        questionId,
        questionText,
        sensitivity: sensitivity as ValidatedQuestionBankRow['sensitivity'],
        sourceReference,
        sourceType: sourceType as QuestionSourceType,
        topic,
      });
    }
  }

  if (dataRows.length === 0) {
    errors.push({ code: 'QUESTION_BANK_FIELD_REQUIRED', row: 2 });
  }
  if (bankVersions.size > 1) {
    errors.push({ code: 'QUESTION_BANK_BANK_VERSION_MIXED', column: 'bank_version', row: 1 });
  }
  const banks = new Set(rows.map(({ bank }) => bank));
  if (rows.length > 0 && (!banks.has('basic') || !banks.has('deep'))) {
    errors.push({ code: 'QUESTION_BANK_BOTH_BANKS_REQUIRED', column: 'bank', row: 1 });
  }
  const fixtureCount = rows.filter(({ sourceType }) => sourceType === 'synthetic_fixture').length;
  if (fixtureCount > 0 && fixtureCount !== rows.length) {
    errors.push({ code: 'QUESTION_BANK_FIXTURE_SCOPE_MIXED', row: 1 });
  }
  const environmentScope = inferScope(rows, environment, errors);
  const bankVersion = bankVersions.size === 1 ? ([...bankVersions][0] ?? null) : null;

  const summary = {
    bankVersion,
    contentDigest: null,
    environmentScope,
    rowCount: dataRows.length,
    sourceFileDigest,
    validatorVersion: QUESTION_BANK_VALIDATOR_VERSION,
  } as const;
  if (errors.length > 0 || bankVersion === null || environmentScope === null) {
    return failure(stableErrors(errors), summary);
  }
  const contentDigest = questionBankContentDigest(bankVersion, rows);
  return {
    errors: [],
    ok: true,
    rows,
    summary: { ...summary, bankVersion, contentDigest, environmentScope },
  };
}

export function questionBankContentDigest(
  bankVersion: string,
  rows: readonly ValidatedQuestionBankRow[],
): string {
  const values = [
    QUESTION_BANK_VALIDATOR_VERSION,
    bankVersion,
    String(rows.length),
    ...[...rows]
      .sort((left, right) => compareCodePoints(left.questionId, right.questionId))
      .flatMap((row) => [
        row.questionId,
        row.bank,
        row.topic,
        row.questionText,
        row.purpose,
        row.applicableConditionCodes.join(';'),
        row.inapplicableConditionCodes.join(';'),
        row.sensitivity,
        row.sourceType,
        row.sourceReference,
        row.licenseStatus,
        row.licenseReference,
        row.enabled ? 'true' : 'false',
      ]),
  ];
  return sha256(new TextEncoder().encode(values.map(lengthPrefix).join('')));
}

function lengthPrefix(value: string): string {
  return `${String(new TextEncoder().encode(value).byteLength)}:${value}`;
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseConditions(
  raw: string,
  column: 'applicable_when' | 'inapplicable_when',
  row: number,
): { errors: readonly QuestionBankValidationError[]; values: readonly QuestionConditionCode[] } {
  if (raw.length === 0) return { errors: [], values: [] };
  const errors: QuestionBankValidationError[] = [];
  const values: QuestionConditionCode[] = [];
  const seen = new Set<string>();
  for (const tokenValue of raw.split(';')) {
    const token = tokenValue.trim();
    if (token.length === 0) {
      errors.push({ code: 'QUESTION_BANK_CONDITION_EMPTY_TOKEN', column, row });
    } else if (!knownConditions.has(token)) {
      errors.push({ code: 'QUESTION_BANK_CONDITION_UNKNOWN', column, row });
    } else if (seen.has(token)) {
      errors.push({ code: 'QUESTION_BANK_CONDITION_DUPLICATE', column, row });
    } else {
      seen.add(token);
      values.push(token as QuestionConditionCode);
    }
  }
  return { errors, values: values.sort() };
}

function licenseCombinationAllowed(
  sourceType: QuestionSourceType,
  licenseStatus: QuestionLicenseStatus,
): boolean {
  if (sourceType === 'project_original') return licenseStatus === 'project_original';
  if (sourceType === 'synthetic_fixture') return licenseStatus === 'fixture_only';
  return licenseStatus === 'verified' || licenseStatus === 'unverified';
}

function inferScope(
  rows: readonly ValidatedQuestionBankRow[],
  environment: QuestionBankEnvironment,
  errors: QuestionBankValidationError[],
): QuestionBankScope | null {
  if (rows.length === 0) return null;
  const fixture = rows.every(({ sourceType }) => sourceType === 'synthetic_fixture');
  if (fixture && ['formal_internal', 'production'].includes(environment)) {
    errors.push({ code: 'QUESTION_BANK_FIXTURE_ENVIRONMENT_BLOCKED', row: 1 });
    return null;
  }
  return fixture ? 'internal_demo' : 'product';
}

function headerMatches(fields: readonly string[]): boolean {
  return (
    fields.length === QUESTION_BANK_HEADERS.length &&
    fields.every((field, index) => field.trim() === QUESTION_BANK_HEADERS[index])
  );
}

function stableErrors(
  errors: readonly QuestionBankValidationError[],
): readonly QuestionBankValidationError[] {
  return [...errors].sort(
    (left, right) =>
      left.row - right.row ||
      (left.column ?? '').localeCompare(right.column ?? '') ||
      left.code.localeCompare(right.code),
  );
}

function failure(
  errors: readonly QuestionBankValidationError[],
  summary: QuestionBankValidationResult['summary'],
): QuestionBankValidationResult {
  return { errors, ok: false, summary };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

class CsvSyntaxError extends Error {
  public constructor(public readonly row: number) {
    super('Malformed CSV');
  }
}

function parseCsv(text: string): readonly CsvRow[] {
  if (text.length === 0) return [];
  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false;
  let physicalRow = 1;
  let recordRow = 1;

  const pushRecord = (): void => {
    fields.push(field);
    rows.push({ fields, row: recordRow });
    fields = [];
    field = '';
    recordRow = physicalRow + 1;
    afterQuote = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? '';
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else if (character === '\r' || character === '\n') {
        if (character === '\r' && text[index + 1] === '\n') index += 1;
        field += '\n';
        physicalRow += 1;
      } else {
        field += character;
      }
      continue;
    }
    if (afterQuote && ![',', '\r', '\n'].includes(character)) {
      throw new CsvSyntaxError(physicalRow);
    }
    if (character === '"') {
      if (field.length !== 0) throw new CsvSyntaxError(physicalRow);
      inQuotes = true;
    } else if (character === ',') {
      fields.push(field);
      field = '';
      afterQuote = false;
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      pushRecord();
      physicalRow += 1;
      recordRow = physicalRow;
    } else {
      field += character;
    }
  }
  if (inQuotes) throw new CsvSyntaxError(recordRow);
  if (field.length > 0 || fields.length > 0 || (!text.endsWith('\n') && !text.endsWith('\r'))) {
    fields.push(field);
    rows.push({ fields, row: recordRow });
  }
  return rows;
}
