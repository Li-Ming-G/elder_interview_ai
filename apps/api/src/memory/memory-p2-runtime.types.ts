import type {
  DecisionTraceStatus,
  DecisionTraceTerminalResult,
} from '../ai-runtime/decision-trace.service.js';

export const MEMORY_P2_SOURCE_CONTRACT_VERSION = 'memory-maintainer-v1.2' as const;

export type MemoryP2TriggerKind = 'semantic_park' | 'capacity_checkpoint' | 'session_final_flush';

export type MemoryP2JobKind = 'mid_online' | 'mid_final';
export type MemoryP2TerminalStatus = Extract<
  DecisionTraceStatus,
  'failed' | 'cancelled' | 'unavailable'
>;
export type MemoryP2RetryableStatus = MemoryP2TerminalStatus;
/** The durable adapter validates values against the formal shared P2 registry before persistence. */
export type MemoryP2ErrorCode = NonNullable<DecisionTraceTerminalResult['errorCode']>;

export interface MemoryP2PolicyBinding {
  aiPolicyRevision: number;
  deletionScopeDigest: string;
  p2PolicyRevision: string;
  p2RetentionPolicyVersion: string;
  retentionPolicyVersion: number;
}

export interface MemoryP2RetryPredecessor {
  attemptNo: number;
  jobId: string;
  status: MemoryP2RetryableStatus;
}

export interface MemoryP2TriggerRequest {
  finalTailManifestHash?: string;
  kind: MemoryP2TriggerKind;
  p1SourceContractVersion: typeof MEMORY_P2_SOURCE_CONTRACT_VERSION;
  p1TerminalJobId: string | null;
  policy: MemoryP2PolicyBinding;
  projectId: string;
  retryOf?: MemoryP2RetryPredecessor;
  sessionId: string;
  sourceCheckpointRootIdentity: string;
  sourceManifestHash: string;
  sourceSnapshotId: string;
  sourceSnapshotRevision: number;
  targetLayerRootIdentity: string;
  targetRevision: number;
}

export interface MemoryP2Trigger extends MemoryP2TriggerRequest {
  attemptNo: number;
  jobKind: MemoryP2JobKind;
  requestIdentity: string;
  triggerIdentity: string;
}

export interface MemoryP2SemanticClaim {
  claim_key: string;
  evidence_ref_ids: string[];
  source_claim_ref_id: string;
  value: unknown;
  value_kind: 'exact' | 'range' | 'unknown';
}

export interface MemoryP2SemanticState {
  canonical_key: string;
  claims: MemoryP2SemanticClaim[];
  memory_tag:
    | 'person'
    | 'relationship'
    | 'place'
    | 'event'
    | 'time'
    | 'time_range'
    | 'important_choice'
    | 'reason_clue'
    | 'unfinished_story'
    | null;
  resolution_kind: 'single' | 'range' | 'unknown' | 'conflict_set';
  semantic_kind: 'episode' | 'fact';
  semantic_status: 'current' | 'uncertain' | 'disputed';
  value: unknown;
  value_kind: 'exact' | 'range' | 'unknown' | null;
}

export interface MemoryP2SourceMember {
  authority: 'automatic' | 'human_confirmed';
  content_digest: string;
  input_order: number;
  project_id: string;
  resolution_id: string;
  resolution_revision: number;
  semantic_state: MemoryP2SemanticState;
  session_id: string;
  source_kind: 'working_resolution' | 'mid_resolution' | 'current_resolution';
  source_ref_id: string;
}

export interface MemoryP2SemanticContext {
  context_schema_version: 'memory-semantic-context-v1';
  evidence_manifest_hash: string;
  evidence_membership: readonly Record<string, unknown>[];
  limits: Record<string, unknown>;
  mode: 'working_to_mid' | 'session_end_to_long';
  policy: {
    deletion_scope_digest: string;
    deletion_scope_status: 'active';
    policy_revision: string;
    retention_policy_version: string;
    retention_status: 'active';
  };
  project_id: string;
  source_checkpoint: Record<string, unknown>;
  source_manifest_hash: string;
  source_members: readonly MemoryP2SourceMember[];
  source_session_id: string;
  source_session_ids: readonly string[];
}

