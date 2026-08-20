import { semanticCanonicalDigest } from './memory-semantic-envelope-contract.js';
import type {
  MemoryP2ProposedClaim,
  MemoryP2ProposedState,
  MemoryP2SemanticContext,
  MemoryP2SemanticProposal,
} from './memory-p2-runtime.types.js';

export interface MemoryP2ProviderPort {
  propose(context: MemoryP2SemanticContext, signal: AbortSignal): Promise<unknown>;
}

export class MemoryP2ProviderError extends Error {
  public readonly errorCode = 'P2_PROVIDER_UNAVAILABLE' as const;

  public constructor(message = 'P2_PROVIDER_UNAVAILABLE') {
    super(message);
    this.name = 'MemoryP2ProviderError';
  }
}

export class UnavailableMemoryP2Provider implements MemoryP2ProviderPort {
  public propose(): Promise<never> {
    return Promise.reject(new MemoryP2ProviderError());
  }
}

export class DeterministicMemoryP2Provider implements MemoryP2ProviderPort {
  public constructor(private readonly environment: 'local' | 'test' | 'staging' | 'production') {}

  public propose(
    context: MemoryP2SemanticContext,
    signal: AbortSignal,
  ): Promise<MemoryP2SemanticProposal> {
    if (this.environment !== 'local' && this.environment !== 'test')
      return Promise.reject(new MemoryP2ProviderError());
    if (signal.aborted) return Promise.reject(abortError(signal.reason));
    const source =
      context.source_members.find((member) => member.authority === 'automatic') ??
      context.source_members[0];
    if (source === undefined) return Promise.reject(new MemoryP2ProviderError());
    const digest = semanticCanonicalDigest('memory-p2-deterministic-proposal-v1', context);
    const proposedState: MemoryP2ProposedState = {
      ...structuredClone(source.semantic_state),
      claims: source.semantic_state.claims.map((claim, index): MemoryP2ProposedClaim => ({
        claim_key: claim.claim_key,
        evidence_ref_ids: [...claim.evidence_ref_ids],
        proposal_claim_ref_id: `proposal-claim:${digest.slice(0, 24)}:${String(index)}`,
        source_claim_ref_ids: [claim.source_claim_ref_id],
        value: structuredClone(claim.value),
        value_kind: claim.value_kind,
      })),
    };
    return Promise.resolve({
      output_schema_version: 'memory-semantic-proposal-v1',
      proposals: [
        {
          proposal_id: `proposal:${digest.slice(0, 32)}`,
          proposed_state: proposedState,
          reason_code: 'episode_reorganization',
          semantic_intent: 'reorganize',
          source_member_ref_ids: [source.source_ref_id],
          target:
            source.authority === 'automatic'
              ? { existing_source_ref_id: source.source_ref_id, kind: 'existing_slot' }
              : { existing_source_ref_id: null, kind: 'new_slot' },
        },
      ],
      source_manifest_hash: context.source_manifest_hash,
    });
  }
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  return new DOMException('The operation was aborted', 'AbortError');
}
