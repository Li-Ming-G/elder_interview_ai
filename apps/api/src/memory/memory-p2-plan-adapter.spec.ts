import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MemoryP2PlanAdapter, MemoryP2PlanError } from './memory-p2-plan-adapter.js';
import {
  semanticContentDigest,
  semanticSourceManifestHash,
} from './memory-semantic-envelope-contract.js';
import type {
  MemoryP2SemanticContext,
  MemoryP2SemanticProposal,
} from './memory-p2-runtime.types.js';

interface SemanticFixture {
  base: {
    context: MemoryP2SemanticContext;
    plan: Record<string, unknown>;
    proposal: MemoryP2SemanticProposal;
  };
}

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), 'docs/contracts/fixtures/memory-semantic-envelope-v1.fixtures.json'),
    'utf8',
  ),
) as SemanticFixture;

describe('MemoryP2PlanAdapter', () => {
  const adapter = new MemoryP2PlanAdapter();

  it('uses the formal schemas and pure validator to build the canonical transient plan', () => {
    const context = adapter.validateContext(structuredClone(fixture.base.context));
    const result = adapter.build(context, structuredClone(fixture.base.proposal));

    expect(result.plan).toEqual(fixture.base.plan);
    expect(result.proposal).toEqual(fixture.base.proposal);
  });

  it('rejects a provider object that does not satisfy the formal proposal schema', () => {
    const error = capturePlanError(() => adapter.build(fixture.base.context, { proposals: [] }));
    expect(error.errorCode).toBe('P2_TERMINAL_UNAVAILABLE');
    expect(error.validationErrors).toEqual(['SEMANTIC_PROPOSAL_SCHEMA_INVALID']);
  });

  it('runs the formal pure validator for Context manifest closure before provider use', () => {
    const context = structuredClone(fixture.base.context);
    context.source_manifest_hash = 'f'.repeat(64);

    const error = capturePlanError(() => adapter.validateContext(context));
    expect(error.errorCode).toBe('P2_SOURCE_DRIFT');
    expect(error.validationErrors).toContain('SEMANTIC_SOURCE_MANIFEST_MISMATCH');
  });

  it('rejects a schema-valid Context whose claim escapes the frozen evidence subgraph', () => {
    const context = structuredClone(fixture.base.context);
    const source = context.source_members.at(0);
    const claim = source?.semantic_state.claims.at(0);
    if (source === undefined || claim === undefined)
      throw new Error('fixture source claim required');
    claim.evidence_ref_ids = ['evidence:outside'];
    source.content_digest = semanticContentDigest(source.semantic_state);
    context.source_manifest_hash = semanticSourceManifestHash(
      context.source_members,
      context.evidence_membership,
    );
    context.source_checkpoint.member_manifest_hash = context.source_manifest_hash;

    const error = capturePlanError(() => adapter.validateContext(context));
    expect(error.errorCode).toBe('P2_SOURCE_DRIFT');
    expect(error.validationErrors).toContain('SEMANTIC_EVIDENCE_REF_INVALID');
  });

  it('rejects semantic evidence invention after schema validation', () => {
    const proposal = structuredClone(fixture.base.proposal);
    const firstProposal = proposal.proposals.at(0);
    const firstClaim = firstProposal?.proposed_state.claims.at(0);
    if (firstClaim === undefined) throw new Error('fixture proposal claim required');
    firstClaim.evidence_ref_ids = ['evidence:invented'];

    const error = capturePlanError(() => adapter.build(fixture.base.context, proposal));
    expect(error.errorCode).toBe('P2_TERMINAL_UNAVAILABLE');
    expect(error.validationErrors).toContain('SEMANTIC_PROPOSAL_EVIDENCE_INVALID');
  });
});

function capturePlanError(work: () => unknown): MemoryP2PlanError {
  try {
    work();
  } catch (error) {
    if (error instanceof MemoryP2PlanError) return error;
    throw error;
  }
  throw new Error('expected MemoryP2PlanError');
}
