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
    consumerSessionId: string;
    expiresAt: Date;
    projectId: string;
    requestId: string;
  }): Promise<string> {
    const [memories, questions] = await Promise.all([
      this.memory.list(input.actorId, input.projectId),
      this.actualAsked.list(input.actorId, input.projectId),
    ]);
    const job = await this.coordinator.freeze({
      actorId: input.actorId,
      expiresAt: input.expiresAt,
      jobType: 'context_snapshot',
      memoryResolutionIds: memories.map(({ id }) => id),
      projectId: input.projectId,
      requestId: input.requestId,
      sessionIds: [input.consumerSessionId],
      trustedRole: 'interviewer',
    });
    const snapshotId = randomUUID();
    await this.coordinator.writeBack(job, async (tx) => {
      const outputId = randomUUID();
      const memoryManifest = job.memories.map(
        (item) => `${item.inputMemoryId}:${item.resolutionId}:${String(item.resolutionRevision)}`,
      );
      const questionManifest = questions.map(
        (item) =>
          `actual_question:${item.id}:${String(item.analysisRevision)}:${item.normalizedDigest}`,
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
          aiDerivedOutputId: outputId,
          aiJobId: job.id,
          consumerSessionId: input.consumerSessionId,
          id: snapshotId,
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
      for (const [inputOrder, question] of questions.entries()) {
        await tx.contextSnapshotActualQuestion.create({
          data: { actualQuestionId: question.id, contextSnapshotId: snapshotId, inputOrder },
        });
        await tx.aiOutputQuestionDependency.create({
          data: {
            aiDerivedOutputId: outputId,
            dependencyOrder: inputOrder,
            id: randomUUID(),
            targetDigest: question.normalizedDigest,
            targetId: question.id,
            targetKind: 'actual_question',
            targetRevision: question.analysisRevision,
          },
        });
      }
    });
    return snapshotId;
  }
}
