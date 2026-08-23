import { createHash } from 'node:crypto';

export const P4_CONTEXT_SCHEMA_VERSION = 'interview-director-context-v2' as const;
export const P4_CONTEXT_CONTRACT_VERSION = 'p4-context-freeze-v1' as const;
export const P4_MEMBERSHIP_SCHEMA_VERSION = 'p4-membership-freeze-v2' as const;
export const P4_FREEZE_SCHEMA_VERSION = 'p4-context-freeze-v1' as const;

export const P4_REQUIRED_SECTIONS = [
  'interview_state',
  'working_memory',
  'active_memory',
  'resumed_memory',
  'recent_transcript',
  'memory_candidates',
  'boundaries',
  'actual_asked',
  'displayed',
  'question_bank',
  'current_presentation',
] as const;

export type P4Section = (typeof P4_REQUIRED_SECTIONS)[number];
export type P4Digest = string;
export type P4Uuid = string;

export interface P4EvidenceReference {
  segment_id: P4Uuid;
  text_revision: number;
  speaker_role_revision: number;
  effective_text_digest: P4Digest;
  order: number;
}

export interface P4WorkingMemoryItem {
  id: P4Uuid;
  canonical_key: string;
  memory_type: string;
  value: unknown;
  value_kind: 'exact' | 'range' | 'unknown';
  layer: 'working';
  status: 'current' | 'uncertain' | 'disputed';
  revision: number;
  thread_id: P4Uuid;
  evidence: readonly P4EvidenceReference[];
}

export interface P4ThreadMemoryItem {
  memory_id: P4Uuid;
  resolution_authority_id: P4Uuid;
  revision_id: P4Uuid;
  revision_no: number;
  source_level: 'mid' | 'long';
  semantic_kind: 'episode' | 'fact';
  semantic_status: 'current' | 'uncertain' | 'disputed';
  safe_content: string;
  membership_digest: P4Digest;
  input_order: number;
}

export interface P4TranscriptSegment {
  segment_id: P4Uuid;
  session_id: P4Uuid;
  start_ms: number;
  text: string;
  trusted_role: 'elder' | 'interviewer';
  content_kind: 'conversation_final';
  text_revision: number;
  speaker_role_revision: number;
  effective_text_digest: P4Digest;
}

export interface P4MemoryCandidate {
  memory_id: P4Uuid;
  resolution_authority_id: P4Uuid;
  revision_id: P4Uuid;
  revision_no?: number;
  source_level: 'mid' | 'long';
  semantic_kind: 'episode' | 'fact';
  semantic_status: 'current' | 'uncertain' | 'disputed';
  safe_content: string;
  retrieval_sources: readonly ('embedding' | 'graph')[];
  embedding_score: number | null;
  graph_distance: number | null;
  rank: number;
}

export interface P4Boundary {
  id: P4Uuid;
  code: string;
  abstract_scope: string;
  status: 'active';
  revision: number;
  content_policy: 'control-only-no-source-text';
}

export interface P4ActualQuestion {
  actual_question_id: P4Uuid;
  text: string;
  source: 'interviewer_spontaneous' | 'matched_system_suggestion';
  evidence_segment_ids: readonly P4Uuid[];
}

export interface P4DisplayedQuestion {
  snapshot_id: P4Uuid;
  text: string;
  display_sequence: number;
  outcome: 'actual_asked' | 'explicitly_replaced' | 'not_observed' | 'unjudged';
  actual_question_id: P4Uuid | null;
}

export interface P4QuestionBankReference {
  question_bank_item_id: P4Uuid;
  bank: 'basic' | 'deep';
  topic: string;
  question_text: string;
  purpose: string;
  sensitivity: 'low' | 'medium' | 'high';
  bank_version: string;
}

export interface P4Presentation {
  snapshot_id: P4Uuid;
  text: string;
  display_sequence: number;
}

export interface P4ThreadMemoryInput {
  state: 'active' | 'resumed' | 'empty';
  thread_id: P4Uuid | null;
  thread_revision: number | null;
  source_session_id: P4Uuid | null;
  items: readonly P4AssemblyMember<P4ThreadMemoryItem>[];
}

