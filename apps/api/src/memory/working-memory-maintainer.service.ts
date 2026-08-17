import { Injectable } from '@nestjs/common';

import {
  assertCandidateOperation,
  evidenceFromSegment,
  type MemoryBoundary,
  type WorkingMemoryCandidateOperation,
  type WorkingMemoryItem,
  type WorkingMemoryMaintainerInput,
  type MaintainerTranscriptSegment,
} from './memory-core.contract.js';
import { StructuredAiProvider } from '../ai-runtime/structured-ai.provider.js';
import type { StructuredMemoryClaim } from '../ai-runtime/structured-ai.provider.js';

export interface WorkingMemoryMaintenanceResult {
  operations: readonly WorkingMemoryCandidateOperation[];
  boundaryCandidates: readonly MemoryBoundary[];
  trigger: 'batch_threshold' | 'time_threshold' | 'not_ready';
}

export interface WorkingMemoryTriggerInput {
  finalizedSinceLastRun: number;
  oldestUnprocessedAtMs: number | null;
  nowMs: number;
  minimumUsefulContent: boolean;
  batchThreshold?: number;
  timeThresholdMs?: number;
}

export function workingMemoryTrigger(
  input: WorkingMemoryTriggerInput,
): WorkingMemoryMaintenanceResult['trigger'] {
  const batchThreshold = input.batchThreshold ?? 3;
  const timeThresholdMs = input.timeThresholdMs ?? 15_000;
  if (!input.minimumUsefulContent) return 'not_ready';
  if (input.finalizedSinceLastRun >= batchThreshold) return 'batch_threshold';
  if (
    input.oldestUnprocessedAtMs !== null &&
    input.nowMs - input.oldestUnprocessedAtMs >= timeThresholdMs
  ) {
    return 'time_threshold';
  }
  return 'not_ready';
}

@Injectable()
export class WorkingMemoryMaintainerService {
  public constructor(private readonly provider: StructuredAiProvider) {}

  public async propose(
    input: WorkingMemoryMaintainerInput,
    trigger: WorkingMemoryMaintenanceResult['trigger'],
  ): Promise<WorkingMemoryMaintenanceResult> {
    if (trigger === 'not_ready') return { boundaryCandidates: [], operations: [], trigger };
    const elderSegments = input.finalizedTranscript.filter(
      ({ trustedRole }) => trustedRole === 'elder',
    );
    if (elderSegments.length === 0) return { boundaryCandidates: [], operations: [], trigger };
    const claims = await this.provider.extractMemory(
      elderSegments.map((segment) => ({
        inputSegmentId: segment.segmentId,
        segmentId: segment.segmentId,
        sessionId: segment.sessionId,
        startMs: segment.startMs,
        text: segment.text,
        trustedRole: segment.trustedRole,
      })),
    );
    const operations: WorkingMemoryCandidateOperation[] = [];
    const comparisonWorking = [...input.currentWorking];
    for (const claim of claims) {
      const operation = this.toOperation(
        claim,
        { ...input, currentWorking: comparisonWorking },
        elderSegments,
      )[0];
      if (operation === undefined) continue;
      operations.push(operation);
      if (
        operation.kind !== 'DUPLICATE' &&
        operation.canonicalKey !== null &&
        operation.memoryType !== null &&
        operation.valueKind !== null
      ) {
        const virtualId = operation.targetMemoryId ?? `working:${operation.operationId}`;
        const existing = comparisonWorking.find(({ id }) => id === virtualId);
        const virtual: WorkingMemoryItem = {
          canonicalKey: operation.canonicalKey,
          evidence: operation.evidence,
          id: virtualId,
          layer: 'working',
          memoryType: operation.memoryType,
          revision: existing?.revision ?? 1,
          status:
            operation.kind === 'UNCERTAIN' || operation.valueKind === 'unknown'
              ? 'uncertain'
              : 'current',
          threadId: operation.targetThreadId ?? `thread:${operation.canonicalKey}`,
          value: operation.value,
          valueKind: operation.valueKind,
        };
        const existingIndex = comparisonWorking.findIndex(({ id }) => id === virtualId);
        if (existingIndex >= 0) comparisonWorking[existingIndex] = virtual;
        else comparisonWorking.push(virtual);
      }
    }
    const boundaryCandidates = elderSegments.flatMap((segment) =>
      this.boundaryFromSegment(segment),
    );
    operations.forEach(assertCandidateOperation);
    return { boundaryCandidates, operations, trigger };
  }

