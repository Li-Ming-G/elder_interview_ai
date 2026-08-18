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

type Envelope = {
  context: Record<string, unknown>;
  proposal: Record<string, unknown>;
  plan: Record<string, unknown>;
  committed: Record<string, unknown>;
  trace: Record<string, unknown>;
};

const fixture = readJson('docs/contracts/fixtures/memory-semantic-envelope-v1.fixtures.json') as {
  base: Envelope;
};

describe('P2-A1 semantic consolidation adversarial contract', () => {
  it('accepts the frozen positive envelope through every schema and semantic link', () => {
    const value = base();
    expect(schema('memory-semantic-context-v1')(value.context)).toBe(true);
    expect(schema('memory-semantic-proposal-v1')(value.proposal)).toBe(true);
    expect(schema('validated-memory-mutation-plan-v1')(value.plan)).toBe(true);
    expect(schema('committed-semantic-projection-v1')(value.committed)).toBe(true);
    expect(schema('memory-semantic-trace-v1')(value.trace)).toBe(true);
    expect(validate(value)).toEqual({ valid: true, errors: [], verification: 'contract' });
  });

  it.each(['raw_transcript', 'prompt', 'provider_payload', 'sql', 'cas'])(
    'rejects forbidden semantic payload key %s in transient context and proposal values',
    (key) => {
      const contextValue = base();
      set(contextValue.context, 'source_members.0.semantic_state.value', { [key]: 'payload' });
      expect(validate(contextValue).errors).toContain('SEMANTIC_VALUE_KEY_FORBIDDEN');
      expect(schema('memory-semantic-context-v1')(contextValue.context)).toBe(false);

      const proposalValue = base();
      set(proposalValue.proposal, 'proposals.0.proposed_state.value', { [key]: 'payload' });
      expect(validate(proposalValue).errors).toContain('SEMANTIC_VALUE_KEY_FORBIDDEN');
      expect(schema('memory-semantic-proposal-v1')(proposalValue.proposal)).toBe(false);
    },
  );

  it.each([
    ['resolution_id', '99999999-9999-4999-8999-999999999999'],
    ['revision', 2],
    ['lifecycle_status', 'active'],
    ['boundary_mutation', { status: 'revoked' }],
    ['server_reserved_ids', ['99999999-9999-4999-8999-999999999999']],
    ['source_transition_policy', 'overwrite'],
    ['commit', true],
  ])('keeps proposal free of persistence/control field %s', (key, value) => {
    const envelope = base();
    set(envelope.proposal, `proposals.0.${key}`, value);
    expect(schema('memory-semantic-proposal-v1')(envelope.proposal)).toBe(false);
  });

  it.each([
    ['validated_state', { value: 'durable' }],
    ['server_reserved_ids', ['99999999-9999-4999-8999-999999999999']],
    ['source_transition_policy', 'overwrite'],
    ['commit_status', 'committed'],
  ])('keeps the transient mutation plan non-persistent: %s', (key, value) => {
    const envelope = base();
    set(envelope.plan, `entries.0.${key}`, value);
    expect(schema('validated-memory-mutation-plan-v1')(envelope.plan)).toBe(false);
  });

  it('binds checkpoint project, sessions, count, source manifest, and evidence manifest', () => {
    const mutations: Array<[string, unknown]> = [
      ['source_checkpoint.project_id', '77777777-7777-4777-8777-777777777777'],
      ['source_checkpoint.source_session_ids', ['77777777-7777-4777-8777-777777777777']],
      ['source_checkpoint.expected_member_count', 1],
      ['source_checkpoint.member_manifest_hash', 'f'.repeat(64)],
      ['source_checkpoint.evidence_manifest_hash', 'f'.repeat(64)],
    ];
    for (const [path, value] of mutations) {
      const envelope = base();
      set(envelope.context, path, value);
      expect(validate(envelope).errors, path).toContain('SEMANTIC_CHECKPOINT_PARITY_INVALID');
    }
  });

  it.each([
    [
      'evidence_membership.0.session_id',
      '77777777-7777-4777-8777-777777777777',
      'SEMANTIC_EVIDENCE_REF_INVALID',
    ],
    ['evidence_membership.0.text_revision', 9, 'SEMANTIC_EVIDENCE_MANIFEST_MISMATCH'],
    [
      'evidence_membership.0.effective_text_digest',
      'f'.repeat(64),
      'SEMANTIC_EVIDENCE_MANIFEST_MISMATCH',
    ],
    ['evidence_membership.1.input_order', 0, 'SEMANTIC_EVIDENCE_ORDER_INVALID'],
  ])('rejects evidence authority drift at %s', (path, value, error) => {
    const envelope = base();
    set(envelope.context, path, value);
    expect(validate(envelope).errors).toContain(error);
  });

  it('rejects missing evidence membership and claim-level cross-membership evidence', () => {
    const missing = base();
    (missing.context.evidence_membership as unknown[]).splice(0, 1);
    expect(validate(missing).errors).toContain('SEMANTIC_EVIDENCE_REF_INVALID');

    const crossed = base();
    set(crossed.proposal, 'proposals.0.proposed_state.claims.0.source_claim_ref_ids', ['claim:a']);
    set(crossed.proposal, 'proposals.0.proposed_state.claims.0.evidence_ref_ids', ['evidence:b']);
    expect(validate(crossed).errors).toContain('SEMANTIC_PROPOSAL_EVIDENCE_INVALID');
  });

  it('rejects duplicate source, proposal-claim, and committed evidence identities', () => {
    const source = base();
    (source.context.source_members as unknown[]).push(
      structuredClone((source.context.source_members as unknown[])[0]),
    );
    expect(validate(source).errors).toContain('SEMANTIC_SOURCE_REF_INVALID');

    const proposalClaim = base();
    const claims = get(proposalClaim.proposal, 'proposals.0.proposed_state.claims') as unknown[];
    claims.push(structuredClone(claims[0]));
    expect(validate(proposalClaim).errors).toContain('SEMANTIC_PROPOSAL_CLAIM_DUPLICATE');

    const committed = base();
    const refs = get(
      committed.committed,
      'entries.0.committed_evidence_manifest.evidence_refs',
    ) as unknown[];
    refs[1] = structuredClone(refs[0]);
    set(
      committed.committed,
      'entries.0.committed_evidence_manifest.evidence_manifest_hash',
      committedEvidenceManifestHash(refs),
    );
    expect(validate(committed).errors).toContain('SEMANTIC_COMMIT_EVIDENCE_DUPLICATE');
  });

  it('keeps source checkpoint refs separate from the newly committed authority', () => {
    const envelope = base();
    const sourceResolutionId = get(envelope.context, 'source_members.0.resolution_id');
    set(envelope.committed, 'entries.0.committed_authority_ref.resolution_id', sourceResolutionId);
    set(envelope.trace, 'committed_refs.0.resolution_id', sourceResolutionId);
    expect(validate(envelope).errors).toContain('SEMANTIC_COMMIT_AUTHORITY_ID_COLLISION');
  });

  it('requires committed evidence manifest and target-layer parity independently of source refs', () => {
    const sourceRefs = base();
    set(sourceRefs.committed, 'entries.0.source_checkpoint_member_refs', ['src:a']);
    expect(validate(sourceRefs).errors).toContain('SEMANTIC_COMMIT_SOURCE_INVALID');

    const evidence = base();
    set(
      evidence.committed,
      'entries.0.committed_evidence_manifest.evidence_manifest_hash',
      'f'.repeat(64),
    );
    expect(validate(evidence).errors).toContain('SEMANTIC_COMMIT_EVIDENCE_INVALID');

    const layer = base();
    set(layer.committed, 'entries.0.target_layer.layer', 'long');
    expect(validate(layer).errors).toContain('SEMANTIC_COMMIT_LAYER_INVALID');
  });

  it.each([
    ['committed', 'entries.0.target_layer.summary'],
    ['trace', 'summary'],
  ] as const)('rejects durable body content in %s', (target, path) => {
    const envelope = base();
    set(envelope[target], path, 'forbidden body');
    expect(validate(envelope).errors).toContain('SEMANTIC_DURABLE_CONTENT_FORBIDDEN');
    const schemaName =
      target === 'committed' ? 'committed-semantic-projection-v1' : 'memory-semantic-trace-v1';
    expect(schema(schemaName)(envelope[target])).toBe(false);
  });

  it('keeps legacy Long durable schemas reference-only while allowing Memory authority values', () => {
    for (const schemaName of [
      'long-memory-consolidation-context-v1',
      'long-memory-consolidation-output-v1',
    ]) {
      const document = readJson(`docs/contracts/${schemaName}.schema.json`) as Record<
        string,
        unknown
      >;
      expect(JSON.stringify(document)).not.toContain('"value": true');
    }
    const contextSchema = readJson(
      'docs/contracts/memory-semantic-context-v1.schema.json',
    ) as Record<string, unknown>;
    expect(JSON.stringify(contextSchema)).toContain('semanticValue');
  });

  it('fails closed on unknown enums and additional properties', () => {
    const unknown = base();
    set(unknown.proposal, 'proposals.0.semantic_intent', 'rewrite_database');
    expect(schema('memory-semantic-proposal-v1')(unknown.proposal)).toBe(false);

    const additional = base();
    set(additional.trace, 'provider_response', { raw: true });
    expect(schema('memory-semantic-trace-v1')(additional.trace)).toBe(false);
  });

  it('rejects cross-project/session source scope and Long input in P1', () => {
    const project = base();
    set(project.context, 'source_members.0.project_id', '77777777-7777-4777-8777-777777777777');
    expect(validate(project).errors).toContain('SEMANTIC_SOURCE_SCOPE_INVALID');

    const session = base();
    set(session.context, 'source_members.0.session_id', '77777777-7777-4777-8777-777777777777');
    expect(validate(session).errors).toContain('SEMANTIC_SOURCE_SCOPE_INVALID');

    expect(validateP1LongInputBoundary({ source_kind: 'long_resolution' }).valid).toBe(false);
    expect(validateP1LongInputBoundary({ layer: 'long' }).valid).toBe(false);
    expect(validateP1LongInputBoundary({ long_memory: [] }).valid).toBe(false);
  });

  it('canonicalizes key order deterministically and hashes every authority revision change', () => {
    expect(semanticCanonicalDigest('golden', { z: 1, nested: { b: 2, a: 1 } })).toBe(
      semanticCanonicalDigest('golden', { nested: { a: 1, b: 2 }, z: 1 }),
    );
    expect(semanticCanonicalDigest('memory-semantic-source-manifest-v1', [])).toBe(
      '41b59863a7e036044cd5cb69eabe595925319744f9b4043043c8540b3d3a7013',
    );

    const envelope = base();
    const members = envelope.context.source_members as unknown[];
    const evidence = envelope.context.evidence_membership as unknown[];
    const original = semanticSourceManifestHash(members, evidence);
    set(envelope.context, 'source_members.0.resolution_revision', 2);
    expect(semanticSourceManifestHash(members, evidence)).not.toBe(original);
    set(envelope.context, 'evidence_membership.0.text_revision', 2);
    expect(semanticSourceManifestHash(members, evidence)).not.toBe(original);
  });

  it('rejects claims and evidence owned by B when the proposal declares only source A', () => {
    const envelope = base();
    const proposal = firstProposal(envelope);
    proposal.semantic_intent = 'derive';
    proposal.source_member_ref_ids = ['src:a'];
    set(proposal, 'proposed_state.claims.0.source_claim_ref_ids', ['claim:b']);
    set(proposal, 'proposed_state.claims.0.evidence_ref_ids', ['evidence:b']);
    refreshDigests(envelope);
    expect(validate(envelope).errors).toContain('SEMANTIC_PROPOSAL_EVIDENCE_INVALID');
  });

  it('rejects distinct source refs that alias the same durable resolution identity', () => {
    const envelope = base();
    set(
      envelope.context,
      'source_members.1.resolution_id',
      get(envelope.context, 'source_members.0.resolution_id'),
    );
    refreshDigests(envelope);
    expect(validate(envelope).errors).toContain('SEMANTIC_SOURCE_RESOLUTION_ID_DUPLICATE');
  });

  it('allows one evidence membership to support different proposal claims by pair identity', () => {
    const envelope = makeSharedEvidenceEnvelope();
    expect((envelope.context.evidence_membership as unknown[]).length).toBe(2);
    expect(
      new Set(
        (envelope.context.evidence_membership as Record<string, unknown>[]).map(
          (item) => `${String(item.session_id)}\u0000${String(item.segment_id)}`,
        ),
      ).size,
    ).toBe(2);
    expect(schema('memory-semantic-proposal-v1')(envelope.proposal)).toBe(true);
    expect(schema('committed-semantic-projection-v1')(envelope.committed)).toBe(true);
    expect(validate(envelope)).toEqual({ valid: true, errors: [], verification: 'contract' });
  });

  it('rejects a duplicate claim/evidence pair even when its durable evidence ID differs', () => {
    const envelope = makeSharedEvidenceEnvelope();
    const manifest = firstCommittedEvidence(envelope);
    const refs = manifest.evidence_refs as Record<string, unknown>[];
    refs.push({
      ...structuredClone(refs[0]),
      memory_evidence_id: '33333333-3333-4333-8333-333333333339',
    });
    manifest.expected_evidence_count = refs.length;
    refreshDigests(envelope);
    expect(validate(envelope).errors).toContain('SEMANTIC_COMMIT_EVIDENCE_DUPLICATE');
  });

  it('rejects a commit that drops one of two proposed evidence pairs', () => {
    const envelope = base();
    const manifest = firstCommittedEvidence(envelope);
    const refs = manifest.evidence_refs as unknown[];
    refs.pop();
    manifest.expected_evidence_count = refs.length;
    manifest.evidence_manifest_hash = committedEvidenceManifestHash(refs);
    refreshDigests(envelope);
    expect(validate(envelope).errors).toContain('SEMANTIC_COMMIT_EVIDENCE_INCOMPLETE');
  });

  it('rejects two evidence refs that alias the same session segment', () => {
    const envelope = base();
    const evidence = envelope.context.evidence_membership as Record<string, unknown>[];
    evidence[1].segment_id = evidence[0].segment_id;
    refreshDigests(envelope);
    expect(validate(envelope).errors).toContain('SEMANTIC_EVIDENCE_SEGMENT_DUPLICATE');
  });

  it('enforces new-slot initial revision and proposal-to-commit state parity', () => {
    const revision = base();
    firstCommittedAuthority(revision).resolution_revision = 99;
    refreshDigests(revision);
    expect(validate(revision).errors).toContain('SEMANTIC_COMMIT_NEW_AUTHORITY_REVISION_INVALID');

    const status = base();
    firstCommittedAuthority(status).semantic_status = 'uncertain';
    refreshDigests(status);
    expect(validate(status).errors).toContain('SEMANTIC_COMMIT_STATE_MISMATCH');

    const proposalStatus = base();
    firstProposedState(proposalStatus).semantic_status = 'uncertain';
    refreshDigests(proposalStatus);
    expect(validate(proposalStatus).errors).toContain('SEMANTIC_COMMIT_STATE_MISMATCH');
  });

  it('rejects current + exact + conflict_set in schema and semantic validation', () => {
    const envelope = base();
    firstProposedState(envelope).resolution_kind = 'conflict_set';
    refreshDigests(envelope);
    expect(schema('memory-semantic-proposal-v1')(envelope.proposal)).toBe(false);
    expect(validate(envelope).errors).toContain('SEMANTIC_PROPOSAL_STATE_INVALID');
  });

  it('requires an existing target to be declared and to preserve its semantic slot', () => {
    const undeclared = base();
    const proposal = firstProposal(undeclared);
    proposal.semantic_intent = 'derive';
    proposal.source_member_ref_ids = ['src:a'];
    proposal.target = { kind: 'existing_slot', existing_source_ref_id: 'src:b' };
    const plan = firstPlanEntry(undeclared);
    plan.target_kind = 'existing_slot';
    plan.target_authority_ref = {
      resolution_id: get(undeclared.context, 'source_members.1.resolution_id'),
      expected_revision: 1,
    };
    refreshDigests(undeclared);
    expect(validate(undeclared).errors).toContain('SEMANTIC_PROPOSAL_TARGET_INVALID');

    const slot = makeExistingEnvelope();
    firstProposedState(slot).canonical_key = 'different-semantic-slot';
    refreshDigests(slot);
    expect(validate(slot).errors).toContain('SEMANTIC_PROPOSAL_SLOT_MISMATCH');
  });

  it('rejects Long trigger sessions outside scope and incomplete final Mid/current manifests', () => {
    const trigger = makeLongEnvelope();
    trigger.context.source_session_id = '77777777-7777-4777-8777-777777777777';
    expect(validate(trigger).errors).toContain('SEMANTIC_LONG_TRIGGER_SESSION_INVALID');

    for (const [path, value] of [
      ['mid_expected_count', 2],
      ['mid_manifest_hash', 'f'.repeat(64)],
      ['current_expected_count', 0],
      ['current_manifest_hash', 'e'.repeat(64)],
    ] as const) {
      const envelope = makeLongEnvelope();
      set(sourceSet(envelope), path, value);
      expect(validate(envelope).errors, path).toContain('SEMANTIC_LONG_SOURCE_SET_INVALID');
    }
  });

  it('pins independent content, evidence, plan, and whole-commit golden digests', () => {
    const envelope = base();
    expect(semanticContentDigest(get(envelope.context, 'source_members.0.semantic_state'))).toBe(
      '5afaee6ea57384afcb95257d284386088e065474e711952d9c1d3b46a98f72a6',
    );
    expect(semanticEvidenceManifestHash(envelope.context.evidence_membership as unknown[])).toBe(
      '363a1db3ffc32fdc80d9f3c2465d7efaebf8f121772419b3db8f97e5da1ccbed',
    );
    expect(semanticMutationPlanDigest(envelope.plan)).toBe(
      '737b32a2cb3e839bf80fc049664fefd87aac945156846db79ec0f83c78d2dc84',
    );
    expect(semanticCommittedProjectionDigest(envelope.committed)).toBe(
      '8a393cc1b4257e3fd42f05ef000189de3bfcf8811f6b009e0c72f6ccbe2601bd',
    );
  });

  it('binds array order into source, evidence, proposal, and whole-commit digests', () => {
    const envelope = base();
    const members = envelope.context.source_members as unknown[];
    const evidence = envelope.context.evidence_membership as unknown[];
    expect(semanticSourceManifestHash(members.toReversed(), evidence)).not.toBe(
      envelope.context.source_manifest_hash,
    );
    expect(semanticEvidenceManifestHash(evidence.toReversed())).not.toBe(
      envelope.context.evidence_manifest_hash,
    );

    const proposal = structuredClone(envelope.proposal);
    (get(proposal, 'proposals.0.source_member_ref_ids') as unknown[]).reverse();
    expect(semanticProposalDigest(proposal)).not.toBe(envelope.plan.proposal_digest);

    const committed = structuredClone(envelope.committed);
    (get(committed, 'entries.0.committed_evidence_manifest.evidence_refs') as unknown[]).reverse();
    expect(semanticCommittedProjectionDigest(committed)).not.toBe(envelope.committed.commit_digest);
  });

  it.each([
    ['content', 'canonical_key', 'tampered-key'],
    ['content', 'value', { title: 'tampered' }],
    ['content', 'semantic_status', 'uncertain'],
    ['evidence', 'segment_id', '77777777-7777-4777-8777-777777777777'],
    ['evidence', 'session_id', '77777777-7777-4777-8777-777777777777'],
    ['evidence', 'text_revision', 99],
    ['evidence', 'speaker_role_revision', 99],
    ['evidence', 'effective_text_digest', 'f'.repeat(64)],
    ['evidence', 'input_order', 9],
  ])('changes the %s digest when %s is tampered', (kind, field, replacement) => {
    const envelope = base();
    if (kind === 'content') {
      const state = get(envelope.context, 'source_members.0.semantic_state') as Record<
        string,
        unknown
      >;
      const before = semanticContentDigest(state);
      state[field] = replacement;
      expect(semanticContentDigest(state)).not.toBe(before);
      return;
    }
    const evidence = envelope.context.evidence_membership as Record<string, unknown>[];
    const before = semanticEvidenceManifestHash(evidence);
    evidence[0][field] = replacement;
    expect(semanticEvidenceManifestHash(evidence)).not.toBe(before);
  });

  it.each([
    ['plan_schema_version', 'validated-memory-mutation-plan-v999'],
    ['source_manifest_hash', 'f'.repeat(64)],
    ['proposal_digest', 'e'.repeat(64)],
    ['entries.0.proposal_id', 'proposal:tampered'],
    ['entries.0.source_member_ref_ids', ['src:b', 'src:a']],
    ['entries.0.target_kind', 'existing_slot'],
    [
      'entries.0.target_authority_ref',
      {
        resolution_id: '77777777-7777-4777-8777-777777777777',
        expected_revision: 9,
      },
    ],
    ['entries.0.proposed_state_digest', 'd'.repeat(64)],
    ['entries.0.claim_evidence_manifest_hash', 'c'.repeat(64)],
  ])('binds plan field %s into the plan digest', (path, replacement) => {
    const envelope = base();
    const before = semanticMutationPlanDigest(envelope.plan);
    set(envelope.plan, path, replacement);
    expect(semanticMutationPlanDigest(envelope.plan)).not.toBe(before);
  });

  it.each([
    ['projection_schema_version', 'committed-semantic-projection-v999'],
    ['source_manifest_hash', 'f'.repeat(64)],
    ['proposal_digest', 'e'.repeat(64)],
    ['plan_digest', 'd'.repeat(64)],
    ['entries.0.proposal_id', 'proposal:tampered'],
    ['entries.0.source_checkpoint_member_refs', ['src:b', 'src:a']],
    ['entries.0.committed_authority_ref.resolution_id', '77777777-7777-4777-8777-777777777777'],
    ['entries.0.committed_authority_ref.resolution_revision', 2],
    ['entries.0.committed_authority_ref.semantic_kind', 'fact'],
    ['entries.0.committed_authority_ref.canonical_key', 'tampered-slot'],
    ['entries.0.committed_authority_ref.value_kind', 'range'],
    ['entries.0.committed_authority_ref.resolution_kind', 'range'],
    ['entries.0.committed_authority_ref.semantic_status', 'uncertain'],
    ['entries.0.committed_evidence_manifest.expected_evidence_count', 1],
    ['entries.0.committed_evidence_manifest.evidence_manifest_hash', 'c'.repeat(64)],
    [
      'entries.0.committed_evidence_manifest.evidence_refs.0.proposal_claim_ref_id',
      'proposal-claim:tampered',
    ],
    ['entries.0.committed_evidence_manifest.evidence_refs.0.evidence_ref_id', 'evidence:tampered'],
    [
      'entries.0.committed_evidence_manifest.evidence_refs.0.memory_evidence_id',
      '44444444-4444-4444-8444-444444444444',
    ],
    ['entries.0.target_layer.layer', 'long'],
    ['entries.0.target_layer.layer_identity_id', '66666666-6666-4666-8666-666666666666'],
    ['entries.0.target_layer.layer_revision_id', '55555555-5555-4555-8555-555555555555'],
    ['entries.0.target_layer.layer_revision', 2],
  ])('binds committed field %s into the whole-commit digest', (path, replacement) => {
    const envelope = base();
    const before = semanticCommittedProjectionDigest(envelope.committed);
    set(envelope.committed, path, replacement);
    expect(semanticCommittedProjectionDigest(envelope.committed)).not.toBe(before);
  });

  it('fails closed across plan link and self-digest tampering', () => {
    for (const [path, replacement, error] of [
      ['source_manifest_hash', 'f'.repeat(64), 'SEMANTIC_MUTATION_PLAN_LINK_INVALID'],
      ['proposal_digest', 'e'.repeat(64), 'SEMANTIC_MUTATION_PLAN_LINK_INVALID'],
    ] as const) {
      const envelope = base();
      set(envelope.plan, path, replacement);
      envelope.plan.plan_digest = semanticMutationPlanDigest(envelope.plan);
      expect(validate(envelope).errors, path).toContain(error);
    }

    const selfDigest = base();
    selfDigest.plan.plan_digest = 'f'.repeat(64);
    expect(validate(selfDigest).errors).toContain('SEMANTIC_MUTATION_PLAN_DIGEST_MISMATCH');
  });

  it('fails closed across committed projection link, self-digest, and trace-link tampering', () => {
    for (const path of ['source_manifest_hash', 'proposal_digest', 'plan_digest']) {
      const envelope = base();
      set(envelope.committed, path, 'f'.repeat(64));
      envelope.committed.commit_digest = semanticCommittedProjectionDigest(envelope.committed);
      set(envelope.trace, path, get(envelope.committed, path));
      envelope.trace.commit_digest = envelope.committed.commit_digest;
      expect(validate(envelope).errors, path).toContain('SEMANTIC_COMMIT_BRIDGE_LINK_INVALID');
    }

    const selfDigest = base();
    selfDigest.committed.commit_digest = 'f'.repeat(64);
    selfDigest.trace.commit_digest = selfDigest.committed.commit_digest;
    expect(validate(selfDigest).errors).toContain('SEMANTIC_COMMIT_DIGEST_MISMATCH');

    for (const path of [
      'source_manifest_hash',
      'proposal_digest',
      'plan_digest',
      'commit_digest',
    ]) {
      const envelope = base();
      set(envelope.trace, path, 'f'.repeat(64));
      expect(validate(envelope).errors, path).toContain('SEMANTIC_TRACE_LINK_INVALID');
    }
  });

  it('allows multi-entry source/evidence reuse while keeping global identities distinct', () => {
    const envelope = makeMultiEntryEnvelope();
    const proposals = envelope.proposal.proposals as Record<string, unknown>[];
    expect(proposals[0].source_member_ref_ids).toContain('src:a');
    expect(proposals[1].source_member_ref_ids).toContain('src:a');
    expect(get(proposals[0], 'proposed_state.claims.0.evidence_ref_ids')).toContain('evidence:a');
    expect(get(proposals[1], 'proposed_state.claims.0.evidence_ref_ids')).toContain('evidence:a');
    expect((envelope.context.evidence_membership as unknown[]).length).toBe(2);
    expect(schema('memory-semantic-proposal-v1')(envelope.proposal)).toBe(true);
    expect(schema('validated-memory-mutation-plan-v1')(envelope.plan)).toBe(true);
    expect(schema('committed-semantic-projection-v1')(envelope.committed)).toBe(true);
    expect(validate(envelope)).toEqual({ valid: true, errors: [], verification: 'contract' });
  });

  it('rejects two proposals that target the same existing CAS authority', () => {
    const envelope = makeMultiEntryEnvelope();
    const proposals = envelope.proposal.proposals as Record<string, unknown>[];
    const plans = envelope.plan.entries as Record<string, unknown>[];
    for (const proposal of proposals) {
      proposal.semantic_intent = 'reorganize';
      proposal.source_member_ref_ids = ['src:a'];
      proposal.target = { kind: 'existing_slot', existing_source_ref_id: 'src:a' };
      const state = proposal.proposed_state as Record<string, unknown>;
      state.semantic_kind = 'episode';
      state.canonical_key = 'school-memory';
    }
    for (const plan of plans) {
      plan.source_member_ref_ids = ['src:a'];
      plan.target_kind = 'existing_slot';
      plan.target_authority_ref = {
        resolution_id: get(envelope.context, 'source_members.0.resolution_id'),
        expected_revision: 1,
      };
    }
    refreshDigests(envelope);
    expect(validate(envelope).errors).toContain('SEMANTIC_MUTATION_PLAN_AUTHORITY_DUPLICATE');
  });

  it.each([
    ['proposal id', 'SEMANTIC_PROPOSAL_INVALID'],
    ['claim ref', 'SEMANTIC_PROPOSAL_CLAIM_DUPLICATE'],
    ['proposal semantic slot', 'SEMANTIC_PROPOSAL_TARGET_SLOT_DUPLICATE'],
    ['plan proposal id', 'SEMANTIC_MUTATION_PLAN_INVALID'],
    ['plan semantic slot', 'SEMANTIC_MUTATION_PLAN_TARGET_SLOT_DUPLICATE'],
    ['commit proposal id', 'SEMANTIC_COMMIT_BRIDGE_INVALID'],
    ['committed resolution id', 'SEMANTIC_COMMIT_AUTHORITY_ID_DUPLICATE'],
    ['committed authority metadata', 'SEMANTIC_COMMIT_AUTHORITY_METADATA_CONFLICT'],
    ['committed semantic slot', 'SEMANTIC_COMMIT_TARGET_SLOT_DUPLICATE'],
    ['claim/evidence pair', 'SEMANTIC_COMMIT_EVIDENCE_DUPLICATE'],
    ['durable MemoryEvidence id', 'SEMANTIC_COMMIT_MEMORY_EVIDENCE_ID_DUPLICATE'],
  ])('enforces projection-wide uniqueness for %s', (kind, error) => {
    const envelope = makeMultiEntryEnvelope();
    applyGlobalUniquenessMutation(envelope, kind);
    refreshDigests(envelope);
    expect(validate(envelope).errors).toContain(error);
  });

  it('keeps context resolution, evidence ref, and segment inventories globally unique', () => {
    const resolution = makeMultiEntryEnvelope();
    set(
      resolution.context,
      'source_members.1.resolution_id',
      get(resolution.context, 'source_members.0.resolution_id'),
    );
    refreshDigests(resolution);
    expect(validate(resolution).errors).toContain('SEMANTIC_SOURCE_RESOLUTION_ID_DUPLICATE');

    const evidenceRef = makeMultiEntryEnvelope();
    set(evidenceRef.context, 'evidence_membership.1.evidence_ref_id', 'evidence:a');
    refreshDigests(evidenceRef);
    expect(validate(evidenceRef).errors).toContain('SEMANTIC_EVIDENCE_REF_INVALID');

    const segment = makeMultiEntryEnvelope();
    set(
      segment.context,
      'evidence_membership.1.segment_id',
      get(segment.context, 'evidence_membership.0.segment_id'),
    );
    refreshDigests(segment);
    expect(validate(segment).errors).toContain('SEMANTIC_EVIDENCE_SEGMENT_DUPLICATE');
  });
});