export interface P4AssemblyMember<T> {
  value: T;
  source_membership_digest: P4Digest;
  input_order: number;
}

export interface P4BudgetInput {
  config_ref: string;
  policy_version: string;
}

export interface P4AssemblyInput {
  project_id: P4Uuid;
  current_session_id: P4Uuid;
  interview_state: P4InterviewState;
  working_memory: readonly P4AssemblyMember<P4WorkingMemoryItem>[];
  active_memory: P4ThreadMemoryInput;
  resumed_memory: P4ThreadMemoryInput;
  recent_transcript: readonly P4AssemblyMember<P4TranscriptSegment>[];
  memory_candidates: readonly P4AssemblyMember<P4MemoryCandidate>[];
  boundaries: readonly P4AssemblyMember<P4Boundary>[];
  actual_asked: readonly P4AssemblyMember<P4ActualQuestion>[];
  displayed: readonly P4AssemblyMember<P4DisplayedQuestion>[];
  question_bank: readonly P4AssemblyMember<P4QuestionBankReference>[];
  current_presentation: P4AssemblyMember<P4Presentation> | null;
  budget: P4BudgetInput;
  policy_revision: string;
}

export interface P4InterviewState {
  journey_stage: 'rapport' | 'life_outline' | 'story_depth';
  journey_reason_codes: readonly string[];
  goal: string;
}

export interface P4ContextV2 {
  context_schema_version: typeof P4_CONTEXT_SCHEMA_VERSION;
  contract_version: typeof P4_CONTEXT_CONTRACT_VERSION;
  project_id: P4Uuid;
  current_session_id: P4Uuid;
  interview_state: P4InterviewState;
  working_memory: {
    source: 'p1-working-direct';
    items: readonly P4WorkingMemoryItem[];
  };
  active_memory: P4ThreadMemorySection;
  resumed_memory: P4ThreadMemorySection;
  recent_transcript: readonly P4TranscriptSegment[];
  memory_candidates: readonly P4MemoryCandidate[];
  boundaries: readonly P4Boundary[];
  actual_asked: readonly P4ActualQuestion[];
  displayed: readonly P4DisplayedQuestion[];
  question_bank: readonly P4QuestionBankReference[];
  current_presentation: P4Presentation | null;
  budget: P4BudgetInput;
  v1_compatibility: {
    mode: 'projection-only';
    schema_id: 'interview-director-context-v1';
    projection_fields: readonly [
      'current_presentation',
      'interview_state',
      'recent_transcript',
      'actual_asked',
      'recently_displayed',
      'bank_references',
      'boundaries',
    ];
  };
  freeze: P4FreezeMetadata;
  membership: P4MembershipFreeze;
  membership_digest: P4Digest;
  context_digest: P4Digest;
}

export interface P4ThreadMemorySection {
  state: 'active' | 'resumed' | 'empty';
  thread_id: P4Uuid | null;
  thread_revision: number | null;
  source_session_id: P4Uuid | null;
  items: readonly P4ThreadMemoryItem[];
}

export interface P4FreezeMetadata {
  freeze_schema_version: typeof P4_FREEZE_SCHEMA_VERSION;
  source_contracts: {
    p3_retrieval: 'memory-p3-retrieval-v1';
    v1_context: 'interview-director-context-v1';
    p4_context: typeof P4_CONTEXT_CONTRACT_VERSION;
  };
  scope: {
    project_id: P4Uuid;
    current_session_id: P4Uuid;
    active_thread_id: P4Uuid | null;
    resumed_thread_id: P4Uuid | null;
  };
  required_sections: readonly P4Section[];
  deterministic_ordering: {
    algorithm: 'p4-canonical-order-v1';
    tie_breakers: readonly ['input_order', 'source_id_lexicographic', 'revision_ascending'];
  };
  budget_config_ref: string;
  policy_revision: string;
}

export interface P4MembershipEntry {
  section: P4Section;
  source_type: string;
  source_id: string;
  source_revision: number | null;
  content_digest: P4Digest;
  membership_digest: P4Digest;
  input_order: number;
}

export interface P4SectionMembership {
  section: P4Section;
  source_bearing: true;
  expected_member_count: number;
  entries: readonly P4MembershipEntry[];
}

