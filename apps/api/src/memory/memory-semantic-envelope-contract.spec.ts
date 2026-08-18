import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  committedEvidenceManifestHash,
  semanticCanonicalDigest,
  semanticClaimEvidenceManifestHash,
  semanticCommittedProjectionDigest,
  semanticContentDigest,
  semanticEvidenceManifestHash,
  semanticMutationPlanDigest,
  semanticProposalDigest,
  semanticSourceKindManifestHash,
  semanticSourceManifestHash,
  validateP1LongInputBoundary,
  validateSemanticEnvelope,
} from './memory-semantic-envelope-contract.js';

interface FixtureSet {
  base: {
    context: Record<string, unknown>;
    proposal: Record<string, unknown>;
    plan: Record<string, unknown>;
    committed: Record<string, unknown>;
    trace: Record<string, unknown>;
  };
  semantic_cases: Array<{
    name: string;
    target: keyof FixtureSet['base'];
    path: string;
    value: unknown;
    expected_error: string;
    schema_invalid?: boolean;
    secondary_target?: keyof FixtureSet['base'];
    secondary_path?: string;
    secondary_value?: unknown;
  }>;
  p1_long_cases: Array<{ name: string; value: unknown }>;
  p2_long_cases: Array<{
    name: string;
    valid: boolean;
    mutation?: 'trigger_session_outside' | 'mid_count_drift' | 'current_revision_drift';
    expected_error?: string;
  }>;
  projection_global_cases: Array<{
    name: string;
    valid: boolean;
    mutation?:
      | 'duplicate_proposal_id'
      | 'duplicate_claim_ref'
      | 'duplicate_proposal_slot'
      | 'duplicate_plan_proposal_id'
      | 'duplicate_plan_authority'
      | 'duplicate_plan_slot'
      | 'duplicate_commit_proposal_id'
      | 'duplicate_commit_resolution'
      | 'conflicting_commit_authority'
      | 'duplicate_commit_slot'
      | 'duplicate_commit_pair'
      | 'duplicate_memory_evidence_id';
    expected_error?: string;
  }>;
}

const fixtures = readJson(
  'docs/contracts/fixtures/memory-semantic-envelope-v1.fixtures.json',
) as FixtureSet;

