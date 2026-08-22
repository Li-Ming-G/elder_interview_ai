export const MEMORY_P2_ERROR_CODES = [
  'P2_PROVIDER_UNAVAILABLE',
  'P2_SOURCE_DRIFT',
  'P2_TARGET_DRIFT',
  'P2_POLICY_DRIFT',
  'P2_DELETION_SCOPE_DRIFT',
  'P2_RETENTION_UNAVAILABLE',
  'P2_CAS_LOST',
  'P2_RESTART_RECOVERY',
  'P2_TRACE_UNAVAILABLE',
  'P2_MIGRATION_UNAVAILABLE',
  'P2_TERMINAL_UNAVAILABLE',
] as const;

export type MemoryP2ErrorCode = (typeof MEMORY_P2_ERROR_CODES)[number];

const MEMORY_P2_ERROR_CODE_SET: ReadonlySet<string> = new Set(MEMORY_P2_ERROR_CODES);

export function isMemoryP2ErrorCode(value: unknown): value is MemoryP2ErrorCode {
  return typeof value === 'string' && MEMORY_P2_ERROR_CODE_SET.has(value);
}

export const MEMORY_P2_TRACE_SOURCE_KINDS = [
  'checkpoint',
  'job',
  'input_segment',
  'evidence',
  'resolution',
] as const;

export type MemoryP2TraceSourceKind = (typeof MEMORY_P2_TRACE_SOURCE_KINDS)[number];
export type MemoryP2JobStatus =
  'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unavailable';
export type MemoryP2TraceStatus = Exclude<MemoryP2JobStatus, 'pending'>;
export type MemoryP2TerminalStatus = Exclude<MemoryP2TraceStatus, 'running'>;
export type MemoryP2TraceStage =
  'frozen' | 'proposed' | 'validated' | 'planned' | 'committed' | 'recovered' | 'terminal';
export type MemoryP2RunningTraceStage = Extract<
  MemoryP2TraceStage,
  'frozen' | 'proposed' | 'validated' | 'planned'
>;
export type MemoryP2AdvanceTraceStage = Exclude<MemoryP2RunningTraceStage, 'frozen'>;
export type MemoryP2MemoryOutcome =
  | 'checkpoint_committed'
  | 'long_committed'
  | 'no_change'
  | 'unjudged'
  | 'failed'
  | 'cancelled'
  | 'unavailable';
export type MemoryP2RetentionState =
  'active' | 'hidden' | 'expired' | 'deleted' | 'purging' | 'purged' | 'cleanup_failed' | 'unknown';

interface MemoryP2TraceReferenceBase {
  sourceRevision: number;
  membershipDigest: string;
  deletionScopeDigest: string;
  inputOrder: number;
}

export interface MemoryP2CheckpointTraceReference extends MemoryP2TraceReferenceBase {
  sourceKind: 'checkpoint';
  sourceCheckpointId: string;
  sourceJobId?: never;
  aiJobInputSegmentId?: never;
  evidenceId?: never;
  resolutionAuthorityId?: never;
}

export interface MemoryP2JobTraceReference extends MemoryP2TraceReferenceBase {
  sourceKind: 'job';
  sourceCheckpointId?: never;
  sourceJobId: string;
  aiJobInputSegmentId?: never;
  evidenceId?: never;
  resolutionAuthorityId?: never;
}

export interface MemoryP2InputSegmentTraceReference extends MemoryP2TraceReferenceBase {
  sourceKind: 'input_segment';
  sourceCheckpointId?: never;
  sourceJobId?: never;
  aiJobInputSegmentId: string;
  evidenceId?: never;
  resolutionAuthorityId?: never;
}

export interface MemoryP2EvidenceTraceReference extends MemoryP2TraceReferenceBase {
  sourceKind: 'evidence';
  sourceCheckpointId?: never;
  sourceJobId?: never;
  aiJobInputSegmentId?: never;
  evidenceId: string;
  resolutionAuthorityId?: never;
}

export interface MemoryP2ResolutionTraceReference extends MemoryP2TraceReferenceBase {
  sourceKind: 'resolution';
  sourceCheckpointId?: never;
  sourceJobId?: never;
  aiJobInputSegmentId?: never;
  evidenceId?: never;
  resolutionAuthorityId: string;
}

export type MemoryP2TraceReference =
  | MemoryP2CheckpointTraceReference
  | MemoryP2JobTraceReference
  | MemoryP2InputSegmentTraceReference
  | MemoryP2EvidenceTraceReference
  | MemoryP2ResolutionTraceReference;

export interface MemoryP2TraceReferenceAuthority {
  sourceKind: MemoryP2TraceSourceKind;
  targetId: string;
  projectId: string;
  sessionId: string;
  sourceRevision: number;
  membershipDigest: string;
  deletionScopeDigest: string;
  readability: 'active' | 'hidden' | 'deleted' | 'expired' | 'missing' | 'cleanup_failed';
}

export interface MemoryP2TracePolicyAuthority {
  aiJobId: string;
  p2PolicyRevision: string;
  p2RetentionPolicyVersion: string;
  deletionScopeDigest: string;
  retentionState: MemoryP2RetentionState;
  expiresAt: Date;
}

