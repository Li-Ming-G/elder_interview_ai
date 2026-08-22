import {
  MEMORY_P2_TRACE_SOURCE_KINDS,
  MemoryP2RuntimeError,
  isMemoryP2ErrorCode,
  type MemoryP2AdvanceTraceStage,
  type MemoryP2Clock,
  type MemoryP2DecisionTraceParentRecord,
  type MemoryP2DecisionTraceSemanticRecord,
  type MemoryP2DecisionTraceWrite,
  type MemoryP2DecisionTraceWritePort,
  type MemoryP2ErrorCode,
  type MemoryP2MemoryOutcome,
  type MemoryP2ObservabilitySink,
  type MemoryP2RetentionState,
  type MemoryP2RunningTraceStage,
  type MemoryP2TerminalStatus,
  type MemoryP2TraceAuthorityPort,
  type MemoryP2TraceIdentity,
  type MemoryP2TracePolicyAuthority,
  type MemoryP2TraceReference,
  type MemoryP2TraceReferenceAuthority,
  type MemoryP2TraceSourceSessionAuthority,
  type MemoryP2TraceSourceSessionScope,
  type MemoryP2TraceStage,
  type MemoryP2TraceStatus,
  type MemoryP2TraceWriteResult,
} from './memory-p2-observability.types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[a-f0-9]{64}$/;
const FORBIDDEN_DURABLE_KEYS = new Set([
  'context',
  'contextpayload',
  'semanticvalue',
  'value',
  'valuejson',
  'resolvedvalue',
  'transcript',
  'rawtext',
  'prompt',
  'proposal',
  'proposalpayload',
  'plan',
  'planpayload',
  'providerpayload',
  'providerrequest',
  'providerresponse',
  'requestpayload',
  'responsepayload',
]);
const SOURCE_KINDS = new Set<string>(MEMORY_P2_TRACE_SOURCE_KINDS);
const SYSTEM_CLOCK: MemoryP2Clock = { now: () => new Date() };

export interface MemoryP2RunningTraceInput {
  identity: MemoryP2TraceIdentity;
  memoryOutcome: 'unjudged';
  p2PolicyRevision: string;
  p2RetentionPolicyVersion: string;
  retentionState: 'active';
  references: readonly MemoryP2TraceReference[];
  sourceSessionScope: MemoryP2TraceSourceSessionScope;
}

export interface MemoryP2RunningStageInput {
  identity: MemoryP2TraceIdentity;
  memoryOutcome: 'unjudged';
  p2PolicyRevision: string;
  p2RetentionPolicyVersion: string;
  retentionState: 'active';
  stage: MemoryP2AdvanceTraceStage;
  proposalDigest: string;
  planDigest: string | null;
  references: readonly MemoryP2TraceReference[];
  sourceSessionScope: MemoryP2TraceSourceSessionScope;
}

export interface MemoryP2TerminalTraceInput {
  identity: MemoryP2TraceIdentity;
  memoryOutcome: MemoryP2MemoryOutcome;
  p2PolicyRevision: string;
  p2RetentionPolicyVersion: string;
  retentionState: MemoryP2RetentionState;
  status: MemoryP2TerminalStatus;
  stage: Extract<MemoryP2TraceStage, 'committed' | 'recovered' | 'terminal'>;
  errorCode: MemoryP2ErrorCode | null;
  completedAt: Date;
  proposalDigest: string | null;
  planDigest: string | null;
  commitDigest: string | null;
  references: readonly MemoryP2TraceReference[];
  sourceSessionScope: MemoryP2TraceSourceSessionScope;
  expectedJobStatuses: readonly MemoryP2TraceStatus[];
  expectedTraceStatuses: readonly (MemoryP2TraceStatus | 'missing')[];
}

export class MemoryP2DecisionTraceService {
  public constructor(
    private readonly writes: MemoryP2DecisionTraceWritePort,
    private readonly authorities: MemoryP2TraceAuthorityPort,
    private readonly observations: MemoryP2ObservabilitySink,
    private readonly clock: MemoryP2Clock = SYSTEM_CLOCK,
  ) {}

