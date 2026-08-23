import { describe, expect, it } from 'vitest';

import {
  classifyMemoryGateEvidenceRole,
  evaluateMemoryGate,
  type MemoryGateCandidate,
  type MemoryGateEvidenceReference,
} from './memory-gate-correction.service.js';

const snapshot = {
  authorityContract: 'memory-claim-resolution-v1' as const,
  currentSessionId: 'session-1',
  deletionScopeDigest: 'deletion',
  evidenceManifestDigest: 'manifest',
  policyRevision: 'policy-1',
  projectId: 'project-1',
  snapshotRevision: 1,
  sourceSessionIds: ['session-1'],
};

function evidence(
  evidenceRole: MemoryGateEvidenceReference['evidenceRole'] = 'elder_story_context',
): MemoryGateEvidenceReference {
  return {
    authorityRevision: 1,
    contentKind: 'conversation_final',
    effectiveTextDigest: 'digest',
    evidenceId: 'evidence-1',
    evidenceRole,
    eligibility: { authorization: 'authorized', deletion: 'not-deleted', retention: 'eligible' },
    projectId: 'project-1',
    sessionId: 'session-1',
    sourceId: 'segment-1',
    sourceKind: 'transcript_segment',
    speakerRoleRevision: 1,
    textRevision: 1,
    trustedRole: 'elder',
  };
}

function candidate(overrides: Partial<MemoryGateCandidate> = {}): MemoryGateCandidate {
  return {
    candidateId: 'candidate-1',
    proposalSource: 'llm_proposal',
    candidateKind: 'fact',
    operation: 'create',
    target: null,
    expectedRevision: null,
    proposedState: {
      canonicalKey: 'birth.place',
      claims: [{ claimId: null, claimKey: 'place', evidenceIds: ['evidence-1'] }],
      resolutionKind: 'single',
      reviewRequired: false,
      semanticKind: 'fact',
      semanticStatus: 'current',
      value: 'Shanghai',
      valueKind: 'exact',
    },
    evidence: [evidence('explicit_fact_statement')],
    evidenceManifestDigest: 'manifest',
    ...overrides,
  };
}

