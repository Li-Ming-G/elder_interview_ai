import { createHash } from 'node:crypto';

export const MEMORY_CORE_CONTRACT_VERSION = 'memory-core-v1-candidate' as const;

export type MemoryLayer = 'working' | 'mid' | 'long' | 'unknown';
export type MemoryStatus = 'current' | 'superseded' | 'uncertain' | 'disputed';
export type ThreadStatus = 'active' | 'parked';
export type BoundaryStatus = 'active' | 'revoked' | 'superseded';

export type WorkingMemoryOperationKind =
  'CONTINUE' | 'BRANCH' | 'RESUME' | 'NEW' | 'DUPLICATE' | 'SUPPLEMENT' | 'RELATED' | 'UNCERTAIN';

export interface MemoryEvidenceRef {
  segmentId: string;
  textRevision: number;
  speakerRoleRevision: number;
  effectiveTextDigest: string;
  order: number;
}

export interface WorkingMemoryItem {
  id: string;
  canonicalKey: string;
  memoryType: string;
  value: unknown;
  valueKind: 'exact' | 'range' | 'unknown';
  layer: 'working';
  status: Extract<MemoryStatus, 'current' | 'uncertain' | 'disputed'>;
  revision: number;
  threadId: string;
  evidence: readonly MemoryEvidenceRef[];
}

export interface MemoryThreadState {
  id: string;
  status: ThreadStatus;
  revision: number;
  topicKey: string;
}

export interface MemoryBoundary {
  id: string;
  code: string;
  abstractScope: string;
  status: BoundaryStatus;
  revision: number;
  evidence: readonly MemoryEvidenceRef[];
}

export interface WorkingMemoryCandidateOperation {
  operationId: string;
  kind: WorkingMemoryOperationKind;
  targetMemoryId: string | null;
  targetThreadId: string | null;
  canonicalKey: string | null;
  memoryType: string | null;
  value: unknown;
  valueKind: 'exact' | 'range' | 'unknown' | null;
  evidence: readonly MemoryEvidenceRef[];
  reasonCode:
    | 'same_canonical_key'
    | 'explicit_correction'
    | 'same_topic'
    | 'new_topic'
    | 'duplicate_content'
    | 'uncertain_value'
    | 'boundary_candidate';
}

export interface WorkingMemoryMaintainerInput {
  activeThread: MemoryThreadState | null;
  currentWorking: readonly WorkingMemoryItem[];
  finalizedTranscript: readonly MaintainerTranscriptSegment[];
  sessionMidIndex: readonly MemoryReference[];
}

export interface MaintainerTranscriptSegment {
  segmentId: string;
  sessionId: string;
  startMs: number;
  text: string;
  trustedRole: 'elder' | 'interviewer';
  textRevision: number;
  speakerRoleRevision: number;
  effectiveTextDigest: string;
}

export interface MemoryReference {
  id: string;
  layer: MemoryLayer;
  revision: number | null;
  status: MemoryStatus | 'unavailable';
  canonicalKey: string | null;
  membershipDigest: string | null;
}

export interface MemoryCandidate extends MemoryReference {
  source: 'working' | 'mid_index' | 'recent_transcript';
  rank: number;
  score: number;
  included: boolean;
  exclusionReason: string | null;
}

export interface MemoryContextV2Candidate {
  context_schema_version: 'interview-director-context-v2-candidate';
  interview_state: {
    journey_stage: 'rapport' | 'life_outline' | 'story_depth';
    journey_reason_codes: readonly string[];
    goal: string;
  };
  active_thread: MemoryThreadState | null;
  current_working_memory: readonly WorkingMemoryItem[];
  memory_candidates: readonly MemoryCandidate[];
  boundaries: readonly MemoryBoundary[];
  recent_transcript: readonly MaintainerTranscriptSegment[];
  actual_asked: readonly { id: string; text: string }[];
  recently_displayed: readonly { id: string; text: string }[];
  current_presentation: { id: string; text: string } | null;
  bank_references: readonly { id: string; text: string; purpose: string }[];
  budget: { maxMemoryItems: number; maxCandidateItems: number; maxTranscriptSegments: number };
  membership_digest: string;
}

export function evidenceFromSegment(
  segment: MaintainerTranscriptSegment,
  order: number,
): MemoryEvidenceRef {
  return {
    effectiveTextDigest: segment.effectiveTextDigest,
    order,
    segmentId: segment.segmentId,
    speakerRoleRevision: segment.speakerRoleRevision,
    textRevision: segment.textRevision,
  };
}

export function membershipDigest(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\n'), 'utf8').digest('hex');
}

export function assertCandidateOperation(operation: WorkingMemoryCandidateOperation): void {
  if (operation.evidence.length === 0) throw new Error('MEMORY_OPERATION_EVIDENCE_REQUIRED');
  if (operation.kind === 'NEW' && operation.targetMemoryId !== null) {
    throw new Error('MEMORY_NEW_TARGET_MUST_BE_EMPTY');
  }
  if (
    ['CONTINUE', 'DUPLICATE', 'SUPPLEMENT', 'RESUME'].includes(operation.kind) &&
    operation.targetMemoryId === null
  ) {
    throw new Error('MEMORY_OPERATION_TARGET_REQUIRED');
  }
}