export interface MemoryP2ProposedClaim {
  claim_key: string;
  evidence_ref_ids: string[];
  proposal_claim_ref_id: string;
  source_claim_ref_ids: string[];
  value: unknown;
  value_kind: 'exact' | 'range' | 'unknown';
}

export interface MemoryP2ProposedState extends Omit<MemoryP2SemanticState, 'claims'> {
  claims: MemoryP2ProposedClaim[];
}

export interface MemoryP2ProposalEntry {
  proposal_id: string;
  proposed_state: MemoryP2ProposedState;
  reason_code:
    | 'new_semantic_slot'
    | 'duplicate_semantics'
    | 'episode_reorganization'
    | 'history_compression'
    | 'unresolved_evidence';
  semantic_intent: 'derive' | 'merge' | 'reorganize' | 'compress' | 'mark_uncertain';
  source_member_ref_ids: string[];
  target: {
    existing_source_ref_id: string | null;
    kind: 'new_slot' | 'existing_slot';
  };
}

export interface MemoryP2SemanticProposal {
  output_schema_version: 'memory-semantic-proposal-v1';
  proposals: MemoryP2ProposalEntry[];
  source_manifest_hash: string;
}

export interface MemoryP2MutationPlanEntry {
  claim_evidence_manifest_hash: string;
  proposal_id: string;
  proposed_state_digest: string;
  source_member_ref_ids: string[];
  target_authority_ref: {
    expected_revision: number;
    resolution_id: string;
  } | null;
  target_kind: 'new_slot' | 'existing_slot';
}

export interface MemoryP2MutationPlan {
  entries: MemoryP2MutationPlanEntry[];
  plan_digest: string;
  plan_schema_version: 'validated-memory-mutation-plan-v1';
  proposal_digest: string;
  source_manifest_hash: string;
}

export interface MemoryP2FrozenAttempt {
  attemptNo: number;
  context: MemoryP2SemanticContext;
  deadlineAt: Date;
  jobId: string;
  trigger: MemoryP2Trigger;
}

export type MemoryP2StoredOutcome =
  | {
      commitProjection: unknown;
      jobId: string;
      status: 'succeeded';
    }
  | {
      errorCode: MemoryP2ErrorCode;
      jobId: string;
      status: MemoryP2TerminalStatus;
    };

export type MemoryP2FreezeResult =
  | { attempt: MemoryP2FrozenAttempt; kind: 'claimed' }
  | { jobId: string; kind: 'in_progress'; status: 'pending' | 'running' }
  | { kind: 'replay'; outcome: MemoryP2StoredOutcome };

export type MemoryP2GateResult =
  | { kind: 'allowed' }
  | {
      errorCode: MemoryP2ErrorCode;
      kind: 'blocked';
      status: MemoryP2TerminalStatus;
    };

export type MemoryP2AuthorityResult =
  | { authorityToken: string; kind: 'current' }
  | {
      errorCode: MemoryP2ErrorCode;
      kind: 'drifted';
      status: 'cancelled' | 'unavailable';
    };

export interface MemoryP2CommitRequest {
  attempt: MemoryP2FrozenAttempt;
  authorityToken: string;
  /** Transient input for applying Claim/Resolution/Evidence writes; never persist this object. */
  plan: MemoryP2MutationPlan;
  /** Transient provider output; never persist this object or include it in Trace/logs. */
  proposal: MemoryP2SemanticProposal;
}

export type MemoryP2CommitResult =
  { commitProjection: unknown; kind: 'committed' } | { errorCode: 'P2_CAS_LOST'; kind: 'cas_lost' };

