import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { Injectable } from '@nestjs/common';

import { canonicalJson, sha256 } from '../ai-runtime/ai-provenance.js';
import type { QuestionPurpose } from '../question-evidence/question-presentation.types.js';

export const DIRECTOR_CONTEXT_SCHEMA_VERSION = 'interview-director-context-v1';
export const DIRECTOR_OUTPUT_SCHEMA_VERSION = 'interview-director-output-v1';
export const DIRECTOR_PROMPT_BUNDLE_VERSION = 'interview-director-prompt-v1';
export const CHECKPOINT_A_DIRECTOR_PROMPT_BUNDLE_VERSION =
  'interview-director-prompt-checkpoint-a-v1';
export const DIRECTOR_CONTEXT_BUILDER_VERSION = 'interview-director-context-builder-v1';
export const DIRECTOR_MODEL_CONFIG_VERSION = 'local-test-director-v1';
export const CHECKPOINT_A_DIRECTOR_MODEL_CONFIG_VERSION = 'checkpoint-a-configured-director-v2';

export type DirectorPromptBundleSelection = 'v1' | 'checkpoint_a';

export interface DirectorPromptBundle {
  readonly version: string;
  readonly status: 'formal';
  readonly system: string;
  readonly task: string;
  readonly digest: string;
}