export interface MemoryP2TraceSourceSessionScope {
  targetLayer: 'mid' | 'long';
  sourceSessionIds: readonly string[];
  sourceSessionManifestHash: string;
}

export interface MemoryP2TraceSourceSessionAuthority extends MemoryP2TraceSourceSessionScope {
  aiJobId: string;
}

export interface MemoryP2TraceIdentity {
  traceId: string;
  projectId: string;
  sessionId: string;
  ownerActorId: string;
  requestId: string;
  generationId: string;
  aiJobId: string;
  inputHash: string;
  sourceManifestHash: string;
  deletionScopeDigest: string;
  startedAt: Date;
  createdAt: Date;
  expiresAt: Date;
}

export interface MemoryP2DecisionTraceParentRecord extends MemoryP2TraceIdentity {
  triggerType: 'memory_layer_evolve';
  traceKind: 'memory_layer_evolve';
  memoryOutcome: MemoryP2MemoryOutcome;
  decisionOutcome: 'unavailable';
  directorInvoked: false;
  status: MemoryP2TraceStatus;
  stage: MemoryP2TraceStage;
  errorCode: MemoryP2ErrorCode | null;
  contextRevision: 0;
  stageTimingsMs: Record<string, never>;
  completedAt: Date | null;
  durationMs: number | null;
  attemptId: null;
  gateReason: null;
  publicationOutcome: null;
  workingRevision: null;
  activeThreadId: null;
  contextDigest: null;
  retentionState: MemoryP2RetentionState;
}

export interface MemoryP2DecisionTraceSemanticRecord {
  traceId: string;
  aiJobId: string;
  deletionScopeDigest: string;
  sourceManifestHash: string;
  proposalDigest: string | null;
  planDigest: string | null;
  commitDigest: string | null;
  createdAt: Date;
}

export interface MemoryP2DecisionTraceWrite {
  parent: MemoryP2DecisionTraceParentRecord;
  semantic: MemoryP2DecisionTraceSemanticRecord;
  references: readonly MemoryP2TraceReference[];
}

export interface MemoryP2TraceWriteResult {
  outcome: 'created' | 'updated' | 'replayed' | 'cas_lost';
  trace: MemoryP2DecisionTraceWrite | null;
}

export interface MemoryP2DecisionTraceWritePort {
  readonly transactionOwnership: 'existing_ai_job_coordinator';
  createRunning(input: {
    write: MemoryP2DecisionTraceWrite;
    expectedPolicyAuthority: MemoryP2TracePolicyAuthority;
    expectedSourceSessionAuthority: MemoryP2TraceSourceSessionAuthority;
    writeAt: Date;
  }): Promise<MemoryP2TraceWriteResult>;
  advanceRunningStage(input: {
    write: MemoryP2DecisionTraceWrite;
    expectedPolicyAuthority: MemoryP2TracePolicyAuthority;
    expectedSourceSessionAuthority: MemoryP2TraceSourceSessionAuthority;
    expectedStage: MemoryP2RunningTraceStage;
    writeAt: Date;
  }): Promise<MemoryP2TraceWriteResult>;
  writeTerminal(input: {
    write: MemoryP2DecisionTraceWrite;
    expectedPolicyAuthority: MemoryP2TracePolicyAuthority;
    expectedSourceSessionAuthority: MemoryP2TraceSourceSessionAuthority;
    expectedJobStatuses: readonly MemoryP2JobStatus[];
    expectedTraceStatuses: readonly (MemoryP2TraceStatus | 'missing')[];
    writeAt: Date;
  }): Promise<MemoryP2TraceWriteResult>;
}

export interface MemoryP2TraceAuthorityPort {
  readPolicyAuthority(aiJobId: string, writeAt: Date): Promise<MemoryP2TracePolicyAuthority | null>;
  readSourceSessionAuthority(aiJobId: string): Promise<MemoryP2TraceSourceSessionAuthority | null>;
  readReferenceAuthorities(
    references: readonly MemoryP2TraceReference[],
  ): Promise<readonly MemoryP2TraceReferenceAuthority[]>;
}

export interface MemoryP2TraceObservation {
  jobId: string;
  traceId: string | null;
  stage: MemoryP2TraceStage;
  outcome: MemoryP2MemoryOutcome;
  status: MemoryP2TraceStatus;
  errorCode: MemoryP2ErrorCode | null;
  sourceCount: number;
  sourceManifestHash: string;
  deletionScopeDigest: string;
  proposalDigest: string | null;
  planDigest: string | null;
  commitDigest: string | null;
  durationMs: number | null;
}

export interface MemoryP2ObservabilitySink {
  record(observation: MemoryP2TraceObservation): void;
}

export interface MemoryP2CheckpointAuthority {
  checkpointId: string;
  projectId: string;
  sessionId: string;
  sourceManifestHash: string;
  deletionScopeDigest: string;
  p2PolicyRevision: string;
  p2RetentionPolicyVersion: string;
  status: 'committed' | 'hidden' | 'deleted' | 'expired' | 'cleanup_failed';
}