export interface MemoryP2TerminalRequest {
  attempt: MemoryP2FrozenAttempt;
  errorCode: MemoryP2ErrorCode;
  status: MemoryP2TerminalStatus;
}

export interface MemoryP2LongFollowUp {
  finalMidCommitProjection: unknown;
  finalMidJobId: string;
  finalTailManifestHash: string;
  projectId: string;
  sessionId: string;
}

export interface MemoryP2RuntimeStorePort {
  /** Atomically CAS-writes semantic authority, layer facts, committed projection, and terminal Trace. */
  commitAuthorityAndTerminalTrace(request: MemoryP2CommitRequest): Promise<MemoryP2CommitResult>;
  /** Atomically enforces one-winner/retry-predecessor rules and freezes checkpoint/job/running Trace. */
  freezeJobCheckpointAndRunningTrace(trigger: MemoryP2Trigger): Promise<MemoryP2FreezeResult>;
  /** Rechecks permission, deletion, retention, and policy immediately before provider invocation. */
  preProviderGate(attempt: MemoryP2FrozenAttempt): Promise<MemoryP2GateResult>;
  /** Re-reads source/target/policy/evidence authority and returns a single-use commit CAS token. */
  readAuthority(attempt: MemoryP2FrozenAttempt): Promise<MemoryP2AuthorityResult>;
  /** Returns true only after the idempotent Long wake is durably registered. */
  registerLongWakeAfterFinalMid(followUp: MemoryP2LongFollowUp): Promise<boolean>;
  /** Atomically CAS-terminalizes the job and reference-only Trace with zero target writes. */
  terminalizeJobAndTrace(request: MemoryP2TerminalRequest): Promise<MemoryP2StoredOutcome>;
}

export type MemoryP2ProgressEvent =
  | {
      jobId: string;
      sourceManifestHash: string;
      stage: 'context_validated';
    }
  | {
      jobId: string;
      sourceManifestHash: string;
      stage: 'proposal_received';
    }
  | {
      jobId: string;
      proposalDigest: string;
      sourceManifestHash: string;
      stage: 'proposal_validated';
    }
  | {
      jobId: string;
      planDigest: string;
      proposalDigest: string;
      sourceManifestHash: string;
      stage: 'plan_built';
    }
  | {
      jobId: string;
      sourceManifestHash: string;
      stage: 'authority_checked';
    };

/**
 * Emits non-authoritative, reference-only progress. The DB port owns formal lifecycle and Trace
 * writes through freeze/commit/terminalize; this port never receives payloads or CAS tokens.
 */
export interface MemoryP2ProgressPort {
  recordProgress(event: MemoryP2ProgressEvent): Promise<void>;
}

export type MemoryP2RunResult =
  | {
      commitProjection: unknown;
      followUp: 'not_applicable' | 'registered';
      jobId: string;
      outcome: 'succeeded';
      replayed: boolean;
    }
  | {
      jobId: string;
      outcome: 'in_progress';
      status: 'pending' | 'running';
    }
  | {
      errorCode: MemoryP2ErrorCode;
      jobId: string;
      outcome: 'terminal';
      replayed: boolean;
      status: MemoryP2TerminalStatus;
    }
  | {
      errorCode: MemoryP2ErrorCode;
      jobId: string;
      outcome: 'rebase_required';
    }
  | {
      errorCode: MemoryP2ErrorCode;
      outcome: 'not_frozen';
      requestIdentity: string;
    }
  | {
      errorCode: MemoryP2ErrorCode;
      jobId: string;
      outcome: 'repair_required';
      persistedStatus: 'running';
      repair: 'startup_reconciliation' | 'terminalize';
    }
  | {
      commitProjection: unknown;
      errorCode: MemoryP2ErrorCode;
      jobId: string;
      outcome: 'follow_up_pending';
      persistedStatus: 'succeeded';
      repair: 'long_wake_registration';
      replayed: boolean;
    };