export interface P4MembershipFreeze {
  membership_schema_version: typeof P4_MEMBERSHIP_SCHEMA_VERSION;
  scope: {
    project_id: P4Uuid;
    current_session_id: P4Uuid;
  };
  sections: readonly P4SectionMembership[];
}

export class P4ContextAssemblyError extends Error {
  public constructor(
    public readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = 'P4ContextAssemblyError';
  }
}

const SOURCE_TYPES: Record<P4Section, string> = {
  interview_state: 'interview_state',
  working_memory: 'working_memory',
  active_memory: 'memory_thread',
  resumed_memory: 'memory_thread',
  recent_transcript: 'transcript_segment',
  memory_candidates: 'memory_candidate',
  boundaries: 'boundary_control',
  actual_asked: 'actual_question',
  displayed: 'display_snapshot',
  question_bank: 'question_bank_item',
  current_presentation: 'presentation',
};

export function assembleP4ContextV2(input: P4AssemblyInput): P4ContextV2 {
  assertNonEmpty(input.project_id, 'P4_SCOPE_PROJECT_REQUIRED');
  assertNonEmpty(input.current_session_id, 'P4_SCOPE_SESSION_REQUIRED');
  assertNonEmpty(input.budget.config_ref, 'P4_BUDGET_CONFIG_REQUIRED');
  assertNonEmpty(input.budget.policy_version, 'P4_BUDGET_POLICY_REQUIRED');
  if (input.budget.policy_version !== 'p4-priority-budget-v1') fail('P4_BUDGET_POLICY_MISMATCH');
  assertNonEmpty(input.policy_revision, 'P4_POLICY_REVISION_REQUIRED');

  const workingMemory = orderedMembers(input.working_memory, 'working_memory').map(({ value }) =>
    cloneJsonValue(value),
  );
  const activeMemory = buildThreadMemory(input.active_memory, 'active');
  const resumedMemory = buildThreadMemory(input.resumed_memory, 'resumed');
  const recentTranscript = orderedMembers(input.recent_transcript, 'recent_transcript').map(
    ({ value }) => cloneJsonValue(value),
  );
  const memoryCandidates = orderedMembers(input.memory_candidates, 'memory_candidates').map(
    ({ value }) => cloneJsonValue(value),
  );
  const boundaries = orderedMembers(input.boundaries, 'boundaries').map(({ value }) =>
    cloneJsonValue(value),
  );
  const actualAsked = orderedMembers(input.actual_asked, 'actual_asked').map(({ value }) =>
    cloneJsonValue(value),
  );
  const displayed = orderedMembers(input.displayed, 'displayed').map(({ value }) =>
    cloneJsonValue(value),
  );
  const questionBank = orderedMembers(input.question_bank, 'question_bank').map(({ value }) =>
    cloneJsonValue(value),
  );
  const currentPresentation =
    input.current_presentation === null ? null : cloneJsonValue(input.current_presentation.value);

  const freeze: P4FreezeMetadata = {
    freeze_schema_version: P4_FREEZE_SCHEMA_VERSION,
    source_contracts: {
      p3_retrieval: 'memory-p3-retrieval-v1',
      v1_context: 'interview-director-context-v1',
      p4_context: P4_CONTEXT_CONTRACT_VERSION,
    },
    scope: {
      project_id: input.project_id,
      current_session_id: input.current_session_id,
      active_thread_id: activeMemory.thread_id,
      resumed_thread_id: resumedMemory.thread_id,
    },
    required_sections: [...P4_REQUIRED_SECTIONS],
    deterministic_ordering: {
      algorithm: 'p4-canonical-order-v1',
      tie_breakers: ['input_order', 'source_id_lexicographic', 'revision_ascending'],
    },
    budget_config_ref: input.budget.config_ref,
    policy_revision: input.policy_revision,
  };

  const sectionMembers = createSectionMembers(input);
  const membership = {
    membership_schema_version: P4_MEMBERSHIP_SCHEMA_VERSION,
    scope: {
      project_id: input.project_id,
      current_session_id: input.current_session_id,
    },
    sections: P4_REQUIRED_SECTIONS.map((section) =>
      createSectionMembership(section, sectionMembers[section]),
    ),
  } satisfies P4MembershipFreeze;
  const membershipDigest = sha256({
    scope: freeze.scope,
    sections: membership.sections,
  });

  const contextWithoutDigest = {
    context_schema_version: P4_CONTEXT_SCHEMA_VERSION,
    contract_version: P4_CONTEXT_CONTRACT_VERSION,
    project_id: input.project_id,
    current_session_id: input.current_session_id,
    interview_state: cloneJsonValue(input.interview_state),
    working_memory: { source: 'p1-working-direct' as const, items: workingMemory },
    active_memory: activeMemory,
    resumed_memory: resumedMemory,
    recent_transcript: recentTranscript,
    memory_candidates: memoryCandidates,
    boundaries,
    actual_asked: actualAsked,
    displayed,
    question_bank: questionBank,
    current_presentation: currentPresentation,
    budget: cloneJsonValue(input.budget),
    v1_compatibility: {
      mode: 'projection-only' as const,
      schema_id: 'interview-director-context-v1' as const,
      projection_fields: [
        'current_presentation',
        'interview_state',
        'recent_transcript',
        'actual_asked',
        'recently_displayed',
        'bank_references',
        'boundaries',
      ] as const,
    },
    freeze,
    membership,
    membership_digest: membershipDigest,
  };
  const context = {
    ...contextWithoutDigest,
    context_digest: sha256(contextWithoutDigest),
  };

  return deepFreeze(context);
}