  public async createRunning(input: MemoryP2RunningTraceInput): Promise<MemoryP2TraceWriteResult> {
    assertNoDurableContent(input);
    const write = buildMemoryP2RunningTrace(input);
    const writeAt = this.currentWriteTime();
    const [expectedPolicyAuthority, expectedSourceSessionAuthority] = await Promise.all([
      this.assertPolicy(input, writeAt),
      this.assertSourceSession(input),
    ]);
    await this.assertAuthorities(write, expectedSourceSessionAuthority);
    const result = await this.writes.createRunning({
      expectedPolicyAuthority,
      expectedSourceSessionAuthority,
      write,
      writeAt,
    });
    this.observe(result.trace ?? write);
    return result;
  }

  public async advanceRunningStage(
    input: MemoryP2RunningStageInput,
  ): Promise<MemoryP2TraceWriteResult> {
    assertNoDurableContent(input);
    const write = buildMemoryP2RunningStageTrace(input);
    const writeAt = this.currentWriteTime();
    const [expectedPolicyAuthority, expectedSourceSessionAuthority] = await Promise.all([
      this.assertPolicy(input, writeAt),
      this.assertSourceSession(input),
    ]);
    await this.assertAuthorities(write, expectedSourceSessionAuthority);
    const result = await this.writes.advanceRunningStage({
      expectedPolicyAuthority,
      expectedSourceSessionAuthority,
      expectedStage: previousRunningStage(input.stage),
      write,
      writeAt,
    });
    this.observe(result.trace ?? write);
    return result;
  }

  public async terminalize(input: MemoryP2TerminalTraceInput): Promise<MemoryP2TraceWriteResult> {
    assertNoDurableContent(input);
    const write = buildMemoryP2TerminalTrace(input);
    const writeAt = this.currentWriteTime();
    const [expectedPolicyAuthority, expectedSourceSessionAuthority] = await Promise.all([
      this.assertPolicy(input, writeAt),
      this.assertSourceSession(input),
    ]);
    await this.assertAuthorities(write, expectedSourceSessionAuthority);
    const result = await this.writes.writeTerminal({
      expectedJobStatuses: input.expectedJobStatuses,
      expectedPolicyAuthority,
      expectedSourceSessionAuthority,
      expectedTraceStatuses: input.expectedTraceStatuses,
      write,
      writeAt,
    });
    this.observe(result.trace ?? write);
    return result;
  }

  public validateAuthorities(
    write: MemoryP2DecisionTraceWrite,
    authorities: readonly MemoryP2TraceReferenceAuthority[],
    sourceSessionScope: MemoryP2TraceSourceSessionScope,
  ): void {
    assertReferenceAuthorityParity(write, authorities, sourceSessionScope);
  }

  private async assertAuthorities(
    write: MemoryP2DecisionTraceWrite,
    sourceSessionScope: MemoryP2TraceSourceSessionScope,
  ): Promise<void> {
    const authorities = await this.authorities.readReferenceAuthorities(write.references);
    assertReferenceAuthorityParity(write, authorities, sourceSessionScope);
  }

  private async assertSourceSession(input: {
    identity: MemoryP2TraceIdentity;
    sourceSessionScope: MemoryP2TraceSourceSessionScope;
  }): Promise<MemoryP2TraceSourceSessionAuthority> {
    const authority = await this.authorities.readSourceSessionAuthority(input.identity.aiJobId);
    assertSourceSessionAuthority(input.identity, input.sourceSessionScope, authority);
    return authority;
  }

  private async assertPolicy(
    input: {
      identity: MemoryP2TraceIdentity;
      p2PolicyRevision: string;
      p2RetentionPolicyVersion: string;
    },
    writeAt: Date,
  ): Promise<MemoryP2TracePolicyAuthority> {
    const authority = await this.authorities.readPolicyAuthority(input.identity.aiJobId, writeAt);
    assertPolicyAuthority(input, authority, writeAt);
    return authority;
  }

  private currentWriteTime(): Date {
    const writeAt = this.clock.now();
    if (!Number.isFinite(writeAt.getTime())) fail('P2_RETENTION_UNAVAILABLE');
    return new Date(writeAt.getTime());
  }

  private observe(write: MemoryP2DecisionTraceWrite): void {
    this.observations.record({
      commitDigest: write.semantic.commitDigest,
      deletionScopeDigest: write.semantic.deletionScopeDigest,
      durationMs: write.parent.durationMs,
      errorCode: write.parent.errorCode,
      jobId: write.parent.aiJobId,
      outcome: write.parent.memoryOutcome,
      planDigest: write.semantic.planDigest,
      proposalDigest: write.semantic.proposalDigest,
      sourceCount: write.references.length,
      sourceManifestHash: write.semantic.sourceManifestHash,
      stage: write.parent.stage,
      status: write.parent.status,
      traceId: write.parent.traceId,
    });
  }
}

