import { Injectable } from '@nestjs/common';

export type MemoryGateCandidateKind = 'episode' | 'fact' | 'boundary';
export type MemoryGateOperation =
  'create' | 'correct' | 'mark_uncertain' | 'mark_disputed' | 'activate' | 'revoke' | 'supersede';
export type MemoryGateDecisionStatus = 'accepted' | 'rejected' | 'review_required';
export type MemoryGateMutationAction =
  'none' | 'create_authority_revision' | 'append_memory_revision' | 'append_boundary_revision';

export type MemoryGateReasonCode =
  | 'EXPLICIT_ELDER_EVIDENCE'
  | 'EXPLICIT_BOUNDARY_INTENT'
  | 'APPENDED_CORRECTION'
  | 'CONFLICT_REQUIRES_REVIEW'
  | 'ELIGIBLE_EVIDENCE_WITH_CONFLICT'
  | 'EVIDENCE_MISSING'
  | 'FACT_EXPLICIT_ELDER_EVIDENCE_REQUIRED'
  | 'BOUNDARY_EXPLICIT_INTENT_REQUIRED'
  | 'BOUNDARY_WITHDRAWAL_REQUIRED'
  | 'BOUNDARY_HUMAN_AUTHORIZATION_REQUIRED'
  | 'EVIDENCE_NOT_ELIGIBLE'
  | 'STALE_EVIDENCE'
  | 'DELETED_EVIDENCE'
  | 'RETENTION_INELIGIBLE'
  | 'UNKNOWN_AUTHORITY'
  | 'ILLEGAL_TRANSITION'
  | 'REVISION_MISMATCH'
  | 'AMBIGUOUS_CORRECTION'
  | 'SEMANTIC_KIND_MISMATCH'
  | 'AUTHORITY_SNAPSHOT_MISMATCH';

export interface MemoryGateEvidenceReference {
  evidenceId: string;
  sourceKind: 'transcript_segment';
  sourceId: string;
  authorityRevision: number;
  projectId: string;
  sessionId: string;
  trustedRole: 'elder' | 'interviewer';
  contentKind: 'conversation_final';
  textRevision: number;
  speakerRoleRevision: number;
  effectiveTextDigest: string;
  evidenceRole:
    | 'explicit_fact_statement'
    | 'elder_story_context'
    | 'boundary_activation_intent'
    | 'boundary_withdrawal_or_contradiction'
    | 'interviewer_suggestion'
    | 'model_inference'
    | 'unknown';
  eligibility: {
    authorization: 'authorized' | 'denied' | 'unknown';
    retention: 'eligible' | 'ineligible' | 'unknown';
    deletion: 'not-deleted' | 'deleted' | 'unknown';
  };
}

/**
 * Reads already accepted authority signals. A semantic kind or transcript
 * marker is not an evidence classification, and ordinary transcript prose is
 * never promoted to an explicit Fact or Boundary intent.
 */
export function classifyMemoryGateEvidenceRole(
  trustedRole: MemoryGateEvidenceReference['trustedRole'],
  _text: string,
  acceptedFactAuthority = false,
  acceptedBoundaryIntent = false,
): MemoryGateEvidenceReference['evidenceRole'] {
  void _text;
  if (trustedRole !== 'elder') return 'interviewer_suggestion';
  if (acceptedFactAuthority) return 'explicit_fact_statement';
  if (acceptedBoundaryIntent) return 'boundary_activation_intent';
  return 'elder_story_context';
}

export function memoryGateEligibility(
  policyAuthorized: boolean,
  retentionEligible: boolean,
  deletionEligible: boolean,
): MemoryGateEvidenceReference['eligibility'] {
  return {
    authorization: policyAuthorized ? 'authorized' : 'unknown',
    deletion: deletionEligible ? 'not-deleted' : 'unknown',
    retention: retentionEligible ? 'eligible' : 'ineligible',
  };
}

export interface MemoryGateAuthoritySnapshot {
  authorityContract: 'memory-claim-resolution-v1';
  projectId: string;
  currentSessionId: string;
  sourceSessionIds: readonly string[];
  evidenceManifestDigest: string;
  deletionScopeDigest: string;
  policyRevision: string;
  snapshotRevision: number;
}

export interface MemoryGateMemoryTarget {
  targetType: 'memory_resolution';
  authorityId: string;
  revisionId: string;
  revisionNo: number;
  resolutionStatus: 'current' | 'superseded';
  semanticStatus: 'current' | 'uncertain' | 'disputed';
  semanticKind: 'episode' | 'fact';
}

