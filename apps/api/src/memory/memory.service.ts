import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AiJobCoordinatorService } from '../ai-runtime/ai-job-coordinator.service.js';
import {
  AiOutputEligibilityService,
  isCurrentMemoryProvenanceReadable,
} from '../ai-runtime/ai-output-eligibility.service.js';
import {
  canonicalJson,
  EMPTY_MANIFEST_HASH,
  manifestHash,
  sha256,
} from '../ai-runtime/ai-provenance.js';
import { AiPolicyService } from '../ai-runtime/ai-policy.service.js';
import { StructuredAiProvider } from '../ai-runtime/structured-ai.provider.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  MEMORY_MAINTAINER_RUNTIME_CONFIG,
  type MemoryMaintainerRuntimeConfig,
} from './memory-maintainer.runtime.js';

export interface CurrentMemoryItem {
  authority: 'automatic' | 'human_confirmed' | 'system_migration';
  canonicalKey: string;
  id: string;
  layer: 'working' | 'mid' | 'long' | 'unknown';
  memoryType: string | null;
  resolutionKind: string;
  resolutionRevision: number;
  resolvedValue: unknown;
  semanticKind: 'episode' | 'fact' | null;
}

@Injectable()
export class CurrentMemoryReader {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: AiOutputEligibilityService,
    private readonly policy: AiPolicyService,
    @Inject(MEMORY_MAINTAINER_RUNTIME_CONFIG)
    private readonly memoryMaintainerConfig: MemoryMaintainerRuntimeConfig,
  ) {}

  public async list(actorId: string, projectId: string): Promise<readonly CurrentMemoryItem[]> {
    const policy = await this.policy.assertAllowed(actorId, projectId, []);
    const blockedCanonicalKeys = new Set(policy.blockedCanonicalKeys);
    const rows = await this.prisma.memoryResolution.findMany({
      orderBy: [{ semanticKind: 'asc' }, { canonicalKey: 'asc' }, { id: 'asc' }],
      where: {
        projectId,
        provenanceState: this.memoryMaintainerConfig.enabled ? 'active' : null,
        status: 'current',
      },
    });
    const visible: CurrentMemoryItem[] = [];
    for (const row of rows) {
      if (
        blockedCanonicalKeys.has(row.canonicalKey) ||
        !isCurrentMemoryProvenanceReadable(row.provenanceState) ||
        !(await this.eligibility.isMemoryResolutionEligible(actorId, projectId, row.id))
      )
        continue;
      visible.push({
        authority: row.authority,
        canonicalKey: row.canonicalKey,
        id: row.id,
        layer: row.layer ?? 'unknown',
        memoryType: row.memoryType,
        resolutionKind: row.resolutionKind,
        resolutionRevision: row.resolutionRevision,
        resolvedValue: row.resolvedValueJson,
        semanticKind: row.semanticKind,
      });
    }
    return visible;
  }
}

