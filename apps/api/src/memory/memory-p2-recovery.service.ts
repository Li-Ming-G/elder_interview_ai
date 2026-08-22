import {
  assertMemoryP2SourceSessionScope,
  assertReferenceAuthorityParity,
  buildMemoryP2RunningTrace,
  buildMemoryP2TerminalTrace,
} from './memory-p2-decision-trace.service.js';
import {
  MemoryP2RuntimeError,
  isMemoryP2ErrorCode,
  type MemoryP2Clock,
  type MemoryP2CommitFence,
  type MemoryP2DecisionTraceWrite,
  type MemoryP2ErrorCode,
  type MemoryP2JobStatus,
  type MemoryP2MemoryOutcome,
  type MemoryP2ObservabilitySink,
  type MemoryP2RecoveryAuthority,
  type MemoryP2RecoveryCommand,
  type MemoryP2RecoveryOutcome,
  type MemoryP2RecoveryPort,
  type MemoryP2TerminalStatus,
  type MemoryP2TraceReference,
  type MemoryP2TraceSourceSessionScope,
  type MemoryP2TraceStatus,
} from './memory-p2-observability.types.js';

const DIGEST = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYSTEM_CLOCK: MemoryP2Clock = { now: () => new Date() };

export interface MemoryP2RecoveryScanResult {
  jobId: string;
  outcome: MemoryP2RecoveryOutcome;
}

export class MemoryP2RecoveryService {
  public constructor(
    private readonly repository: MemoryP2RecoveryPort,
    private readonly observations: MemoryP2ObservabilitySink,
    private readonly clock: MemoryP2Clock = SYSTEM_CLOCK,
  ) {}

  public async reconcilePersistedState(
    limit = 200,
  ): Promise<readonly MemoryP2RecoveryScanResult[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
      throw new MemoryP2RuntimeError('P2_TRACE_UNAVAILABLE');
    const staleAtOrBefore = this.currentWriteTime();
    const ids = [...new Set(await this.repository.scanCandidateJobIds({ limit, staleAtOrBefore }))];
    const results: MemoryP2RecoveryScanResult[] = [];
    for (const jobId of ids) results.push({ jobId, outcome: await this.reconcileJob(jobId) });
    return results;
  }

