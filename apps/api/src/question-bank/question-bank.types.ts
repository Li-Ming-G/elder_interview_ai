export const QUESTION_BANK_HEADERS = [
  'question_id',
  'bank',
  'topic',
  'question_text',
  'purpose',
  'applicable_when',
  'inapplicable_when',
  'sensitivity',
  'source_type',
  'source_reference',
  'license_status',
  'license_reference',
  'bank_version',
  'enabled',
] as const;

export const QUESTION_BANK_VALIDATOR_VERSION = 'question-bank-validator-v1';
export const QUESTION_CONDITION_VERSION = 'question_condition_v1';

export const QUESTION_PURPOSES = [
  'detail',
  'cause',
  'person',
  'scene',
  'emotion',
  'choice',
  'conflict',
  'turning_point',
  'clarify',
  'timeline',
  'transition',
] as const;

export const QUESTION_CONDITION_CODES = [
  'stage.rapport',
  'stage.life_outline',
  'stage.story_depth',
  'context.person',
  'context.event',
  'context.choice',
  'context.turning_point',
  'context.emotion',
  'context.unfinished_story',
  'response.low_detail',
  'response.concrete',
  'response.reluctant',
  'topic.exhausted',
] as const;

export const JOURNEY_STAGES = ['rapport', 'life_outline', 'story_depth'] as const;
export const QUESTION_BANK_ENVIRONMENTS = [
  'local',
  'test',
  'internal_demo',
  'formal_internal',
  'production',
] as const;

export type QuestionBankHeader = (typeof QUESTION_BANK_HEADERS)[number];
export type QuestionPurpose = (typeof QUESTION_PURPOSES)[number];
export type QuestionConditionCode = (typeof QUESTION_CONDITION_CODES)[number];
export type JourneyStage = (typeof JOURNEY_STAGES)[number];
export type QuestionBankEnvironment = (typeof QUESTION_BANK_ENVIRONMENTS)[number];
export type QuestionBankScope = 'product' | 'internal_demo';
export type QuestionBankKind = 'basic' | 'deep';
export type QuestionSensitivity = 'low' | 'medium' | 'high';
export type QuestionSourceType =
  'project_original' | 'licensed_external' | 'public_domain' | 'synthetic_fixture';
export type QuestionLicenseStatus = 'project_original' | 'verified' | 'unverified' | 'fixture_only';

export type QuestionBankErrorCode =
  | 'QUESTION_BANK_ACTIVE_RELEASE_UNAVAILABLE'
  | 'QUESTION_BANK_BANK_VERSION_MIXED'
  | 'QUESTION_BANK_BOTH_BANKS_REQUIRED'
  | 'QUESTION_BANK_CONDITION_CONTRADICTORY'
  | 'QUESTION_BANK_CONDITION_DUPLICATE'
  | 'QUESTION_BANK_CONDITION_EMPTY_TOKEN'
  | 'QUESTION_BANK_CONDITION_UNKNOWN'
  | 'QUESTION_BANK_CSV_MALFORMED'
  | 'QUESTION_BANK_ENABLED_INVALID'
  | 'QUESTION_BANK_ENCODING_INVALID'
  | 'QUESTION_BANK_ENUM_UNKNOWN'
  | 'QUESTION_BANK_FIELD_INVALID'
  | 'QUESTION_BANK_FIELD_REQUIRED'
  | 'QUESTION_BANK_FIXTURE_ENVIRONMENT_BLOCKED'
  | 'QUESTION_BANK_FIXTURE_SCOPE_MIXED'
  | 'QUESTION_BANK_HEADER_INVALID'
  | 'QUESTION_BANK_LICENSE_COMBINATION_INVALID'
  | 'QUESTION_BANK_LICENSE_REFERENCE_REQUIRED'
  | 'QUESTION_BANK_POLICY_BLOCKED'
  | 'QUESTION_BANK_POLICY_UNAVAILABLE'
  | 'QUESTION_BANK_PURPOSE_REQUIRED'
  | 'QUESTION_BANK_PURPOSE_UNKNOWN'
  | 'QUESTION_BANK_QUESTION_ID_DUPLICATE'
  | 'QUESTION_BANK_RELEASE_INVALID_STATE'
  | 'QUESTION_BANK_RELEASE_NOT_FOUND'
  | 'QUESTION_BANK_REQUEST_ID_REUSED'
  | 'QUESTION_BANK_ROW_COLUMN_COUNT'
  | 'QUESTION_BANK_SOURCE_REFERENCE_REQUIRED'
  | 'QUESTION_BANK_VERSION_EXISTS';

export interface QuestionBankValidationError {
  code: QuestionBankErrorCode;
  column?: QuestionBankHeader;
  row: number;
}

export interface ValidatedQuestionBankRow {
  applicableConditionCodes: readonly QuestionConditionCode[];
  bank: QuestionBankKind;
  bankVersion: string;
  enabled: boolean;
  inapplicableConditionCodes: readonly QuestionConditionCode[];
  licenseReference: string;
  licenseStatus: QuestionLicenseStatus;
  purpose: QuestionPurpose;
  questionId: string;
  questionText: string;
  sensitivity: QuestionSensitivity;
  sourceReference: string;
  sourceType: QuestionSourceType;
  topic: string;
}

export interface QuestionBankValidationSummary {
  bankVersion: string | null;
  contentDigest: string | null;
  environmentScope: QuestionBankScope | null;
  rowCount: number;
  sourceFileDigest: string;
  validatorVersion: typeof QUESTION_BANK_VALIDATOR_VERSION;
}

export type QuestionBankValidationResult =
  | {
      errors: readonly QuestionBankValidationError[];
      ok: false;
      summary: QuestionBankValidationSummary;
    }
  | {
      errors: readonly [];
      ok: true;
      rows: readonly ValidatedQuestionBankRow[];
      summary: QuestionBankValidationSummary & {
        bankVersion: string;
        contentDigest: string;
        environmentScope: QuestionBankScope;
      };
    };

export class QuestionBankError extends Error {
  public readonly code: QuestionBankErrorCode;
  public readonly errors: readonly QuestionBankValidationError[];

  public constructor(
    code: QuestionBankErrorCode,
    errors: readonly QuestionBankValidationError[] = [],
  ) {
    super(code);
    this.name = 'QuestionBankError';
    this.code = code;
    this.errors = errors;
  }
}

export interface EligibleQuestionBankItem {
  applicableConditionCodes: readonly QuestionConditionCode[];
  bank: QuestionBankKind;
  bankVersion: string;
  inapplicableConditionCodes: readonly QuestionConditionCode[];
  itemId: string;
  licenseStatus: 'project_original' | 'verified' | 'fixture_only';
  purpose: QuestionPurpose;
  questionId: string;
  questionText: string;
  sensitivity: QuestionSensitivity;
  sourceType: QuestionSourceType;
  topic: string;
}

export interface QuestionBankPolicyContext {
  environmentScope: QuestionBankScope;
  policyDecision: 'allowed' | 'blocked' | 'unavailable';
}