export function buildMemoryP2RunningTrace(
  input: MemoryP2RunningTraceInput,
): MemoryP2DecisionTraceWrite {
  assertTraceIdentity(input.identity);
  assertPolicyVersions(input.p2PolicyRevision, input.p2RetentionPolicyVersion);
  assertMemoryP2SourceSessionScope(input.identity, input.sourceSessionScope);
  assertReferences(input.identity, input.references);
  return buildWrite({
    commitDigest: null,
    completedAt: null,
    errorCode: null,
    identity: input.identity,
    memoryOutcome: input.memoryOutcome,
    planDigest: null,
    proposalDigest: null,
    references: input.references,
    retentionState: input.retentionState,
    stage: 'frozen',
    status: 'running',
  });
}

export function buildMemoryP2RunningStageTrace(
  input: MemoryP2RunningStageInput,
): MemoryP2DecisionTraceWrite {
  assertTraceIdentity(input.identity);
  assertPolicyVersions(input.p2PolicyRevision, input.p2RetentionPolicyVersion);
  assertMemoryP2SourceSessionScope(input.identity, input.sourceSessionScope);
  assertReferences(input.identity, input.references);
  return buildWrite({
    commitDigest: null,
    completedAt: null,
    errorCode: null,
    identity: input.identity,
    memoryOutcome: input.memoryOutcome,
    planDigest: input.planDigest,
    proposalDigest: input.proposalDigest,
    references: input.references,
    retentionState: input.retentionState,
    stage: input.stage,
    status: 'running',
  });
}

export function buildMemoryP2TerminalTrace(
  input: Omit<MemoryP2TerminalTraceInput, 'expectedJobStatuses' | 'expectedTraceStatuses'>,
): MemoryP2DecisionTraceWrite {
  assertTraceIdentity(input.identity);
  assertPolicyVersions(input.p2PolicyRevision, input.p2RetentionPolicyVersion);
  assertMemoryP2SourceSessionScope(input.identity, input.sourceSessionScope);
  assertReferences(input.identity, input.references);
  assertTerminal(input);
  return buildWrite(input);
}

export function assertPolicyAuthority(
  expected: {
    identity: MemoryP2TraceIdentity;
    p2PolicyRevision: string;
    p2RetentionPolicyVersion: string;
  },
  authority: MemoryP2TracePolicyAuthority | null,
  writeAt: Date,
): asserts authority is MemoryP2TracePolicyAuthority {
  if (authority === null || authority.aiJobId !== expected.identity.aiJobId)
    fail('P2_POLICY_DRIFT');
  if (
    authority.p2PolicyRevision !== expected.p2PolicyRevision ||
    authority.p2RetentionPolicyVersion !== expected.p2RetentionPolicyVersion
  )
    fail('P2_POLICY_DRIFT');
  if (authority.deletionScopeDigest !== expected.identity.deletionScopeDigest)
    fail('P2_DELETION_SCOPE_DRIFT');
  if (
    authority.retentionState !== 'active' ||
    !Number.isFinite(authority.expiresAt.getTime()) ||
    !Number.isFinite(writeAt.getTime()) ||
    authority.expiresAt <= writeAt ||
    authority.expiresAt.getTime() !== expected.identity.expiresAt.getTime()
  )
    fail('P2_RETENTION_UNAVAILABLE');
}

export function assertReferenceAuthorityParity(
  write: MemoryP2DecisionTraceWrite,
  authorities: readonly MemoryP2TraceReferenceAuthority[],
  sourceSessionScope: MemoryP2TraceSourceSessionScope,
): void {
  assertMemoryP2SourceSessionScope(write.parent, sourceSessionScope);
  if (authorities.length !== write.references.length) fail('P2_TRACE_UNAVAILABLE');
  const referencedSessions = new Set<string>();
  for (let index = 0; index < write.references.length; index += 1) {
    const reference = write.references[index];
    const authority = authorities[index];
    if (reference === undefined || authority === undefined) fail('P2_TRACE_UNAVAILABLE');
    if (authority.readability !== 'active') fail('P2_RETENTION_UNAVAILABLE');
    if (
      authority.sourceKind !== reference.sourceKind ||
      authority.targetId !== traceReferenceTargetId(reference) ||
      authority.projectId !== write.parent.projectId ||
      !sourceSessionScope.sourceSessionIds.includes(authority.sessionId) ||
      authority.sourceRevision !== reference.sourceRevision ||
      authority.membershipDigest !== reference.membershipDigest
    )
      fail('P2_SOURCE_DRIFT');
    if (
      authority.deletionScopeDigest !== reference.deletionScopeDigest ||
      authority.deletionScopeDigest !== write.semantic.deletionScopeDigest
    )
      fail('P2_DELETION_SCOPE_DRIFT');
    referencedSessions.add(authority.sessionId);
  }
  if (!sameStringSet([...referencedSessions], sourceSessionScope.sourceSessionIds))
    fail('P2_SOURCE_DRIFT');
}

