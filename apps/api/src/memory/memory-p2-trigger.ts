import { semanticCanonicalDigest } from './memory-semantic-envelope-contract.js';
import {
  MEMORY_P2_SOURCE_CONTRACT_VERSION,
  type MemoryP2Trigger,
  type MemoryP2TriggerRequest,
} from './memory-p2-runtime.types.js';

const FINAL_TRIGGER = 'session_final_flush';

export function buildMemoryP2Trigger(request: MemoryP2TriggerRequest): MemoryP2Trigger {
  assertTriggerRequest(request);
  const jobKind = request.kind === FINAL_TRIGGER ? 'mid_final' : 'mid_online';
  const triggerIdentity = semanticCanonicalDigest('memory-p2-trigger-v1', {
    final_tail_manifest_hash: request.finalTailManifestHash ?? null,
    job_kind: jobKind,
    kind: request.kind,
    p1_source_contract_version: request.p1SourceContractVersion,
    p1_terminal_job_id: request.p1TerminalJobId,
    policy: request.policy,
    project_id: request.projectId,
    session_id: request.sessionId,
    source_checkpoint_root_identity: request.sourceCheckpointRootIdentity,
    source_manifest_hash: request.sourceManifestHash,
    source_snapshot_id: request.sourceSnapshotId,
    source_snapshot_revision: request.sourceSnapshotRevision,
    target_layer_root_identity: request.targetLayerRootIdentity,
    target_revision: request.targetRevision,
  });
  const attemptNo = (request.retryOf?.attemptNo ?? 0) + 1;
  const requestIdentity = semanticCanonicalDigest('memory-p2-request-v1', {
    attempt_no: attemptNo,
    retry_of_job_id: request.retryOf?.jobId ?? null,
    trigger_identity: triggerIdentity,
  });
  return { ...request, attemptNo, jobKind, requestIdentity, triggerIdentity };
}

function assertTriggerRequest(request: MemoryP2TriggerRequest): void {
  const sourceContractVersion = request.p1SourceContractVersion as string;
  if (sourceContractVersion !== MEMORY_P2_SOURCE_CONTRACT_VERSION)
    throw new Error('P2_P1_SOURCE_VERSION_INVALID');
  if (!Number.isInteger(request.sourceSnapshotRevision) || request.sourceSnapshotRevision < 1)
    throw new Error('P2_SOURCE_REVISION_INVALID');
  if (!Number.isInteger(request.targetRevision) || request.targetRevision < 0)
    throw new Error('P2_TARGET_REVISION_INVALID');
  if (
    request.retryOf !== undefined &&
    (!Number.isInteger(request.retryOf.attemptNo) ||
      request.retryOf.attemptNo < 1 ||
      !isRetryableStatus(request.retryOf.status))
  )
    throw new Error('P2_RETRY_PREDECESSOR_INVALID');

  if (request.kind === FINAL_TRIGGER) {
    if (request.p1TerminalJobId === null || request.finalTailManifestHash === undefined)
      throw new Error('P2_FINAL_SOURCE_REQUIRED');
  } else if (request.p1TerminalJobId !== null || request.finalTailManifestHash !== undefined) {
    throw new Error('P2_ONLINE_SOURCE_INVALID');
  }
}

function isRetryableStatus(value: string): boolean {
  return value === 'failed' || value === 'cancelled' || value === 'unavailable';
}