export interface MemoryGateBoundaryTarget {
  targetType: 'boundary_revision';
  boundaryId: string;
  revisionId: string;
  revisionNo: number;
  status: 'active' | 'revoked' | 'superseded';
}

export interface MemoryGateSemanticClaim {
  claimId: string | null;
  claimKey: string;
  evidenceIds: readonly string[];
}

export interface MemoryGateSemanticState {
  semanticKind: 'episode' | 'fact';
  canonicalKey: string;
  valueKind: 'exact' | 'range' | 'unknown' | null;
  value: unknown;
  resolutionKind: 'single' | 'range' | 'unknown' | 'conflict_set';
  semanticStatus: 'current' | 'uncertain' | 'disputed';
  reviewRequired: boolean;
  claims: readonly MemoryGateSemanticClaim[];
}

export interface MemoryGateBoundaryState {
  code: 'elder_explicit_boundary';
  abstractScope: string;
  status: 'active' | 'revoked' | 'superseded';
  reviewRequired: boolean;
}

export interface MemoryGateCandidate {
  candidateId: string;
  proposalSource: 'llm_proposal';
  candidateKind: MemoryGateCandidateKind;
  operation: MemoryGateOperation;
  target: MemoryGateMemoryTarget | MemoryGateBoundaryTarget | null;
  expectedRevision: number | null;
  proposedState: MemoryGateSemanticState | MemoryGateBoundaryState;
  evidence: readonly MemoryGateEvidenceReference[];
  evidenceManifestDigest: string;
}

export interface MemoryGateMutationPlan {
  action: MemoryGateMutationAction;
  authorityKind: 'memory_resolution' | 'boundary_revision';
  newRevisionId: string | null;
  newRevisionNo: number | null;
  predecessorRevisionId: string | null;
  predecessorPreserved: true;
  evidencePreserved: true;
  sourcePreserved: true;
}

export interface MemoryGateDecision {
  decisionStatus: MemoryGateDecisionStatus;
  reasonCode: MemoryGateReasonCode;
  failClosed: boolean;
  mutation: MemoryGateMutationPlan;
}

const NO_MUTATION = (
  authorityKind: MemoryGateMutationPlan['authorityKind'],
): MemoryGateMutationPlan => ({
  action: 'none',
  authorityKind,
  newRevisionId: null,
  newRevisionNo: null,
  predecessorRevisionId: null,
  predecessorPreserved: true,
  evidencePreserved: true,
  sourcePreserved: true,
});

function rejected(
  authorityKind: MemoryGateMutationPlan['authorityKind'],
  reasonCode: MemoryGateReasonCode,
): MemoryGateDecision {
  return {
    decisionStatus: 'rejected',
    failClosed: true,
    mutation: NO_MUTATION(authorityKind),
    reasonCode,
  };
}

function review(
  candidate: MemoryGateCandidate,
  reasonCode: MemoryGateReasonCode,
  action: MemoryGateMutationAction,
): MemoryGateDecision {
  return {
    decisionStatus: 'review_required',
    failClosed: true,
    mutation: mutation(candidate, action),
    reasonCode,
  };
}

function mutation(
  candidate: MemoryGateCandidate,
  action: MemoryGateMutationAction,
): MemoryGateMutationPlan {
  const authorityKind =
    candidate.candidateKind === 'boundary' ? 'boundary_revision' : 'memory_resolution';
  if (action === 'none') return NO_MUTATION(authorityKind);
  const target = candidate.target;
  const predecessorRevisionId = target === null ? null : target.revisionId;
  const predecessorRevisionNo = target === null ? 0 : target.revisionNo;
  return {
    action,
    authorityKind,
    newRevisionId: candidate.candidateId,
    newRevisionNo: predecessorRevisionNo + 1,
    predecessorRevisionId,
    predecessorPreserved: true,
    evidencePreserved: true,
    sourcePreserved: true,
  };
}

function semanticState(
  state: MemoryGateCandidate['proposedState'],
): state is MemoryGateSemanticState {
  return 'semanticKind' in state;
}

function targetMemory(target: MemoryGateCandidate['target']): target is MemoryGateMemoryTarget {
  return target !== null && target.targetType === 'memory_resolution';
}

