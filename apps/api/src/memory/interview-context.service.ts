import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AiJobCoordinatorService } from '../ai-runtime/ai-job-coordinator.service.js';
import { EMPTY_MANIFEST_HASH, manifestHash } from '../ai-runtime/ai-provenance.js';
import { PrismaService } from '../database/prisma.service.js';
import { ActualAskedReader } from '../question-evidence/question-evidence.service.js';
import { CurrentMemoryReader } from './memory.service.js';

@Injectable()
export class InterviewContextService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly coordinator: AiJobCoordinatorService,
    private readonly memory: CurrentMemoryReader,
    private readonly actualAsked: ActualAskedReader,
  ) {}

  public async create(input: {
    actorId: string;
    contextBuilderVersion?: string;
    consumerSessionId: string;
    expiresAt: Date;
    projectId: string;
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
}
