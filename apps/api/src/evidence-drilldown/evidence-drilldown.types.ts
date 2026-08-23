import type { P4ContextV2 } from '../memory/p4-context-v2-assembly.js';

export const EVIDENCE_CONTRACT_VERSION = 'p5-evidence-drilldown-v1' as const;
export const EVIDENCE_SCOPE_TYPE = 'p4-frozen-project-session-scope' as const;
export const EVIDENCE_SOURCE_CONTRACT = 'p4-context-freeze-v1' as const;
export const EVIDENCE_STAGE = 'evidence_drilldown' as const;

export type EvidenceOperation = 'get_memory_evidence' | 'search_transcript';
export type EvidenceErrorCode =
  | 'OUT_OF_SCOPE'
  | 'MEMORY_NOT_MEMBER'
  | 'STALE_SOURCE'
  | 'DELETED_SOURCE'
  | 'RETENTION_INELIGIBLE'
  | 'AUTHORIZATION_DENIED'
  | 'MALFORMED_REQUEST'
  | 'MALFORMED_RESULT'
  | 'TOOL_EXECUTION_FAILED'
  | 'ROUND_ALREADY_USED'
  | 'ROUND_RECURSION_FORBIDDEN';

export interface EvidenceRoundFence {
  generation_id: string;
  context_digest: string;
  membership_digest: string;
  evidence_round: 1;
  max_evidence_rounds: 1;
}

export interface EvidenceScope {
  scope_type: typeof EVIDENCE_SCOPE_TYPE;
  source_contract: typeof EVIDENCE_SOURCE_CONTRACT;
  project_id: string;
  current_session_id: string;
  authorized_session_ids: readonly string[];
}

export interface EvidenceRequestEnvelope {
  contract_version: typeof EVIDENCE_CONTRACT_VERSION;
  message_type: 'request';
  request_id: string;
  operation: EvidenceOperation;
  round: EvidenceRoundFence;
  scope: EvidenceScope;
  request: { memory_id: string } | { query: string };
}

export interface EvidenceMemoryReference {
  memory_id: string;
  resolution_authority_id: string;
  revision_id: string;
  revision_no: number;
  source_level: 'mid' | 'long';
  semantic_kind: 'episode' | 'fact';
  semantic_status: 'current' | 'uncertain' | 'disputed';
  membership_digest: string;
}

export interface EvidenceSourceFence {
  authorization: { status: 'authorized'; scope: typeof EVIDENCE_SCOPE_TYPE };
  retention: { status: 'eligible'; policy_revision: string };
  deletion: { status: 'not-deleted'; fence_revision: number };
}

export interface EvidenceTranscriptSegment {
  segment_id: string;
  project_id: string;
  session_id: string;
  start_ms: number;
  text: string;
  trusted_role: 'elder' | 'interviewer';
  content_kind: 'conversation_final';
  text_revision: number;
  speaker_role_revision: number;
  effective_text_digest: string;
  source_fence: EvidenceSourceFence;
}

export interface EvidenceHit {
  source: EvidenceTranscriptSegment;
  neighboring_context: {
    before: readonly EvidenceTranscriptSegment[];
    after: readonly EvidenceTranscriptSegment[];
  };
}

export interface EvidenceDiagnostics {
  stage: typeof EVIDENCE_STAGE;
  error_code: 'NONE' | EvidenceErrorCode;
  duration_ms: number;
  result_count: number;
  reference_count: number;
}

export interface EvidenceResultEnvelope {
  contract_version: typeof EVIDENCE_CONTRACT_VERSION;
  message_type: 'result';
  request_id: string;
  operation: EvidenceOperation;
  round: EvidenceRoundFence;
  scope: EvidenceScope;
  result:
    | {
        result_type: 'memory_evidence';
        memory: EvidenceMemoryReference;
        evidence: readonly EvidenceHit[];
      }
    | {
        result_type: 'transcript_search';
        query: string;
        match_state: 'matches' | 'no_match';
        matches: readonly (EvidenceHit & { match_rank: number })[];
      };
  diagnostics: EvidenceDiagnostics;
}

export interface EvidenceErrorEnvelope {
  contract_version: typeof EVIDENCE_CONTRACT_VERSION;
  message_type: 'error';
  request_id: string;
  operation: EvidenceOperation;
  round: EvidenceRoundFence;
  scope: EvidenceScope;
  error: {
    error_code: EvidenceErrorCode;
    phase: EvidenceErrorPhase;
    generation_outcome: 'SYSTEM_ERROR';
  };
  diagnostics: EvidenceDiagnostics;
}

export type EvidenceErrorPhase =
  | 'request_validation'
  | 'scope'
  | 'membership'
  | 'source_fence'
  | 'round_guard'
  | 'execution'
  | 'result_validation';

export interface EvidenceDrilldownRuntimeScope {
  actorId: string;
  p4Context: P4ContextV2;
}

export interface EvidenceMemoryRecord {
  memory: EvidenceMemoryReference;
  evidence: readonly {
    evidence_id: string;
    authority_revision: number;
    project_id: string;
    session_id: string;
    source_id: string;
    membership_digest: string;
    text_revision: number;
    speaker_role_revision: number;
    effective_text_digest: string;
  }[];
}

export interface EvidenceTranscriptRecord {
  segment_id: string;
  project_id: string;
  session_id: string;
  start_ms: number;
  text: string;
  trusted_role: 'elder' | 'interviewer' | 'unknown';
  content_kind: 'conversation' | 'speaker_calibration';
  text_revision: number;
  speaker_role_revision: number;
  effective_text_digest: string;
}
