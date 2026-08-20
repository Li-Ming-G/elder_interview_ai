import {
  MEMORY_P2_ERROR_CODES,
  MEMORY_P2_TRACE_SOURCE_KINDS,
  MemoryP2RuntimeError,
  type MemoryP2DecisionTraceParentRecord,
  type MemoryP2DecisionTraceSemanticRecord,
  type MemoryP2DecisionTraceWrite,
  type MemoryP2DecisionTraceWritePort,
  type MemoryP2ErrorCode,
  type MemoryP2MemoryOutcome,
  type MemoryP2ObservabilitySink,
  type MemoryP2RetentionState,
  type MemoryP2TerminalStatus,
  type MemoryP2TraceAuthorityPort,
  type MemoryP2TraceIdentity,
  type MemoryP2TracePolicyAuthority,
  type MemoryP2TraceReference,
  type MemoryP2TraceReferenceAuthority,
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
const ERROR_CODES = new Set<string>(MEMORY_P2_ERROR_CODES);
const SOURCE_KINDS = new Set<string>(MEMORY_P2_TRACE_SOURCE_KINDS);

export interface MemoryP2RunningTraceInput {
  identity: MemoryP2TraceIdentity;
  memoryOutcome: Extract<MemoryP2MemoryOutcome, 'unjudged' | 'no_change'>;
  p2PolicyRevision: string;
  p2RetentionPolicyVersion: string;
  retentionState: 'active';
  references: readonly MemoryP2TraceReference[];
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
  expectedJobStatuses: readonly MemoryP2TraceStatus[];
  expectedTraceStatuses: readonly (MemoryP2TraceStatus | 'missing')[];
}

export class MemoryP2DecisionTraceService {
  public constructor(
    private readonly writes: MemoryP2DecisionTraceWritePort,
    private readonly authorities: MemoryP2TraceAuthorityPort,
    private readonly observations: MemoryP2ObservabilitySink,
  ) {}

  public async createRunning(input: MemoryP2RunningTraceInput): Promise<MemoryP2TraceWriteResult> {
    assertNoDurableContent(input);
    const write = buildMemoryP2RunningTrace(input);
    const expectedPolicyAuthority = await this.assertPolicy(input);
    await this.assertAuthorities(write);
    const result = await this.writes.createRunning({ expectedPolicyAuthority, write });
    this.observe(result.trace ?? write);
    return result;
  }

  public async terminalize(input: MemoryP2TerminalTraceInput): Promise<MemoryP2TraceWriteResult> {
    assertNoDurableContent(input);
    const write = buildMemoryP2TerminalTrace(input);
    const expectedPolicyAuthority = await this.assertPolicy(input);
    await this.assertAuthorities(write);
    const result = await this.writes.writeTerminal({
      expectedJobStatuses: input.expectedJobStatuses,
      expectedPolicyAuthority,
      expectedTraceStatuses: input.expectedTraceStatuses,
      write,
    });
    this.observe(result.trace ?? write);
    return result;
  }

  public validateAuthorities(
    write: MemoryP2DecisionTraceWrite,
    authorities: readonly MemoryP2TraceReferenceAuthority[],
  ): void {
    assertReferenceAuthorityParity(write, authorities);
  }

  private async assertAuthorities(write: MemoryP2DecisionTraceWrite): Promise<void> {
    const authorities = await this.authorities.readReferenceAuthorities(write.references);
    assertReferenceAuthorityParity(write, authorities);
  }

  private async assertPolicy(input: {
    identity: MemoryP2TraceIdentity;
    p2PolicyRevision: string;
    p2RetentionPolicyVersion: string;
  }): Promise<MemoryP2TracePolicyAuthority> {
    const authority = await this.authorities.readPolicyAuthority(input.identity.aiJobId);
    assertPolicyAuthority(input, authority);
    return authority;
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

export function buildMemoryP2TerminalTrace(
  input: Omit<MemoryP2TerminalTraceInput, 'expectedJobStatuses' | 'expectedTraceStatuses'>,
): MemoryP2DecisionTraceWrite {
  assertTraceIdentity(input.identity);
  assertPolicyVersions(input.p2PolicyRevision, input.p2RetentionPolicyVersion);
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
    authority.expiresAt <= expected.identity.createdAt
  )
    fail('P2_RETENTION_UNAVAILABLE');
}

export function assertReferenceAuthorityParity(
  write: MemoryP2DecisionTraceWrite,
  authorities: readonly MemoryP2TraceReferenceAuthority[],
): void {
  if (authorities.length !== write.references.length) fail('P2_TRACE_UNAVAILABLE');
  for (let index = 0; index < write.references.length; index += 1) {
    const reference = write.references[index];
    const authority = authorities[index];
    if (reference === undefined || authority === undefined) fail('P2_TRACE_UNAVAILABLE');
    if (authority.readability !== 'active') fail('P2_RETENTION_UNAVAILABLE');
    if (
      authority.sourceKind !== reference.sourceKind ||
      authority.targetId !== traceReferenceTargetId(reference) ||
      authority.projectId !== write.parent.projectId ||
      authority.sessionId !== write.parent.sessionId ||
      authority.sourceRevision !== reference.sourceRevision ||
      authority.membershipDigest !== reference.membershipDigest
    )
      fail('P2_SOURCE_DRIFT');
    if (
      authority.deletionScopeDigest !== reference.deletionScopeDigest ||
      authority.deletionScopeDigest !== write.semantic.deletionScopeDigest
    )
      fail('P2_DELETION_SCOPE_DRIFT');
  }
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
      !isDigest(input.proposalDigest) ||
      !isDigest(input.planDigest) ||
      !isDigest(input.commitDigest)
    )
      fail('P2_TRACE_UNAVAILABLE');
    if (input.stage !== 'committed' && input.stage !== 'recovered') fail('P2_TRACE_UNAVAILABLE');
    return;
  }
  if (input.errorCode === null || !ERROR_CODES.has(input.errorCode)) fail('P2_TRACE_UNAVAILABLE');
  if (input.commitDigest !== null) fail('P2_TRACE_UNAVAILABLE');
  if (input.proposalDigest !== null && !isDigest(input.proposalDigest))
    fail('P2_TRACE_UNAVAILABLE');
  if (input.planDigest !== null && !isDigest(input.planDigest)) fail('P2_TRACE_UNAVAILABLE');
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