export interface QuestionDirectorContractOptions {
  readonly promptBundle?: DirectorPromptBundleSelection;
  readonly repositoryRoot?: string;
  readonly modelConfig?: {
    readonly allowFallback?: boolean;
    readonly apiProfile?: string;
    readonly endpoint?: string;
    readonly mode?: 'generic' | 'checkpoint_a';
    readonly model?: string;
    readonly provider?: string;
    readonly requireParameters?: boolean;
    readonly responseFormat?: string;
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
  public readonly promptBundleVersion: string;
  public readonly contextSchemaDigest: string;
  public readonly outputSchemaDigest: string;
  public readonly promptBundleDigest: string;
  public readonly contextBuilderDigest = sha256(DIRECTOR_CONTEXT_BUILDER_VERSION);
  public readonly modelConfigVersion: string;
  public readonly modelConfigDigest: string;
  public readonly prompt: { system: string; task: string };
  private readonly validateContextSchema: ValidateFunction;
  private readonly validateOutputSchema: ValidateFunction;

  public constructor(options: QuestionDirectorContractOptions = {}) {
    const root = options.repositoryRoot ?? findRepositoryRoot();
    const contextSchemaText = readFileSync(
      join(root, 'docs/contracts/interview-director-context.schema.json'),
      'utf8',
    );
    const outputSchemaText = readFileSync(
      join(root, 'docs/contracts/interview-director-output.schema.json'),
      'utf8',
    );
    const bundle = loadDirectorPromptBundle(root, options.promptBundle ?? 'v1');
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
    this.prompt = { system: bundle.system, task: bundle.task };
    this.promptBundleVersion = bundle.version;
    this.promptBundleDigest = bundle.digest;
    const modelConfig = resolveModelConfig(options);
    this.modelConfigVersion = modelConfig.version;
    this.modelConfigDigest = modelConfig.digest;
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

const CHECKPOINT_A_PROMPT_BUNDLE_DIGEST =
  'ad94e07bb8e0ce43f0046cc0b7f103831bd134ca8c80e5e499cb068e2decd673';
const CHECKPOINT_A_OWNER_PROMPT_DIGEST =
  'd43e44d2400bec4e6d96b632b8d0071406dff9a037dec9b54e01172cff534b3b';
const CHECKPOINT_A_PROMPT_BUNDLE_MANIFEST =
  'docs/prompts/interview-director/checkpoint-a-v1/manifest.json';
export function loadDirectorPromptBundle(root: string, selection: unknown): DirectorPromptBundle {
  if (selection === 'v1') {
    const system = readPromptFile(root, 'docs/prompts/interview-director/v1/system.md');
    const task = readPromptFile(root, 'docs/prompts/interview-director/v1/task.md');
    return {
      digest: sha256(canonicalJson({ system, task })),
      status: 'formal',
      system,
      task,
      version: DIRECTOR_PROMPT_BUNDLE_VERSION,
    };
  }
  if (selection !== 'checkpoint_a') throw new Error('INTERVIEW_DIRECTOR_PROMPT_BUNDLE_UNKNOWN');

  const manifestPath = join(root, CHECKPOINT_A_PROMPT_BUNDLE_MANIFEST);
  const manifest = parseCheckpointAManifest(manifestPath);
  const system = readPromptFile(root, 'docs/prompts/interview-director/checkpoint-a-v1/system.md');
  const task = readPromptFile(root, 'docs/prompts/interview-director/checkpoint-a-v1/task.md');
  const owner = readPromptFile(
    root,
    'docs/prompts/interview-director/owner-inputs/Interview_Director_System_v2.md',
  );
  const digest = sha256(canonicalJson({ system, task }));
  if (
    manifest.bundle_version !== CHECKPOINT_A_DIRECTOR_PROMPT_BUNDLE_VERSION ||
    manifest.status !== 'formal' ||
    manifest.system_file !== 'system.md' ||
    manifest.task_file !== 'task.md' ||
    manifest.context_schema_version !== DIRECTOR_CONTEXT_SCHEMA_VERSION ||
    manifest.output_schema_version !== DIRECTOR_OUTPUT_SCHEMA_VERSION ||
    manifest.evidence_contract_version !== 'evidence-drilldown-v1' ||
    manifest.runtime_scope !== 'checkpoint_a_only' ||
    manifest.owner_artifact_sha256 !== CHECKPOINT_A_OWNER_PROMPT_DIGEST ||
    manifest.prompt_bundle_digest !== CHECKPOINT_A_PROMPT_BUNDLE_DIGEST ||
    manifest.prompt_bundle_digest !== digest ||
    sha256(system) !== CHECKPOINT_A_OWNER_PROMPT_DIGEST ||
    sha256(owner) !== CHECKPOINT_A_OWNER_PROMPT_DIGEST ||
    system !== owner
  ) {
    throw new Error('INTERVIEW_DIRECTOR_PROMPT_BUNDLE_IDENTITY_MISMATCH');
  }
  return { digest, status: 'formal', system, task, version: manifest.bundle_version };
}

function readPromptFile(root: string, relativePath: string): string {
  try {
    return readFileSync(join(root, relativePath), 'utf8');
  } catch {
    throw new Error('INTERVIEW_DIRECTOR_PROMPT_BUNDLE_NOT_FOUND');
  }
}

function parseCheckpointAManifest(path: string): {
  bundle_version: string;
  context_schema_version: string;
  evidence_contract_version: string;
  owner_artifact_sha256: string;
  output_schema_version: string;
  prompt_bundle_digest: string;
  runtime_scope: string;
  status: string;
  system_file: string;
  task_file: string;
} {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    throw new Error('INTERVIEW_DIRECTOR_PROMPT_BUNDLE_NOT_FOUND');
  }
  const record = value as Record<string, unknown> | null;
  const ownerArtifact =
    record !== null && typeof record === 'object' && !Array.isArray(record)
      ? (record.owner_artifact as Record<string, unknown> | null)
      : null;
  if (
    record === null ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    typeof record.bundle_version !== 'string' ||
    typeof record.context_schema_version !== 'string' ||
    typeof record.evidence_contract_version !== 'string' ||
    ownerArtifact === null ||
    Array.isArray(ownerArtifact) ||
    typeof ownerArtifact.sha256 !== 'string' ||
    typeof record.prompt_bundle_digest !== 'string' ||
    typeof record.output_schema_version !== 'string' ||
    typeof record.runtime_scope !== 'string' ||
    typeof record.status !== 'string' ||
    typeof record.system_file !== 'string' ||
    typeof record.task_file !== 'string'
  ) {
    throw new Error('INTERVIEW_DIRECTOR_PROMPT_BUNDLE_UNKNOWN');
  }
  return {
    bundle_version: record.bundle_version,
    context_schema_version: record.context_schema_version,
    evidence_contract_version: record.evidence_contract_version,
    owner_artifact_sha256: ownerArtifact.sha256,
    output_schema_version: record.output_schema_version,
    prompt_bundle_digest: record.prompt_bundle_digest,
    runtime_scope: record.runtime_scope,
    status: record.status,
    system_file: record.system_file,
    task_file: record.task_file,
  };
}

function resolveModelConfig(options: QuestionDirectorContractOptions): {
  version: string;
  digest: string;
} {
  if (options.promptBundle !== 'checkpoint_a') {
    return {
      digest: sha256(DIRECTOR_MODEL_CONFIG_VERSION),
      version: DIRECTOR_MODEL_CONFIG_VERSION,
    };
  }
  const supplied = options.modelConfig;
  if (supplied === undefined) {
    return {
      digest: sha256(CHECKPOINT_A_DIRECTOR_MODEL_CONFIG_VERSION),
      version: CHECKPOINT_A_DIRECTOR_MODEL_CONFIG_VERSION,
    };
  }
  if (
    supplied.mode !== 'checkpoint_a' ||
    supplied.provider !== 'configured_api' ||
    !['anthropic_messages', 'openai_chat_completions', 'openrouter_chat_completions'].includes(
      supplied.apiProfile ?? '',
    ) ||
    typeof supplied.endpoint !== 'string' ||
    supplied.endpoint.length === 0 ||
    typeof supplied.model !== 'string' ||
    supplied.model.length === 0 ||
    (supplied.apiProfile === 'anthropic_messages'
      ? supplied.responseFormat !== 'prompt_only_json'
      : supplied.responseFormat !== 'json_object')
  ) {
    throw new Error('CHECKPOINT_A_MODEL_CONFIG_MISMATCH');
  }
  const effectiveConfig = {
    allowFallback: supplied.allowFallback,
    apiProfile: supplied.apiProfile,
    endpoint: supplied.endpoint,
    model: supplied.model,
    provider: supplied.provider,
    requireParameters: supplied.requireParameters,
    responseFormat: supplied.responseFormat,
  };
  return {
    digest: sha256(canonicalJson(effectiveConfig)),
    version: CHECKPOINT_A_DIRECTOR_MODEL_CONFIG_VERSION,
  };
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