  private toOperation(
    claim: StructuredMemoryClaim,
    input: WorkingMemoryMaintainerInput,
    segments: readonly MaintainerTranscriptSegment[],
  ): WorkingMemoryCandidateOperation[] {
    const evidence = claim.evidenceSegmentIds.flatMap((id, order) => {
      const segment = segments.find((candidate) => candidate.segmentId === id);
      return segment === undefined ? [] : [evidenceFromSegment(segment, order)];
    });
    if (evidence.length === 0) throw new Error('MEMORY_OPERATION_EVIDENCE_OUTSIDE_BATCH');
    const target = input.currentWorking.find((item) => item.canonicalKey === claim.canonicalKey);
    if (target === undefined) {
      const resumable = input.sessionMidIndex.find(
        (item) =>
          item.canonicalKey === claim.canonicalKey &&
          item.layer === 'mid' &&
          item.status === 'current',
      );
      const related = input.currentWorking.find(
        (item) => topicPrefix(item.canonicalKey) === topicPrefix(claim.canonicalKey),
      );
      const kind =
        claim.valueKind === 'unknown'
          ? 'UNCERTAIN'
          : resumable !== undefined
            ? 'RESUME'
            : related !== undefined
              ? 'RELATED'
              : input.activeThread !== null && input.currentWorking.length > 0
                ? 'BRANCH'
                : 'NEW';
      return [
        {
          operationId: `memory-op:${claim.canonicalKey}:${evidence.map(({ segmentId }) => segmentId).join(',')}`,
          kind,
          targetMemoryId: resumable?.id ?? null,
          targetThreadId:
            kind === 'BRANCH'
              ? `thread:branch:${claim.canonicalKey}:${evidence.map(({ segmentId }) => segmentId).join(',')}`
              : (related?.threadId ?? resumable?.threadId ?? input.activeThread?.id ?? null),
          canonicalKey: claim.canonicalKey,
          memoryType: claim.memoryType,
          value: claim.value,
          valueKind: claim.valueKind,
          evidence,
          reasonCode:
            claim.valueKind === 'unknown'
              ? 'uncertain_value'
              : resumable !== undefined
                ? 'same_topic'
                : related !== undefined
                  ? 'same_topic'
                  : 'new_topic',
        },
      ];
    }
    const existingValue = JSON.stringify(target.value);
    const nextValue = JSON.stringify(claim.value);
    const kind =
      claim.valueKind === 'unknown'
        ? 'UNCERTAIN'
        : existingValue === nextValue
          ? 'DUPLICATE'
          : claim.explicitCorrection
            ? 'SUPPLEMENT'
            : 'CONTINUE';
    return [
      {
        operationId: `memory-op:${target.id}:${evidence.map(({ segmentId }) => segmentId).join(',')}`,
        kind,
        targetMemoryId: target.id,
        targetThreadId: target.threadId,
        canonicalKey: claim.canonicalKey,
        memoryType: claim.memoryType,
        value: claim.value,
        valueKind: claim.valueKind,
        evidence,
        reasonCode:
          kind === 'DUPLICATE'
            ? 'duplicate_content'
            : claim.explicitCorrection
              ? 'explicit_correction'
              : 'same_canonical_key',
      },
    ];
  }