  public async reconcileJob(jobId: string): Promise<MemoryP2RecoveryOutcome> {
    const authority = await this.repository.readRecoveryAuthority(jobId);
    if (authority === null) return 'not_found';
    const writeAt = this.currentWriteTime();
    const authorityError = recoveryAuthorityError(authority, writeAt);
    const completeCommit = hasCompleteCommitProof(authority);
    const anyCommit = hasAnyCommitProof(authority);

    if (authority.jobStatus === 'succeeded') {
      if (authorityError !== null || !completeCommit)
        return this.preserveSucceededUnreadable(authority, authorityError ?? 'P2_TARGET_DRIFT');
      if (authority.jobMemoryOutcome !== committedOutcome(authority))
        return this.preserveSucceededUnreadable(authority, 'P2_TARGET_DRIFT');
      if (traceMatchesCommitted(authority)) return 'already_converged';
      if (authority.trace?.status === 'running' && !traceMatchesRunningAuthority(authority))
        return this.preserveSucceededUnreadable(authority, 'P2_TRACE_UNAVAILABLE');
      if (authority.trace !== null && authority.trace.status !== 'running')
        return this.preserveSucceededUnreadable(authority, 'P2_TRACE_UNAVAILABLE');
      return this.apply(
        authority,
        recoveryCommand(authority, writeAt, {
          errorCode: null,
          expectedJobStatuses: ['succeeded'],
          expectedTraceStatuses: ['missing', 'running'],
          kind: 'preserve_committed',
          memoryOutcome: committedOutcome(authority),
          status: 'succeeded',
        }),
        'preserved_committed',
      );
    }

    if (authority.jobStatus === 'pending' || authority.jobStatus === 'running') {
      const leaseState = durableLeaseState(authority, writeAt);
      if (leaseState === 'active') return 'active_attempt';
      if (leaseState === 'invalid')
        return this.preserveTerminalUnreadable(authority, 'P2_TRACE_UNAVAILABLE');
      if (authority.trace !== null && !traceMatchesRunningAuthority(authority)) {
        if (anyCommit) return this.preserveSucceededUnreadable(authority, 'P2_TRACE_UNAVAILABLE');
        return this.preserveTerminalUnreadable(authority, 'P2_TRACE_UNAVAILABLE');
      }
      if (
        completeCommit &&
        authorityError === null &&
        (authority.trace === null ||
          authority.trace.status === 'running' ||
          traceMatchesCommitted(authority))
      )
        return this.apply(
          authority,
          recoveryCommand(authority, writeAt, {
            errorCode: null,
            expectedJobStatuses: ['pending', 'running'],
            expectedTraceStatuses: ['missing', 'running', 'succeeded'],
            kind: 'preserve_committed',
            memoryOutcome: committedOutcome(authority),
            status: 'succeeded',
          }),
          'preserved_committed',
        );
      if (anyCommit)
        return this.preserveSucceededUnreadable(authority, authorityError ?? 'P2_TARGET_DRIFT');
      if (!hasBuildableSourceSessionScope(authority))
        return this.preserveTerminalUnreadable(authority, 'P2_SOURCE_DRIFT');
      if (authorityError === 'P2_RETENTION_UNAVAILABLE')
        return this.preserveTerminalUnreadable(authority, authorityError);
      const errorCode = authorityError ?? 'P2_RESTART_RECOVERY';
      return this.apply(
        authority,
        recoveryCommand(authority, writeAt, {
          errorCode,
          expectedJobStatuses: ['pending', 'running'],
          expectedTraceStatuses: ['missing', 'running'],
          kind: 'terminalize_uncommitted',
          memoryOutcome: 'unavailable',
          status: 'unavailable',
        }),
        'terminalized_uncommitted',
      );
    }

    if (anyCommit)
      return this.preserveSucceededUnreadable(authority, authorityError ?? 'P2_TARGET_DRIFT');
    const terminalFacts = durableTerminalFacts(authority);
    if (terminalFacts === null)
      return this.preserveTerminalUnreadable(authority, 'P2_TRACE_UNAVAILABLE');
    if (authorityError !== null) return this.preserveTerminalUnreadable(authority, authorityError);
    if (traceMatchesTerminalJob(authority, terminalFacts)) return 'already_converged';
    if (authority.trace?.status === 'running' && !traceMatchesRunningAuthority(authority))
      return this.preserveTerminalUnreadable(authority, 'P2_TRACE_UNAVAILABLE');
    if (authority.trace !== null && authority.trace.status !== 'running')
      return this.preserveTerminalUnreadable(authority, 'P2_TRACE_UNAVAILABLE');
    return this.apply(
      authority,
      recoveryCommand(authority, writeAt, {
        errorCode: terminalFacts.errorCode,
        expectedJobStatuses: [authority.jobStatus],
        expectedTraceStatuses: ['missing', 'running'],
        kind: 'repair_terminal_trace',
        memoryOutcome: terminalFacts.memoryOutcome,
        status: terminalFacts.status,
      }),
      'repaired_terminal_trace',
    );
  }

  public async createCommitFence(
    jobId: string,
    attemptNo: number,
    leaseOwnerId: string,
    leaseEpoch: number,
  ): Promise<MemoryP2CommitFence> {
    const authority = await this.repository.readRecoveryAuthority(jobId);
    const writeAt = this.currentWriteTime();
    if (authority === null || authority.attemptNo !== attemptNo)
      throw new MemoryP2RuntimeError('P2_CAS_LOST');
    if (
      authority.jobStatus !== 'running' ||
      authority.committed !== null ||
      authority.leaseOwnerId !== leaseOwnerId ||
      authority.leaseEpoch !== leaseEpoch ||
      durableLeaseState(authority, writeAt) !== 'active' ||
      (authority.trace !== null && !traceMatchesRunningAuthority(authority))
    )
      throw new MemoryP2RuntimeError('P2_CAS_LOST');
    const authorityError = recoveryAuthorityError(authority, writeAt);
    if (authorityError !== null) throw new MemoryP2RuntimeError(authorityError);
    const checkpoint = authority.checkpoint;
    if (checkpoint === null) throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
    const leaseExpiresAt = authority.leaseExpiresAt;
    if (leaseExpiresAt === null) throw new MemoryP2RuntimeError('P2_CAS_LOST');
    return {
      attemptNo,
      checkpointId: checkpoint.checkpointId,
      deletionScopeDigest: authority.identity.deletionScopeDigest,
      jobId,
      jobRevision: authority.jobRevision,
      p2PolicyRevision: authority.p2PolicyRevision,
      p2RetentionPolicyVersion: authority.p2RetentionPolicyVersion,
      leaseEpoch,
      leaseExpiresAt,
      leaseOwnerId,
      sourceManifestHash: authority.identity.sourceManifestHash,
    };
  }