export function validateP4ContextV2(context: P4ContextV2): void {
  if (!sameArray(context.freeze.required_sections, P4_REQUIRED_SECTIONS))
    fail('P4_REQUIRED_SECTION_MANIFEST');
  if (
    !sameArray(
      context.membership.sections.map(({ section }) => section),
      P4_REQUIRED_SECTIONS,
    )
  )
    fail('P4_MEMBERSHIP_SECTION_OMITTED');
  if (context.membership.sections.length !== P4_REQUIRED_SECTIONS.length)
    fail('P4_MEMBERSHIP_SECTION_COUNT');
  if (context.membership.scope.project_id !== context.project_id)
    fail('P4_MEMBERSHIP_SCOPE_PROJECT');
  if (context.membership.scope.current_session_id !== context.current_session_id)
    fail('P4_MEMBERSHIP_SCOPE_SESSION');
  if (context.freeze.scope.project_id !== context.project_id) fail('P4_FREEZE_SCOPE_PROJECT');
  if (context.freeze.scope.current_session_id !== context.current_session_id)
    fail('P4_FREEZE_SCOPE_SESSION');

  for (const section of context.membership.sections) {
    if (section.expected_member_count !== section.entries.length)
      fail('P4_MEMBERSHIP_COUNT_MISMATCH');
    const seenIds = new Set<string>();
    for (const entry of section.entries) {
      if (entry.section !== section.section) fail('P4_MEMBERSHIP_SECTION_MISMATCH');
      if (entry.source_type !== SOURCE_TYPES[section.section])
        fail('P4_MEMBERSHIP_SOURCE_TYPE_MISMATCH');
      if (seenIds.has(entry.source_id)) fail('P4_MEMBERSHIP_ENTRY_DUPLICATE');
      seenIds.add(entry.source_id);
      assertDigest(entry.content_digest, 'P4_MEMBERSHIP_CONTENT_DIGEST_INVALID');
      assertDigest(entry.membership_digest, 'P4_MEMBERSHIP_DIGEST_INVALID');
    }
  }

  validateSectionParity(context);

  const expectedMembershipDigest = sha256({
    scope: context.freeze.scope,
    sections: context.membership.sections,
  });
  if (context.membership_digest !== expectedMembershipDigest) fail('P4_MEMBERSHIP_DIGEST_MISMATCH');

  const contextWithoutDigest = { ...context } as Record<string, unknown>;
  delete contextWithoutDigest.context_digest;
  if (context.context_digest !== sha256(contextWithoutDigest)) fail('P4_CONTEXT_DIGEST_MISMATCH');
}