describe('Memory Gate/Correction V1 runtime evaluator', () => {
  it('accepts explicit elder Fact evidence and rejects inference-only evidence', () => {
    expect(evaluateMemoryGate(candidate(), snapshot).decisionStatus).toBe('accepted');
    const inferred = candidate({ evidence: [evidence('model_inference')] });
    expect(evaluateMemoryGate(inferred, snapshot)).toMatchObject({
      decisionStatus: 'rejected',
      reasonCode: 'FACT_EXPLICIT_ELDER_EVIDENCE_REQUIRED',
      mutation: { action: 'none' },
    });

    expect(
      evaluateMemoryGate(
        candidate({
          evidence: [{ ...evidence('explicit_fact_statement'), trustedRole: 'interviewer' }],
        }),
        snapshot,
      ),
    ).toMatchObject({
      decisionStatus: 'rejected',
      reasonCode: 'EVIDENCE_NOT_ELIGIBLE',
      mutation: { action: 'none' },
    });
  });

  it('rejects deleted and retention-ineligible evidence before mutation', () => {
    expect(
      evaluateMemoryGate(
        candidate({
          evidence: [
            {
              ...evidence('explicit_fact_statement'),
              eligibility: {
                authorization: 'authorized',
                deletion: 'deleted',
                retention: 'eligible',
              },
            },
          ],
        }),
        snapshot,
      ),
    ).toMatchObject({ decisionStatus: 'rejected', reasonCode: 'DELETED_EVIDENCE' });
    expect(
      evaluateMemoryGate(
        candidate({
          evidence: [
            {
              ...evidence('explicit_fact_statement'),
              eligibility: {
                authorization: 'authorized',
                deletion: 'not-deleted',
                retention: 'ineligible',
              },
            },
          ],
        }),
        snapshot,
      ),
    ).toMatchObject({ decisionStatus: 'rejected', reasonCode: 'RETENTION_INELIGIBLE' });
    expect(
      evaluateMemoryGate(
        candidate({
          evidence: [
            {
              ...evidence('explicit_fact_statement'),
              eligibility: {
                authorization: 'authorized',
                deletion: 'unknown',
                retention: 'eligible',
              },
            },
          ],
        }),
        snapshot,
      ),
    ).toMatchObject({
      decisionStatus: 'rejected',
      reasonCode: 'EVIDENCE_NOT_ELIGIBLE',
      mutation: { action: 'none' },
    });
  });

  it('does not promote ordinary story context or ordinary boundary text', () => {
    expect(classifyMemoryGateEvidenceRole('elder', '我小时候住在上海')).toBe('elder_story_context');
    expect(classifyMemoryGateEvidenceRole('elder', '工作记忆[fact:birth.place]=上海')).toBe(
      'explicit_fact_statement',
    );
    expect(classifyMemoryGateEvidenceRole('interviewer', '工作记忆[fact:birth.place]=上海')).toBe(
      'interviewer_suggestion',
    );
    expect(classifyMemoryGateEvidenceRole('elder', '访谈边界=家庭关系')).toBe(
      'elder_story_context',
    );
    expect(classifyMemoryGateEvidenceRole('elder', 'ordinary text', false, true)).toBe(
      'boundary_activation_intent',
    );
    expect(classifyMemoryGateEvidenceRole('elder', '请继续讲学校的故事')).toBe(
      'elder_story_context',
    );

    expect(
      evaluateMemoryGate(candidate({ evidence: [evidence('elder_story_context')] }), snapshot),
    ).toMatchObject({
      decisionStatus: 'rejected',
      reasonCode: 'FACT_EXPLICIT_ELDER_EVIDENCE_REQUIRED',
    });
    expect(
      evaluateMemoryGate(
        candidate({
          candidateKind: 'boundary',
          operation: 'activate',
          proposedState: {
            abstractScope: 'ordinary text',
            code: 'elder_explicit_boundary',
            reviewRequired: false,
            status: 'active',
          },
          evidence: [evidence('elder_story_context')],
        }),
        snapshot,
      ),
    ).toMatchObject({
      decisionStatus: 'rejected',
      reasonCode: 'BOUNDARY_EXPLICIT_INTENT_REQUIRED',
    });
  });

  it('rejects a candidate whose manifest is not the accepted snapshot manifest', () => {
    expect(
      evaluateMemoryGate(candidate({ evidenceManifestDigest: 'different-manifest' }), snapshot),
    ).toMatchObject({
      decisionStatus: 'rejected',
      reasonCode: 'AUTHORITY_SNAPSHOT_MISMATCH',
      mutation: { action: 'none' },
    });
  });

  it('appends corrections and preserves the predecessor CAS identity', () => {
    const corrected = candidate({
      candidateId: 'candidate-2',
      operation: 'correct',
      target: {
        authorityId: 'authority-1',
        revisionId: 'revision-1',
        revisionNo: 3,
        resolutionStatus: 'current',
        semanticKind: 'fact',
        semanticStatus: 'current',
        targetType: 'memory_resolution',
      },
      expectedRevision: 3,
    });
    expect(evaluateMemoryGate(corrected, snapshot)).toMatchObject({
      decisionStatus: 'accepted',
      reasonCode: 'APPENDED_CORRECTION',
      mutation: {
        action: 'append_memory_revision',
        newRevisionNo: 4,
        predecessorRevisionId: 'revision-1',
        predecessorPreserved: true,
        evidencePreserved: true,
        sourcePreserved: true,
      },
    });
  });

  it('requires explicit Boundary intent and never silently revokes it', () => {
    const activated = candidate({
      candidateId: 'boundary-1',
      candidateKind: 'boundary',
      operation: 'activate',
      proposedState: {
        abstractScope: 'family history',
        code: 'elder_explicit_boundary',
        reviewRequired: false,
        status: 'active',
      },
      evidence: [evidence('boundary_activation_intent')],
    });
    expect(evaluateMemoryGate(activated, snapshot).decisionStatus).toBe('accepted');

    const silentRevoke = candidate({
      candidateId: 'boundary-2',
      candidateKind: 'boundary',
      operation: 'revoke',
      target: {
        boundaryId: 'boundary-1',
        revisionId: 'boundary-revision-1',
        revisionNo: 1,
        status: 'active',
        targetType: 'boundary_revision',
      },
      expectedRevision: 1,
      proposedState: {
        abstractScope: 'family history',
        code: 'elder_explicit_boundary',
        reviewRequired: false,
        status: 'revoked',
      },
      evidence: [evidence('elder_story_context')],
    });
    expect(evaluateMemoryGate(silentRevoke, snapshot)).toMatchObject({
      decisionStatus: 'rejected',
      reasonCode: 'BOUNDARY_WITHDRAWAL_REQUIRED',
    });
  });

  it('retains uncertainty/dispute as review-required rather than last-write-wins', () => {
    const disputed = candidate({
      candidateId: 'candidate-dispute',
      operation: 'mark_disputed',
      target: {
        authorityId: 'authority-1',
        revisionId: 'revision-1',
        revisionNo: 1,
        resolutionStatus: 'current',
        semanticKind: 'fact',
        semanticStatus: 'current',
        targetType: 'memory_resolution',
      },
      expectedRevision: 1,
      evidence: [
        evidence('explicit_fact_statement'),
        { ...evidence('explicit_fact_statement'), evidenceId: 'evidence-2', sourceId: 'segment-2' },
      ],
      proposedState: {
        canonicalKey: 'birth.place',
        claims: [
          { claimId: null, claimKey: 'one', evidenceIds: ['evidence-1'] },
          { claimId: null, claimKey: 'two', evidenceIds: ['evidence-2'] },
        ],
        resolutionKind: 'conflict_set',
        reviewRequired: true,
        semanticKind: 'fact',
        semanticStatus: 'disputed',
        value: null,
        valueKind: null,
      },
    });
    expect(evaluateMemoryGate(disputed, snapshot)).toMatchObject({
      decisionStatus: 'review_required',
      reasonCode: 'ELIGIBLE_EVIDENCE_WITH_CONFLICT',
      mutation: { action: 'append_memory_revision' },
    });
  });
});