function targetBoundary(target: MemoryGateCandidate['target']): target is MemoryGateBoundaryTarget {
  return target !== null && target.targetType === 'boundary_revision';
}

/**
 * Pure implementation of the accepted P5C-01 gate. It deliberately returns a
 * mutation description only; callers still own the transaction and CAS write.
 */
export function evaluateMemoryGate(
  candidate: MemoryGateCandidate,
  snapshot: MemoryGateAuthoritySnapshot,
): MemoryGateDecision {
  const authorityKind =
    candidate.candidateKind === 'boundary' ? 'boundary_revision' : 'memory_resolution';
  if (
    snapshot.projectId.length === 0 ||
    snapshot.currentSessionId.length === 0 ||
    snapshot.sourceSessionIds.length === 0 ||
    snapshot.snapshotRevision < 1
  )
    return rejected(authorityKind, 'AUTHORITY_SNAPSHOT_MISMATCH');

  if (candidate.evidence.length === 0) return rejected(authorityKind, 'EVIDENCE_MISSING');
  if (
    candidate.evidenceManifestDigest.length === 0 ||
    candidate.evidenceManifestDigest !== snapshot.evidenceManifestDigest
  )
    return rejected(authorityKind, 'AUTHORITY_SNAPSHOT_MISMATCH');

  for (const evidence of candidate.evidence) {
    if (
      evidence.projectId !== snapshot.projectId ||
      !snapshot.sourceSessionIds.includes(evidence.sessionId) ||
      evidence.authorityRevision < 1
    )
      return rejected(authorityKind, 'STALE_EVIDENCE');
    if (evidence.eligibility.authorization !== 'authorized')
      return rejected(authorityKind, 'EVIDENCE_NOT_ELIGIBLE');
    if (evidence.eligibility.deletion !== 'not-deleted')
      return rejected(
        authorityKind,
        evidence.eligibility.deletion === 'deleted' ? 'DELETED_EVIDENCE' : 'EVIDENCE_NOT_ELIGIBLE',
      );
    if (evidence.eligibility.retention !== 'eligible')
      return rejected(authorityKind, 'RETENTION_INELIGIBLE');
    if (evidence.trustedRole !== 'elder') return rejected(authorityKind, 'EVIDENCE_NOT_ELIGIBLE');
  }

  const evidenceIds = new Set(candidate.evidence.map(({ evidenceId }) => evidenceId));
  if (
    candidate.evidence.length !== evidenceIds.size ||
    (semanticState(candidate.proposedState) &&
      candidate.proposedState.claims.some((claim) =>
        claim.evidenceIds.some((evidenceId) => !evidenceIds.has(evidenceId)),
      ))
  )
    return rejected(authorityKind, 'STALE_EVIDENCE');

  const creates = candidate.operation === 'create' || candidate.operation === 'activate';
  if (creates) {
    if (candidate.target !== null || candidate.expectedRevision !== null)
      return rejected(authorityKind, 'ILLEGAL_TRANSITION');
  } else if (candidate.target === null || candidate.expectedRevision === null) {
    return rejected(authorityKind, 'UNKNOWN_AUTHORITY');
  } else if (candidate.expectedRevision !== candidate.target.revisionNo) {
    return rejected(authorityKind, 'REVISION_MISMATCH');
  }

  if (candidate.candidateKind === 'boundary') {
    if (!['activate', 'revoke', 'supersede'].includes(candidate.operation))
      return rejected(authorityKind, 'ILLEGAL_TRANSITION');
    if (!('code' in candidate.proposedState))
      return rejected(authorityKind, 'SEMANTIC_KIND_MISMATCH');
    if (candidate.operation === 'activate') {
      if (
        candidate.proposedState.status !== 'active' ||
        !candidate.evidence.some(
          ({ evidenceRole }) => evidenceRole === 'boundary_activation_intent',
        )
      )
        return rejected(authorityKind, 'BOUNDARY_EXPLICIT_INTENT_REQUIRED');
      return {
        decisionStatus: 'accepted',
        failClosed: false,
        mutation: mutation(candidate, 'create_authority_revision'),
        reasonCode: 'EXPLICIT_BOUNDARY_INTENT',
      };
    }
    if (!targetBoundary(candidate.target) || candidate.target.status !== 'active')
      return rejected(authorityKind, 'ILLEGAL_TRANSITION');
    if (
      (candidate.operation === 'revoke' && candidate.proposedState.status !== 'revoked') ||
      (candidate.operation === 'supersede' && candidate.proposedState.status !== 'superseded')
    )
      return rejected(authorityKind, 'ILLEGAL_TRANSITION');
    if (
      !candidate.evidence.some(
        ({ evidenceRole }) => evidenceRole === 'boundary_withdrawal_or_contradiction',
      )
    )
      return rejected(authorityKind, 'BOUNDARY_WITHDRAWAL_REQUIRED');
    return review(candidate, 'BOUNDARY_HUMAN_AUTHORIZATION_REQUIRED', 'none');
  }

  if (
    !semanticState(candidate.proposedState) ||
    candidate.proposedState.semanticKind !== candidate.candidateKind
  )
    return rejected(authorityKind, 'SEMANTIC_KIND_MISMATCH');
  if (['activate', 'revoke', 'supersede'].includes(candidate.operation))
    return rejected(authorityKind, 'ILLEGAL_TRANSITION');
  if (targetBoundary(candidate.target)) return rejected(authorityKind, 'SEMANTIC_KIND_MISMATCH');
  if (candidate.target !== null && !targetMemory(candidate.target))
    return rejected(authorityKind, 'UNKNOWN_AUTHORITY');
  if (candidate.target !== null && candidate.target.semanticKind !== candidate.candidateKind)
    return rejected(authorityKind, 'SEMANTIC_KIND_MISMATCH');
  if (candidate.target !== null && candidate.target.resolutionStatus !== 'current')
    return rejected(authorityKind, 'ILLEGAL_TRANSITION');

  if (candidate.candidateKind === 'fact') {
    const hasExplicitFact = candidate.evidence.some(
      ({ evidenceRole }) => evidenceRole === 'explicit_fact_statement',
    );
    if (!hasExplicitFact) return rejected(authorityKind, 'FACT_EXPLICIT_ELDER_EVIDENCE_REQUIRED');
  }
  if (
    candidate.proposedState.semanticStatus === 'current' &&
    (candidate.proposedState.reviewRequired ||
      candidate.proposedState.resolutionKind === 'conflict_set')
  )
    return rejected(authorityKind, 'AMBIGUOUS_CORRECTION');
  if (
    candidate.proposedState.semanticStatus === 'uncertain' &&
    (!candidate.proposedState.reviewRequired ||
      candidate.proposedState.resolutionKind === 'conflict_set')
  )
    return rejected(authorityKind, 'AMBIGUOUS_CORRECTION');
  if (
    candidate.proposedState.semanticStatus === 'disputed' &&
    (!candidate.proposedState.reviewRequired ||
      candidate.proposedState.resolutionKind !== 'conflict_set' ||
      candidate.proposedState.value !== null ||
      candidate.proposedState.valueKind !== null ||
      candidate.proposedState.claims.length < 2)
  )
    return rejected(authorityKind, 'AMBIGUOUS_CORRECTION');

  if (candidate.proposedState.semanticStatus === 'disputed')
    return review(
      candidate,
      'ELIGIBLE_EVIDENCE_WITH_CONFLICT',
      candidate.target === null ? 'create_authority_revision' : 'append_memory_revision',
    );
  if (candidate.proposedState.semanticStatus === 'uncertain')
    return review(
      candidate,
      'CONFLICT_REQUIRES_REVIEW',
      candidate.target === null ? 'create_authority_revision' : 'append_memory_revision',
    );

  return {
    decisionStatus: 'accepted',
    failClosed: false,
    mutation: mutation(
      candidate,
      candidate.target === null ? 'create_authority_revision' : 'append_memory_revision',
    ),
    reasonCode:
      candidate.operation === 'correct' ? 'APPENDED_CORRECTION' : 'EXPLICIT_ELDER_EVIDENCE',
  };
}

@Injectable()
export class MemoryGateCorrectionService {
  public evaluate(
    candidate: MemoryGateCandidate,
    snapshot: MemoryGateAuthoritySnapshot,
  ): MemoryGateDecision {
    return evaluateMemoryGate(candidate, snapshot);
  }

  public assertWritable(
    candidate: MemoryGateCandidate,
    snapshot: MemoryGateAuthoritySnapshot,
  ): MemoryGateDecision {
    const decision = this.evaluate(candidate, snapshot);
    if (decision.mutation.action === 'none') throw new Error(`MEMORY_GATE_${decision.reasonCode}`);
    return decision;
  }
}