export function assertSourceSessionAuthority(
  identity: MemoryP2TraceIdentity,
  expected: MemoryP2TraceSourceSessionScope,
  authority: MemoryP2TraceSourceSessionAuthority | null,
): asserts authority is MemoryP2TraceSourceSessionAuthority {
  assertMemoryP2SourceSessionScope(identity, expected);
  if (
    authority === null ||
    authority.aiJobId !== identity.aiJobId ||
    authority.targetLayer !== expected.targetLayer ||
    authority.sourceSessionManifestHash !== expected.sourceSessionManifestHash ||
    !sameOrderedStrings(authority.sourceSessionIds, expected.sourceSessionIds)
  )
    fail('P2_SOURCE_DRIFT');
}

export function traceReferenceTargetId(reference: MemoryP2TraceReference): string {
  switch (reference.sourceKind) {
    case 'checkpoint':
      return reference.sourceCheckpointId;
    case 'job':
      return reference.sourceJobId;
    case 'input_segment':
      return reference.aiJobInputSegmentId;
    case 'evidence':
      return reference.evidenceId;
    case 'resolution':
      return reference.resolutionAuthorityId;
  }
}

function buildWrite(input: {
  identity: MemoryP2TraceIdentity;
  memoryOutcome: MemoryP2MemoryOutcome;
  retentionState: MemoryP2RetentionState;
  status: MemoryP2TraceStatus;
  stage: MemoryP2TraceStage;
  errorCode: MemoryP2ErrorCode | null;
  completedAt: Date | null;
  proposalDigest: string | null;
  planDigest: string | null;
  commitDigest: string | null;
  references: readonly MemoryP2TraceReference[];
}): MemoryP2DecisionTraceWrite {
  assertTraceStateInvariant(input);
  const durationMs =
    input.completedAt === null
      ? null
      : Math.max(0, input.completedAt.getTime() - input.identity.startedAt.getTime());
  const parent: MemoryP2DecisionTraceParentRecord = {
    ...input.identity,
    activeThreadId: null,
    attemptId: null,
    completedAt: input.completedAt,
    contextDigest: null,
    contextRevision: 0,
    decisionOutcome: 'unavailable',
    directorInvoked: false,
    durationMs,
    errorCode: input.errorCode,
    gateReason: null,
    memoryOutcome: input.memoryOutcome,
    publicationOutcome: null,
    retentionState: input.retentionState,
    stage: input.stage,
    stageTimingsMs: {},
    status: input.status,
    traceKind: 'memory_layer_evolve',
    triggerType: 'memory_layer_evolve',
    workingRevision: null,
  };
  const semantic: MemoryP2DecisionTraceSemanticRecord = {
    aiJobId: input.identity.aiJobId,
    commitDigest: input.commitDigest,
    createdAt: input.identity.createdAt,
    deletionScopeDigest: input.identity.deletionScopeDigest,
    planDigest: input.planDigest,
    proposalDigest: input.proposalDigest,
    sourceManifestHash: input.identity.sourceManifestHash,
    traceId: input.identity.traceId,
  };
  return { parent, references: input.references.map(copyReference), semantic };
}

