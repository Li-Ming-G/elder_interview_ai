import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

import {
  validateDecisionTraceV11,
  type ContractValidationResult,
} from './memory-evolution-contract.js';

export const DECISION_TRACE_V11_VERSION = 'decision-trace-v1.1' as const;
export const DECISION_TRACE_V11_SCHEMA_PATH =
  'docs/contracts/decision-trace-v1.1.schema.json' as const;

export interface DecisionTraceV11Contract {
  loaded_version: typeof DECISION_TRACE_V11_VERSION;
  schema_sha256: string;
  validate(value: unknown): ContractValidationResult;
}

export function loadDecisionTraceV11Contract(
  schemaPath: string = DECISION_TRACE_V11_SCHEMA_PATH,
  expectedSchemaSha256?: string,
): DecisionTraceV11Contract {
  const bytes = readFileSync(schemaPath);
  const schemaSha256 = createHash('sha256').update(bytes).digest('hex');
  if (expectedSchemaSha256 !== undefined && schemaSha256 !== expectedSchemaSha256) {
    throw new Error('DECISION_TRACE_V11_SCHEMA_DIGEST_MISMATCH');
  }
  const schema = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  if (schema.$id === undefined || schema.title === undefined)
    throw new Error('DECISION_TRACE_V11_SCHEMA_METADATA_REQUIRED');
  const AjvConstructor = Ajv2020 as unknown as new (options: object) => {
    addFormat(name: string, format: RegExp): void;
    compile(schema: object): (value: unknown) => boolean;
  };
  const ajv = new AjvConstructor({
    allErrors: true,
    strict: true,
    validateFormats: true,
    allowUnionTypes: false,
  });
  ajv.addFormat(
    'uuid',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/);
  const validateSchema = ajv.compile(schema);
  return {
    loaded_version: DECISION_TRACE_V11_VERSION,
    schema_sha256: schemaSha256,
    validate(value: unknown): ContractValidationResult {
      if (!validateSchema(value))
        return { valid: false, errors: ['TRACE_SCHEMA_INVALID'], verification: 'contract' };
      return validateDecisionTraceV11(value);
    },
  };
}