describe('memory semantic envelope contract', () => {
  it('compiles all formal schemas and accepts the positive fixture', () => {
    expect(
      compile('docs/contracts/memory-semantic-context-v1.schema.json')(fixtures.base.context),
    ).toBe(true);
    expect(
      compile('docs/contracts/memory-semantic-proposal-v1.schema.json')(fixtures.base.proposal),
    ).toBe(true);
    expect(
      compile('docs/contracts/validated-memory-mutation-plan-v1.schema.json')(fixtures.base.plan),
    ).toBe(true);
    expect(
      compile('docs/contracts/committed-semantic-projection-v1.schema.json')(
        fixtures.base.committed,
      ),
    ).toBe(true);
    expect(
      compile('docs/contracts/memory-semantic-trace-v1.schema.json')(fixtures.base.trace),
    ).toBe(true);
    expect(
      validateSemanticEnvelope(
        fixtures.base.context,
        fixtures.base.proposal,
        fixtures.base.plan,
        fixtures.base.committed,
        fixtures.base.trace,
      ),
    ).toEqual({ valid: true, errors: [], verification: 'contract' });
  });

  it('uses domain-separated canonical JSON without implicit Unicode normalization', () => {
    expect(semanticCanonicalDigest('memory-semantic-source-manifest-v1', [])).toBe(
      '41b59863a7e036044cd5cb69eabe595925319744f9b4043043c8540b3d3a7013',
    );
    expect(semanticCanonicalDigest('memory-semantic-proposal-v1', {})).toBe(
      '5d1f930346251777282a705eb93f1e86929dbdf5b17850ba330d9ef1741bff09',
    );
    expect(semanticCanonicalDigest('domain', { b: 2, a: 1 })).toBe(
      semanticCanonicalDigest('domain', { a: 1, b: 2 }),
    );
    expect(semanticCanonicalDigest('domain', 'e\u0301')).not.toBe(
      semanticCanonicalDigest('domain', '\u00e9'),
    );
    expect(semanticCanonicalDigest('domain-a', [])).not.toBe(
      semanticCanonicalDigest('domain-b', []),
    );
  });

  it('binds source order into the manifest', () => {
    const members = structuredClone(fixtures.base.context.source_members) as unknown[];
    const evidence = fixtures.base.context.evidence_membership as unknown[];
    expect(semanticSourceManifestHash(members, evidence)).toBe(
      fixtures.base.context.source_manifest_hash,
    );
    expect(semanticSourceManifestHash(members.toReversed(), evidence)).not.toBe(
      fixtures.base.context.source_manifest_hash,
    );
  });

  it('pins canonical goldens for content, evidence, plan, and committed projection', () => {
    const context = fixtures.base.context;
    expect(
      semanticContentDigest(
        (context.source_members as Record<string, unknown>[])[0].semantic_state,
      ),
    ).toBe('5afaee6ea57384afcb95257d284386088e065474e711952d9c1d3b46a98f72a6');
    expect(semanticEvidenceManifestHash(context.evidence_membership as unknown[])).toBe(
      '363a1db3ffc32fdc80d9f3c2465d7efaebf8f121772419b3db8f97e5da1ccbed',
    );
    expect(semanticMutationPlanDigest(fixtures.base.plan)).toBe(
      '737b32a2cb3e839bf80fc049664fefd87aac945156846db79ec0f83c78d2dc84',
    );
    expect(semanticCommittedProjectionDigest(fixtures.base.committed)).toBe(
      '8a393cc1b4257e3fd42f05ef000189de3bfcf8811f6b009e0c72f6ccbe2601bd',
    );
  });

  it('binds every mutation-plan field except the self digest', () => {
    for (const [path, value] of [
      ['plan_schema_version', 'validated-memory-mutation-plan-v0'],
      ['source_manifest_hash', 'f'.repeat(64)],
      ['proposal_digest', 'e'.repeat(64)],
      ['entries.0.proposal_id', 'proposal:different'],
      ['entries.0.source_member_ref_ids', ['src:b', 'src:a']],
      ['entries.0.target_kind', 'existing_slot'],
      [
        'entries.0.target_authority_ref',
        {
          resolution_id: '88888888-8888-4888-8888-888888888881',
          expected_revision: 1,
        },
      ],
      ['entries.0.proposed_state_digest', 'd'.repeat(64)],
      ['entries.0.claim_evidence_manifest_hash', 'c'.repeat(64)],
    ] as const) {
      const plan = structuredClone(fixtures.base.plan);
      setPath(plan, path, value);
      expect(semanticMutationPlanDigest(plan), path).not.toBe(fixtures.base.plan.plan_digest);
    }
  });

  it('binds array order and every committed projection field into digests', () => {
    const reorderedEvidence = structuredClone(
      fixtures.base.context.evidence_membership,
    ) as unknown[];
    reorderedEvidence.reverse();
    expect(semanticEvidenceManifestHash(reorderedEvidence)).not.toBe(
      fixtures.base.context.evidence_manifest_hash,
    );

    const committedEvidenceRefs = (
      (fixtures.base.committed.entries as Record<string, unknown>[])[0]
        .committed_evidence_manifest as Record<string, unknown>
    ).evidence_refs as unknown[];
    for (const [path, value] of [
      ['projection_schema_version', 'committed-semantic-projection-v0'],
      ['source_manifest_hash', 'f'.repeat(64)],
      ['proposal_digest', 'e'.repeat(64)],
      ['plan_digest', 'd'.repeat(64)],
      ['entries.0.proposal_id', 'proposal:different'],
      ['entries.0.source_checkpoint_member_refs', ['src:b', 'src:a']],
      ['entries.0.committed_authority_ref.resolution_id', '77777777-7777-4777-8777-777777777777'],
      ['entries.0.committed_authority_ref.resolution_revision', 2],
      ['entries.0.committed_authority_ref.semantic_kind', 'fact'],
      ['entries.0.committed_authority_ref.canonical_key', 'different-slot'],
      ['entries.0.committed_authority_ref.value_kind', 'range'],
      ['entries.0.committed_authority_ref.resolution_kind', 'range'],
      ['entries.0.committed_authority_ref.semantic_status', 'uncertain'],
      ['entries.0.committed_evidence_manifest.expected_evidence_count', 1],
      ['entries.0.committed_evidence_manifest.evidence_manifest_hash', 'b'.repeat(64)],
      [
        'entries.0.committed_evidence_manifest.evidence_refs',
        structuredClone(committedEvidenceRefs).toReversed(),
      ],
      ['entries.0.target_layer.layer', 'long'],
      ['entries.0.target_layer.layer_identity_id', '77777777-7777-4777-8777-777777777777'],
      ['entries.0.target_layer.layer_revision_id', '66666666-6666-4666-8666-666666666666'],
      ['entries.0.target_layer.layer_revision', 2],
    ] as const) {
      const committed = structuredClone(fixtures.base.committed);
      setPath(committed, path, value);
      expect(semanticCommittedProjectionDigest(committed), path).not.toBe(
        fixtures.base.committed.commit_digest,
      );
    }
  });

  it('fails closed for every linked digest field', () => {
    for (const [target, path] of [
      ['context', 'source_members.0.content_digest'],
      ['context', 'evidence_manifest_hash'],
      ['context', 'source_manifest_hash'],
      ['context', 'source_checkpoint.member_manifest_hash'],
      ['context', 'source_checkpoint.evidence_manifest_hash'],
      ['proposal', 'source_manifest_hash'],
      ['plan', 'source_manifest_hash'],
      ['plan', 'proposal_digest'],
      ['plan', 'plan_digest'],
      ['committed', 'source_manifest_hash'],
      ['committed', 'proposal_digest'],
      ['committed', 'plan_digest'],
      ['committed', 'commit_digest'],
      ['trace', 'source_manifest_hash'],
      ['trace', 'proposal_digest'],
      ['trace', 'plan_digest'],
      ['trace', 'commit_digest'],
      ['trace', 'source_memberships.0.content_digest'],
      ['trace', 'committed_refs.0.evidence_manifest_hash'],
    ] as const) {
      const value = cloneBase();
      setPath(value[target], path, 'f'.repeat(64));
      expect(validateBase(value).valid, `${target}.${path}`).toBe(false);
    }
  });

  it('closes proposal provenance and proposal-to-commit evidence parity', () => {
    const wrongOwner = cloneBase();
    const proposal = firstProposal(wrongOwner);
    proposal.semantic_intent = 'derive';
    proposal.source_member_ref_ids = ['src:a'];
    refreshEnvelopeDigests(wrongOwner);
    expect(validateBase(wrongOwner).errors).toContain('SEMANTIC_PROPOSAL_EVIDENCE_INVALID');

    const incomplete = cloneBase();
    const evidenceManifest = firstCommittedEvidence(incomplete);
    (evidenceManifest.evidence_refs as unknown[]).pop();
    evidenceManifest.expected_evidence_count = 1;
    evidenceManifest.evidence_manifest_hash = committedEvidenceManifestHash(
      evidenceManifest.evidence_refs as unknown[],
    );
    refreshEnvelopeDigests(incomplete);
    expect(validateBase(incomplete).errors).toContain('SEMANTIC_COMMIT_EVIDENCE_INCOMPLETE');

    const duplicateSegment = cloneBase();
    const evidence = duplicateSegment.context.evidence_membership as Record<string, unknown>[];
    evidence[1].segment_id = evidence[0].segment_id;
    refreshEnvelopeDigests(duplicateSegment);
    expect(validateBase(duplicateSegment).errors).toContain('SEMANTIC_EVIDENCE_SEGMENT_DUPLICATE');

    const duplicateResolution = cloneBase();
    const members = duplicateResolution.context.source_members as Record<string, unknown>[];
    members[1].resolution_id = members[0].resolution_id;
    refreshEnvelopeDigests(duplicateResolution);
    expect(validateBase(duplicateResolution).errors).toContain(
      'SEMANTIC_SOURCE_RESOLUTION_ID_DUPLICATE',
    );
  });

  it('allows one evidence ref to support multiple proposal claims and committed pairs', () => {
    const value = cloneBase();
    const claims = firstProposedState(value).claims as Record<string, unknown>[];
    claims.push({
      proposal_claim_ref_id: 'proposal-claim:school-route',
      claim_key: 'school-route',
      value_kind: 'exact',
      value: { detail: '沿河走路' },
      source_claim_ref_ids: ['claim:a'],
      evidence_ref_ids: ['evidence:a'],
    });
    const evidenceManifest = firstCommittedEvidence(value);
    (evidenceManifest.evidence_refs as Record<string, unknown>[]).push({
      proposal_claim_ref_id: 'proposal-claim:school-route',
      evidence_ref_id: 'evidence:a',
      memory_evidence_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3',
    });
    evidenceManifest.expected_evidence_count = 3;
    refreshEnvelopeDigests(value);
    expect(validateBase(value)).toEqual({ valid: true, errors: [], verification: 'contract' });
    expect(compile('docs/contracts/memory-semantic-proposal-v1.schema.json')(value.proposal)).toBe(
      true,
    );
    expect(
      compile('docs/contracts/committed-semantic-projection-v1.schema.json')(value.committed),
    ).toBe(true);

    const duplicatePair = structuredClone(value);
    const duplicatePairManifest = firstCommittedEvidence(duplicatePair);
    (duplicatePairManifest.evidence_refs as Record<string, unknown>[]).push({
      proposal_claim_ref_id: 'proposal-claim:school-route',
      evidence_ref_id: 'evidence:a',
      memory_evidence_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4',
    });
    duplicatePairManifest.expected_evidence_count = 4;
    refreshEnvelopeDigests(duplicatePair);
    expect(validateBase(duplicatePair).errors).toContain('SEMANTIC_COMMIT_EVIDENCE_DUPLICATE');
  });

  it('enforces new and existing authority revision, slot, and P1 v1.2 dialect parity', () => {
    const existing = makeExistingSlotEnvelope();
    expect(validateBase(existing)).toEqual({ valid: true, errors: [], verification: 'contract' });

    const newRevision = cloneBase();
    firstCommittedAuthority(newRevision).resolution_revision = 99;
    refreshEnvelopeDigests(newRevision);
    expect(validateBase(newRevision).errors).toContain(
      'SEMANTIC_COMMIT_NEW_AUTHORITY_REVISION_INVALID',
    );

    const statusDrift = cloneBase();
    firstCommittedAuthority(statusDrift).semantic_status = 'uncertain';
    refreshEnvelopeDigests(statusDrift);
    expect(validateBase(statusDrift).errors).toContain('SEMANTIC_COMMIT_STATE_MISMATCH');

    const dialectConflict = cloneBase();
    const state = firstProposedState(dialectConflict);
    state.resolution_kind = 'conflict_set';
    refreshEnvelopeDigests(dialectConflict);
    expect(validateBase(dialectConflict).errors).toContain('SEMANTIC_PROPOSAL_STATE_INVALID');

    const slotDrift = makeExistingSlotEnvelope();
    firstProposedState(slotDrift).canonical_key = 'different-slot';
    refreshEnvelopeDigests(slotDrift);
    expect(validateBase(slotDrift).errors).toContain('SEMANTIC_PROPOSAL_SLOT_MISMATCH');
  });

  it.each(fixtures.p2_long_cases)('validates P2-A Long source set case $name', (fixture) => {
    const value = makeLongEnvelope();
    if (fixture.mutation === 'trigger_session_outside')
      value.context.source_session_id = '77777777-7777-4777-8777-777777777777';
    if (fixture.mutation === 'mid_count_drift') sourceSet(value).mid_expected_count = 2;
    if (fixture.mutation === 'current_revision_drift') {
      const members = value.context.source_members as Record<string, unknown>[];
      members[1].resolution_revision = 2;
      refreshEnvelopeDigests(value, false);
    }
    const result = validateBase(value);
    expect(result.valid).toBe(fixture.valid);
    if (fixture.expected_error) expect(result.errors).toContain(fixture.expected_error);
    if (fixture.valid) {
      expect(compile('docs/contracts/memory-semantic-context-v1.schema.json')(value.context)).toBe(
        true,
      );
      expect(
        compile('docs/contracts/committed-semantic-projection-v1.schema.json')(value.committed),
      ).toBe(true);
    }
  });

  it.each(fixtures.projection_global_cases)(
    'validates projection-wide invariant case $name',
    (fixture) => {
      const value = makeMultiEntryEnvelope();
      applyProjectionGlobalMutation(value, fixture.mutation);
      refreshEnvelopeDigests(value);
      const result = validateBase(value);
      expect(result.valid).toBe(fixture.valid);
      if (fixture.expected_error) expect(result.errors).toContain(fixture.expected_error);
      if (fixture.valid) {
        expect(
          compile('docs/contracts/memory-semantic-proposal-v1.schema.json')(value.proposal),
        ).toBe(true);
        expect(
          compile('docs/contracts/validated-memory-mutation-plan-v1.schema.json')(value.plan),
        ).toBe(true);
        expect(
          compile('docs/contracts/committed-semantic-projection-v1.schema.json')(value.committed),
        ).toBe(true);
      }
    },
  );

  it.each(fixtures.semantic_cases)('rejects semantic case $name', (fixture) => {
    const value = structuredClone(fixtures.base);
    setPath(value[fixture.target], fixture.path, fixture.value);
    if (fixture.secondary_target && fixture.secondary_path)
      setPath(value[fixture.secondary_target], fixture.secondary_path, fixture.secondary_value);
    const result = validateSemanticEnvelope(
      value.context,
      value.proposal,
      value.plan,
      value.committed,
      value.trace,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(fixture.expected_error);
    if (fixture.schema_invalid)
      expect(
        compile(`docs/contracts/memory-semantic-${fixture.target}-v1.schema.json`)(
          value[fixture.target],
        ),
      ).toBe(false);
  });

  it.each(fixtures.p1_long_cases)('rejects P1 Long input case $name', (fixture) => {
    expect(validateP1LongInputBoundary(fixture.value)).toEqual({
      valid: false,
      errors: ['P1_LONG_INPUT_FORBIDDEN'],
      verification: 'contract',
    });
  });

  it('allows a P1 current-session shape without Long input', () => {
    expect(
      validateP1LongInputBoundary({
        context_schema_version: 'memory-maintainer-context-v1.2',
        current_working_memory: [],
        session_mid_index: [],
      }),
    ).toEqual({ valid: true, errors: [], verification: 'contract' });
  });
});

type Envelope = FixtureSet['base'];

function cloneBase(): Envelope {
  return structuredClone(fixtures.base);
}

function validateBase(value: Envelope): ReturnType<typeof validateSemanticEnvelope> {
  return validateSemanticEnvelope(
    value.context,
    value.proposal,
    value.plan,
    value.committed,
    value.trace,
  );
}

function firstProposal(value: Envelope): Record<string, unknown> {
  return (value.proposal.proposals as Record<string, unknown>[])[0];
}

function firstProposedState(value: Envelope): Record<string, unknown> {
  return firstProposal(value).proposed_state as Record<string, unknown>;
}

function firstPlanEntry(value: Envelope): Record<string, unknown> {
  return (value.plan.entries as Record<string, unknown>[])[0];
}

function firstCommittedEntry(value: Envelope): Record<string, unknown> {
  return (value.committed.entries as Record<string, unknown>[])[0];
}

function firstCommittedAuthority(value: Envelope): Record<string, unknown> {
  return firstCommittedEntry(value).committed_authority_ref as Record<string, unknown>;
}

function firstCommittedEvidence(value: Envelope): Record<string, unknown> {
  return firstCommittedEntry(value).committed_evidence_manifest as Record<string, unknown>;
}

function sourceSet(value: Envelope): Record<string, unknown> {
  return (value.context.source_checkpoint as Record<string, unknown>).source_set as Record<
    string,
    unknown
  >;
}

function makeMultiEntryEnvelope(): Envelope {
  const value = cloneBase();
  (value.proposal.proposals as Record<string, unknown>[]).push({
    proposal_id: 'proposal:birth-place',
    semantic_intent: 'derive',
    source_member_ref_ids: ['src:a'],
    target: { kind: 'new_slot', existing_source_ref_id: null },
    proposed_state: {
      semantic_kind: 'fact',
      memory_tag: 'place',
      canonical_key: 'birth-place',
      value_kind: 'exact',
      value: { name: '河边村庄' },
      resolution_kind: 'single',
      semantic_status: 'current',
      claims: [
        {
          proposal_claim_ref_id: 'proposal-claim:birth-place',
          claim_key: 'birth-place',
          value_kind: 'exact',
          value: { name: '河边村庄' },
          source_claim_ref_ids: ['claim:a'],
          evidence_ref_ids: ['evidence:a'],
        },
      ],
    },
    reason_code: 'new_semantic_slot',
  });
  (value.plan.entries as Record<string, unknown>[]).push({
    proposal_id: 'proposal:birth-place',
    source_member_ref_ids: ['src:a'],
    target_kind: 'new_slot',
    target_authority_ref: null,
    proposed_state_digest: '0'.repeat(64),
    claim_evidence_manifest_hash: '0'.repeat(64),
  });
  (value.committed.entries as Record<string, unknown>[]).push({
    proposal_id: 'proposal:birth-place',
    source_checkpoint_member_refs: ['src:a'],
    committed_authority_ref: {
      resolution_id: '99999999-9999-4999-8999-999999999998',
      resolution_revision: 1,
      semantic_kind: 'fact',
      canonical_key: 'birth-place',
      value_kind: 'exact',
      resolution_kind: 'single',
      semantic_status: 'current',
    },
    committed_evidence_manifest: {
      expected_evidence_count: 1,
      evidence_manifest_hash: '0'.repeat(64),
      evidence_refs: [
        {
          proposal_claim_ref_id: 'proposal-claim:birth-place',
          evidence_ref_id: 'evidence:a',
          memory_evidence_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3',
        },
      ],
    },
    target_layer: {
      layer: 'mid',
      layer_identity_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      layer_revision_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
      layer_revision: 1,
    },
  });
  refreshEnvelopeDigests(value);
  return value;
}

function applyProjectionGlobalMutation(
  value: Envelope,
  mutation: FixtureSet['projection_global_cases'][number]['mutation'],
): void {
  if (!mutation) return;
  const proposals = value.proposal.proposals as Record<string, unknown>[];
  const planEntries = value.plan.entries as Record<string, unknown>[];
  const committedEntries = value.committed.entries as Record<string, unknown>[];
  const firstState = proposals[0].proposed_state as Record<string, unknown>;
  const secondState = proposals[1].proposed_state as Record<string, unknown>;
  const firstAuthority = committedEntries[0].committed_authority_ref as Record<string, unknown>;
  const secondAuthority = committedEntries[1].committed_authority_ref as Record<string, unknown>;
  const firstEvidence = (committedEntries[0].committed_evidence_manifest as Record<string, unknown>)
    .evidence_refs as Record<string, unknown>[];
  const secondEvidence = (
    committedEntries[1].committed_evidence_manifest as Record<string, unknown>
  ).evidence_refs as Record<string, unknown>[];

  if (mutation === 'duplicate_proposal_id') proposals[1].proposal_id = proposals[0].proposal_id;
  if (mutation === 'duplicate_claim_ref')
    (secondState.claims as Record<string, unknown>[])[0].proposal_claim_ref_id = (
      firstState.claims as Record<string, unknown>[]
    )[0].proposal_claim_ref_id;
  if (mutation === 'duplicate_proposal_slot' || mutation === 'duplicate_plan_slot') {
    secondState.semantic_kind = firstState.semantic_kind;
    secondState.canonical_key = firstState.canonical_key;
  }
  if (mutation === 'duplicate_plan_proposal_id')
    planEntries[1].proposal_id = planEntries[0].proposal_id;
  if (mutation === 'duplicate_plan_authority') {
    for (const entry of planEntries) {
      entry.target_kind = 'existing_slot';
      entry.target_authority_ref = {
        resolution_id: '88888888-8888-4888-8888-888888888881',
        expected_revision: 1,
      };
    }
  }
  if (mutation === 'duplicate_commit_proposal_id')
    committedEntries[1].proposal_id = committedEntries[0].proposal_id;
  if (mutation === 'duplicate_commit_resolution') Object.assign(secondAuthority, firstAuthority);
  if (mutation === 'conflicting_commit_authority')
    secondAuthority.resolution_id = firstAuthority.resolution_id;
  if (mutation === 'duplicate_commit_slot') {
    secondAuthority.semantic_kind = firstAuthority.semantic_kind;
    secondAuthority.canonical_key = firstAuthority.canonical_key;
  }
  if (mutation === 'duplicate_commit_pair') {
    secondEvidence[0].proposal_claim_ref_id = firstEvidence[0].proposal_claim_ref_id;
    secondEvidence[0].evidence_ref_id = firstEvidence[0].evidence_ref_id;
  }
  if (mutation === 'duplicate_memory_evidence_id')
    secondEvidence[0].memory_evidence_id = firstEvidence[0].memory_evidence_id;
}

function makeExistingSlotEnvelope(): Envelope {
  const value = cloneBase();
  const proposal = firstProposal(value);
  proposal.semantic_intent = 'reorganize';
  proposal.target = { kind: 'existing_slot', existing_source_ref_id: 'src:a' };
  const planEntry = firstPlanEntry(value);
  planEntry.target_kind = 'existing_slot';
  planEntry.target_authority_ref = {
    resolution_id: '88888888-8888-4888-8888-888888888881',
    expected_revision: 1,
  };
  const authority = firstCommittedAuthority(value);
  authority.resolution_id = '88888888-8888-4888-8888-888888888881';
  authority.resolution_revision = 2;
  refreshEnvelopeDigests(value);
  return value;
}

function makeLongEnvelope(): Envelope {
  const value = cloneBase();
  value.context.mode = 'session_end_to_long';
  const members = value.context.source_members as Record<string, unknown>[];
  members[0].source_kind = 'mid_resolution';
  members[1].source_kind = 'current_resolution';
  const targetLayer = firstCommittedEntry(value).target_layer as Record<string, unknown>;
  targetLayer.layer = 'long';
  refreshEnvelopeDigests(value, true);
  return value;
}

function refreshEnvelopeDigests(value: Envelope, refreshLongSourceSet = true): void {
  const context = value.context;
  const members = context.source_members as unknown[];
  const evidenceMembership = context.evidence_membership as unknown[];
  const evidenceManifestHash = semanticEvidenceManifestHash(evidenceMembership);
  const sourceManifestHash = semanticSourceManifestHash(members, evidenceMembership);
  context.evidence_manifest_hash = evidenceManifestHash;
  context.source_manifest_hash = sourceManifestHash;
  const checkpoint = context.source_checkpoint as Record<string, unknown>;
  checkpoint.member_manifest_hash = sourceManifestHash;
  checkpoint.evidence_manifest_hash = evidenceManifestHash;
  if (context.mode === 'session_end_to_long' && refreshLongSourceSet) {
    const records = members as Record<string, unknown>[];
    checkpoint.source_set = {
      kind: 'final_mid_and_current',
      mid_expected_count: records.filter((member) => member.source_kind === 'mid_resolution')
        .length,
      mid_manifest_hash: semanticSourceKindManifestHash('mid_resolution', members),
      current_expected_count: records.filter(
        (member) => member.source_kind === 'current_resolution',
      ).length,
      current_manifest_hash: semanticSourceKindManifestHash('current_resolution', members),
    };
  }

  value.proposal.source_manifest_hash = sourceManifestHash;
  const proposalDigest = semanticProposalDigest(value.proposal);
  value.plan.source_manifest_hash = sourceManifestHash;
  value.plan.proposal_digest = proposalDigest;
  const proposals = value.proposal.proposals as Record<string, unknown>[];
  const planEntries = value.plan.entries as Record<string, unknown>[];
  for (const entry of planEntries) {
    const proposal = proposals.find((item) => item.proposal_id === entry.proposal_id);
    if (!proposal) continue;
    entry.proposed_state_digest = semanticContentDigest(proposal.proposed_state);
    entry.claim_evidence_manifest_hash = semanticClaimEvidenceManifestHash(proposal);
  }
  value.plan.plan_digest = semanticMutationPlanDigest(value.plan);

  value.committed.source_manifest_hash = sourceManifestHash;
  value.committed.proposal_digest = proposalDigest;
  value.committed.plan_digest = value.plan.plan_digest;
  for (const entry of value.committed.entries as Record<string, unknown>[]) {
    const evidence = entry.committed_evidence_manifest as Record<string, unknown>;
    evidence.evidence_manifest_hash = committedEvidenceManifestHash(
      evidence.evidence_refs as unknown[],
    );
  }
  value.committed.commit_digest = semanticCommittedProjectionDigest(value.committed);

  value.trace.source_manifest_hash = sourceManifestHash;
  value.trace.proposal_digest = proposalDigest;
  value.trace.plan_digest = value.plan.plan_digest;
  value.trace.commit_digest = value.committed.commit_digest;
  value.trace.source_memberships = (members as Record<string, unknown>[]).map((member) => ({
    source_ref_id: member.source_ref_id,
    resolution_id: member.resolution_id,
    resolution_revision: member.resolution_revision,
    input_order: member.input_order,
    content_digest: member.content_digest,
  }));
  value.trace.committed_refs = (value.committed.entries as Record<string, unknown>[]).map(
    (entry) => {
      const authority = entry.committed_authority_ref as Record<string, unknown>;
      const evidence = entry.committed_evidence_manifest as Record<string, unknown>;
      const layer = entry.target_layer as Record<string, unknown>;
      return {
        proposal_id: entry.proposal_id,
        resolution_id: authority.resolution_id,
        resolution_revision: authority.resolution_revision,
        evidence_manifest_hash: evidence.evidence_manifest_hash,
        layer_identity_id: layer.layer_identity_id,
        layer_revision_id: layer.layer_revision_id,
      };
    },
  );
}

function compile(path: string): (value: unknown) => boolean {
  const AjvConstructor = Ajv2020 as unknown as new (options: object) => {
    addFormat(name: string, format: RegExp): void;
    compile(schema: object): (value: unknown) => boolean;
  };
  const ajv = new AjvConstructor({ allErrors: true, strict: true, validateFormats: true });
  ajv.addFormat(
    'uuid',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  return ajv.compile(readJson(path) as object);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(findRoot(), path), 'utf8'));
}

function findRoot(): string {
  return process.cwd().replaceAll('\\', '/').endsWith('/apps/api')
    ? join(process.cwd(), '..', '..')
    : process.cwd();
}

function setPath(value: unknown, path: string, replacement: unknown): void {
  const parts = path.split('.');
  let cursor = value as Record<string, unknown>;
  for (let index = 0; index < parts.length - 1; index += 1)
    cursor = Array.isArray(cursor)
      ? (cursor[Number(parts[index])] as Record<string, unknown>)
      : (cursor[parts[index]] as Record<string, unknown>);
  if (Array.isArray(cursor)) cursor[Number(parts.at(-1))] = replacement;
  else cursor[parts.at(-1) ?? ''] = replacement;
}