  private async apply(
    authority: MemoryP2RecoveryAuthority,
    command: MemoryP2RecoveryCommand,
    appliedOutcome: MemoryP2RecoveryOutcome,
  ): Promise<MemoryP2RecoveryOutcome> {
    const result = await this.repository.applyRecovery(command);
    if (result.outcome === 'cas_lost') return 'cas_lost';
    this.observe(command.trace);
    return result.outcome === 'replayed' ? 'already_converged' : appliedOutcome;
  }

  private preserveSucceededUnreadable(
    authority: MemoryP2RecoveryAuthority,
    errorCode: MemoryP2ErrorCode,
  ): MemoryP2RecoveryOutcome {
    this.observations.record({
      commitDigest: authority.committed?.commitDigest ?? null,
      deletionScopeDigest: authority.identity.deletionScopeDigest,
      durationMs: null,
      errorCode,
      jobId: authority.identity.aiJobId,
      outcome: 'unavailable',
      planDigest: authority.committed?.planDigest ?? null,
      proposalDigest: authority.committed?.proposalDigest ?? null,
      sourceCount: authority.references.length,
      sourceManifestHash: authority.identity.sourceManifestHash,
      stage: 'recovered',
      status: 'unavailable',
      traceId: authority.trace?.traceId ?? null,
    });
    return 'preserved_succeeded_unreadable';
  }

  private preserveTerminalUnreadable(
    authority: MemoryP2RecoveryAuthority,
    errorCode: MemoryP2ErrorCode,
  ): MemoryP2RecoveryOutcome {
    this.observations.record({
      commitDigest: null,
      deletionScopeDigest: authority.identity.deletionScopeDigest,
      durationMs: null,
      errorCode,
      jobId: authority.identity.aiJobId,
      outcome: durableTerminalFacts(authority)?.memoryOutcome ?? 'unavailable',
      planDigest: authority.trace?.planDigest ?? null,
      proposalDigest: authority.trace?.proposalDigest ?? null,
      sourceCount: authority.references.length,
      sourceManifestHash: authority.identity.sourceManifestHash,
      stage: 'recovered',
      status: terminalTraceStatus(authority.jobStatus),
      traceId: authority.trace?.traceId ?? null,
    });
    return 'terminal_authority_unreadable';
  }

