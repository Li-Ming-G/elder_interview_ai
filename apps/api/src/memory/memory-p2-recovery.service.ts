import {
  assertReferenceAuthorityParity,
  buildMemoryP2RunningTrace,
  buildMemoryP2TerminalTrace,
} from './memory-p2-decision-trace.service.js';
import {
  MemoryP2RuntimeError,
  type MemoryP2CommitFence,
  type MemoryP2DecisionTraceWrite,
  type MemoryP2ErrorCode,
  type MemoryP2JobStatus,
  type MemoryP2ObservabilitySink,
  type MemoryP2RecoveryAuthority,
  type MemoryP2RecoveryCommand,
  type MemoryP2RecoveryOutcome,
  type MemoryP2RecoveryPort,
  type MemoryP2TerminalStatus,
  type MemoryP2TraceStatus,
} from './memory-p2-observability.types.js';

const DIGEST = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface MemoryP2RecoveryScanResult {
  jobId: string;
  outcome: MemoryP2RecoveryOutcome;
}

export class MemoryP2RecoveryService {
  public constructor(
    private readonly repository: MemoryP2RecoveryPort,
    private readonly observations: MemoryP2ObservabilitySink,
  ) {}

  public async reconcilePersistedState(
    limit = 200,
  ): Promise<readonly MemoryP2RecoveryScanResult[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
      throw new MemoryP2RuntimeError('P2_TRACE_UNAVAILABLE');
    const ids = [...new Set(await this.repository.scanCandidateJobIds(limit))];
    const results: MemoryP2RecoveryScanResult[] = [];
    for (const jobId of ids) results.push({ jobId, outcome: await this.reconcileJob(jobId) });
    return results;
  }

  public async reconcileJob(jobId: string): Promise<MemoryP2RecoveryOutcome> {
    const authority = await this.repository.readRecoveryAuthority(jobId);
    if (authority === null) return 'not_found';
    const authorityError = recoveryAuthorityError(authority);
    const completeCommit = hasCompleteCommitProof(authority);
    const anyCommit = hasAnyCommitProof(authority);

    if (authority.jobStatus === 'succeeded') {
      if (authorityError !== null || !completeCommit)
        return this.preserveSucceededUnreadable(authority, authorityError ?? 'P2_TARGET_DRIFT');
      if (traceMatchesCommitted(authority)) return 'already_converged';
      if (authority.trace !== null && authority.trace.status !== 'running')
        return this.preserveSucceededUnreadable(authority, 'P2_TRACE_UNAVAILABLE');
      return this.apply(
        authority,
        recoveryCommand(authority, {
          errorCode: null,
          expectedJobStatuses: ['succeeded'],
          expectedTraceStatuses: ['missing', 'running'],
          kind: 'preserve_committed',
          status: 'succeeded',
        }),
        'preserved_committed',
      );
    }

    if (authority.jobStatus === 'pending' || authority.jobStatus === 'running') {
      if (
        completeCommit &&
        authorityError === null &&
        (authority.trace === null ||
          authority.trace.status === 'running' ||
          traceMatchesCommitted(authority))
      )
        return this.apply(
          authority,
          recoveryCommand(authority, {
            errorCode: null,
            expectedJobStatuses: ['pending', 'running'],
            expectedTraceStatuses: ['missing', 'running', 'succeeded'],
            kind: 'preserve_committed',
            status: 'succeeded',
          }),
          'preserved_committed',
        );
      if (anyCommit)
        return this.preserveSucceededUnreadable(authority, authorityError ?? 'P2_TARGET_DRIFT');
      const errorCode = authorityError ?? 'P2_RESTART_RECOVERY';
      return this.apply(
        authority,
        recoveryCommand(authority, {
          errorCode,
          expectedJobStatuses: ['pending', 'running'],
          expectedTraceStatuses: ['missing', 'running'],
          kind: 'terminalize_uncommitted',
          status: 'unavailable',
        }),
        'terminalized_uncommitted',
      );
    }

    if (anyCommit)
      return this.preserveSucceededUnreadable(authority, authorityError ?? 'P2_TARGET_DRIFT');
    if (traceMatchesTerminalJob(authority)) return 'already_converged';
    const status = terminalTraceStatus(authority.jobStatus);
    const errorCode =
      authority.trace?.errorCode ?? authorityError ?? terminalErrorForJob(authority.jobStatus);
    return this.apply(
      authority,
      recoveryCommand(authority, {
        errorCode,
        expectedJobStatuses: [authority.jobStatus],
        expectedTraceStatuses: ['missing', 'running'],
        kind: 'repair_terminal_trace',
        status,
      }),
      'repaired_terminal_trace',
    );
  }

