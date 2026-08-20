import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MemoryP2PlanAdapter, MemoryP2PlanError } from './memory-p2-plan-adapter.js';
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