  private currentWriteTime(): Date {
    const writeAt = this.clock.now();
    if (!Number.isFinite(writeAt.getTime()))
      throw new MemoryP2RuntimeError('P2_RETENTION_UNAVAILABLE');
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

function recoveryCommand(
  authority: MemoryP2RecoveryAuthority,
  writeAt: Date,
  input: {
    kind: MemoryP2RecoveryCommand['kind'];
    status: MemoryP2TerminalStatus;
    errorCode: MemoryP2ErrorCode | null;
    memoryOutcome: MemoryP2MemoryOutcome;
    expectedJobStatuses: readonly MemoryP2JobStatus[];
    expectedTraceStatuses: readonly (MemoryP2TraceStatus | 'missing')[];
  },
): MemoryP2RecoveryCommand {
  const committed = authority.committed;
  const success = input.status === 'succeeded';
  const trace = buildMemoryP2TerminalTrace({
    commitDigest: success ? (committed?.commitDigest ?? null) : null,
    completedAt: new Date(Math.max(authority.identity.startedAt.getTime(), writeAt.getTime())),
    errorCode: input.errorCode,
    identity: authority.identity,
    memoryOutcome: input.memoryOutcome,
    p2PolicyRevision: authority.p2PolicyRevision,
    p2RetentionPolicyVersion: authority.p2RetentionPolicyVersion,
    planDigest: success ? (committed?.planDigest ?? null) : (authority.trace?.planDigest ?? null),
    proposalDigest: success
      ? (committed?.proposalDigest ?? null)
      : (authority.trace?.proposalDigest ?? null),
    references: authority.references,
    retentionState: authority.retentionState,
    sourceSessionScope: recoverySourceSessionScope(authority),
    stage: 'recovered',
    status: input.status,
  });
  return {
    errorCode: input.errorCode,
    expectedAttemptNo: authority.attemptNo,
    expectedCheckpointId: authority.checkpoint?.checkpointId ?? null,
    expectedCommitDigest: committed?.commitDigest ?? null,
    expectedDeletionScopeDigest: authority.identity.deletionScopeDigest,
    expectedJobRevision: authority.jobRevision,
    expectedJobStatuses: input.expectedJobStatuses,
    expectedLeaseEpoch: authority.leaseEpoch,
    expectedLeaseExpiresAt: authority.leaseExpiresAt,
    expectedLeaseOwnerId: authority.leaseOwnerId,
    expectedP2PolicyRevision: authority.p2PolicyRevision,
    expectedP2RetentionPolicyVersion: authority.p2RetentionPolicyVersion,
    expectedRetentionExpiresAt: authority.identity.expiresAt,
    expectedSourceManifestHash: authority.identity.sourceManifestHash,
    expectedSourceSessionIds: authority.sourceSessionIds,
    expectedSourceSessionManifestHash: authority.sourceSessionManifestHash,
    expectedTargetLayer: authority.targetLayer,
    expectedTargetLayerRevisionId: committed?.targetLayerRevisionId ?? null,
    expectedTargetRevision: committed?.targetRevision ?? null,
    expectedTargetRevisionDigest: committed?.targetRevisionDigest ?? null,
    expectedTraceStatuses: input.expectedTraceStatuses,
    jobId: authority.identity.aiJobId,
    kind: input.kind,
    terminalStatus: input.status,
    trace,
    writeAt,
  };
}

function recoveryAuthorityError(
  authority: MemoryP2RecoveryAuthority,
  writeAt: Date,
): MemoryP2ErrorCode | null {
  if (authority.migrationStatus !== 'ready' && authority.migrationStatus !== 'completed')
    return 'P2_MIGRATION_UNAVAILABLE';
  if (authority.legacyNullResolutionCount > 0) return 'P2_SOURCE_DRIFT';
  if (authority.retentionState !== 'active') return 'P2_RETENTION_UNAVAILABLE';
  if (
    !Number.isFinite(authority.identity.expiresAt.getTime()) ||
    !Number.isFinite(writeAt.getTime()) ||
    authority.identity.expiresAt <= writeAt
  )
    return 'P2_RETENTION_UNAVAILABLE';
  const checkpoint = authority.checkpoint;
  if (checkpoint === null) return 'P2_SOURCE_DRIFT';
  if (checkpoint.status !== 'committed') return 'P2_RETENTION_UNAVAILABLE';
  if (
    checkpoint.projectId !== authority.identity.projectId ||
    checkpoint.sessionId !== authority.identity.sessionId ||
    checkpoint.sourceManifestHash !== authority.identity.sourceManifestHash
  )
    return 'P2_SOURCE_DRIFT';
  if (checkpoint.deletionScopeDigest !== authority.identity.deletionScopeDigest)
    return 'P2_DELETION_SCOPE_DRIFT';
  if (
    checkpoint.p2PolicyRevision !== authority.p2PolicyRevision ||
    checkpoint.p2RetentionPolicyVersion !== authority.p2RetentionPolicyVersion
  )
    return 'P2_POLICY_DRIFT';
  try {
    const running = buildMemoryP2RunningTrace({
      identity: authority.identity,
      memoryOutcome: 'unjudged',
      p2PolicyRevision: authority.p2PolicyRevision,
      p2RetentionPolicyVersion: authority.p2RetentionPolicyVersion,
      references: authority.references,
      retentionState: 'active',
      sourceSessionScope: recoverySourceSessionScope(authority),
    });
    assertReferenceAuthorityParity(
      running,
      authority.referenceAuthorities,
      recoverySourceSessionScope(authority),
    );
  } catch (error) {
    return error instanceof MemoryP2RuntimeError ? error.code : 'P2_TRACE_UNAVAILABLE';
  }
  return null;
}

function hasCompleteCommitProof(authority: MemoryP2RecoveryAuthority): boolean {
  const committed = authority.committed;
  if (committed === null) return false;
  const resolutionIds = new Set(committed.resolutionAuthorityIds);
  const evidenceIds = new Set(committed.evidenceAuthorityIds);
  const tracedResolutionIds = new Set(
    authority.references
      .filter((reference) => reference.sourceKind === 'resolution')
      .map((reference) => reference.resolutionAuthorityId),
  );
  const tracedEvidenceIds = new Set(
    authority.references
      .filter((reference) => reference.sourceKind === 'evidence')
      .map((reference) => reference.evidenceId),
  );
  return (
    committed.targetLayer === authority.targetLayer &&
    UUID.test(committed.targetLayerIdentityId) &&
    UUID.test(committed.targetLayerRevisionId) &&
    committed.targetRevision > 0 &&
    isDigest(committed.targetRevisionDigest) &&
    isDigest(committed.proposalDigest) &&
    isDigest(committed.planDigest) &&
    isDigest(committed.commitDigest) &&
    resolutionIds.size > 0 &&
    resolutionIds.size === committed.resolutionAuthorityIds.length &&
    [...resolutionIds].every((id) => tracedResolutionIds.has(id)) &&
    evidenceIds.size > 0 &&
    evidenceIds.size === committed.evidenceAuthorityIds.length &&
    [...evidenceIds].every((id) => tracedEvidenceIds.has(id))
  );
}

function hasAnyCommitProof(authority: MemoryP2RecoveryAuthority): boolean {
  return authority.committed !== null;
}

function traceMatchesRunningAuthority(authority: MemoryP2RecoveryAuthority): boolean {
  const trace = authority.trace;
  if (
    trace === null ||
    trace.status !== 'running' ||
    !['frozen', 'proposed', 'validated', 'planned'].includes(trace.stage) ||
    trace.memoryOutcome !== 'unjudged' ||
    trace.errorCode !== null ||
    trace.commitDigest !== null ||
    trace.sourceManifestHash !== authority.identity.sourceManifestHash ||
    trace.deletionScopeDigest !== authority.identity.deletionScopeDigest ||
    trace.p2PolicyRevision !== authority.p2PolicyRevision ||
    trace.p2RetentionPolicyVersion !== authority.p2RetentionPolicyVersion ||
    trace.retentionState !== authority.retentionState ||
    trace.expiresAt.getTime() !== authority.identity.expiresAt.getTime() ||
    !referencesEqual(trace.references, authority.references)
  )
    return false;
  if (trace.stage === 'frozen') return trace.proposalDigest === null && trace.planDigest === null;
  if (!isDigest(trace.proposalDigest ?? '')) return false;
  return trace.stage === 'planned' ? isDigest(trace.planDigest ?? '') : trace.planDigest === null;
}

function traceMatchesCommitted(authority: MemoryP2RecoveryAuthority): boolean {
  const trace = authority.trace;
  const committed = authority.committed;
  return (
    trace !== null &&
    committed !== null &&
    trace.status === 'succeeded' &&
    (trace.stage === 'committed' || trace.stage === 'recovered') &&
    trace.memoryOutcome === committedOutcome(authority) &&
    trace.errorCode === null &&
    trace.sourceManifestHash === authority.identity.sourceManifestHash &&
    trace.deletionScopeDigest === authority.identity.deletionScopeDigest &&
    trace.p2PolicyRevision === authority.p2PolicyRevision &&
    trace.p2RetentionPolicyVersion === authority.p2RetentionPolicyVersion &&
    trace.retentionState === authority.retentionState &&
    trace.expiresAt.getTime() === authority.identity.expiresAt.getTime() &&
    trace.proposalDigest === committed.proposalDigest &&
    trace.planDigest === committed.planDigest &&
    trace.commitDigest === committed.commitDigest &&
    referencesEqual(trace.references, authority.references)
  );
}

function traceMatchesTerminalJob(
  authority: MemoryP2RecoveryAuthority,
  terminalFacts: DurableTerminalFacts,
): boolean {
  const trace = authority.trace;
  return (
    trace !== null &&
    trace.status === terminalFacts.status &&
    (trace.stage === 'terminal' || trace.stage === 'recovered') &&
    trace.memoryOutcome === terminalFacts.memoryOutcome &&
    trace.errorCode === terminalFacts.errorCode &&
    trace.commitDigest === null &&
    trace.sourceManifestHash === authority.identity.sourceManifestHash &&
    trace.deletionScopeDigest === authority.identity.deletionScopeDigest &&
    trace.p2PolicyRevision === authority.p2PolicyRevision &&
    trace.p2RetentionPolicyVersion === authority.p2RetentionPolicyVersion &&
    trace.retentionState === authority.retentionState &&
    trace.expiresAt.getTime() === authority.identity.expiresAt.getTime() &&
    validOptionalDigests(trace.proposalDigest, trace.planDigest) &&
    referencesEqual(trace.references, authority.references)
  );
}

function terminalTraceStatus(status: MemoryP2JobStatus): MemoryP2TerminalStatus {
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return status === 'succeeded' ? 'succeeded' : 'unavailable';
}

function committedOutcome(
  authority: MemoryP2RecoveryAuthority,
): 'checkpoint_committed' | 'long_committed' {
  return authority.committed?.targetLayer === 'long' ? 'long_committed' : 'checkpoint_committed';
}

interface DurableTerminalFacts {
  status: Exclude<MemoryP2TerminalStatus, 'succeeded'>;
  memoryOutcome: Extract<MemoryP2MemoryOutcome, 'failed' | 'cancelled' | 'unavailable'>;
  errorCode: MemoryP2ErrorCode;
}

function durableTerminalFacts(authority: MemoryP2RecoveryAuthority): DurableTerminalFacts | null {
  if (
    authority.jobStatus !== 'failed' &&
    authority.jobStatus !== 'cancelled' &&
    authority.jobStatus !== 'unavailable'
  )
    return null;
  const expectedOutcome = authority.jobStatus;
  if (
    authority.jobMemoryOutcome !== expectedOutcome ||
    !isMemoryP2ErrorCode(authority.jobFailureCode)
  )
    return null;
  return {
    errorCode: authority.jobFailureCode,
    memoryOutcome: expectedOutcome,
    status: authority.jobStatus,
  };
}

function validOptionalDigests(proposalDigest: string | null, planDigest: string | null): boolean {
  return (
    (proposalDigest === null || isDigest(proposalDigest)) &&
    (planDigest === null || isDigest(planDigest)) &&
    (planDigest === null || proposalDigest !== null)
  );
}

function referencesEqual(
  actual: readonly MemoryP2TraceReference[],
  expected: readonly MemoryP2TraceReference[],
): boolean {
  if (actual.length !== expected.length) return false;
  return actual.every((reference, index) => {
    const other = expected[index];
    return (
      other !== undefined &&
      reference.sourceKind === other.sourceKind &&
      traceReferenceId(reference) === traceReferenceId(other) &&
      reference.sourceRevision === other.sourceRevision &&
      reference.membershipDigest === other.membershipDigest &&
      reference.deletionScopeDigest === other.deletionScopeDigest &&
      reference.inputOrder === other.inputOrder
    );
  });
}

function traceReferenceId(reference: MemoryP2TraceReference): string {
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

function recoverySourceSessionScope(
  authority: MemoryP2RecoveryAuthority,
): MemoryP2TraceSourceSessionScope {
  return {
    sourceSessionIds: authority.sourceSessionIds,
    sourceSessionManifestHash: authority.sourceSessionManifestHash,
    targetLayer: authority.targetLayer,
  };
}

function hasBuildableSourceSessionScope(authority: MemoryP2RecoveryAuthority): boolean {
  try {
    assertMemoryP2SourceSessionScope(authority.identity, recoverySourceSessionScope(authority));
    return true;
  } catch {
    return false;
  }
}

function durableLeaseState(
  authority: MemoryP2RecoveryAuthority,
  now: Date,
): 'active' | 'expired' | 'invalid' {
  if (
    authority.leaseOwnerId === null ||
    authority.leaseOwnerId.length < 1 ||
    !Number.isInteger(authority.leaseEpoch) ||
    authority.leaseEpoch < 1 ||
    authority.leaseExpiresAt === null ||
    !Number.isFinite(authority.leaseExpiresAt.getTime())
  )
    return 'invalid';
  return authority.leaseExpiresAt > now ? 'active' : 'expired';
}

function isDigest(value: string): boolean {
  return DIGEST.test(value);
}
