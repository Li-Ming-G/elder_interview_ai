import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { AiJobCoordinatorService } from '../ai-runtime/ai-job-coordinator.service.js';
import { AiOutputEligibilityService } from '../ai-runtime/ai-output-eligibility.service.js';
import { EMPTY_MANIFEST_HASH, manifestHash } from '../ai-runtime/ai-provenance.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AiJob } from '../generated/prisma/client.js';
import {
  postSessionLaneTriggerKey,
  postSessionTriggerIdentity,
} from '../project-foundation/post-session-coordination.identity.js';
import {
  ActualAskedReader,
  type ActualAskedItem,
} from '../question-evidence/question-evidence.service.js';
import { CurrentMemoryReader, type CurrentMemoryItem } from './memory.service.js';
import {
  MEMORY_MAINTAINER_RUNTIME_CONFIG,
  type MemoryMaintainerRuntimeConfig,
} from './memory-maintainer.runtime.js';

export type PostSessionTerminalOutcome =
  'succeeded' | 'unjudged' | 'failed' | 'cancelled' | 'unavailable';

export interface OpeningContextProvenance {
  actualLane: { jobId: string; outcome: PostSessionTerminalOutcome };
  basisAnalysisTriggerIdentity: string;
  basisSessionId: string;
  calibrationConfirmed: boolean;
  calibrationGateIdentity: string;
  memoryLane: { jobId: string; outcome: PostSessionTerminalOutcome };
}

export interface FrozenOpeningContextInput {
  actualAsked: readonly ActualAskedItem[];
  basisSessionId: string;
  calibrationConfirmed: boolean;
  memories: readonly CurrentMemoryItem[];
  projectId: string;
  scopeSessionIds: readonly string[];
  snapshotId: string;
}