function assertTerminal(
  input: Omit<MemoryP2TerminalTraceInput, 'expectedJobStatuses' | 'expectedTraceStatuses'>,
): void {
  if (!Number.isFinite(input.completedAt.getTime())) fail('P2_TRACE_UNAVAILABLE');
  if (input.completedAt < input.identity.startedAt) fail('P2_TRACE_UNAVAILABLE');
  if (input.status === 'succeeded') {
    if (
      input.errorCode !== null ||
      !['checkpoint_committed', 'long_committed', 'no_change'].includes(input.memoryOutcome) ||
      !isDigest(input.proposalDigest) ||
      !isDigest(input.planDigest) ||
      !isDigest(input.commitDigest)
    )
      fail('P2_TRACE_UNAVAILABLE');
    if (input.stage !== 'committed' && input.stage !== 'recovered') fail('P2_TRACE_UNAVAILABLE');
    return;
  }
  const expectedOutcome: Record<
    Exclude<MemoryP2TerminalStatus, 'succeeded'>,
    MemoryP2MemoryOutcome
  > = {
    cancelled: 'cancelled',
    failed: 'failed',
    unavailable: 'unavailable',
  };
  if (input.memoryOutcome !== expectedOutcome[input.status]) fail('P2_TRACE_UNAVAILABLE');
  if (input.stage !== 'terminal' && input.stage !== 'recovered') fail('P2_TRACE_UNAVAILABLE');
  if (!isMemoryP2ErrorCode(input.errorCode)) fail('P2_TRACE_UNAVAILABLE');
  if (input.commitDigest !== null) fail('P2_TRACE_UNAVAILABLE');
  if (input.proposalDigest !== null && !isDigest(input.proposalDigest))
    fail('P2_TRACE_UNAVAILABLE');
  if (input.planDigest !== null && !isDigest(input.planDigest)) fail('P2_TRACE_UNAVAILABLE');
  if (input.planDigest !== null && input.proposalDigest === null) fail('P2_TRACE_UNAVAILABLE');
}

function assertTraceStateInvariant(input: {
  status: MemoryP2TraceStatus;
  stage: MemoryP2TraceStage;
  memoryOutcome: MemoryP2MemoryOutcome;
  errorCode: MemoryP2ErrorCode | null;
  completedAt: Date | null;
  proposalDigest: string | null;
  planDigest: string | null;
  commitDigest: string | null;
}): void {
  if (input.status !== 'running') return;
  if (!['frozen', 'proposed', 'validated', 'planned'].includes(input.stage))
    fail('P2_TRACE_UNAVAILABLE');
  if (
    input.memoryOutcome !== 'unjudged' ||
    input.errorCode !== null ||
    input.completedAt !== null ||
    input.commitDigest !== null
  )
    fail('P2_TRACE_UNAVAILABLE');
  if (input.stage === 'frozen') {
    if (input.proposalDigest !== null || input.planDigest !== null) fail('P2_TRACE_UNAVAILABLE');
    return;
  }
  if (!isDigest(input.proposalDigest)) fail('P2_TRACE_UNAVAILABLE');
  if (input.stage === 'planned') {
    if (!isDigest(input.planDigest)) fail('P2_TRACE_UNAVAILABLE');
    return;
  }
  if (input.planDigest !== null) fail('P2_TRACE_UNAVAILABLE');
}

function previousRunningStage(stage: MemoryP2AdvanceTraceStage): MemoryP2RunningTraceStage {
  switch (stage) {
    case 'proposed':
      return 'frozen';
    case 'validated':
      return 'proposed';
    case 'planned':
      return 'validated';
  }
}

function assertTraceIdentity(identity: MemoryP2TraceIdentity): void {
  for (const value of [
    identity.traceId,
    identity.projectId,
    identity.sessionId,
    identity.ownerActorId,
    identity.requestId,
    identity.generationId,
    identity.aiJobId,
  ])
    if (!UUID.test(value)) fail('P2_TRACE_UNAVAILABLE');
  if (
    !isDigest(identity.inputHash) ||
    !isDigest(identity.sourceManifestHash) ||
    !isDigest(identity.deletionScopeDigest)
  )
    fail('P2_TRACE_UNAVAILABLE');
  if (
    !Number.isFinite(identity.startedAt.getTime()) ||
    !Number.isFinite(identity.createdAt.getTime()) ||
    !Number.isFinite(identity.expiresAt.getTime()) ||
    identity.expiresAt <= identity.createdAt
  )
    fail('P2_TRACE_UNAVAILABLE');
}

function assertPolicyVersions(policyRevision: string, retentionPolicyVersion: string): void {
  if (
    policyRevision.length < 1 ||
    policyRevision.length > 80 ||
    retentionPolicyVersion.length < 1 ||
    retentionPolicyVersion.length > 80
  )
    fail('P2_POLICY_DRIFT');
}