function createSectionMembers(
  input: P4AssemblyInput,
): Record<P4Section, readonly P4AssemblyMember<unknown>[]> {
  return {
    interview_state: [
      {
        value: input.interview_state,
        source_membership_digest: sha256({
          source: 'interview_state',
          project_id: input.project_id,
          current_session_id: input.current_session_id,
        }),
        input_order: 0,
      },
    ],
    working_memory: input.working_memory,
    active_memory: input.active_memory.items,
    resumed_memory: input.resumed_memory.items,
    recent_transcript: input.recent_transcript,
    memory_candidates: input.memory_candidates,
    boundaries: input.boundaries,
    actual_asked: input.actual_asked,
    displayed: input.displayed,
    question_bank: input.question_bank,
    current_presentation: input.current_presentation === null ? [] : [input.current_presentation],
  };
}

function createSectionMembership(
  section: P4Section,
  sourceMembers: readonly P4AssemblyMember<unknown>[],
): P4SectionMembership {
  const members = orderedMembers(sourceMembers, section);
  return {
    section,
    source_bearing: true,
    expected_member_count: members.length,
    entries: members.map(({ value, source_membership_digest, input_order }) => ({
      section,
      source_type: SOURCE_TYPES[section],
      source_id: sourceId(section, value),
      source_revision: sourceRevision(section, value),
      content_digest: sha256(value),
      membership_digest: source_membership_digest,
      input_order,
    })),
  };
}

function orderedMembers<T>(
  members: readonly P4AssemblyMember<T>[],
  section: P4Section,
): readonly P4AssemblyMember<T>[] {
  const prepared = members.map((member) => {
    const sourceIdValue = sourceId(section, member.value);
    const revision = sourceRevision(section, member.value);
    if (!Number.isInteger(member.input_order) || member.input_order < 0)
      fail('P4_INPUT_ORDER_INVALID');
    assertDigest(member.source_membership_digest, 'P4_SOURCE_MEMBERSHIP_DIGEST_INVALID');
    return { member, sourceId: sourceIdValue, revision };
  });
  const seenIds = new Set<string>();
  for (const { sourceId: sourceIdValue } of prepared) {
    if (seenIds.has(sourceIdValue)) fail('P4_SOURCE_ID_DUPLICATE');
    seenIds.add(sourceIdValue);
  }
  return prepared
    .sort(
      (left, right) =>
        left.member.input_order - right.member.input_order ||
        compareLexical(left.sourceId, right.sourceId) ||
        compareRevision(left.revision, right.revision),
    )
    .map(({ member }) => member);
}

function buildThreadMemory(
  input: P4ThreadMemoryInput,
  expectedState: 'active' | 'resumed',
): P4ThreadMemorySection {
  if (input.state !== expectedState && input.state !== 'empty')
    fail(expectedState === 'active' ? 'P4_ACTIVE_STATE_MISMATCH' : 'P4_RESUMED_STATE_MISMATCH');
  if (input.state === 'empty') {
    if (
      input.thread_id !== null ||
      input.thread_revision !== null ||
      input.source_session_id !== null ||
      input.items.length !== 0
    )
      fail('P4_THREAD_SECTION_STATE_PARITY');
    return {
      state: 'empty',
      thread_id: null,
      thread_revision: null,
      source_session_id: null,
      items: [],
    };
  }
  if (
    input.thread_id === null ||
    input.thread_revision === null ||
    input.source_session_id === null
  )
    fail('P4_THREAD_SOURCE_REVISION_REQUIRED');
  if (!Number.isInteger(input.thread_revision) || input.thread_revision < 1)
    fail('P4_THREAD_SOURCE_REVISION_INVALID');
  const items = orderedMembers(
    input.items,
    expectedState === 'active' ? 'active_memory' : 'resumed_memory',
  );
  for (const { value, input_order } of items) {
    if (value.input_order !== input_order) fail('P4_THREAD_INPUT_ORDER_MISMATCH');
  }
  return {
    state: input.state,
    thread_id: input.thread_id,
    thread_revision: input.thread_revision,
    source_session_id: input.source_session_id,
    items: items.map(({ value }) => cloneJsonValue(value)),
  };
}

