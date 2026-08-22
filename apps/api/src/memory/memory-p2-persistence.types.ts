import type {
  MemoryResolutionKind,
  MemoryType,
  MemoryValueKind,
  Prisma,
} from '../generated/prisma/client.js';
import { canonicalDigest } from './memory-persistence-contract.js';

export const MEMORY_P2_MIGRATION_NAME = '20260822120000_memory_p2_c_database';
export const MEMORY_P2_MIGRATION_SCHEMA_VERSION = 'memory-persistence-p2c-v1';
export const MEMORY_P2_MIGRATION_PREDECESSOR_FINGERPRINT =
  '2b1a4ba4a0a20f2e986cec7de2c9863dd7a67673abb033406374517e4bafcea6';
export const MEMORY_P2_MANIFEST_ALGORITHM_VERSION = 'canonical-json-sha256-v1';

export type MemoryP2JobKind = 'mid_online' | 'mid_final' | 'long_session_end';
export type MemoryP2TriggerKind = 'semantic_park' | 'capacity_checkpoint' | 'session_final_flush';
export type MemoryP2Layer = 'mid' | 'long';
export type MemoryP2SemanticKind = 'episode' | 'fact';
export type MemoryP2SemanticStatus = 'current' | 'uncertain' | 'disputed';
export type MemoryP2ClaimRole = 'primary' | 'supporting' | 'conflicting' | 'superseded';
export type MemoryP2TraceSourceKind =
  'checkpoint' | 'job' | 'input_segment' | 'evidence' | 'resolution';
export type MemoryP2RetentionTargetKind = 'checkpoint' | 'layer_revision' | 'job' | 'trace';

export type MemoryP2PersistenceErrorCode =
  | 'MEMORY_P2_AUTHORITY_CAS_MISMATCH'
  | 'MEMORY_P2_CHECKPOINT_INVALID'
  | 'MEMORY_P2_COMMIT_ALREADY_TERMINAL'
  | 'MEMORY_P2_INPUT_SCOPE_MISMATCH'
  | 'MEMORY_P2_JOB_NOT_RUNNING'
  | 'MEMORY_P2_MANIFEST_INVALID'
  | 'MEMORY_P2_MIGRATION_UNAVAILABLE'
  | 'MEMORY_P2_READ_UNAVAILABLE'
  | 'MEMORY_P2_SOURCE_NOT_FROZEN';

export class MemoryP2PersistenceError extends Error {
  public constructor(public readonly code: MemoryP2PersistenceErrorCode) {
    super(code);
    this.name = 'MemoryP2PersistenceError';
  }
}

export interface MemoryP2CheckpointMemberInput {
  boundaryStatus: string;
  claimCount: number;
  inputOrder: number;
  membershipDigest: string;
  resolutionAuthorityId: string;
  resolutionRevision: number;
  resolutionRowId: string;
  semanticStatus: MemoryP2SemanticStatus;
}

export interface MemoryP2TraceSourceInput {
  deletionScopeDigest: string;
  inputOrder: number;
  membershipDigest: string;
  sourceId: string;
  sourceKind: MemoryP2TraceSourceKind;
  sourceRevision: number;
}

export interface MemoryP2LeaseToken {
  epoch: number;
  expiresAt: Date;
  owner: string;
}

export interface MemoryP2FreezeCheckpointInput {
  aiJobId: string;
  aiPolicyRevision: number;
  checkpointId: string;
  deletionScopeDigest: string;
  deletionScopePolicyRevision: number;
  evidenceManifestHash: string;
  lease: MemoryP2LeaseToken;
  expectedMemberCount: number;
  expiresAt: Date;
  memberManifestHash: string;
  members: readonly MemoryP2CheckpointMemberInput[];
  midExpectedCount: number;
  midManifestHash: string | null;
  ownerActorId: string;
  p2PolicyContractRevision: string;
  p2PolicyRevision: string;
  p2RetentionContractVersion: string;
  p2RetentionPolicyVersion: string;
  projectId: string;
  retentionPolicyVersion: number;
  rootIdentity: string;
  sourceBoundaryManifestHash: string;
  sourceCurrentExpectedCount: number;
  sourceCurrentManifestHash: string | null;
  sourceP1TerminalJobId: string | null;
  sourceP1TerminalOutcome: string | null;
  sourceP1TerminalStatus: string | null;
  sourceResolutionManifestHash: string;
  sourceRevisionDigest: string;
  sourceSessionId: string;
  sourceSetKind: string;
  sourceThreadId: string;
  sourceThreadManifestHash: string;
  sourceThreadRevision: number;
  sourceThreadRevisionId: string;
  sourceThreadStatus: string;
  sourceTraceReferences: readonly MemoryP2TraceSourceInput[];
  sourceWorkingSnapshotContractVersion: string;
  sourceWorkingSnapshotId: string;
  targetSlotDigest: string;
  traceGenerationId: string;
  traceId: string;
  traceRequestId: string;
  triggerIdentity: string;
  triggerIdentityHash: string;
  triggerKind: MemoryP2TriggerKind;
}

export interface MemoryP2FrozenCheckpoint {
  checkpointId: string;
  replayed: boolean;
  traceId: string;
}

export interface MemoryP2EvidenceInput {
  authorityRevision: 1;
  effectiveTextDigest: string;
  expectedEvidenceId: string | null;
  inputOrder: number;
  inputSegmentId: string;
  membershipDigest: string;
  sourceId: string;
  speakerRoleRevision: number;
  textRevision: number;
}

export interface MemoryP2ClaimInput {
  canonicalKey: string;
  evidences: readonly MemoryP2EvidenceInput[];
  explicitCorrection: boolean;
  memoryType: MemoryType | null;
  normalizedValueDigest: string;
  role: MemoryP2ClaimRole;
  semanticKind: MemoryP2SemanticKind;
  valueJson: Prisma.InputJsonValue;
  valueKind: MemoryValueKind;
}

