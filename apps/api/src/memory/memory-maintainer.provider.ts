import { Injectable } from '@nestjs/common';

export type MemoryMaintainerTriggerKind =
  'batch_threshold' | 'time_threshold' | 'session_final_flush';
export type MemorySemanticKind = 'episode' | 'fact';
export type MemorySemanticStatus = 'current' | 'uncertain' | 'disputed';
export type MaintainerMemoryTag =
  | 'person'
  | 'relationship'
  | 'place'
  | 'event'
  | 'time'
  | 'time_range'
  | 'important_choice'
  | 'reason_clue'
  | 'unfinished_story';

export interface MemoryMaintainerContextV12 {
  context_schema_version: 'memory-maintainer-context-v1.2';
  trigger: {
    kind: MemoryMaintainerTriggerKind;
    identity: string;
    selected_new_segment_count: number;
    cumulative_useful_characters: number;
    minimum_useful_characters: number;
  };
  transcript_membership: readonly {
    segment_id: string;
    session_id: string;
    membership_kind: 'new' | 'overlap';
    start_ms: number;
    text: string;
    trusted_role: 'elder' | 'interviewer';
    text_revision: number;
    speaker_role_revision: number;
    effective_text_digest: string;
    content_kind: 'conversation';
  }[];
  active_thread: null | {
    thread_id: string;
    revision: number;
    status: 'active' | 'parked';
    topic_key: string;
  };
  current_working_memory: readonly MemoryMaintainerWorkingMemory[];
  session_mid_index: readonly unknown[];
  active_boundaries: readonly {
    boundary_id: string;
    revision: number;
    status: 'active';
    code: 'elder_explicit_boundary';
    abstract_scope: string;
  }[];
}

export interface MemoryMaintainerWorkingMemory {
  resolution_id: string;
  revision: number;
  thread_id: string;
  semantic_kind: MemorySemanticKind;
  memory_tag?: MaintainerMemoryTag | null;
  canonical_key: string;
  value_kind: 'exact' | 'range' | 'unknown' | null;
  value: unknown;
  resolution_kind: 'single' | 'range' | 'unknown' | 'conflict_set';
  semantic_status: MemorySemanticStatus;
  resolution_status: 'current';
  claims: readonly {
    claim_id: string;
    value_kind: 'exact' | 'range' | 'unknown';
    value: unknown;
  }[];
}

export interface MemoryMaintainerOutputV12 {
  output_schema_version: 'memory-maintainer-output-v1.2';
  operations: readonly MemoryMaintainerOperationV12[];
  boundary_candidates: readonly {
    candidate_id: string;
    code: 'elder_explicit_boundary';
    abstract_scope: string;
    evidence_segment_ids: readonly string[];
  }[];
}

export interface MemoryMaintainerOperationV12 {
  operation_id: string;
  kind:
    'CONTINUE' | 'BRANCH' | 'RESUME' | 'NEW' | 'DUPLICATE' | 'SUPPLEMENT' | 'RELATED' | 'UNCERTAIN';
  target_resolution_id: string | null;
  expected_resolution_revision: number | null;
  anchor_thread_id: string | null;
  expected_anchor_thread_revision: number | null;
  proposed_state: null | {
    semantic_kind: MemorySemanticKind;
    memory_tag?: MaintainerMemoryTag | null;
    canonical_key: string;
    value_kind: 'exact' | 'range' | 'unknown' | null;
    value: unknown;
    resolution_kind: 'single' | 'range' | 'unknown' | 'conflict_set';
    semantic_status: MemorySemanticStatus;
    claims: readonly {
      claim_id: string | null;
      claim_key: string;
      value_kind: 'exact' | 'range' | 'unknown';
      value: unknown;
      evidence_segment_ids: readonly string[];
    }[];
  };
  evidence_segment_ids: readonly string[];
  reason_code:
    | 'same_canonical_key'
    | 'explicit_correction'
    | 'same_topic'
    | 'new_topic'
    | 'duplicate_content'
    | 'uncertain_value'
    | 'conflicting_claims';
}

export abstract class MemoryMaintainerProvider {
  public abstract maintain(context: MemoryMaintainerContextV12): Promise<unknown>;
}

export class MemoryMaintainerProviderUnavailableError extends Error {
  public constructor() {
    super('AI_PROVIDER_UNAVAILABLE');
  }
}

@Injectable()
export class UnavailableMemoryMaintainerProvider extends MemoryMaintainerProvider {
  public override maintain(): Promise<never> {
    return Promise.reject(new MemoryMaintainerProviderUnavailableError());
  }
}

/** Deterministic local/test fixture. It emits NEW Episode/Fact candidates without guessing links. */
@Injectable()
export class LocalTestMemoryMaintainerProvider extends MemoryMaintainerProvider {
  public override maintain(
    context: MemoryMaintainerContextV12,
  ): Promise<MemoryMaintainerOutputV12> {
    const operations: MemoryMaintainerOperationV12[] = [];
    const boundaryCandidates: MemoryMaintainerOutputV12['boundary_candidates'][number][] = [];
    for (const segment of context.transcript_membership) {
      if (segment.membership_kind !== 'new' || segment.trusted_role !== 'elder') continue;
      const match =
        /^工作记忆\[(episode|fact):(?:(person|relationship|place|event|time|time_range|important_choice|reason_clue|unfinished_story):)?(.+?)\]\s*=\s*(.+)$/u.exec(
          segment.text.trim(),
        );
      if (match !== null) {
        const semanticKind = match[1] as MemorySemanticKind;
        const memoryTag = (match[2] as MaintainerMemoryTag | undefined) ?? null;
        const canonicalKey = match[3] ?? 'local';
        const value = match[4] ?? '';
        operations.push({
          operation_id: `local:${segment.segment_id}`,
          kind: 'NEW',
          target_resolution_id: null,
          expected_resolution_revision: null,
          anchor_thread_id: null,
          expected_anchor_thread_revision: null,
          proposed_state: {
            semantic_kind: semanticKind,
            memory_tag: memoryTag,
            canonical_key: canonicalKey,
            value_kind: 'exact',
            value,
            resolution_kind: 'single',
            semantic_status: 'current',
            claims: [
              {
                claim_id: null,
                claim_key: `local:${segment.segment_id}`,
                value_kind: 'exact',
                value,
                evidence_segment_ids: [segment.segment_id],
              },
            ],
          },
          evidence_segment_ids: [segment.segment_id],
          reason_code: 'new_topic',
        });
      }
      const boundary = /^访谈边界\s*=\s*(.+)$/u.exec(segment.text.trim());
      if (boundary?.[1] !== undefined) {
        boundaryCandidates.push({
          candidate_id: `local-boundary:${segment.segment_id}`,
          code: 'elder_explicit_boundary',
          abstract_scope: boundary[1].slice(0, 240),
          evidence_segment_ids: [segment.segment_id],
        });
      }
    }
    return Promise.resolve({
      output_schema_version: 'memory-maintainer-output-v1.2',
      operations,
      boundary_candidates: boundaryCandidates,
    });
  }
}
