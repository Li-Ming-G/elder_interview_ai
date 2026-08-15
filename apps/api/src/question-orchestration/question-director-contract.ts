import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { Injectable } from '@nestjs/common';

import { canonicalJson, sha256 } from '../ai-runtime/ai-provenance.js';
import type { QuestionPurpose } from '../question-evidence/question-presentation.types.js';

export const DIRECTOR_CONTEXT_SCHEMA_VERSION = 'interview-director-context-v1';
export const DIRECTOR_OUTPUT_SCHEMA_VERSION = 'interview-director-output-v1';
export const DIRECTOR_PROMPT_BUNDLE_VERSION = 'interview-director-prompt-v1';
export const DIRECTOR_CONTEXT_BUILDER_VERSION = 'interview-director-context-builder-v1';
export const DIRECTOR_MODEL_CONFIG_VERSION = 'local-test-director-v1';

export function loadInterviewDirectorPromptBundle(bundleVersion: string): {
  system: string;
  task: string;
} {
  if (bundleVersion !== DIRECTOR_PROMPT_BUNDLE_VERSION) {
    throw new Error('AI_PROMPT_BUNDLE_NOT_FORMAL');
  }
  const root = findRepositoryRoot();
  return {
    system: readFileSync(join(root, 'docs/prompts/interview-director/v1/system.md'), 'utf8'),
    task: readFileSync(join(root, 'docs/prompts/interview-director/v1/task.md'), 'utf8'),
  };
}

export interface InterviewDirectorContextV1 {
  context_schema_version: typeof DIRECTOR_CONTEXT_SCHEMA_VERSION;
  current_presentation: { snapshot_id: string; text: string } | null;
  interview_state: {
    journey_stage: 'rapport' | 'life_outline' | 'story_depth';
    journey_reason_codes: string[];
    goal: string;
  };
  recent_transcript: Array<{
    segment_id: string;
    start_ms: number;
    text: string;
    trusted_role: 'elder' | 'interviewer';
  }>;
  current_memories: Array<{
    memory_resolution_id: string;
    memory_type: string;
    value_kind: 'exact' | 'range' | 'unknown';
    value: string;
    authority: string;
  }>;
  actual_asked: Array<{ actual_question_id: string; text: string }>;
  recently_displayed: Array<{ snapshot_id: string; text: string }>;
  bank_references: Array<{
    question_bank_item_id: string;
    bank: 'basic' | 'deep';
    topic: string;
    question_text: string;
    purpose: QuestionPurpose;
    sensitivity: 'low' | 'medium' | 'high';
  }>;
  boundaries: Array<{ code: string; abstract_scope: string }>;
}

export type InterviewDirectorOutputV1 =
  | {
      decision: 'suggest';
      question: string;
      reason: string;
      purpose: QuestionPurpose;
      risk: 'low' | 'medium' | 'high';
      grounding: Array<{ kind: 'segment'; id: string } | { kind: 'memory'; id: string }>;
      declared_bank_references: Array<{
        question_bank_item_id: string;
        usage: 'inspiration' | 'adapted' | 'verbatim';
      }>;
      continue_reason_code: null;
    }
  | {
      decision: 'continue_listening';
      question: null;
      reason: string;
      purpose: null;
      risk: null;
      grounding: [];
      declared_bank_references: [];
      continue_reason_code: 'continuous_narration' | 'insufficient_context' | 'safety_blocked';
    };

@Injectable()
export class QuestionDirectorContract {
  public readonly contextSchemaDigest: string;
  public readonly outputSchemaDigest: string;
  public readonly promptBundleDigest: string;
  public readonly contextBuilderDigest = sha256(DIRECTOR_CONTEXT_BUILDER_VERSION);
  public readonly modelConfigDigest = sha256(DIRECTOR_MODEL_CONFIG_VERSION);
  public readonly prompt: { system: string; task: string };
  private readonly validateContextSchema: ValidateFunction;
  private readonly validateOutputSchema: ValidateFunction;

  public constructor() {
    const root = findRepositoryRoot();
    const contextSchemaText = readFileSync(
      join(root, 'docs/contracts/interview-director-context.schema.json'),
      'utf8',
    );
    const outputSchemaText = readFileSync(
      join(root, 'docs/contracts/interview-director-output.schema.json'),
      'utf8',
    );
    const prompt = loadInterviewDirectorPromptBundle(DIRECTOR_PROMPT_BUNDLE_VERSION);
    const AjvConstructor = Ajv2020 as unknown as new (options: {
      allErrors: boolean;
      strict: boolean;
    }) => {
      addFormat(name: string, format: RegExp): void;
      compile(schema: object): ValidateFunction;
    };
    const ajv = new AjvConstructor({ allErrors: true, strict: false });
    ajv.addFormat(
      'uuid',
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    this.validateContextSchema = ajv.compile(JSON.parse(contextSchemaText) as object);
    this.validateOutputSchema = ajv.compile(JSON.parse(outputSchemaText) as object);
    this.contextSchemaDigest = sha256(contextSchemaText);
    this.outputSchemaDigest = sha256(outputSchemaText);
    this.prompt = prompt;
    this.promptBundleDigest = sha256(canonicalJson(this.prompt));
  }

  public assertContext(value: unknown): asserts value is InterviewDirectorContextV1 {
    if (!this.validateContextSchema(value)) throw new Error('AI_CONTEXT_SCHEMA_INVALID');
  }

  public parseOutput(
    value: unknown,
    context: InterviewDirectorContextV1,
  ): InterviewDirectorOutputV1 {
    if (!this.validateOutputSchema(value)) throw new Error('AI_OUTPUT_SCHEMA_INVALID');
    const output = value as InterviewDirectorOutputV1;
    const segmentIds = new Set(context.recent_transcript.map(({ segment_id }) => segment_id));
    const memoryIds = new Set(
      context.current_memories.map(({ memory_resolution_id }) => memory_resolution_id),
    );
    const bankIds = new Set(
      context.bank_references.map(({ question_bank_item_id }) => question_bank_item_id),
    );
    if (
      output.grounding.some(({ id, kind }) =>
        kind === 'segment' ? !segmentIds.has(id) : !memoryIds.has(id),
      ) ||
      output.declared_bank_references.some(
        ({ question_bank_item_id }) => !bankIds.has(question_bank_item_id),
      )
    ) {
      throw new Error('AI_OUTPUT_REFERENCE_OUTSIDE_CONTEXT');
    }
    return output;
  }
}

function findRepositoryRoot(): string {
  let current = resolve(process.cwd());
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, 'docs/contracts/interview-director-output.schema.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('INTERVIEW_DIRECTOR_ARTIFACTS_NOT_FOUND');
}
