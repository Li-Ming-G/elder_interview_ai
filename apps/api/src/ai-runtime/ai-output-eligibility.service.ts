import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { AiJobInputMemory, AiJobInputSegment, Prisma } from '../generated/prisma/client.js';
import { projectTrustedSpeakerRole } from '../transcription/trusted-speaker-role.js';
import { effectiveTextDigest, manifestHash, sha256 } from './ai-provenance.js';
import { AiPolicyService } from './ai-policy.service.js';

@Injectable()
export class AiOutputEligibilityService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AiPolicyService,
  ) {}

  public async isEligible(
    actorId: string,
    outputId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<boolean> {
    try {
      const output = await db.aiDerivedOutput.findUnique({ where: { id: outputId } });
      if (output === null || output.status !== 'current') return false;
      const job = await db.aiJob.findUnique({ where: { id: output.aiJobId } });
      if (
        job === null ||
        job.status !== 'succeeded' ||
        job.retentionState !== 'active' ||
        job.expiresAt <= new Date()
      )
        return false;
      const scopes = await db.aiJobSessionScope.findMany({ where: { aiJobId: job.id } });
      const policy = await this.policy.assertAllowed(
        actorId,
        job.projectId,
        scopes.map(({ sessionId }) => sessionId),
        db,
      );
      if (policy.policyRevision !== job.policyRevision) return false;
      for (const scope of scopes) {
        const session = await db.interviewSession.findUnique({
          where: { id: scope.sessionId },
        });
        if (session === null || session.speakerRoleRevision !== scope.speakerRoleRevision)
          return false;
      }

      const segmentDeps = await db.aiOutputSegmentDependency.findMany({
        orderBy: { dependencyOrder: 'asc' },
        where: { aiDerivedOutputId: output.id },
      });
      const segmentInputs = await db.aiJobInputSegment.findMany({
        where: { id: { in: segmentDeps.map(({ aiJobInputSegmentId }) => aiJobInputSegmentId) } },
      });
      const segmentById = new Map(segmentInputs.map((input) => [input.id, input]));
      const orderedSegments = segmentDeps
        .map(({ aiJobInputSegmentId }) => segmentById.get(aiJobInputSegmentId))
        .filter((value): value is AiJobInputSegment => value !== undefined);
      if (orderedSegments.length !== segmentDeps.length) return false;
      const segmentManifest = orderedSegments.map(
        (input) =>
          `${input.id}:${input.transcriptSegmentId}:${String(input.textRevision)}:${String(input.speakerRoleRevision)}:${input.effectiveTextDigest}`,
      );
      if (
        segmentManifest.length !== output.expectedSegmentCount ||
        manifestHash(segmentManifest) !== output.expectedSegmentManifestHash
      )
        return false;
      for (const input of orderedSegments) {
        const segment = await db.transcriptSegment.findUnique({
          where: { id: input.transcriptSegmentId },
        });
        if (segment === null) return false;
        const projection = projectTrustedSpeakerRole(segment);
        if (
          segment.textRevision !== input.textRevision ||
          segment.speakerRoleRevision !== input.speakerRoleRevision ||
          segment.contentKind !== input.contentKind ||
          projection.trustedEffectiveSpeakerRole !== input.trustedEffectiveRole ||
          (segment.correctedSpeakerRole === null
            ? segment.originalRoleAuthority
            : 'user_confirmed') !== input.roleAuthority ||
          effectiveTextDigest(segment.correctedText ?? segment.originalText) !==
            input.effectiveTextDigest
        )
          return false;
      }

      const memoryDeps = await db.aiOutputMemoryDependency.findMany({
        orderBy: { dependencyOrder: 'asc' },
        where: { aiDerivedOutputId: output.id },
      });
      const memoryInputs = await db.aiJobInputMemory.findMany({
        where: { id: { in: memoryDeps.map(({ aiJobInputMemoryId }) => aiJobInputMemoryId) } },
      });
      const memoryById = new Map(memoryInputs.map((input) => [input.id, input]));
      const orderedMemories = memoryDeps
        .map(({ aiJobInputMemoryId }) => memoryById.get(aiJobInputMemoryId))
        .filter((value): value is AiJobInputMemory => value !== undefined);
      if (orderedMemories.length !== memoryDeps.length) return false;
      const memoryManifest = orderedMemories.map(
        (input) => `${input.id}:${input.memoryResolutionId}:${String(input.resolutionRevision)}`,
      );
      if (
        memoryManifest.length !== output.expectedMemoryCount ||
        manifestHash(memoryManifest) !== output.expectedMemoryManifestHash
      )
        return false;
      for (const input of orderedMemories) {
        const resolution = await db.memoryResolution.findUnique({
          where: { id: input.memoryResolutionId },
        });
        const outputResolution =
          output.outputType === 'memory_resolution'
            ? await db.memoryResolution.findUnique({
                where: { id: output.businessOutputId },
              })
            : null;
        if (
          resolution === null ||
          (resolution.status !== 'current' &&
            outputResolution?.supersedesResolutionId !== resolution.id) ||
          resolution.resolutionRevision !== input.resolutionRevision
        )
          return false;
        if (
          output.outputType !== 'memory_resolution' &&
          resolution.authority === 'automatic' &&
          (resolution.aiDerivedOutputId === null ||
            !(await this.isEligible(actorId, resolution.aiDerivedOutputId, db)))
        )
          return false;
      }

      const questions = await db.aiOutputQuestionDependency.findMany({
        orderBy: { dependencyOrder: 'asc' },
        where: { aiDerivedOutputId: output.id },
      });
      const questionManifest = questions.map(
        (item) =>
          `${item.targetKind}:${item.targetId}:${String(item.targetRevision)}:${item.targetDigest}`,
      );
      if (
        questionManifest.length !== output.expectedQuestionCount ||
        manifestHash(questionManifest) !== output.expectedQuestionManifestHash
      )
        return false;
      for (const question of questions) {
        if (
          !(await this.isQuestionTargetEligible(
            actorId,
            question.targetKind,
            question.targetId,
            question.targetRevision,
            question.targetDigest,
            db,
          ))
        ) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  public async isQuestionTargetEligible(
    actorId: string,
    kind: string,
    id: string,
    revision: number,
    digest: string,
    db: Prisma.TransactionClient | PrismaService,
  ): Promise<boolean> {
    if (kind === 'display_snapshot') {
      const row = await db.questionDisplaySnapshot.findUnique({ where: { id } });
      return (
        row !== null &&
        row.normalizedQuestionDigest === digest &&
        row.publishedPresentationRevision === revision &&
        row.retentionState === 'active' &&
        row.expiresAt > new Date()
      );
    }
    if (kind === 'actual_question') {
      const row = await db.actualQuestion.findUnique({ where: { id } });
      if (row === null || row.normalizedDigest !== digest) return false;
      const analysis = await db.actualQuestionAnalysis.findUnique({
        where: { id: row.actualQuestionAnalysisId },
      });
      return (
        analysis !== null &&
        analysis.isCurrentPublished &&
        analysis.aiDerivedOutputId !== null &&
        (await this.isEligible(actorId, analysis.aiDerivedOutputId, db))
      );
    }
    if (kind === 'evidence_event') {
      const row = await db.questionEvidenceEvent.findUnique({ where: { id } });
      if (
        row === null ||
        revision !== 0 ||
        sha256(`${row.eventType}:${row.eventAt.toISOString()}:${row.requestId}`) !== digest
      )
        return false;
      if (row.retentionOwnerKind === 'ai_job' && row.retentionAiJobId !== null) {
        const root = await db.aiJob.findUnique({ where: { id: row.retentionAiJobId } });
        return root !== null && root.retentionState === 'active' && root.expiresAt > new Date();
      }
      if (
        row.retentionOwnerKind === 'display_snapshot' &&
        row.retentionDisplaySnapshotId !== null
      ) {
        const root = await db.questionDisplaySnapshot.findUnique({
          where: { id: row.retentionDisplaySnapshotId },
        });
        return root !== null && root.retentionState === 'active' && root.expiresAt > new Date();
      }
      return false;
    }
    return false;
  }
}
