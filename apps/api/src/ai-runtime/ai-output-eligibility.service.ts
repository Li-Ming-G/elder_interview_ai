import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { AiJobInputMemory, AiJobInputSegment } from '../generated/prisma/client.js';
import { projectTrustedSpeakerRole } from '../transcription/trusted-speaker-role.js';
import { effectiveTextDigest, manifestHash, sha256 } from './ai-provenance.js';
import { AiPolicyService } from './ai-policy.service.js';

@Injectable()
export class AiOutputEligibilityService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AiPolicyService,
  ) {}

  public async isEligible(actorId: string, outputId: string): Promise<boolean> {
    try {
      const output = await this.prisma.aiDerivedOutput.findUnique({ where: { id: outputId } });
      if (output === null || output.status !== 'current') return false;
      const job = await this.prisma.aiJob.findUnique({ where: { id: output.aiJobId } });
      if (
        job === null ||
        job.status !== 'succeeded' ||
        job.retentionState !== 'active' ||
        job.expiresAt <= new Date()
      )
        return false;
      const scopes = await this.prisma.aiJobSessionScope.findMany({ where: { aiJobId: job.id } });
      const policy = await this.policy.assertAllowed(
        actorId,
        job.projectId,
        scopes.map(({ sessionId }) => sessionId),
      );
      if (policy.policyRevision !== job.policyRevision) return false;
      for (const scope of scopes) {
        const session = await this.prisma.interviewSession.findUnique({
          where: { id: scope.sessionId },
        });
        if (session === null || session.speakerRoleRevision !== scope.speakerRoleRevision)
          return false;
      }

      const segmentDeps = await this.prisma.aiOutputSegmentDependency.findMany({
        orderBy: { dependencyOrder: 'asc' },
        where: { aiDerivedOutputId: output.id },
      });
      const segmentInputs = await this.prisma.aiJobInputSegment.findMany({
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
        const segment = await this.prisma.transcriptSegment.findUnique({
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

      const memoryDeps = await this.prisma.aiOutputMemoryDependency.findMany({
        orderBy: { dependencyOrder: 'asc' },
        where: { aiDerivedOutputId: output.id },
      });
      const memoryInputs = await this.prisma.aiJobInputMemory.findMany({
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
        const resolution = await this.prisma.memoryResolution.findUnique({
          where: { id: input.memoryResolutionId },
        });
        const outputResolution =
          output.outputType === 'memory_resolution'
            ? await this.prisma.memoryResolution.findUnique({
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
            !(await this.isEligible(actorId, resolution.aiDerivedOutputId)))
        )
          return false;
      }

      const questions = await this.prisma.aiOutputQuestionDependency.findMany({
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
          !(await this.questionTargetExists(
            actorId,
            question.targetKind,
            question.targetId,
            question.targetRevision,
            question.targetDigest,
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

  private async questionTargetExists(
    actorId: string,
    kind: string,
    id: string,
    revision: number,
    digest: string,
  ): Promise<boolean> {
    if (kind === 'display_snapshot') {
      const row = await this.prisma.questionDisplaySnapshot.findUnique({ where: { id } });
      return (
        row !== null &&
        row.normalizedQuestionDigest === digest &&
        row.publishedPresentationRevision === revision &&
        row.retentionState === 'active'
      );
    }
    if (kind === 'actual_question') {
      const row = await this.prisma.actualQuestion.findUnique({ where: { id } });
      if (row === null || row.normalizedDigest !== digest) return false;
      const analysis = await this.prisma.actualQuestionAnalysis.findUnique({
        where: { id: row.actualQuestionAnalysisId },
      });
      return (
        analysis !== null &&
        analysis.isCurrentPublished &&
        analysis.aiDerivedOutputId !== null &&
        (await this.isEligible(actorId, analysis.aiDerivedOutputId))
      );
    }
    if (kind === 'evidence_event') {
      const row = await this.prisma.questionEvidenceEvent.findUnique({ where: { id } });
      return (
        row !== null &&
        revision === 0 &&
        sha256(`${row.eventType}:${row.eventAt.toISOString()}:${row.requestId}`) === digest
      );
    }
    return false;
  }
}