function assertReferences(
  identity: MemoryP2TraceIdentity,
  references: readonly MemoryP2TraceReference[],
): void {
  if (references.length === 0) fail('P2_TRACE_UNAVAILABLE');
  const targets = new Set<string>();
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    if (reference === undefined) fail('P2_TRACE_UNAVAILABLE');
    const raw = reference as unknown as Record<string, unknown>;
    if (!SOURCE_KINDS.has(String(raw.sourceKind))) fail('P2_TRACE_UNAVAILABLE');
    const typedColumns = [
      raw.sourceCheckpointId,
      raw.sourceJobId,
      raw.aiJobInputSegmentId,
      raw.evidenceId,
      raw.resolutionAuthorityId,
    ].filter((value) => value !== null && value !== undefined);
    if (
      typedColumns.length !== 1 ||
      typeof typedColumns[0] !== 'string' ||
      !UUID.test(typedColumns[0])
    )
      fail('P2_TRACE_UNAVAILABLE');
    if (reference.inputOrder !== index || !Number.isInteger(reference.inputOrder))
      fail('P2_TRACE_UNAVAILABLE');
    if (!Number.isInteger(reference.sourceRevision) || reference.sourceRevision < 0)
      fail('P2_TRACE_UNAVAILABLE');
    if (
      !isDigest(reference.membershipDigest) ||
      reference.deletionScopeDigest !== identity.deletionScopeDigest
    )
      fail('P2_DELETION_SCOPE_DRIFT');
    const target = traceReferenceTargetId(reference);
    if (!UUID.test(target)) fail('P2_TRACE_UNAVAILABLE');
    const key = `${reference.sourceKind}:${target}`;
    if (targets.has(key)) fail('P2_TRACE_UNAVAILABLE');
    targets.add(key);
  }
}

export function assertMemoryP2SourceSessionScope(
  identity: Pick<MemoryP2TraceIdentity, 'sessionId'>,
  scope: MemoryP2TraceSourceSessionScope,
): void {
  if (!isDigest(scope.sourceSessionManifestHash) || scope.sourceSessionIds.length === 0)
    fail('P2_SOURCE_DRIFT');
  if (
    scope.sourceSessionIds.some((sessionId) => !UUID.test(sessionId)) ||
    new Set(scope.sourceSessionIds).size !== scope.sourceSessionIds.length
  )
    fail('P2_SOURCE_DRIFT');
  if (
    scope.targetLayer === 'mid' &&
    (scope.sourceSessionIds.length !== 1 || scope.sourceSessionIds[0] !== identity.sessionId)
  )
    fail('P2_SOURCE_DRIFT');
}

function sameStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((value) => expected.includes(value))
  );
}

function sameOrderedStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return (
    actual.length === expected.length && actual.every((value, index) => value === expected[index])
  );
}

function copyReference(reference: MemoryP2TraceReference): MemoryP2TraceReference {
  const common = {
    deletionScopeDigest: reference.deletionScopeDigest,
    inputOrder: reference.inputOrder,
    membershipDigest: reference.membershipDigest,
    sourceRevision: reference.sourceRevision,
  };
  switch (reference.sourceKind) {
    case 'checkpoint':
      return {
        ...common,
        sourceCheckpointId: reference.sourceCheckpointId,
        sourceKind: 'checkpoint',
      };
    case 'job':
      return { ...common, sourceJobId: reference.sourceJobId, sourceKind: 'job' };
    case 'input_segment':
      return {
        ...common,
        aiJobInputSegmentId: reference.aiJobInputSegmentId,
        sourceKind: 'input_segment',
      };
    case 'evidence':
      return { ...common, evidenceId: reference.evidenceId, sourceKind: 'evidence' };
    case 'resolution':
      return {
        ...common,
        resolutionAuthorityId: reference.resolutionAuthorityId,
        sourceKind: 'resolution',
      };
  }
}

function assertNoDurableContent(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoDurableContent(item);
    return;
  }
  if (value === null || typeof value !== 'object' || value instanceof Date) return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replaceAll('_', '').toLowerCase();
    if (FORBIDDEN_DURABLE_KEYS.has(normalized)) fail('P2_TRACE_UNAVAILABLE');
    assertNoDurableContent(child);
  }
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && DIGEST.test(value);
}

function fail(code: MemoryP2ErrorCode): never {
  throw new MemoryP2RuntimeError(code);
}
