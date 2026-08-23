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

export type P4PriorityClass = 'protected' | 'high' | 'normal' | 'optional';

export interface P4SelectionConfiguration {
  config_ref: string;
  policy_version: string;
  capacity_profile_ref: string;
  entry_cost_profile_ref: string;
  config_digest?: P4Digest;
  capacity_units: number;
  entry_costs: Readonly<Record<string, number>>;
}

export interface P4SelectionReference {
  section: P4Section;
  source_type: string;
  source_id: string;
  source_revision: number | null;
}

export interface P4SelectionPlan {
  plan_schema_version: 'p4-selection-plan-v1';
  status: 'selected';
  policy_version: 'p4-priority-budget-v1';
  membership_digest: P4Digest;
  configuration: {
    config_ref: string;
    capacity_profile_ref: string;
    entry_cost_profile_ref: string;
    config_digest?: P4Digest;
  };
  selected: readonly P4SelectionReference[];
  clipped: readonly P4SelectionReference[];
  fallback: 'no_v1_fallback';
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

const POLICY_SECTION_ORDER = [
  'boundaries',
  'interview_state',
  'recent_transcript',
  'working_memory',
  'active_memory',
  'resumed_memory',
  'memory_candidates',
  'actual_asked',
  'displayed',
  'current_presentation',
  'question_bank',
] as const satisfies readonly P4Section[];

const PRIORITY_CLASSES: Readonly<Record<P4PriorityClass, readonly P4Section[]>> = {
  protected: ['boundaries', 'interview_state'],
  high: ['recent_transcript'],
  normal: ['working_memory', 'active_memory', 'resumed_memory', 'memory_candidates'],
  optional: ['actual_asked', 'displayed', 'current_presentation', 'question_bank'],
};

export function assembleP4ContextV2(input: P4AssemblyInput): P4ContextV2 {
  assertP4AssemblyInputShape(input);
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

  validateP4ContextV2(context);
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
    const seenOrderingKeys = new Set<string>();
    for (const entry of section.entries) {
      if (entry.section !== section.section) fail('P4_MEMBERSHIP_SECTION_MISMATCH');
      if (entry.source_type !== SOURCE_TYPES[section.section])
        fail('P4_MEMBERSHIP_SOURCE_TYPE_MISMATCH');
      const orderingKey = `${String(entry.input_order)}\u0000${entry.source_id}\u0000${String(entry.source_revision)}`;
      if (seenOrderingKeys.has(orderingKey)) fail('P4_ORDERING_KEY_COLLISION');
      seenOrderingKeys.add(orderingKey);
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

export function selectP4ContextV2(
  context: P4ContextV2,
  configuration: P4SelectionConfiguration,
): P4SelectionPlan {
  validateP4ContextV2(context);
  assertSelectionConfiguration(configuration);
  if (
    configuration.config_ref !== context.budget.config_ref ||
    configuration.policy_version !== context.budget.policy_version ||
    configuration.policy_version !== 'p4-priority-budget-v1'
  )
    fail('P4_CONFIGURATION_MISMATCH');

  const orderedEntries = policyEntries(context);
  const costs = orderedEntries.map((entry) => selectionCost(entry, configuration));
  const protectedCost = costs
    .filter(({ priorityClass }) => priorityClass === 'protected')
    .reduce((total, { cost }) => total + cost, 0);
  if (protectedCost > configuration.capacity_units) fail('P4_PROTECTED_OVERFLOW');

  let remaining = configuration.capacity_units;
  const selected: P4SelectionReference[] = [];
  const clipped: P4SelectionReference[] = [];
  for (const priorityClass of ['protected', 'high', 'normal', 'optional'] as const) {
    let classClipped = false;
    for (const candidate of costs.filter(
      ({ priorityClass: candidateClass }) => candidateClass === priorityClass,
    )) {
      if (priorityClass === 'protected') {
        selected.push(candidate.reference);
        remaining -= candidate.cost;
        continue;
      }
      if (classClipped || candidate.cost > remaining) {
        classClipped = true;
        clipped.push(candidate.reference);
        continue;
      }
      selected.push(candidate.reference);
      remaining -= candidate.cost;
    }
  }

  const plan: P4SelectionPlan = {
    plan_schema_version: 'p4-selection-plan-v1',
    status: 'selected',
    policy_version: 'p4-priority-budget-v1',
    membership_digest: context.membership_digest,
    configuration: {
      config_ref: configuration.config_ref,
      capacity_profile_ref: configuration.capacity_profile_ref,
      entry_cost_profile_ref: configuration.entry_cost_profile_ref,
      ...(configuration.config_digest === undefined
        ? {}
        : { config_digest: configuration.config_digest }),
    },
    selected,
    clipped,
    fallback: 'no_v1_fallback',
  };
  validateP4SelectionPlan(context, plan);
  return deepFreeze(plan);
}

export function validateP4SelectionPlan(context: P4ContextV2, plan: P4SelectionPlan): void {
  validateP4ContextV2(context);
  assertSelectionPlanShape(plan);
  if (plan.membership_digest !== context.membership_digest)
    fail('P4_SELECTION_MEMBERSHIP_MISMATCH');
  if (plan.configuration.config_ref !== context.budget.config_ref)
    fail('P4_CONFIGURATION_MISMATCH');

  const expected = policyEntries(context).map(({ reference }) => reference);
  const expectedProtected = policyEntries(context)
    .filter(({ priorityClass }) => priorityClass === 'protected')
    .map(({ reference }) => reference);
  const selected = [...plan.selected];
  const clipped = [...plan.clipped];
  if (
    !sameReferenceSet(
      selected.filter((reference) => isProtectedSection(reference.section)),
      expectedProtected,
    )
  )
    fail('P4_PARTIAL_PROTECTED_SELECTION');
  if (clipped.some((reference) => isProtectedSection(reference.section)))
    fail('P4_PARTIAL_PROTECTED_SELECTION');
  if (!sameReferenceSet([...selected, ...clipped], expected))
    fail('P4_SELECTION_MEMBERSHIP_MISMATCH');
}

function policyEntries(context: P4ContextV2): readonly {
  reference: P4SelectionReference;
  priorityClass: P4PriorityClass;
}[] {
  const entriesBySection = new Map(
    context.membership.sections.map((section) => [section.section, section.entries]),
  );
  const priorityBySection = new Map<P4Section, P4PriorityClass>();
  for (const [priorityClass, sections] of Object.entries(PRIORITY_CLASSES) as [
    P4PriorityClass,
    readonly P4Section[],
  ][]) {
    for (const section of sections) priorityBySection.set(section, priorityClass);
  }
  return POLICY_SECTION_ORDER.flatMap((section) => {
    const priorityClass = priorityBySection.get(section);
    const entries = entriesBySection.get(section);
    if (priorityClass === undefined || entries === undefined) fail('P4_SELECTION_SECTION_MISSING');
    return [...entries]
      .sort(compareMembershipEntries)
      .map((entry) => ({ reference: referenceFromEntry(entry), priorityClass }));
  });
}

function selectionCost(
  candidate: { reference: P4SelectionReference; priorityClass: P4PriorityClass },
  configuration: P4SelectionConfiguration,
): { reference: P4SelectionReference; priorityClass: P4PriorityClass; cost: number } {
  const cost = configuration.entry_costs[candidate.reference.source_id];
  if (cost === undefined) fail('P4_CONFIGURATION_MISMATCH');
  if (!Number.isFinite(cost) || cost < 0) fail('P4_CONFIGURATION_MISMATCH');
  return { ...candidate, cost };
}

function referenceFromEntry(entry: P4MembershipEntry): P4SelectionReference {
  return {
    section: entry.section,
    source_type: entry.source_type,
    source_id: entry.source_id,
    source_revision: entry.source_revision,
  };
}

function isProtectedSection(section: P4Section): boolean {
  return PRIORITY_CLASSES.protected.includes(section);
}

function sameReferenceSet(
  left: readonly P4SelectionReference[],
  right: readonly P4SelectionReference[],
): boolean {
  if (left.length !== right.length) return false;
  const leftKeys = left.map(selectionReferenceKey).sort(compareLexical);
  const rightKeys = right.map(selectionReferenceKey).sort(compareLexical);
  return leftKeys.every((key, index) => key === rightKeys[index]);
}

function selectionReferenceKey(reference: P4SelectionReference): string {
  return `${reference.section}\u0000${reference.source_type}\u0000${reference.source_id}\u0000${String(reference.source_revision)}`;
}

function assertSelectionConfiguration(value: unknown): asserts value is P4SelectionConfiguration {
  const record = asRecord(value);
  assertExactKeys(
    record,
    [
      'config_ref',
      'policy_version',
      'capacity_profile_ref',
      'entry_cost_profile_ref',
      'capacity_units',
      'entry_costs',
    ],
    'P4_CONFIGURATION_SHAPE_INVALID',
    ['config_digest'],
  );
  assertNonEmpty(record.config_ref, 'P4_CONFIGURATION_REQUIRED');
  assertNonEmpty(record.policy_version, 'P4_CONFIGURATION_REQUIRED');
  assertNonEmpty(record.capacity_profile_ref, 'P4_CONFIGURATION_REQUIRED');
  assertNonEmpty(record.entry_cost_profile_ref, 'P4_CONFIGURATION_REQUIRED');
  if (record.config_digest !== undefined)
    assertDigest(record.config_digest, 'P4_CONFIGURATION_DIGEST_INVALID');
  if (!Number.isInteger(record.capacity_units) || (record.capacity_units as number) < 0)
    fail('P4_CONFIGURATION_CAPACITY_INVALID');
  const entryCosts = asRecord(record.entry_costs);
  for (const cost of Object.values(entryCosts)) {
    if (!Number.isFinite(cost) || (cost as number) < 0) fail('P4_CONFIGURATION_COST_INVALID');
  }
}

function assertSelectionPlanShape(value: unknown): asserts value is P4SelectionPlan {
  const record = asRecord(value);
  assertExactKeys(
    record,
    [
      'plan_schema_version',
      'status',
      'policy_version',
      'membership_digest',
      'configuration',
      'selected',
      'clipped',
      'fallback',
    ],
    'P4_SELECTION_PLAN_SHAPE_INVALID',
  );
  if (record.plan_schema_version !== 'p4-selection-plan-v1')
    fail('P4_SELECTION_PLAN_SHAPE_INVALID');
  if (record.status !== 'selected') fail('P4_SELECTION_PLAN_SHAPE_INVALID');
  if (record.policy_version !== 'p4-priority-budget-v1') fail('P4_SELECTION_POLICY_MISMATCH');
  assertDigest(record.membership_digest, 'P4_SELECTION_MEMBERSHIP_INVALID');
  if (record.fallback !== 'no_v1_fallback') fail('P4_SELECTION_FALLBACK_FORBIDDEN');
  const configuration = asRecord(record.configuration);
  assertExactKeys(
    configuration,
    ['config_ref', 'capacity_profile_ref', 'entry_cost_profile_ref'],
    'P4_CONFIGURATION_SHAPE_INVALID',
    ['config_digest'],
  );
  assertNonEmpty(configuration.config_ref, 'P4_CONFIGURATION_REQUIRED');
  assertNonEmpty(configuration.capacity_profile_ref, 'P4_CONFIGURATION_REQUIRED');
  assertNonEmpty(configuration.entry_cost_profile_ref, 'P4_CONFIGURATION_REQUIRED');
  if (configuration.config_digest !== undefined)
    assertDigest(configuration.config_digest, 'P4_CONFIGURATION_DIGEST_INVALID');
  assertSelectionReferences(record.selected);
  assertSelectionReferences(record.clipped);
}

function assertSelectionReferences(
  value: unknown,
): asserts value is readonly P4SelectionReference[] {
  if (!Array.isArray(value)) fail('P4_SELECTION_REFERENCE_SHAPE_INVALID');
  for (const reference of value) {
    const record = asRecord(reference);
    assertExactKeys(
      record,
      ['section', 'source_type', 'source_id', 'source_revision'],
      'P4_SELECTION_REFERENCE_SHAPE_INVALID',
    );
    if (!P4_REQUIRED_SECTIONS.includes(record.section as P4Section))
      fail('P4_SELECTION_REFERENCE_SHAPE_INVALID');
    assertNonEmpty(record.source_type, 'P4_SELECTION_REFERENCE_SHAPE_INVALID');
    assertNonEmpty(record.source_id, 'P4_SELECTION_REFERENCE_SHAPE_INVALID');
    if (
      record.source_revision !== null &&
      (!Number.isInteger(record.source_revision) || (record.source_revision as number) < 0)
    )
      fail('P4_SELECTION_REFERENCE_SHAPE_INVALID');
  }
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

function assertP4AssemblyInputShape(value: unknown): asserts value is P4AssemblyInput {
  const input = asRecord(value);
  assertExactKeys(
    input,
    [
      'project_id',
      'current_session_id',
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
      'budget',
      'policy_revision',
    ],
    'P4_ASSEMBLY_INPUT_SHAPE_INVALID',
  );
  assertUuid(input.project_id, 'P4_SCOPE_PROJECT_INVALID');
  assertUuid(input.current_session_id, 'P4_SCOPE_SESSION_INVALID');
  assertInterviewStateShape(input.interview_state);
  assertMemberArray(input.working_memory, assertWorkingMemoryShape);
  assertThreadMemoryShape(input.active_memory);
  assertThreadMemoryShape(input.resumed_memory);
  assertMemberArray(input.recent_transcript, assertTranscriptShape);
  assertMemberArray(input.memory_candidates, assertCandidateShape);
  assertMemberArray(input.boundaries, assertBoundaryShape);
  assertMemberArray(input.actual_asked, assertActualQuestionShape);
  assertMemberArray(input.displayed, assertDisplayedQuestionShape);
  assertMemberArray(input.question_bank, assertQuestionBankShape);
  if (input.current_presentation !== null)
    assertMemberShape(input.current_presentation, assertPresentationShape);
  assertBudgetShape(input.budget);
  assertNonEmpty(input.policy_revision, 'P4_POLICY_REVISION_REQUIRED');
}

function assertMemberArray(value: unknown, validateValue: (value: unknown) => void): void {
  if (!Array.isArray(value)) fail('P4_ASSEMBLY_SECTION_ARRAY_INVALID');
  for (const member of value) assertMemberShape(member, validateValue);
}

function assertMemberShape<T>(
  value: unknown,
  validateValue: (value: unknown) => asserts value is T,
): asserts value is P4AssemblyMember<T> {
  const member = asRecord(value);
  assertExactKeys(
    member,
    ['value', 'source_membership_digest', 'input_order'],
    'P4_ASSEMBLY_MEMBER_SHAPE_INVALID',
  );
  assertDigest(member.source_membership_digest, 'P4_SOURCE_MEMBERSHIP_DIGEST_INVALID');
  assertNonNegativeInteger(member.input_order, 'P4_INPUT_ORDER_INVALID');
  validateValue(member.value);
}

function assertInterviewStateShape(value: unknown): asserts value is P4InterviewState {
  const state = asRecord(value);
  assertExactKeys(
    state,
    ['journey_stage', 'journey_reason_codes', 'goal'],
    'P4_INTERVIEW_STATE_SHAPE_INVALID',
  );
  assertEnum(
    state.journey_stage,
    ['rapport', 'life_outline', 'story_depth'],
    'P4_INTERVIEW_STATE_INVALID',
  );
  if (!Array.isArray(state.journey_reason_codes) || state.journey_reason_codes.length > 12)
    fail('P4_INTERVIEW_STATE_INVALID');
  const reasonCodes = new Set<string>();
  for (const reasonCode of state.journey_reason_codes) {
    assertNonEmpty(reasonCode, 'P4_INTERVIEW_STATE_INVALID');
    if (reasonCodes.has(reasonCode)) fail('P4_INTERVIEW_STATE_INVALID');
    reasonCodes.add(reasonCode);
  }
  assertStringLength(state.goal, 1, 300, 'P4_INTERVIEW_STATE_INVALID');
}

function assertWorkingMemoryShape(value: unknown): asserts value is P4WorkingMemoryItem {
  const item = asRecord(value);
  assertExactKeys(
    item,
    [
      'id',
      'canonical_key',
      'memory_type',
      'value',
      'value_kind',
      'layer',
      'status',
      'revision',
      'thread_id',
      'evidence',
    ],
    'P4_WORKING_MEMORY_SHAPE_INVALID',
  );
  assertUuid(item.id, 'P4_WORKING_MEMORY_SHAPE_INVALID');
  assertStringLength(item.canonical_key, 1, 240, 'P4_WORKING_MEMORY_SHAPE_INVALID');
  assertNonEmpty(item.memory_type, 'P4_WORKING_MEMORY_SHAPE_INVALID');
  canonicalJson(item.value);
  assertEnum(item.value_kind, ['exact', 'range', 'unknown'], 'P4_WORKING_MEMORY_SHAPE_INVALID');
  if (item.layer !== 'working') fail('P4_WORKING_MEMORY_SHAPE_INVALID');
  assertEnum(item.status, ['current', 'uncertain', 'disputed'], 'P4_WORKING_MEMORY_SHAPE_INVALID');
  assertPositiveInteger(item.revision, 'P4_WORKING_MEMORY_SHAPE_INVALID');
  assertUuid(item.thread_id, 'P4_WORKING_MEMORY_SHAPE_INVALID');
  assertEvidenceArray(item.evidence);
}

function assertThreadMemoryShape(value: unknown): asserts value is P4ThreadMemoryInput {
  const section = asRecord(value);
  assertExactKeys(
    section,
    ['state', 'thread_id', 'thread_revision', 'source_session_id', 'items'],
    'P4_THREAD_SECTION_SHAPE_INVALID',
  );
  assertEnum(section.state, ['active', 'resumed', 'empty'], 'P4_THREAD_SECTION_SHAPE_INVALID');
  assertNullableUuid(section.thread_id, 'P4_THREAD_SECTION_SHAPE_INVALID');
  assertNullablePositiveInteger(section.thread_revision, 'P4_THREAD_SECTION_SHAPE_INVALID');
  assertNullableUuid(section.source_session_id, 'P4_THREAD_SECTION_SHAPE_INVALID');
  assertMemberArray(section.items, assertThreadMemoryItemShape);
  const items = section.items as readonly unknown[];
  if (section.state === 'empty') {
    if (
      section.thread_id !== null ||
      section.thread_revision !== null ||
      section.source_session_id !== null
    )
      fail('P4_THREAD_SECTION_STATE_PARITY');
    if (items.length !== 0) fail('P4_THREAD_SECTION_STATE_PARITY');
  } else if (
    section.thread_id === null ||
    section.thread_revision === null ||
    section.source_session_id === null
  ) {
    fail('P4_THREAD_SOURCE_REVISION_REQUIRED');
  }
}

function assertThreadMemoryItemShape(value: unknown): asserts value is P4ThreadMemoryItem {
  const item = asRecord(value);
  assertExactKeys(
    item,
    [
      'memory_id',
      'resolution_authority_id',
      'revision_id',
      'revision_no',
      'source_level',
      'semantic_kind',
      'semantic_status',
      'safe_content',
      'membership_digest',
      'input_order',
    ],
    'P4_THREAD_MEMORY_SHAPE_INVALID',
  );
  assertUuid(item.memory_id, 'P4_THREAD_MEMORY_SHAPE_INVALID');
  assertUuid(item.resolution_authority_id, 'P4_THREAD_MEMORY_SHAPE_INVALID');
  assertUuid(item.revision_id, 'P4_THREAD_MEMORY_SHAPE_INVALID');
  assertPositiveInteger(item.revision_no, 'P4_THREAD_MEMORY_SHAPE_INVALID');
  assertEnum(item.source_level, ['mid', 'long'], 'P4_THREAD_MEMORY_SHAPE_INVALID');
  assertEnum(item.semantic_kind, ['episode', 'fact'], 'P4_THREAD_MEMORY_SHAPE_INVALID');
  assertEnum(
    item.semantic_status,
    ['current', 'uncertain', 'disputed'],
    'P4_THREAD_MEMORY_SHAPE_INVALID',
  );
  assertNonEmpty(item.safe_content, 'P4_THREAD_MEMORY_SHAPE_INVALID');
  assertDigest(item.membership_digest, 'P4_THREAD_MEMORY_SHAPE_INVALID');
  assertNonNegativeInteger(item.input_order, 'P4_THREAD_MEMORY_SHAPE_INVALID');
}

function assertTranscriptShape(value: unknown): asserts value is P4TranscriptSegment {
  const segment = asRecord(value);
  assertExactKeys(
    segment,
    [
      'segment_id',
      'session_id',
      'start_ms',
      'text',
      'trusted_role',
      'content_kind',
      'text_revision',
      'speaker_role_revision',
      'effective_text_digest',
    ],
    'P4_TRANSCRIPT_SHAPE_INVALID',
  );
  assertUuid(segment.segment_id, 'P4_TRANSCRIPT_SHAPE_INVALID');
  assertUuid(segment.session_id, 'P4_TRANSCRIPT_SHAPE_INVALID');
  assertNonNegativeInteger(segment.start_ms, 'P4_TRANSCRIPT_SHAPE_INVALID');
  assertStringLength(segment.text, 1, 1000, 'P4_TRANSCRIPT_SHAPE_INVALID');
  assertEnum(segment.trusted_role, ['elder', 'interviewer'], 'P4_TRANSCRIPT_SHAPE_INVALID');
  if (segment.content_kind !== 'conversation_final') fail('P4_TRANSCRIPT_SHAPE_INVALID');
  assertNonNegativeInteger(segment.text_revision, 'P4_TRANSCRIPT_SHAPE_INVALID');
  assertNonNegativeInteger(segment.speaker_role_revision, 'P4_TRANSCRIPT_SHAPE_INVALID');
  assertDigest(segment.effective_text_digest, 'P4_TRANSCRIPT_SHAPE_INVALID');
}

function assertCandidateShape(value: unknown): asserts value is P4MemoryCandidate {
  const candidate = asRecord(value);
  assertExactKeys(
    candidate,
    [
      'memory_id',
      'resolution_authority_id',
      'revision_id',
      'source_level',
      'semantic_kind',
      'semantic_status',
      'safe_content',
      'retrieval_sources',
      'embedding_score',
      'graph_distance',
      'rank',
    ],
    'P4_P3_CANDIDATE_CLOSED_SHAPE',
    ['revision_no'],
  );
  assertUuid(candidate.memory_id, 'P4_P3_CANDIDATE_SHAPE_INVALID');
  assertUuid(candidate.resolution_authority_id, 'P4_P3_CANDIDATE_SHAPE_INVALID');
  assertUuid(candidate.revision_id, 'P4_P3_CANDIDATE_SHAPE_INVALID');
  if (candidate.revision_no !== undefined)
    assertPositiveInteger(candidate.revision_no, 'P4_P3_CANDIDATE_SHAPE_INVALID');
  assertEnum(candidate.source_level, ['mid', 'long'], 'P4_P3_CANDIDATE_SHAPE_INVALID');
  assertEnum(candidate.semantic_kind, ['episode', 'fact'], 'P4_P3_CANDIDATE_SHAPE_INVALID');
  assertEnum(
    candidate.semantic_status,
    ['current', 'uncertain', 'disputed'],
    'P4_P3_CANDIDATE_SHAPE_INVALID',
  );
  assertStringLength(candidate.safe_content, 1, 12000, 'P4_P3_CANDIDATE_SHAPE_INVALID');
  assertEnumArray(
    candidate.retrieval_sources,
    ['embedding', 'graph'],
    'P4_P3_CANDIDATE_SHAPE_INVALID',
  );
  assertNullableNumber(candidate.embedding_score, 0, 1, 'P4_P3_CANDIDATE_SHAPE_INVALID');
  assertNullableNumber(
    candidate.graph_distance,
    0,
    Number.MAX_SAFE_INTEGER,
    'P4_P3_CANDIDATE_SHAPE_INVALID',
    true,
  );
  assertNonNegativeInteger(candidate.rank, 'P4_P3_CANDIDATE_SHAPE_INVALID');
}

function assertBoundaryShape(value: unknown): asserts value is P4Boundary {
  const boundary = asRecord(value);
  assertExactKeys(
    boundary,
    ['id', 'code', 'abstract_scope', 'status', 'revision', 'content_policy'],
    'P4_BOUNDARY_CONTROL_ONLY',
  );
  assertUuid(boundary.id, 'P4_BOUNDARY_CONTROL_ONLY');
  assertStringLength(boundary.code, 1, 50, 'P4_BOUNDARY_CONTROL_ONLY');
  assertStringLength(boundary.abstract_scope, 1, 160, 'P4_BOUNDARY_CONTROL_ONLY');
  if (boundary.status !== 'active' || boundary.content_policy !== 'control-only-no-source-text')
    fail('P4_BOUNDARY_CONTROL_ONLY');
  assertPositiveInteger(boundary.revision, 'P4_BOUNDARY_CONTROL_ONLY');
}

function assertActualQuestionShape(value: unknown): asserts value is P4ActualQuestion {
  const question = asRecord(value);
  assertExactKeys(
    question,
    ['actual_question_id', 'text', 'source', 'evidence_segment_ids'],
    'P4_ACTUAL_QUESTION_SHAPE_INVALID',
  );
  assertUuid(question.actual_question_id, 'P4_ACTUAL_QUESTION_SHAPE_INVALID');
  assertStringLength(question.text, 1, 1000, 'P4_ACTUAL_QUESTION_SHAPE_INVALID');
  assertEnum(
    question.source,
    ['interviewer_spontaneous', 'matched_system_suggestion'],
    'P4_ACTUAL_QUESTION_SHAPE_INVALID',
  );
  assertUuidArray(question.evidence_segment_ids, 'P4_ACTUAL_QUESTION_SHAPE_INVALID');
}

function assertDisplayedQuestionShape(value: unknown): asserts value is P4DisplayedQuestion {
  const question = asRecord(value);
  assertExactKeys(
    question,
    ['snapshot_id', 'text', 'display_sequence', 'outcome', 'actual_question_id'],
    'P4_DISPLAYED_SHAPE_INVALID',
  );
  assertUuid(question.snapshot_id, 'P4_DISPLAYED_SHAPE_INVALID');
  assertStringLength(question.text, 1, 1000, 'P4_DISPLAYED_SHAPE_INVALID');
  assertPositiveInteger(question.display_sequence, 'P4_DISPLAYED_SHAPE_INVALID');
  assertEnum(
    question.outcome,
    ['actual_asked', 'explicitly_replaced', 'not_observed', 'unjudged'],
    'P4_DISPLAYED_SHAPE_INVALID',
  );
  assertNullableUuid(question.actual_question_id, 'P4_DISPLAYED_SHAPE_INVALID');
}

function assertQuestionBankShape(value: unknown): asserts value is P4QuestionBankReference {
  const item = asRecord(value);
  assertExactKeys(
    item,
    [
      'question_bank_item_id',
      'bank',
      'topic',
      'question_text',
      'purpose',
      'sensitivity',
      'bank_version',
    ],
    'P4_QUESTION_BANK_SHAPE_INVALID',
  );
  assertUuid(item.question_bank_item_id, 'P4_QUESTION_BANK_SHAPE_INVALID');
  assertEnum(item.bank, ['basic', 'deep'], 'P4_QUESTION_BANK_SHAPE_INVALID');
  assertStringLength(item.topic, 1, 80, 'P4_QUESTION_BANK_SHAPE_INVALID');
  assertStringLength(item.question_text, 1, 300, 'P4_QUESTION_BANK_SHAPE_INVALID');
  assertStringLength(item.purpose, 1, 40, 'P4_QUESTION_BANK_SHAPE_INVALID');
  assertEnum(item.sensitivity, ['low', 'medium', 'high'], 'P4_QUESTION_BANK_SHAPE_INVALID');
  assertNonEmpty(item.bank_version, 'P4_QUESTION_BANK_SHAPE_INVALID');
}

function assertPresentationShape(value: unknown): asserts value is P4Presentation {
  const presentation = asRecord(value);
  assertExactKeys(
    presentation,
    ['snapshot_id', 'text', 'display_sequence'],
    'P4_PRESENTATION_SHAPE_INVALID',
  );
  assertUuid(presentation.snapshot_id, 'P4_PRESENTATION_SHAPE_INVALID');
  assertStringLength(presentation.text, 1, 1000, 'P4_PRESENTATION_SHAPE_INVALID');
  assertPositiveInteger(presentation.display_sequence, 'P4_PRESENTATION_SHAPE_INVALID');
}

function assertBudgetShape(value: unknown): asserts value is P4BudgetInput {
  const budget = asRecord(value);
  assertExactKeys(budget, ['config_ref', 'policy_version'], 'P4_BUDGET_SHAPE_INVALID');
  assertNonEmpty(budget.config_ref, 'P4_BUDGET_SHAPE_INVALID');
  assertNonEmpty(budget.policy_version, 'P4_BUDGET_SHAPE_INVALID');
}

function assertEvidenceArray(value: unknown): asserts value is readonly P4EvidenceReference[] {
  if (!Array.isArray(value) || value.length === 0) fail('P4_EVIDENCE_REFERENCE_INVALID');
  for (const reference of value) {
    const evidence = asRecord(reference);
    assertExactKeys(
      evidence,
      ['segment_id', 'text_revision', 'speaker_role_revision', 'effective_text_digest', 'order'],
      'P4_EVIDENCE_REFERENCE_INVALID',
    );
    assertUuid(evidence.segment_id, 'P4_EVIDENCE_REFERENCE_INVALID');
    assertNonNegativeInteger(evidence.text_revision, 'P4_EVIDENCE_REFERENCE_INVALID');
    assertNonNegativeInteger(evidence.speaker_role_revision, 'P4_EVIDENCE_REFERENCE_INVALID');
    assertDigest(evidence.effective_text_digest, 'P4_EVIDENCE_REFERENCE_INVALID');
    assertNonNegativeInteger(evidence.order, 'P4_EVIDENCE_REFERENCE_INVALID');
  }
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
  const seenOrderingKeys = new Set<string>();
  for (const { sourceId: sourceIdValue, revision, member } of prepared) {
    const orderingKey = `${String(member.input_order)}\u0000${sourceIdValue}\u0000${String(revision)}`;
    if (seenOrderingKeys.has(orderingKey)) fail('P4_ORDERING_KEY_COLLISION');
    seenOrderingKeys.add(orderingKey);
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
      return requiredInteger(record.revision_no, 'P4_SOURCE_REVISION_REQUIRED');
    case 'memory_candidates':
      return record.revision_no === undefined
        ? null
        : requiredInteger(record.revision_no, 'P4_SOURCE_REVISION_REQUIRED');
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

function assertStringLength(
  value: unknown,
  min: number,
  max: number,
  code: string,
): asserts value is string {
  if (typeof value !== 'string' || value.length < min || value.length > max) fail(code);
}

function assertUuid(value: unknown, code: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  )
    fail(code);
}

function assertNullableUuid(value: unknown, code: string): asserts value is string | null {
  if (value !== null) assertUuid(value, code);
}

function assertPositiveInteger(value: unknown, code: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 1) fail(code);
}

function assertNullablePositiveInteger(
  value: unknown,
  code: string,
): asserts value is number | null {
  if (value !== null) assertPositiveInteger(value, code);
}

function assertNonNegativeInteger(value: unknown, code: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) fail(code);
}

function assertNullableNumber(
  value: unknown,
  min: number,
  max: number,
  code: string,
  integer = false,
): asserts value is number | null {
  if (value === null) return;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    fail(code);
}

function assertEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  code: string,
): asserts value is T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail(code);
}

function assertEnumArray<T extends string>(
  value: unknown,
  values: readonly T[],
  code: string,
): asserts value is readonly T[] {
  if (!Array.isArray(value) || value.length === 0) fail(code);
  const allowed = new Set(values);
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item as T) || seen.has(item)) fail(code);
    seen.add(item);
  }
}

function assertUuidArray(value: unknown, code: string): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length === 0) fail(code);
  const seen = new Set<string>();
  for (const item of value) {
    assertUuid(item, code);
    if (seen.has(item)) fail(code);
    seen.add(item);
  }
}

function assertExactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  code: string,
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(record, key))) fail(code);
  if (Object.keys(record).some((key) => !allowed.has(key))) fail(code);
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

function compareMembershipEntries(left: P4MembershipEntry, right: P4MembershipEntry): number {
  return (
    left.input_order - right.input_order ||
    compareLexical(left.source_id, right.source_id) ||
    compareRevision(left.source_revision, right.source_revision)
  );
}

function sameArray(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function fail(code: string): never {
  throw new P4ContextAssemblyError(code);
}