export interface MemoryP2CommittedAuthority {
  targetLayer: 'mid' | 'long';
  targetLayerIdentityId: string;
  targetLayerRevisionId: string;
  targetRevision: number;
  targetRevisionDigest: string;
  proposalDigest: string;
  planDigest: string;
  commitDigest: string;
  resolutionAuthorityIds: readonly string[];
  evidenceAuthorityIds: readonly string[];
}

export interface MemoryP2DurableTraceAuthority {
  traceId: string;
  status: MemoryP2TraceStatus;
  stage: MemoryP2TraceStage;
  memoryOutcome: MemoryP2MemoryOutcome;
  errorCode: MemoryP2ErrorCode | null;
  sourceManifestHash: string;
  deletionScopeDigest: string;
  p2PolicyRevision: string;
  p2RetentionPolicyVersion: string;
  retentionState: MemoryP2RetentionState;
  expiresAt: Date;
  proposalDigest: string | null;
  planDigest: string | null;
  commitDigest: string | null;
  references: readonly MemoryP2TraceReference[];
}

export interface MemoryP2RecoveryAuthority {
  identity: MemoryP2TraceIdentity;
  attemptNo: number;
  jobStatus: MemoryP2JobStatus;
  jobMemoryOutcome: MemoryP2MemoryOutcome | null;
  jobFailureCode: MemoryP2ErrorCode | null;
  jobRevision: number;
  leaseOwnerId: string | null;
  leaseEpoch: number;
  leaseExpiresAt: Date | null;
  p2PolicyRevision: string;
  p2RetentionPolicyVersion: string;
  retentionState: MemoryP2RetentionState;
  targetLayer: 'mid' | 'long';
  sourceSessionIds: readonly string[];
  sourceSessionManifestHash: string;
  checkpoint: MemoryP2CheckpointAuthority | null;
  references: readonly MemoryP2TraceReference[];
  referenceAuthorities: readonly MemoryP2TraceReferenceAuthority[];
  legacyNullResolutionCount: number;
  migrationStatus: 'ready' | 'completed' | 'upgrading' | 'interrupted' | 'unavailable';
  committed: MemoryP2CommittedAuthority | null;
  trace: MemoryP2DurableTraceAuthority | null;
}

export interface MemoryP2CommitFence {
  jobId: string;
  attemptNo: number;
  jobRevision: number;
  checkpointId: string;
  sourceManifestHash: string;
  deletionScopeDigest: string;
  p2PolicyRevision: string;
  p2RetentionPolicyVersion: string;
  leaseOwnerId: string;
  leaseEpoch: number;
  leaseExpiresAt: Date;
}

export interface MemoryP2RecoveryCommand {
  kind: 'terminalize_uncommitted' | 'preserve_committed' | 'repair_terminal_trace';
  jobId: string;
  expectedAttemptNo: number;
  expectedJobRevision: number;
  expectedJobStatuses: readonly MemoryP2JobStatus[];
  expectedLeaseOwnerId: string | null;
  expectedLeaseEpoch: number;
  expectedLeaseExpiresAt: Date | null;
  expectedTraceStatuses: readonly (MemoryP2TraceStatus | 'missing')[];
  expectedCheckpointId: string | null;
  expectedSourceManifestHash: string;
  expectedTargetLayer: 'mid' | 'long';
  expectedSourceSessionIds: readonly string[];
  expectedSourceSessionManifestHash: string;
  expectedDeletionScopeDigest: string;
  expectedP2PolicyRevision: string;
  expectedP2RetentionPolicyVersion: string;
  expectedRetentionExpiresAt: Date;
  expectedTargetLayerRevisionId: string | null;
  expectedTargetRevision: number | null;
  expectedTargetRevisionDigest: string | null;
  expectedCommitDigest: string | null;
  terminalStatus: MemoryP2TerminalStatus;
  errorCode: MemoryP2ErrorCode | null;
  writeAt: Date;
  trace: MemoryP2DecisionTraceWrite;
}

export interface MemoryP2RecoveryCasResult {
  outcome: 'applied' | 'replayed' | 'cas_lost';
}

export interface MemoryP2RecoveryPort {
  readonly transactionOwnership: 'existing_ai_job_coordinator';
  scanCandidateJobIds(input: { limit: number; staleAtOrBefore: Date }): Promise<readonly string[]>;
  readRecoveryAuthority(jobId: string): Promise<MemoryP2RecoveryAuthority | null>;
  applyRecovery(command: MemoryP2RecoveryCommand): Promise<MemoryP2RecoveryCasResult>;
}

export type MemoryP2RecoveryOutcome =
  | 'not_found'
  | 'active_attempt'
  | 'already_converged'
  | 'terminalized_uncommitted'
  | 'preserved_committed'
  | 'repaired_terminal_trace'
  | 'preserved_succeeded_unreadable'
  | 'terminal_authority_unreadable'
  | 'cas_lost';

export interface MemoryP2Clock {
  now(): Date;
}

export class MemoryP2RuntimeError extends Error {
  public constructor(public readonly code: MemoryP2ErrorCode) {
    super(code);
    this.name = 'MemoryP2RuntimeError';
  }
}