@Injectable()
export class MemoryService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly coordinator: AiJobCoordinatorService,
    private readonly provider: StructuredAiProvider,
    private readonly current: CurrentMemoryReader,
  ) {}

  public async extract(input: {
    actorId: string;
    expiresAt: Date;
    judgeable?: boolean;
    projectId: string;
    requestId: string;
    sessionIds: readonly string[];
    triggerDedupeKey?: string;
  }): Promise<readonly CurrentMemoryItem[]> {
    const current = await this.current.list(input.actorId, input.projectId);
    const job = await this.coordinator.freeze({
      actorId: input.actorId,
      expiresAt: input.expiresAt,
      jobType: 'memory_extract',
      memoryResolutionIds: current.map(({ id }) => id),
      projectId: input.projectId,
      requestId: input.requestId,
      sessionIds: input.sessionIds,
      ...(input.triggerDedupeKey === undefined ? {} : { triggerDedupeKey: input.triggerDedupeKey }),
      trustedRole: 'elder',
    });
    if (job.replayed) {
      if (job.status === 'succeeded') return this.current.list(input.actorId, input.projectId);
      throw new Error(`AI_REQUEST_REPLAY_${job.status.toUpperCase()}`);
    }
    const claims =
      input.judgeable === false
        ? []
        : await this.coordinator.callProvider(job, () => this.provider.extractMemory(job.segments));
    await this.coordinator.writeBack(job, async (tx) => {
      if (input.judgeable === false) {
        await tx.aiJob.update({ data: { failureCode: 'MEMORY_UNJUDGED' }, where: { id: job.id } });
        return;
      }
      for (const claim of claims) {
        const evidenceInputs = claim.evidenceSegmentIds.map((segmentId) => {
          const frozen = job.segments.find((segment) => segment.segmentId === segmentId);
          if (frozen === undefined) throw new Error('AI_EVIDENCE_OUTSIDE_FROZEN_INPUT');
          return frozen;
        });
        const claimId = randomUUID();
        const claimOutputId = randomUUID();
        const segmentManifest = evidenceInputs.map((segment) =>
          this.segmentManifestEntry(job.id, segment.inputSegmentId),
        );
        const resolvedSegmentManifest = await Promise.all(segmentManifest);
        await tx.aiDerivedOutput.create({
          data: {
            aiJobId: job.id,
            businessOutputId: claimId,
            expectedMemoryCount: 0,
            expectedMemoryManifestHash: EMPTY_MANIFEST_HASH,
            expectedQuestionCount: 0,
            expectedQuestionManifestHash: EMPTY_MANIFEST_HASH,
            expectedSegmentCount: evidenceInputs.length,
            expectedSegmentManifestHash: manifestHash(resolvedSegmentManifest),
            id: claimOutputId,
            outputType: 'memory_claim',
            projectId: input.projectId,
          },
        });
        const valueJson = { value: claim.value } as Prisma.InputJsonValue;
        await tx.memoryClaim.create({
          data: {
            aiDerivedOutputId: claimOutputId,
            aiJobId: job.id,
            canonicalKey: claim.canonicalKey,
            explicitCorrection: claim.explicitCorrection,
            id: claimId,
            memoryType: claim.memoryType,
            normalizedValueDigest: sha256(canonicalJson(valueJson)),
            projectId: input.projectId,
            valueJson,
            valueKind: claim.valueKind,
          },
        });
        for (const [order, evidence] of evidenceInputs.entries()) {
          await tx.memoryClaimEvidence.create({
            data: {
              aiJobInputSegmentId: evidence.inputSegmentId,
              evidenceOrder: order,
              id: randomUUID(),
              memoryClaimId: claimId,
              transcriptSegmentId: evidence.segmentId,
            },
          });
          await tx.aiOutputSegmentDependency.create({
            data: {
              aiDerivedOutputId: claimOutputId,
              aiJobInputSegmentId: evidence.inputSegmentId,
              dependencyOrder: order,
              id: randomUUID(),
            },
          });
        }
        await this.resolveClaim(
          tx,
          job.id,
          input.projectId,
          claimId,
          claimOutputId,
          resolvedSegmentManifest,
        );
      }
    });
    return this.current.list(input.actorId, input.projectId);
  }

  private async resolveClaim(
    tx: Prisma.TransactionClient,
    jobId: string,
    projectId: string,
    claimId: string,
    claimOutputId: string,
    segmentManifest: readonly string[],
  ): Promise<void> {
    const claim = await tx.memoryClaim.findUniqueOrThrow({ where: { id: claimId } });
    const previous = await tx.memoryResolution.findFirst({
      where: {
        canonicalKey: claim.canonicalKey,
        memoryType: claim.memoryType,
        projectId,
        provenanceState: null,
        status: 'current',
      },
    });
    const priorInput =
      previous === null
        ? undefined
        : ((await tx.aiJobInputMemory.findFirst({
            where: { aiJobId: jobId, memoryResolutionId: previous.id },
          })) ?? undefined);
    const previousMembers =
      previous === null
        ? []
        : await tx.memoryResolutionMember.findMany({
            orderBy: { memberOrder: 'asc' },
            where: { memoryResolutionId: previous.id },
          });
    let status: 'current' | 'pending_review' = 'current';
    let kind: 'single' | 'conflict_set' | 'review_required' = 'single';
    let memberIds = [claimId];
    if (previous?.authority === 'human_confirmed') {
      status = 'pending_review';
      kind = 'review_required';
      memberIds = [...previousMembers.map(({ memoryClaimId }) => memoryClaimId), claimId];
    } else if (previous !== null && !claim.explicitCorrection) {
      kind = 'conflict_set';
      memberIds = [...previousMembers.map(({ memoryClaimId }) => memoryClaimId), claimId];
      await tx.memoryResolution.update({
        data: { status: 'superseded' },
        where: { id: previous.id },
      });
    } else if (previous !== null) {
      await tx.memoryResolution.update({
        data: { status: 'superseded' },
        where: { id: previous.id },
      });
    }
    const resolutionId = randomUUID();
    const resolutionOutputId = randomUUID();
    const memoryManifest =
      priorInput === undefined
        ? []
        : [
            `${priorInput.id}:${priorInput.memoryResolutionId}:${String(priorInput.resolutionRevision)}`,
          ];
    await tx.aiDerivedOutput.create({
      data: {
        aiJobId: jobId,
        businessOutputId: resolutionId,
        expectedMemoryCount: memoryManifest.length,
        expectedMemoryManifestHash: manifestHash(memoryManifest),
        expectedQuestionCount: 0,
        expectedQuestionManifestHash: EMPTY_MANIFEST_HASH,
        expectedSegmentCount: segmentManifest.length,
        expectedSegmentManifestHash: manifestHash(segmentManifest),
        id: resolutionOutputId,
        outputType: 'memory_resolution',
        projectId,
        status: status === 'pending_review' ? 'review_required' : 'current',
      },
    });
    await tx.memoryResolution.create({
      data: {
        aiDerivedOutputId: resolutionOutputId,
        aiJobId: jobId,
        authority: 'automatic',
        canonicalKey: claim.canonicalKey,
        id: resolutionId,
        memoryType: claim.memoryType,
        projectId,
        resolutionKind: kind,
        resolutionRevision: (previous?.resolutionRevision ?? 0) + 1,
        resolvedValueJson:
          kind === 'single' ? (claim.valueJson as Prisma.InputJsonValue) : { claim_ids: memberIds },
        status,
        supersedesResolutionId: status === 'current' ? (previous?.id ?? null) : null,
      },
    });
    for (const [memberOrder, memoryClaimId] of memberIds.entries()) {
      await tx.memoryResolutionMember.create({
        data: { id: randomUUID(), memberOrder, memoryClaimId, memoryResolutionId: resolutionId },
      });
    }
    const claimDeps = await tx.aiOutputSegmentDependency.findMany({
      orderBy: { dependencyOrder: 'asc' },
      where: { aiDerivedOutputId: claimOutputId },
    });
    for (const dep of claimDeps) {
      await tx.aiOutputSegmentDependency.create({
        data: {
          aiDerivedOutputId: resolutionOutputId,
          aiJobInputSegmentId: dep.aiJobInputSegmentId,
          dependencyOrder: dep.dependencyOrder,
          id: randomUUID(),
        },
      });
    }
    if (priorInput !== undefined) {
      await tx.aiOutputMemoryDependency.create({
        data: {
          aiDerivedOutputId: resolutionOutputId,
          aiJobInputMemoryId: priorInput.id,
          dependencyOrder: 0,
          id: randomUUID(),
        },
      });
    }
  }

  private async segmentManifestEntry(jobId: string, inputId: string): Promise<string> {
    const input = await this.prisma.aiJobInputSegment.findFirstOrThrow({
      where: { aiJobId: jobId, id: inputId },
    });
    return `${input.id}:${input.transcriptSegmentId}:${String(input.textRevision)}:${String(input.speakerRoleRevision)}:${input.effectiveTextDigest}`;
  }
}