@Injectable()
export class InterviewContextService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly coordinator: AiJobCoordinatorService,
    private readonly eligibility: AiOutputEligibilityService,
    private readonly memory: CurrentMemoryReader,
    private readonly actualAsked: ActualAskedReader,
    @Inject(MEMORY_MAINTAINER_RUNTIME_CONFIG)
    private readonly memoryMaintainerConfig: MemoryMaintainerRuntimeConfig,
  ) {}

  public async create(input: {
    actorId: string;
    contextBuilderVersion?: string;
    consumerSessionId: string;
    expiresAt: Date;
    projectId: string;
    openingProvenance?: OpeningContextProvenance;
    requestId: string;
    scopeSessionIds?: readonly string[];
    triggerDedupeKey?: string;
    trustedRoles?: readonly ('elder' | 'interviewer')[];
  }): Promise<string> {
    const [memories, questions] = await Promise.all([
      this.memory.list(input.actorId, input.projectId),
      this.actualAsked.list(input.actorId, input.projectId),
    ]);
    const job = await this.coordinator.freeze({
      actorId: input.actorId,
      ...(input.contextBuilderVersion === undefined
        ? {}
        : { contextBuilderVersion: input.contextBuilderVersion }),
      actualQuestionIds: questions.map(({ id }) => id),
      expiresAt: input.expiresAt,
      jobType: 'context_snapshot',
      memoryResolutionIds: memories.map(({ id }) => id),
      projectId: input.projectId,
      requestId: input.requestId,
      sessionIds: input.scopeSessionIds ?? [input.consumerSessionId],
      ...(input.triggerDedupeKey === undefined ? {} : { triggerDedupeKey: input.triggerDedupeKey }),
      trustedRole: 'interviewer',
      ...(input.trustedRoles === undefined ? {} : { trustedRoles: input.trustedRoles }),
    });
    if (job.replayed) {
      const existing = await this.prisma.interviewContextSnapshot.findUnique({
        where: { aiJobId: job.id },
      });
      if (job.status === 'succeeded' && existing !== null) return existing.id;
      throw new Error(`AI_REQUEST_REPLAY_${job.status.toUpperCase()}`);
    }
    const snapshotId = randomUUID();
    await this.coordinator.writeBack(job, async (tx) => {
      const outputId = randomUUID();
      const memoryManifest = job.memories.map(
        (item) => `${item.inputMemoryId}:${item.resolutionId}:${String(item.resolutionRevision)}`,
      );
      const questionManifest = job.actualQuestions.map(
        (item) =>
          `actual_question:${item.actualQuestionId}:${String(item.analysisRevision)}:${item.normalizedDigest}`,
      );
      await tx.aiDerivedOutput.create({
        data: {
          aiJobId: job.id,
          businessOutputId: snapshotId,
          expectedMemoryCount: memoryManifest.length,
          expectedMemoryManifestHash: manifestHash(memoryManifest),
          expectedQuestionCount: questionManifest.length,
          expectedQuestionManifestHash: manifestHash(questionManifest),
          expectedSegmentCount: 0,
          expectedSegmentManifestHash: EMPTY_MANIFEST_HASH,
          id: outputId,
          outputType: 'context_snapshot',
          projectId: input.projectId,
        },
      });
      await tx.interviewContextSnapshot.create({
        data: {
          actualQuestionManifestHash: manifestHash(questionManifest),
          actualQuestionCount: job.actualQuestions.length,
          aiDerivedOutputId: outputId,
          aiJobId: job.id,
          ...(input.openingProvenance === undefined
            ? {}
            : {
                actualLaneJobId: input.openingProvenance.actualLane.jobId,
                actualLaneOutcome: input.openingProvenance.actualLane.outcome,
                basisAnalysisTriggerIdentity: input.openingProvenance.basisAnalysisTriggerIdentity,
                basisSessionId: input.openingProvenance.basisSessionId,
                calibrationConfirmed: input.openingProvenance.calibrationConfirmed,
                calibrationGateIdentity: input.openingProvenance.calibrationGateIdentity,
                memoryLaneJobId: input.openingProvenance.memoryLane.jobId,
                memoryLaneOutcome: input.openingProvenance.memoryLane.outcome,
              }),
          consumerSessionId: input.consumerSessionId,
          id: snapshotId,
          memoryCount: job.memories.length,
          memoryManifestHash: manifestHash(memoryManifest),
          policyRevision: job.policyRevision,
          projectId: input.projectId,
        },
      });
      for (const [inputOrder, item] of job.memories.entries()) {
        await tx.contextSnapshotMemory.create({
          data: {
            contextSnapshotId: snapshotId,
            inputOrder,
            memoryResolutionId: item.resolutionId,
            resolutionRevision: item.resolutionRevision,
          },
        });
        await tx.aiOutputMemoryDependency.create({
          data: {
            aiDerivedOutputId: outputId,
            aiJobInputMemoryId: item.inputMemoryId,
            dependencyOrder: inputOrder,
            id: randomUUID(),
          },
        });
      }
      for (const [inputOrder, question] of job.actualQuestions.entries()) {
        await tx.contextSnapshotActualQuestion.create({
          data: {
            actualQuestionId: question.actualQuestionId,
            contextSnapshotId: snapshotId,
            inputOrder,
          },
        });
        await tx.aiOutputQuestionDependency.create({
          data: {
            aiDerivedOutputId: outputId,
            dependencyOrder: inputOrder,
            id: randomUUID(),
            targetDigest: question.normalizedDigest,
            targetId: question.actualQuestionId,
            targetKind: 'actual_question',
            targetRevision: question.analysisRevision,
          },
        });
      }
    });
    return snapshotId;
  }

  public async readForOpening(
    actorId: string,
    consumerSessionId: string,
    snapshotId: string,
  ): Promise<FrozenOpeningContextInput> {
    const snapshot = await this.prisma.interviewContextSnapshot.findUnique({
      where: { id: snapshotId },
    });
    if (
      snapshot === null ||
      snapshot.consumerSessionId !== consumerSessionId ||
      snapshot.basisSessionId === null ||
      snapshot.basisAnalysisTriggerIdentity === null ||
      snapshot.calibrationGateIdentity === null ||
      snapshot.calibrationConfirmed === null ||
      snapshot.memoryLaneOutcome === null ||
      snapshot.memoryLaneJobId === null ||
      snapshot.actualLaneOutcome === null ||
      snapshot.actualLaneJobId === null ||
      !(await this.eligibility.isEligible(actorId, snapshot.aiDerivedOutputId))
    ) {
      throw new Error('AI_OPENING_CONTEXT_INVALID');
    }
    const [contextJob, memoryLaneJob, actualLaneJob, basisSession, consumerSession] =
      await Promise.all([
        this.prisma.aiJob.findUnique({ where: { id: snapshot.aiJobId } }),
        this.prisma.aiJob.findUnique({ where: { id: snapshot.memoryLaneJobId } }),
        this.prisma.aiJob.findUnique({ where: { id: snapshot.actualLaneJobId } }),
        this.prisma.interviewSession.findUnique({
          include: { finalization: true },
          where: { id: snapshot.basisSessionId },
        }),
        this.prisma.interviewSession.findUnique({ where: { id: consumerSessionId } }),
      ]);
    const completedAt = basisSession?.finalization?.completedAt;
    if (
      contextJob?.status !== 'succeeded' ||
      memoryLaneJob === null ||
      actualLaneJob === null ||
      basisSession === null ||
      completedAt == null ||
      consumerSession === null ||
      basisSession.projectId !== snapshot.projectId ||
      consumerSession.projectId !== snapshot.projectId ||
      consumerSession.sequenceNo !== basisSession.sequenceNo + 1 ||
      snapshot.basisAnalysisTriggerIdentity !==
        postSessionTriggerIdentity(basisSession.id, completedAt) ||
      !(await this.memoryLaneProvenanceValid(snapshot, memoryLaneJob)) ||
      actualLaneJob.projectId !== snapshot.projectId ||
      actualLaneJob.jobType !== 'actual_question_reconcile' ||
      actualLaneJob.triggerDedupeKey !==
        postSessionLaneTriggerKey(
          snapshot.basisAnalysisTriggerIdentity,
          'actual_question_reconcile',
        ) ||
      !outcomeMatchesJob(snapshot.actualLaneOutcome, actualLaneJob.status)
    ) {
      throw new Error('AI_OPENING_CONTEXT_PROVENANCE_INVALID');
    }
    const [memoryMemberships, actualMemberships, memories, actualAsked] = await Promise.all([
      this.prisma.contextSnapshotMemory.findMany({
        orderBy: { inputOrder: 'asc' },
        where: { contextSnapshotId: snapshot.id },
      }),
      this.prisma.contextSnapshotActualQuestion.findMany({
        orderBy: { inputOrder: 'asc' },
        where: { contextSnapshotId: snapshot.id },
      }),
      this.memory.list(actorId, snapshot.projectId),
      this.actualAsked.list(actorId, snapshot.projectId),
    ]);
    const memoryById = new Map(memories.map((memory) => [memory.id, memory]));
    const actualById = new Map(actualAsked.map((question) => [question.id, question]));
    const frozenMemories = memoryMemberships.map((membership) => {
      const memory = memoryById.get(membership.memoryResolutionId);
      if (memory === undefined || memory.resolutionRevision !== membership.resolutionRevision) {
        throw new Error('AI_OPENING_CONTEXT_MEMORY_DRIFT');
      }
      return memory;
    });
    const frozenActual = actualMemberships.map((membership) => {
      const question = actualById.get(membership.actualQuestionId);
      if (question === undefined) throw new Error('AI_OPENING_CONTEXT_ACTUAL_QUESTION_DRIFT');
      return question;
    });
    return {
      actualAsked: frozenActual,
      basisSessionId: snapshot.basisSessionId,
      calibrationConfirmed: snapshot.calibrationConfirmed,
      memories: frozenMemories,
      projectId: snapshot.projectId,
      scopeSessionIds: snapshot.calibrationConfirmed
        ? [snapshot.basisSessionId, consumerSessionId]
        : [snapshot.basisSessionId],
      snapshotId: snapshot.id,
    };
  }

  private async memoryLaneProvenanceValid(
    snapshot: {
      basisAnalysisTriggerIdentity: string | null;
      basisSessionId: string | null;
      memoryLaneOutcome: string | null;
      projectId: string;
    },
    job: AiJob,
  ): Promise<boolean> {
    if (
      snapshot.basisAnalysisTriggerIdentity === null ||
      snapshot.basisSessionId === null ||
      snapshot.memoryLaneOutcome === null ||
      job.projectId !== snapshot.projectId ||
      !outcomeMatchesJob(snapshot.memoryLaneOutcome, job.status)
    ) {
      return false;
    }
    if (!this.memoryMaintainerConfig.enabled) {
      return (
        job.jobType === 'memory_extract' &&
        job.triggerDedupeKey ===
          postSessionLaneTriggerKey(snapshot.basisAnalysisTriggerIdentity, 'memory_extract')
      );
    }
    const scopes = await this.prisma.aiJobSessionScope.findMany({
      select: { sessionId: true },
      where: { aiJobId: job.id },
    });
    if (
      job.jobType !== 'working_memory_maintain' ||
      !isP1TriggerIdentity(job.triggerDedupeKey, snapshot.basisSessionId) ||
      scopes.length !== 1 ||
      scopes[0]?.sessionId !== snapshot.basisSessionId
    ) {
      return false;
    }
    if (snapshot.memoryLaneOutcome === 'succeeded') {
      return (
        job.status === 'succeeded' &&
        job.failureCode === null &&
        (await this.prisma.memoryWorkingSnapshot.count({
          where: {
            aiJobId: job.id,
            projectId: snapshot.projectId,
            sourceSessionId: snapshot.basisSessionId,
          },
        })) === 1
      );
    }
    if (snapshot.memoryLaneOutcome === 'unjudged') {
      return (
        ['succeeded', 'cancelled'].includes(job.status) &&
        job.failureCode === 'MEMORY_UNJUDGED' &&
        (await this.prisma.memoryWorkingSnapshot.count({ where: { aiJobId: job.id } })) === 0
      );
    }
    return true;
  }
}

function isP1TriggerIdentity(identity: string | null, sessionId: string): boolean {
  if (identity === null) return false;
  const prefix = `memory-p1-v1.1:${sessionId}:`;
  if (!identity.startsWith(prefix)) return false;
  return /^(?:[0-9a-f]{40}(?::rebase:[0-9a-f]{24})?|final-unjudged:[0-9a-f]{32})$/.test(
    identity.slice(prefix.length),
  );
}

function outcomeMatchesJob(outcome: string, status: string): boolean {
  if (outcome === 'succeeded') return status === 'succeeded';
  if (outcome === 'unjudged') return status === 'succeeded' || status === 'cancelled';
  if (outcome === 'cancelled') return status === 'cancelled';
  return status === 'failed' || status === 'cancelled';
}
