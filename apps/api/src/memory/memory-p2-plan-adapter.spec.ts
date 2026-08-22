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

interface Fixture {
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
) as Fixture;

describe('MemoryP2PlanAdapter', () => {
  const adapter = new MemoryP2PlanAdapter();

  it('validates the frozen Context and builds the canonical transient plan', () => {
    const context = adapter.validateContext(structuredClone(fixture.base.context));
    const result = adapter.build(context, structuredClone(fixture.base.proposal));
    expect(result.plan).toEqual(fixture.base.plan);
    expect(result.proposal).toEqual(fixture.base.proposal);
  });

  it('rejects source drift before provider use and proposal schema violations', () => {
    const context = structuredClone(fixture.base.context);
    context.source_manifest_hash = 'f'.repeat(64);
    expect(() => adapter.validateContext(context)).toThrow(
      expect.objectContaining({ errorCode: 'P2_SOURCE_DRIFT' }),
    );
    expect(() => adapter.build(fixture.base.context, { proposals: [] })).toThrow(
      expect.objectContaining({
        errorCode: 'P2_TERMINAL_UNAVAILABLE',
        validationErrors: ['SEMANTIC_PROPOSAL_SCHEMA_INVALID'],
      }),
    );
  });

  it('rejects a schema-valid Context whose claim escapes frozen evidence', () => {
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
    try {
      adapter.validateContext(context);
      throw new Error('expected source drift');
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryP2PlanError);
      expect((error as MemoryP2PlanError).validationErrors).toContain(
        'SEMANTIC_EVIDENCE_REF_INVALID',
      );
    }
  });
});