export interface MemoryP2ResolutionTargetInput {
  authorityId: string | null;
  canonicalKey: string;
  expectedCurrentResolutionId: string | null;
  expectedCurrentRevision: number;
  identityId: string | null;
  identityKeyDigest: string;
  layer: MemoryP2Layer;
  resolutionKind: MemoryResolutionKind;
  resolvedValueJson: Prisma.InputJsonValue | Prisma.JsonNullValueInput;
  semanticKind: MemoryP2SemanticKind;
  semanticStatus: MemoryP2SemanticStatus;
}

export interface MemoryP2FreezeLongJobInput {
  aiJobId: string;
  deletionScopeDigest: string;
  deletionScopePolicyRevision: number;
  expiresAt: Date;
  lease: MemoryP2LeaseToken;
  ownerActorId: string;
  p2PolicyContractRevision: string;
  p2PolicyRevision: string;
  p2RetentionContractVersion: string;
  p2RetentionPolicyVersion: string;
  projectId: string;
  sourceFinalMidCheckpointId: string;
  sourceP1TerminalJobId: string;
  sourceRevisionDigest: string;
  sourceSessionId: string;
  sourceTraceReferences: readonly MemoryP2TraceSourceInput[];
  targetSlotDigest: string;
  traceGenerationId: string;
  traceId: string;
  traceRequestId: string;
  triggerIdentityHash: string;
}

export interface MemoryP2LongSourceInput {
  inputOrder: number;
  membershipDigest: string;
  sourceMidRevisionId: string;
  sourceSessionId: string;
}

export interface MemoryP2CommitInput {
  aiJobId: string;
  checkpointId: string;
  claims: readonly MemoryP2ClaimInput[];
  commitDigest: string;
  longSourceMidManifestHash: string | null;
  longSourceManifestHash: string | null;
  longSources: readonly MemoryP2LongSourceInput[];
  lease: MemoryP2LeaseToken;
  planDigest: string;
  projectId: string;
  proposalDigest: string;
  sourceSessionId: string;
  target: MemoryP2ResolutionTargetInput;
  traceId: string;
}

export interface MemoryP2CommitResult {
  authorityId: string;
  checkpointId: string;
  layerIdentityId: string;
  layerRevisionId: string;
  memoryClaimIds: readonly string[];
  resolutionId: string;
  resolutionRevision: number;
  targetRevisionDigest: string;
}

export interface MemoryP2LongWakeCandidate {
  ownerActorId: string;
  projectId: string;
  sourceFinalMidCheckpointId: string;
  sourceMidJobId: string;
  sourceP1TerminalJobId: string;
  sourceRevisionDigest: string;
  sourceSessionId: string;
  triggerDedupeKey: string;
}

export interface MemoryP2TerminalizeUnavailableInput {
  aiJobId: string;
  errorCode: string;
  lease: MemoryP2LeaseToken;
  traceId: string;
}

export interface MemoryP2StaleRecoveryCandidate {
  aiJobId: string;
  lease: MemoryP2LeaseToken;
}

export interface MemoryP2ClaimRecoveryLeaseInput {
  aiJobId: string;
  expectedEpoch: number;
  leaseExpiresAt: Date;
  leaseOwner: string;
}

export interface ReadableMemoryP2Checkpoint {
  checkpointId: string;
  committedAt: Date;
  memberIds: readonly string[];
  memberManifestHash: string;
  projectId: string;
  sourceSessionId: string;
}

export interface ReadableMemoryP2LayerRevision {
  authorityId: string;
  claimIds: readonly string[];
  identityId: string;
  layer: MemoryP2Layer;
  memberManifestHash: string;
  resolutionId: string;
  resolutionRevision: number;
  revisionId: string;
  revisionNo: number;
  semanticStatus: MemoryP2SemanticStatus;
}

export function memoryP2CheckpointManifestHash(
  members: readonly MemoryP2CheckpointMemberInput[],
): string {
  return canonicalDigest(
    members.map((member) => [
      member.resolutionAuthorityId,
      member.resolutionRevision,
      member.semanticStatus,
      member.claimCount,
      member.boundaryStatus,
      member.membershipDigest,
      member.inputOrder,
    ]),
  );
}

export function memoryP2ClaimEvidenceManifestHash(
  evidences: readonly {
    authorityRevision: number;
    evidenceId: string;
    membershipDigest: string;
    sourceId: string;
  }[],
  projectId: string,
  sourceSessionId: string,
): string {
  return canonicalDigest(
    [...evidences]
      .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId))
      .map((row) => [
        row.evidenceId,
        'transcript_segment',
        row.sourceId,
        row.authorityRevision,
        row.membershipDigest,
        projectId,
        sourceSessionId,
      ]),
  );
}

export function memoryP2LayerMemberManifestHash(
  members: readonly {
    claimId: string;
    evidenceMembershipDigest: string;
    inputOrder: number;
    role: MemoryP2ClaimRole;
  }[],
): string {
  return canonicalDigest(
    members.map((member) => [
      member.claimId,
      1,
      member.role,
      member.inputOrder,
      member.evidenceMembershipDigest,
    ]),
  );
}

export function memoryP2LongSourceManifestHash(
  sources: readonly MemoryP2LongSourceInput[],
): string {
  return canonicalDigest(
    sources.map((source) => [
      source.sourceSessionId,
      source.sourceMidRevisionId,
      source.membershipDigest,
      source.inputOrder,
    ]),
  );
}

export function memoryP2SourceSessionSetHash(sourceSessionIds: readonly string[]): string {
  return canonicalDigest([...new Set(sourceSessionIds)].sort());
}
