import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { AiJobType, Prisma } from '../generated/prisma/client.js';
import { projectTrustedSpeakerRole } from '../transcription/trusted-speaker-role.js';
import { effectiveTextDigest, manifestHash, sha256 } from './ai-provenance.js';
import { AiPolicyService } from './ai-policy.service.js';
import type { FrozenProviderSegment } from './structured-ai.provider.js';

export interface FrozenAiJob {
  id: string;
  policyRevision: number;
  projectId: string;
  requestedBy: string;
  retentionPolicyVersion: number;
  memories: readonly { inputMemoryId: string; resolutionId: string; resolutionRevision: number }[];
  segments: readonly FrozenProviderSegment[];
  sessionIds: readonly string[];
}

export interface FreezeAiJobRequest {
  actorId: string;
  expiresAt: Date;
  jobType: AiJobType;
  memoryResolutionIds?: readonly string[];
  projectId: string;
  requestId: string;
  sessionIds: readonly string[];
  trustedRole: 'elder' | 'interviewer';
}

@Injectable()
export class AiJobCoordinatorService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AiPolicyService,
  ) {}

  public async freeze(request: FreezeAiJobRequest): Promise<FrozenAiJob> {
    const sessionIds = [...new Set(request.sessionIds)].sort();
    await this.policy.assertAllowed(request.actorId, request.projectId, sessionIds);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `request:${request.requestId}`);
      await this.lock(tx, `project:${request.projectId}`);
      for (const sessionId of sessionIds) await this.lock(tx, `session:${sessionId}`);
      const policy = await this.policy.assertAllowed(
        request.actorId,
        request.projectId,
        sessionIds,
        tx,
      );
      const sessions = await tx.interviewSession.findMany({
        include: { transcriptSegments: { orderBy: [{ startMs: 'asc' }, { id: 'asc' }] } },
        orderBy: [{ sequenceNo: 'asc' }, { id: 'asc' }],
        where: { id: { in: sessionIds }, projectId: request.projectId },
      });
      if (sessions.length !== sessionIds.length) throw new Error('AI_SESSION_SCOPE_INVALID');
      const jobId = randomUUID();
      await tx.aiJob.create({
        data: {
          contextBuilderVersion: 'dev-006.v1',
          expiresAt: request.expiresAt,
          id: jobId,
          jobType: request.jobType,
          modelName: 'local-test-structured',
          policyRevision: policy.policyRevision,
          promptVersion: 'dev-006.v1',
          projectId: request.projectId,
          requestId: request.requestId,
          requestedBy: request.actorId,
          retentionPolicyVersion: policy.retentionPolicyVersion,
          schemaVersion: 'dev-006.v1',
          startedAt: new Date(),
          status: 'running',
        },
      });
      const frozenSegments: FrozenProviderSegment[] = [];
      const frozenMemories: {
        inputMemoryId: string;
        resolutionId: string;
        resolutionRevision: number;
      }[] = [];
      let inputOrder = 0;
      for (const [scopeOrder, session] of sessions.entries()) {
        const eligible = session.transcriptSegments.filter((segment) => {
          const projection = projectTrustedSpeakerRole(segment);
          return (
            segment.contentKind === 'conversation' &&
            projection.trustedEffectiveSpeakerRole === request.trustedRole
          );
        });
        const scopeEntries = eligible.map((segment) => {
          const text = segment.correctedText ?? segment.originalText;
          return `${segment.id}:${String(segment.textRevision)}:${String(segment.speakerRoleRevision)}:${effectiveTextDigest(text)}`;
        });
        await tx.aiJobSessionScope.create({
          data: {
            aiJobId: jobId,
            eligibleSegmentCount: eligible.length,
            id: randomUUID(),
            inputOrder: scopeOrder,
            segmentManifestHash: manifestHash(scopeEntries),
            sessionId: session.id,
            speakerRoleRevision: session.speakerRoleRevision,
          },
        });
        for (const segment of eligible) {
          const text = segment.correctedText ?? segment.originalText;
          const inputSegmentId = randomUUID();
          await tx.aiJobInputSegment.create({
            data: {
              aiJobId: jobId,
              contentKind: segment.contentKind,
              effectiveTextDigest: effectiveTextDigest(text),
              id: inputSegmentId,
              inputOrder,
              roleAuthority:
                segment.correctedSpeakerRole === null
                  ? segment.originalRoleAuthority
                  : 'user_confirmed',
              sessionId: session.id,
              speakerRoleRevision: segment.speakerRoleRevision,
              textRevision: segment.textRevision,
              transcriptSegmentId: segment.id,
              trustedEffectiveRole: request.trustedRole,
            },
          });
          frozenSegments.push({
            inputSegmentId,
            segmentId: segment.id,
            sessionId: session.id,
            startMs: segment.startMs,
            text,
          });
          inputOrder += 1;
        }
      }
      const memoryIds = [...new Set(request.memoryResolutionIds ?? [])].sort();
      const resolutions = await tx.memoryResolution.findMany({
        orderBy: { id: 'asc' },
        where: { id: { in: memoryIds }, projectId: request.projectId, status: 'current' },
      });
      if (resolutions.length !== memoryIds.length) throw new Error('AI_MEMORY_SCOPE_INVALID');
      for (const [memoryOrder, resolution] of resolutions.entries()) {
        const inputMemoryId = randomUUID();
        await tx.aiJobInputMemory.create({
          data: {
            aiJobId: jobId,
            id: inputMemoryId,
            inputOrder: memoryOrder,
            memoryResolutionId: resolution.id,
            resolutionRevision: resolution.resolutionRevision,
          },
        });
        frozenMemories.push({
          inputMemoryId,
          resolutionId: resolution.id,
          resolutionRevision: resolution.resolutionRevision,
        });
      }
      return {
        id: jobId,
        memories: frozenMemories,
        policyRevision: policy.policyRevision,
        projectId: request.projectId,
        requestedBy: request.actorId,
        retentionPolicyVersion: policy.retentionPolicyVersion,
        segments: frozenSegments,
        sessionIds,
      };
    });
  }

  public async callProvider<T>(job: FrozenAiJob, invoke: () => Promise<T>): Promise<T> {
    await this.policy.assertAllowed(job.requestedBy, job.projectId, job.sessionIds);
    const callId = randomUUID();
    const startedAt = new Date();
    await this.prisma.aiProviderCall.create({
      data: {
        aiJobId: job.id,
        callKind: 'primary',
        callNo: 1,
        id: callId,
        inputHash: sha256(
          JSON.stringify(
            job.segments.map(({ inputSegmentId, segmentId, sessionId, startMs }) => ({
              inputSegmentId,
              segmentId,
              sessionId,
              startMs,
            })),
          ),
        ),
        startedAt,
        status: 'running',
      },
    });
    try {
      const output = await invoke();
      await this.prisma.aiProviderCall.update({
        data: {
          completedAt: new Date(),
          latencyMs: Date.now() - startedAt.getTime(),
          outputHash: sha256(JSON.stringify(output)),
          status: 'succeeded',
        },
        where: { id: callId },
      });
      return output;
    } catch (error) {
      await this.prisma.aiProviderCall.update({
        data: {
          completedAt: new Date(),
          errorCode: error instanceof Error ? error.message.slice(0, 80) : 'UNKNOWN',
          latencyMs: Date.now() - startedAt.getTime(),
          status: 'failed',
        },
        where: { id: callId },
      });
      await this.prisma.aiJob.update({
        data: { completedAt: new Date(), failureCode: 'PROVIDER_FAILED', status: 'failed' },
        where: { id: job.id },
      });
      throw error;
    }
  }

  public async writeBack<T>(
    job: FrozenAiJob,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    await this.policy.assertAllowed(job.requestedBy, job.projectId, job.sessionIds);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `project:${job.projectId}`);
      for (const sessionId of job.sessionIds) await this.lock(tx, `session:${sessionId}`);
      const currentPolicy = await this.policy.assertAllowed(
        job.requestedBy,
        job.projectId,
        job.sessionIds,
        tx,
      );
      if (currentPolicy.policyRevision !== job.policyRevision) throw new Error('AI_POLICY_DRIFT');
      const scopes = await tx.aiJobSessionScope.findMany({ where: { aiJobId: job.id } });
      for (const scope of scopes) {
        const session = await tx.interviewSession.findUnique({ where: { id: scope.sessionId } });
        if (session === null || session.speakerRoleRevision !== scope.speakerRoleRevision) {
          throw new Error('AI_SESSION_ROLE_WATERMARK_DRIFT');
        }
      }
      for (const frozen of job.segments) {
        const membership = await tx.aiJobInputSegment.findUniqueOrThrow({
          where: { id: frozen.inputSegmentId },
        });
        const current = await tx.transcriptSegment.findUnique({ where: { id: frozen.segmentId } });
        if (
          current === null ||
          current.textRevision !== membership.textRevision ||
          current.speakerRoleRevision !== membership.speakerRoleRevision ||
          current.contentKind !== membership.contentKind ||
          projectTrustedSpeakerRole(current).trustedEffectiveSpeakerRole !==
            membership.trustedEffectiveRole ||
          effectiveTextDigest(current.correctedText ?? current.originalText) !==
            membership.effectiveTextDigest
        )
          throw new Error('AI_INPUT_DRIFT');
      }
      for (const memory of job.memories) {
        const resolution = await tx.memoryResolution.findUnique({
          where: { id: memory.resolutionId },
        });
        if (
          resolution === null ||
          resolution.status !== 'current' ||
          resolution.resolutionRevision !== memory.resolutionRevision
        )
          throw new Error('AI_MEMORY_INPUT_DRIFT');
      }
      const result = await write(tx);
      await tx.aiJob.update({
        data: { completedAt: new Date(), status: 'succeeded' },
        where: { id: job.id },
      });
      return result;
    });
  }

  private async lock(tx: Prisma.TransactionClient, value: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${value}, 0))`;
  }
}