  public async createCommitFence(jobId: string, attemptNo: number): Promise<MemoryP2CommitFence> {
    const authority = await this.repository.readRecoveryAuthority(jobId);
    if (authority === null || authority.attemptNo !== attemptNo)
      throw new MemoryP2RuntimeError('P2_CAS_LOST');
    if (
      authority.jobStatus !== 'running' ||
      authority.committed !== null ||
      (authority.trace !== null && authority.trace.status !== 'running')
    )
      throw new MemoryP2RuntimeError('P2_CAS_LOST');
    const authorityError = recoveryAuthorityError(authority);
    if (authorityError !== null) throw new MemoryP2RuntimeError(authorityError);
    const checkpoint = authority.checkpoint;
    if (checkpoint === null) throw new MemoryP2RuntimeError('P2_SOURCE_DRIFT');
    return {
      attemptNo,
      checkpointId: checkpoint.checkpointId,
      deletionScopeDigest: authority.identity.deletionScopeDigest,
      jobId,
      jobRevision: authority.jobRevision,
      p2PolicyRevision: authority.p2PolicyRevision,
      p2RetentionPolicyVersion: authority.p2RetentionPolicyVersion,
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
  input: {
    kind: MemoryP2RecoveryCommand['kind'];
    status: MemoryP2TerminalStatus;
    errorCode: MemoryP2ErrorCode | null;
    expectedJobStatuses: readonly MemoryP2JobStatus[];
    expectedTraceStatuses: readonly (MemoryP2TraceStatus | 'missing')[];
  },
): MemoryP2RecoveryCommand {
  const committed = authority.committed;
  const success = input.status === 'succeeded';
  const trace = buildMemoryP2TerminalTrace({
    commitDigest: success ? (committed?.commitDigest ?? null) : null,
    completedAt: new Date(Math.max(authority.identity.startedAt.getTime(), Date.now())),
    errorCode: input.errorCode,
    identity: authority.identity,
    memoryOutcome: success
      ? committedOutcome(authority)
      : input.status === 'cancelled'
        ? 'cancelled'
        : 'unavailable',
    p2PolicyRevision: authority.p2PolicyRevision,
    p2RetentionPolicyVersion: authority.p2RetentionPolicyVersion,
    planDigest: success ? (committed?.planDigest ?? null) : (authority.trace?.planDigest ?? null),
    proposalDigest: success
      ? (committed?.proposalDigest ?? null)
      : (authority.trace?.proposalDigest ?? null),
    references: authority.references,
    retentionState: authority.retentionState,
    stage: success ? 'recovered' : 'recovered',
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
    expectedP2PolicyRevision: authority.p2PolicyRevision,
    expectedP2RetentionPolicyVersion: authority.p2RetentionPolicyVersion,
    expectedSourceManifestHash: authority.identity.sourceManifestHash,
    expectedTargetLayerRevisionId: committed?.targetLayerRevisionId ?? null,
    expectedTargetRevision: committed?.targetRevision ?? null,
    expectedTargetRevisionDigest: committed?.targetRevisionDigest ?? null,
    expectedTraceStatuses: input.expectedTraceStatuses,
    jobId: authority.identity.aiJobId,
    kind: input.kind,
    terminalStatus: input.status,
    trace,
  };
}

function recoveryAuthorityError(authority: MemoryP2RecoveryAuthority): MemoryP2ErrorCode | null {
  if (authority.migrationStatus !== 'ready' && authority.migrationStatus !== 'completed')
    return 'P2_MIGRATION_UNAVAILABLE';
  if (authority.legacyNullResolutionCount > 0) return 'P2_SOURCE_DRIFT';
  if (authority.retentionState !== 'active') return 'P2_RETENTION_UNAVAILABLE';
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
    });
    assertReferenceAuthorityParity(running, authority.referenceAuthorities);
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

function traceMatchesCommitted(authority: MemoryP2RecoveryAuthority): boolean {
  const trace = authority.trace;
  const committed = authority.committed;
  return (
    trace !== null &&
    committed !== null &&
    trace.status === 'succeeded' &&
    (trace.stage === 'committed' || trace.stage === 'recovered') &&
    trace.errorCode === null &&
    trace.sourceManifestHash === authority.identity.sourceManifestHash &&
    trace.deletionScopeDigest === authority.identity.deletionScopeDigest &&
    trace.proposalDigest === committed.proposalDigest &&
    trace.planDigest === committed.planDigest &&
    trace.commitDigest === committed.commitDigest
  );
}

function traceMatchesTerminalJob(authority: MemoryP2RecoveryAuthority): boolean {
  const trace = authority.trace;
  return (
    trace !== null &&
    trace.status === terminalTraceStatus(authority.jobStatus) &&
    trace.commitDigest === null &&
    trace.sourceManifestHash === authority.identity.sourceManifestHash &&
    trace.deletionScopeDigest === authority.identity.deletionScopeDigest
  );
}

function terminalTraceStatus(status: MemoryP2JobStatus): MemoryP2TerminalStatus {
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return status === 'succeeded' ? 'succeeded' : 'unavailable';
}

function terminalErrorForJob(status: MemoryP2JobStatus): MemoryP2ErrorCode {
  if (status === 'unavailable') return 'P2_TERMINAL_UNAVAILABLE';
  return 'P2_RESTART_RECOVERY';
}

function committedOutcome(
  authority: MemoryP2RecoveryAuthority,
): 'checkpoint_committed' | 'long_committed' {
  return authority.committed?.targetLayer === 'long' ? 'long_committed' : 'checkpoint_committed';
}

function isDigest(value: string): boolean {
  return DIGEST.test(value);
}
