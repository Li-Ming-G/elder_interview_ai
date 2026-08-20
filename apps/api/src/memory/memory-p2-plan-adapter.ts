import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';

import {
  semanticClaimEvidenceManifestHash,
  semanticContentDigest,
  semanticMutationPlanDigest,
  semanticProposalDigest,
  validateSemanticEnvelope,
} from './memory-semantic-envelope-contract.js';
import type {
  MemoryP2ErrorCode,
  MemoryP2MutationPlan,
  MemoryP2MutationPlanEntry,
  MemoryP2ProposedClaim,
  MemoryP2ProposedState,
  MemoryP2SemanticContext,
  MemoryP2SemanticProposal,
} from './memory-p2-runtime.types.js';

export interface MemoryP2ValidatedProposal {
  plan: MemoryP2MutationPlan;
  proposal: MemoryP2SemanticProposal;
}

export class MemoryP2PlanError extends Error {
  public constructor(
    public readonly errorCode: MemoryP2ErrorCode,
    public readonly validationErrors: readonly string[],
  ) {
    super(validationErrors[0] ?? errorCode);
    this.name = 'MemoryP2PlanError';
  }
}

export class MemoryP2PlanAdapter {
  private readonly contextSchema: ValidateFunction;
  private readonly planSchema: ValidateFunction;
  private readonly proposalSchema: ValidateFunction;

  public constructor(workspaceRoot = findWorkspaceRoot(process.cwd())) {
    const AjvConstructor = Ajv2020 as unknown as new (options: {
      allErrors: boolean;
      strict: boolean;
      validateFormats: boolean;
    }) => {
      addFormat(name: string, format: RegExp): void;
      compile(schema: object): ValidateFunction;
    };
    const ajv = new AjvConstructor({ allErrors: true, strict: false, validateFormats: true });
    ajv.addFormat(
      'uuid',
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    this.contextSchema = compile(ajv, workspaceRoot, 'memory-semantic-context-v1');
    this.proposalSchema = compile(ajv, workspaceRoot, 'memory-semantic-proposal-v1');
    this.planSchema = compile(ajv, workspaceRoot, 'validated-memory-mutation-plan-v1');
  }

  public validateContext(value: unknown): MemoryP2SemanticContext {
    if (!this.contextSchema(value))
      throw new MemoryP2PlanError('P2_SOURCE_DRIFT', ['SEMANTIC_CONTEXT_SCHEMA_INVALID']);
    const context = value as MemoryP2SemanticContext;
    const probe = buildContextProbeProposal(context);
    if (!this.proposalSchema(probe))
      throw new MemoryP2PlanError('P2_SOURCE_DRIFT', ['SEMANTIC_CONTEXT_PROBE_INVALID']);
    const plan = buildMutationPlan(context, probe);
    if (!this.planSchema(plan))
      throw new MemoryP2PlanError('P2_SOURCE_DRIFT', ['SEMANTIC_CONTEXT_PROBE_INVALID']);
    const semantic = validateSemanticEnvelope(context, probe, plan);
    if (!semantic.valid) throw new MemoryP2PlanError('P2_SOURCE_DRIFT', semantic.errors);
    return context;
  }

  public build(context: MemoryP2SemanticContext, value: unknown): MemoryP2ValidatedProposal {
    if (!this.proposalSchema(value))
      throw new MemoryP2PlanError('P2_TERMINAL_UNAVAILABLE', ['SEMANTIC_PROPOSAL_SCHEMA_INVALID']);
    const proposal = value as MemoryP2SemanticProposal;
    const plan = buildMutationPlan(context, proposal);
    if (!this.planSchema(plan))
      throw new MemoryP2PlanError('P2_TERMINAL_UNAVAILABLE', [
        'SEMANTIC_MUTATION_PLAN_SCHEMA_INVALID',
      ]);
    const semantic = validateSemanticEnvelope(context, proposal, plan);
    if (!semantic.valid) throw new MemoryP2PlanError('P2_TERMINAL_UNAVAILABLE', semantic.errors);
    return { plan, proposal };
  }
}

function buildMutationPlan(
  context: MemoryP2SemanticContext,
  proposal: MemoryP2SemanticProposal,
): MemoryP2MutationPlan {
  const memberByRef = new Map(
    context.source_members.map((member) => [member.source_ref_id, member]),
  );
  const entries: MemoryP2MutationPlanEntry[] = proposal.proposals.map((item) => {
    const targetSource =
      item.target.existing_source_ref_id === null
        ? undefined
        : memberByRef.get(item.target.existing_source_ref_id);
    return {
      claim_evidence_manifest_hash: semanticClaimEvidenceManifestHash(item),
      proposal_id: item.proposal_id,
      proposed_state_digest: semanticContentDigest(item.proposed_state),
      source_member_ref_ids: [...item.source_member_ref_ids],
      target_authority_ref:
        item.target.kind === 'existing_slot' && targetSource !== undefined
          ? {
              expected_revision: targetSource.resolution_revision,
              resolution_id: targetSource.resolution_id,
            }
          : null,
      target_kind: item.target.kind,
    };
  });
  const planWithoutDigest = {
    entries,
    plan_schema_version: 'validated-memory-mutation-plan-v1' as const,
    proposal_digest: semanticProposalDigest(proposal),
    source_manifest_hash: context.source_manifest_hash,
  };
  return {
    ...planWithoutDigest,
    plan_digest: semanticMutationPlanDigest(planWithoutDigest),
  };
}

function buildContextProbeProposal(context: MemoryP2SemanticContext): MemoryP2SemanticProposal {
  const source = context.source_members.at(0);
  if (source === undefined)
    throw new MemoryP2PlanError('P2_SOURCE_DRIFT', ['SEMANTIC_CONTEXT_SOURCE_REQUIRED']);
  const proposedState: MemoryP2ProposedState = {
    ...structuredClone(source.semantic_state),
    claims: source.semantic_state.claims.map((claim, index): MemoryP2ProposedClaim => ({
      claim_key: claim.claim_key,
      evidence_ref_ids: [...claim.evidence_ref_ids],
      proposal_claim_ref_id: `proposal-claim:context-probe:${String(index)}`,
      source_claim_ref_ids: [claim.source_claim_ref_id],
      value: structuredClone(claim.value),
      value_kind: claim.value_kind,
    })),
  };
  return {
    output_schema_version: 'memory-semantic-proposal-v1',
    proposals: [
      {
        proposal_id: 'proposal:context-probe',
        proposed_state: proposedState,
        reason_code: 'new_semantic_slot',
        semantic_intent: 'derive',
        source_member_ref_ids: [source.source_ref_id],
        target: { existing_source_ref_id: null, kind: 'new_slot' },
      },
    ],
    source_manifest_hash: context.source_manifest_hash,
  };
}

function compile(
  ajv: { compile(schema: object): ValidateFunction },
  root: string,
  name: string,
): ValidateFunction {
  const schema = JSON.parse(
    readFileSync(join(root, `docs/contracts/${name}.schema.json`), 'utf8'),
  ) as object;
  return ajv.compile(schema);
}

function findWorkspaceRoot(start: string): string {
  let current = start;
  for (;;) {
    if (existsSync(join(current, 'docs/contracts/memory-semantic-envelope-v1.md'))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error('MEMORY_P2_CONTRACT_ROOT_NOT_FOUND');
    current = parent;
  }
}