  private boundaryFromSegment(segment: MaintainerTranscriptSegment): MemoryBoundary[] {
    const match = /(?:不要|不想|别再|不愿意|不希望)\s*(?:再)?(?:问|聊|谈)?\s*(.*)$/u.exec(
      segment.text.trim(),
    );
    if (match === null) return [];
    const scope = (match[1] ?? '').trim();
    if (scope.length === 0) return [];
    return [
      {
        id: `boundary:${segment.segmentId}`,
        code: 'elder_explicit_boundary',
        abstractScope: scope,
        status: 'active',
        revision: 1,
        evidence: [evidenceFromSegment(segment, 0)],
      },
    ];
  }
}

@Injectable()
export class WorkingMemoryOperationApplier {
  public apply(
    current: readonly WorkingMemoryItem[],
    operations: readonly WorkingMemoryCandidateOperation[],
    authoritativeSegments: ReadonlyMap<string, MaintainerTranscriptSegment>,
  ): readonly WorkingMemoryItem[] {
    const next = new Map(current.map((item) => [item.id, item]));
    for (const operation of operations) {
      assertCandidateOperation(operation);
      for (const evidence of operation.evidence) {
        const segment = authoritativeSegments.get(evidence.segmentId);
        if (segment === undefined) throw new Error('MEMORY_OPERATION_EVIDENCE_NOT_IN_BATCH');
        if (
          evidence.textRevision !== segment.textRevision ||
          evidence.speakerRoleRevision !== segment.speakerRoleRevision ||
          evidence.effectiveTextDigest !== segment.effectiveTextDigest
        ) {
          throw new Error('MEMORY_OPERATION_EVIDENCE_DRIFT');
        }
      }
      if (operation.kind === 'DUPLICATE') continue;
      const existing =
        operation.targetMemoryId === null ? undefined : next.get(operation.targetMemoryId);
      if (existing !== undefined) {
        if (
          operation.canonicalKey !== existing.canonicalKey ||
          operation.memoryType !== existing.memoryType ||
          (operation.targetThreadId !== null && operation.targetThreadId !== existing.threadId)
        ) {
          throw new Error('MEMORY_OPERATION_TARGET_DRIFT');
        }
        next.set(existing.id, {
          ...existing,
          evidence: mergeEvidence(existing.evidence, operation.evidence),
          revision: existing.revision + 1,
          status:
            operation.kind === 'UNCERTAIN' || operation.valueKind === 'unknown'
              ? 'uncertain'
              : existing.status,
          value: operation.value,
          valueKind: operation.valueKind ?? existing.valueKind,
        });
        continue;
      }
      if (
        operation.canonicalKey === null ||
        operation.memoryType === null ||
        operation.valueKind === null
      ) {
        throw new Error('MEMORY_OPERATION_CREATE_FIELDS_REQUIRED');
      }
      const id = operation.targetMemoryId ?? `working:${operation.operationId}`;
      next.set(id, {
        canonicalKey: operation.canonicalKey,
        evidence: operation.evidence,
        id,
        layer: 'working',
        memoryType: operation.memoryType,
        revision: 1,
        status:
          operation.kind === 'UNCERTAIN' || operation.valueKind === 'unknown'
            ? 'uncertain'
            : 'current',
        threadId: operation.targetThreadId ?? `thread:${operation.canonicalKey}`,
        value: operation.value,
        valueKind: operation.valueKind,
      });
    }
    return [...next.values()].sort(
      (left, right) =>
        left.threadId.localeCompare(right.threadId) || left.id.localeCompare(right.id),
    );
  }
}

function topicPrefix(canonicalKey: string): string {
  return canonicalKey.split('.', 1)[0] ?? canonicalKey;
}

function mergeEvidence(
  current: WorkingMemoryItem['evidence'],
  added: WorkingMemoryItem['evidence'],
): WorkingMemoryItem['evidence'] {
  const bySegment = new Map(current.map((item) => [item.segmentId, item]));
  for (const item of added) bySegment.set(item.segmentId, item);
  return [...bySegment.values()].map((item, order) => ({ ...item, order }));
}