function validateSectionParity(context: P4ContextV2): void {
  const sectionValues: Record<P4Section, readonly unknown[]> = {
    interview_state: [context.interview_state],
    working_memory: context.working_memory.items,
    active_memory: context.active_memory.items,
    resumed_memory: context.resumed_memory.items,
    recent_transcript: context.recent_transcript,
    memory_candidates: context.memory_candidates,
    boundaries: context.boundaries,
    actual_asked: context.actual_asked,
    displayed: context.displayed,
    question_bank: context.question_bank,
    current_presentation:
      context.current_presentation === null ? [] : [context.current_presentation],
  };
  for (const section of P4_REQUIRED_SECTIONS) {
    const manifest = context.membership.sections.find((candidate) => candidate.section === section);
    if (manifest === undefined) fail('P4_MEMBERSHIP_SECTION_OMITTED');
    const values = sectionValues[section];
    if (manifest.expected_member_count !== values.length) fail('P4_MEMBERSHIP_COUNT_MISMATCH');
    const entries = manifest.entries;
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      const entry = entries[index];
      if (entry === undefined) fail('P4_MEMBERSHIP_ENTRY_MISSING');
      if (entry.source_id !== sourceId(section, value)) fail('P4_MEMBERSHIP_SOURCE_ID_MISMATCH');
      if (entry.source_revision !== sourceRevision(section, value))
        fail('P4_MEMBERSHIP_REVISION_MISMATCH');
      if (entry.content_digest !== sha256(value)) fail('P4_MEMBERSHIP_CONTENT_DIGEST_MISMATCH');
    }
  }
}

function sourceId(section: P4Section, value: unknown): string {
  const record = asRecord(value);
  switch (section) {
    case 'interview_state':
      return `state:${String(record.journey_stage)}`;
    case 'working_memory':
      return requiredString(record.id, 'P4_SOURCE_ID_REQUIRED');
    case 'active_memory':
    case 'resumed_memory':
      return requiredString(record.memory_id, 'P4_SOURCE_ID_REQUIRED');
    case 'recent_transcript':
      return requiredString(record.segment_id, 'P4_SOURCE_ID_REQUIRED');
    case 'memory_candidates':
      return requiredString(record.memory_id, 'P4_SOURCE_ID_REQUIRED');
    case 'boundaries':
      return requiredString(record.id, 'P4_SOURCE_ID_REQUIRED');
    case 'actual_asked':
      return requiredString(record.actual_question_id, 'P4_SOURCE_ID_REQUIRED');
    case 'displayed':
    case 'current_presentation':
      return requiredString(record.snapshot_id, 'P4_SOURCE_ID_REQUIRED');
    case 'question_bank':
      return requiredString(record.question_bank_item_id, 'P4_SOURCE_ID_REQUIRED');
  }
}

function sourceRevision(section: P4Section, value: unknown): number | null {
  const record = asRecord(value);
  switch (section) {
    case 'interview_state':
    case 'actual_asked':
    case 'question_bank':
      return null;
    case 'working_memory':
    case 'boundaries':
      return requiredInteger(record.revision, 'P4_SOURCE_REVISION_REQUIRED');
    case 'active_memory':
    case 'resumed_memory':
    case 'memory_candidates':
      return requiredInteger(record.revision_no, 'P4_SOURCE_REVISION_REQUIRED');
    case 'recent_transcript':
      return requiredInteger(record.text_revision, 'P4_SOURCE_REVISION_REQUIRED');
    case 'displayed':
    case 'current_presentation':
      return requiredInteger(record.display_sequence, 'P4_SOURCE_REVISION_REQUIRED');
  }
}

function sha256(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('P4_CANONICAL_NUMBER_INVALID');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort(compareLexical)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  fail('P4_CANONICAL_VALUE_INVALID');
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function assertDigest(value: unknown, code: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail(code);
}

function assertNonEmpty(value: unknown, code: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) fail(code);
}

function requiredString(value: unknown, code: string): string {
  assertNonEmpty(value, code);
  return value;
}

function requiredInteger(value: unknown, code: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) fail(code);
  return value as number;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail('P4_MEMBER_OBJECT_REQUIRED');
  return value as Record<string, unknown>;
}

function compareLexical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRevision(left: number | null, right: number | null): number {
  return (left ?? -1) - (right ?? -1);
}

function sameArray(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function fail(code: string): never {
  throw new P4ContextAssemblyError(code);
}