function base(): Envelope {
  return structuredClone(fixture.base);
}

function validate(value: Envelope): ReturnType<typeof validateSemanticEnvelope> {
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

function makeExistingEnvelope(): Envelope {
  const value = base();
  const proposal = firstProposal(value);
  proposal.semantic_intent = 'reorganize';
  proposal.target = { kind: 'existing_slot', existing_source_ref_id: 'src:a' };
  const plan = firstPlanEntry(value);
  plan.target_kind = 'existing_slot';
  plan.target_authority_ref = {
    resolution_id: get(value.context, 'source_members.0.resolution_id'),
    expected_revision: 1,
  };
  const authority = firstCommittedAuthority(value);
  authority.resolution_id = get(value.context, 'source_members.0.resolution_id');
  authority.resolution_revision = 2;
  refreshDigests(value);
  return value;
}

function makeSharedEvidenceEnvelope(): Envelope {
  const value = base();
  const claims = firstProposedState(value).claims as Record<string, unknown>[];
  claims.push({
    proposal_claim_ref_id: 'proposal-claim:school-detail',
    claim_key: 'school-shared-evidence',
    value_kind: 'exact',
    value: { detail: '沿河走路' },
    source_claim_ref_ids: ['claim:a'],
    evidence_ref_ids: ['evidence:a'],
  });
  const manifest = firstCommittedEvidence(value);
  const refs = manifest.evidence_refs as Record<string, unknown>[];
  refs.push({
    proposal_claim_ref_id: 'proposal-claim:school-detail',
    evidence_ref_id: 'evidence:a',
    memory_evidence_id: '33333333-3333-4333-8333-333333333338',
  });
  manifest.expected_evidence_count = refs.length;
  refreshDigests(value);
  return value;
}

function makeMultiEntryEnvelope(): Envelope {
  const value = base();
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
  refreshDigests(value);
  return value;
}

function applyGlobalUniquenessMutation(value: Envelope, kind: string): void {
  const proposals = value.proposal.proposals as Record<string, unknown>[];
  const plans = value.plan.entries as Record<string, unknown>[];
  const commits = value.committed.entries as Record<string, unknown>[];
  const firstState = proposals[0].proposed_state as Record<string, unknown>;
  const secondState = proposals[1].proposed_state as Record<string, unknown>;
  const firstAuthority = commits[0].committed_authority_ref as Record<string, unknown>;
  const secondAuthority = commits[1].committed_authority_ref as Record<string, unknown>;
  const firstEvidence = (commits[0].committed_evidence_manifest as Record<string, unknown>)
    .evidence_refs as Record<string, unknown>[];
  const secondEvidence = (commits[1].committed_evidence_manifest as Record<string, unknown>)
    .evidence_refs as Record<string, unknown>[];

  if (kind === 'proposal id') proposals[1].proposal_id = proposals[0].proposal_id;
  if (kind === 'claim ref')
    (secondState.claims as Record<string, unknown>[])[0].proposal_claim_ref_id = (
      firstState.claims as Record<string, unknown>[]
    )[0].proposal_claim_ref_id;
  if (kind === 'proposal semantic slot' || kind === 'plan semantic slot') {
    secondState.semantic_kind = firstState.semantic_kind;
    secondState.canonical_key = firstState.canonical_key;
  }
  if (kind === 'plan proposal id') plans[1].proposal_id = plans[0].proposal_id;
  if (kind === 'commit proposal id') commits[1].proposal_id = commits[0].proposal_id;
  if (kind === 'committed resolution id') Object.assign(secondAuthority, firstAuthority);
  if (kind === 'committed authority metadata')
    secondAuthority.resolution_id = firstAuthority.resolution_id;
  if (kind === 'committed semantic slot') {
    secondAuthority.semantic_kind = firstAuthority.semantic_kind;
    secondAuthority.canonical_key = firstAuthority.canonical_key;
  }
  if (kind === 'claim/evidence pair') {
    secondEvidence[0].proposal_claim_ref_id = firstEvidence[0].proposal_claim_ref_id;
    secondEvidence[0].evidence_ref_id = firstEvidence[0].evidence_ref_id;
  }
  if (kind === 'durable MemoryEvidence id')
    secondEvidence[0].memory_evidence_id = firstEvidence[0].memory_evidence_id;
}

function makeLongEnvelope(): Envelope {
  const value = base();
  value.context.mode = 'session_end_to_long';
  const members = value.context.source_members as Record<string, unknown>[];
  members[0].source_kind = 'mid_resolution';
  members[1].source_kind = 'current_resolution';
  (firstCommittedEntry(value).target_layer as Record<string, unknown>).layer = 'long';
  refreshDigests(value);
  return value;
}

function refreshDigests(value: Envelope): void {
  const members = value.context.source_members as unknown[];
  const evidence = value.context.evidence_membership as unknown[];
  const evidenceHash = semanticEvidenceManifestHash(evidence);
  const sourceHash = semanticSourceManifestHash(members, evidence);
  value.context.evidence_manifest_hash = evidenceHash;
  value.context.source_manifest_hash = sourceHash;
  const checkpoint = value.context.source_checkpoint as Record<string, unknown>;
  checkpoint.member_manifest_hash = sourceHash;
  checkpoint.evidence_manifest_hash = evidenceHash;
  if (value.context.mode === 'session_end_to_long') {
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

  value.proposal.source_manifest_hash = sourceHash;
  const proposalDigest = semanticProposalDigest(value.proposal);
  value.plan.source_manifest_hash = sourceHash;
  value.plan.proposal_digest = proposalDigest;
  const proposals = value.proposal.proposals as Record<string, unknown>[];
  for (const entry of value.plan.entries as Record<string, unknown>[]) {
    const proposal = proposals.find((candidate) => candidate.proposal_id === entry.proposal_id);
    if (proposal === undefined) continue;
    entry.proposed_state_digest = semanticContentDigest(proposal.proposed_state);
    entry.claim_evidence_manifest_hash = semanticClaimEvidenceManifestHash(proposal);
  }
  value.plan.plan_digest = semanticMutationPlanDigest(value.plan);

  value.committed.source_manifest_hash = sourceHash;
  value.committed.proposal_digest = proposalDigest;
  value.committed.plan_digest = value.plan.plan_digest;
  for (const entry of value.committed.entries as Record<string, unknown>[]) {
    const manifest = entry.committed_evidence_manifest as Record<string, unknown>;
    manifest.evidence_manifest_hash = committedEvidenceManifestHash(
      manifest.evidence_refs as unknown[],
    );
  }
  value.committed.commit_digest = semanticCommittedProjectionDigest(value.committed);

  value.trace.source_manifest_hash = sourceHash;
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
      const manifest = entry.committed_evidence_manifest as Record<string, unknown>;
      const layer = entry.target_layer as Record<string, unknown>;
      return {
        proposal_id: entry.proposal_id,
        resolution_id: authority.resolution_id,
        resolution_revision: authority.resolution_revision,
        evidence_manifest_hash: manifest.evidence_manifest_hash,
        layer_identity_id: layer.layer_identity_id,
        layer_revision_id: layer.layer_revision_id,
      };
    },
  );
}

function schema(name: string): (value: unknown) => boolean {
  const AjvConstructor = Ajv2020 as unknown as new (options: object) => {
    addFormat(name: string, format: RegExp): void;
    compile(schemaValue: object): (value: unknown) => boolean;
  };
  const ajv = new AjvConstructor({ allErrors: true, strict: true, validateFormats: true });
  ajv.addFormat(
    'uuid',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  return ajv.compile(readJson(`docs/contracts/${name}.schema.json`) as object);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(join(root(), path), 'utf8'));
}

function root(): string {
  return process.cwd().endsWith('apps/api') ? join(process.cwd(), '..', '..') : process.cwd();
}

function get(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cursor, part) => {
    if (Array.isArray(cursor)) return cursor[Number(part)];
    return (cursor as Record<string, unknown>)[part];
  }, value);
}

function set(value: unknown, path: string, replacement: unknown): void {
  const parts = path.split('.');
  const parent = parts.length === 1 ? value : get(value, parts.slice(0, -1).join('.'));
  const key = parts.at(-1) ?? '';
  if (Array.isArray(parent)) parent[Number(key)] = replacement;
  else (parent as Record<string, unknown>)[key] = replacement;
}
