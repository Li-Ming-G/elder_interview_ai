import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type {
  AiJobInputSegment,
  AiJobStatus,
  AiJobType,
  Prisma,
} from '../generated/prisma/client.js';
import { projectTrustedSpeakerRole } from '../transcription/trusted-speaker-role.js';
import { AiOutputEligibilityService } from './ai-output-eligibility.service.js';
import { canonicalJson, effectiveTextDigest, manifestHash, sha256 } from './ai-provenance.js';
import { AiPolicyService } from './ai-policy.service.js';
import type { FrozenProviderSegment } from './structured-ai.provider.js';

export interface FrozenActualQuestion {
  actualQuestionId: string;
  analysisId: string;
  analysisRevision: number;
  normalizedDigest: string;
}

async function withDeadline<T>(
  invoke: (signal: AbortSignal) => Promise<T>,
  deadlineMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = Promise.resolve().then(() => invoke(controller.signal));
  void work.catch(() => undefined);
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort(new Error('AI_PROVIDER_TIMEOUT'));
          reject(new Error('AI_PROVIDER_TIMEOUT'));
        }, deadlineMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface FrozenAiJob {
  actualQuestions: readonly FrozenActualQuestion[];
  id: string;
  inputHash: string;
  memories: readonly { inputMemoryId: string; resolutionId: string; resolutionRevision: number }[];
  policyRevision: number;
  projectId: string;
  replayed: boolean;
  requestedBy: string;
  retentionPolicyVersion: number;
  segments: readonly FrozenProviderSegment[];
  sessionIds: readonly string[];
  status: AiJobStatus;
}

export interface FreezeAiJobRequest {
  actorId: string;
  actualQuestionIds?: readonly string[];
  contextBuilderVersion?: string;
  expiresAt: Date;
  jobType: AiJobType;
  memoryResolutionIds?: readonly string[];
  projectId: string;
  requestId: string;
  retryOfJobId?: string;
  sessionIds: readonly string[];
  sourceContextSnapshotId?: string;
  triggerDedupeKey?: string;
  trustedRole: 'elder' | 'interviewer';
  trustedRoles?: readonly ('elder' | 'interviewer')[];
}

interface CancellationResult {
  cancelled: true;
  code: string;
}

interface SourceContextInput {
  actualQuestionIds: string[];
  actualQuestions: Map<string, { analysisRevision: number; normalizedDigest: string }>;
  memoryResolutionIds: string[];
  memoryRevisions: Map<string, number>;
  segments: Map<string, AiJobInputSegment>;
  sessionIds: string[];
}

@Injectable()
export class AiJobCoordinatorService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AiPolicyService,
    private readonly eligibility: AiOutputEligibilityService,
  ) {}

  public async freeze(request: FreezeAiJobRequest): Promise<FrozenAiJob> {
    const sessionIds = [...new Set(request.sessionIds)].sort();
    const memoryIds = [...new Set(request.memoryResolutionIds ?? [])].sort();
    const actualQuestionIds = [...new Set(request.actualQuestionIds ?? [])];
    const trustedRoles = [...new Set(request.trustedRoles ?? [request.trustedRole])].sort();
    const requestIdentityHash = this.requestIdentityHash(
      request,
      sessionIds,
      memoryIds,
      actualQuestionIds,
    );
    await this.policy.assertAllowed(request.actorId, request.projectId, sessionIds);
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `request:${request.requestId}`);
      if (request.triggerDedupeKey !== undefined) {
        await this.lock(tx, `trigger:${request.triggerDedupeKey}`);
      }
      await this.lock(tx, `project:${request.projectId}`);
      for (const sessionId of sessionIds) await this.lock(tx, `session:${sessionId}`);

      const byRequest = await tx.aiJob.findUnique({ where: { requestId: request.requestId } });
      if (byRequest !== null) {
        await this.assertReplayBinding(
          tx,
          byRequest.id,
          request,
          sessionIds,
          memoryIds,
          requestIdentityHash,
        );
        return this.hydrateReplay(tx, byRequest.id);
      }
      if (request.triggerDedupeKey !== undefined) {
        const byTrigger = await tx.aiJob.findFirst({
          where: { triggerDedupeKey: request.triggerDedupeKey },
        });
        if (byTrigger !== null) {
          await this.assertReplayBinding(
            tx,
            byTrigger.id,
            request,
            sessionIds,
            memoryIds,
            requestIdentityHash,
            true,
          );
          return this.hydrateReplay(tx, byTrigger.id);
        }
      }

      const policy = await this.policy.assertAllowed(
        request.actorId,
        request.projectId,
        sessionIds,
        tx,
      );
      const sessions = await tx.interviewSession.findMany({
        include: { transcriptSegments: { orderBy: [{ startMs: 'asc' }, { id: 'asc' }] } },
        orderBy: { id: 'asc' },
        where: { id: { in: sessionIds }, projectId: request.projectId },
      });
      if (sessions.length !== sessionIds.length) throw new Error('AI_SESSION_SCOPE_INVALID');
      const sourceContext = await this.sourceContextInput(
        tx,
        request.actorId,
        request.projectId,
        request.sourceContextSnapshotId,
      );
      if (
        sourceContext !== null &&
        (!sameValues(sourceContext.sessionIds, sessionIds) ||
          !sameValues(sourceContext.memoryResolutionIds, memoryIds) ||
          !sameValues(sourceContext.actualQuestionIds, actualQuestionIds))
      ) {
        throw new Error('AI_CONTEXT_SNAPSHOT_MEMBERSHIP_MISMATCH');
      }
      const sessionsById = new Map(sessions.map((session) => [session.id, session]));
      const orderedSessions = sessionIds.map((id) => {
        const session = sessionsById.get(id);
        if (session === undefined) throw new Error('AI_SESSION_SCOPE_INVALID');
        return session;
      });
      if (request.retryOfJobId !== undefined) {
        const retried = await tx.aiJob.findUnique({ where: { id: request.retryOfJobId } });
        if (
          retried === null ||
          retried.projectId !== request.projectId ||
          retried.jobType !== request.jobType ||
          !['failed', 'cancelled'].includes(retried.status)
        ) {
          throw new Error('AI_RETRY_IDENTITY_INVALID');
        }
      }

      const jobId = randomUUID();
      await tx.aiJob.create({
        data: {
          contextBuilderVersion: request.contextBuilderVersion ?? 'dev-006.v1',
          expiresAt: request.expiresAt,
          id: jobId,
          inputHash: '0'.repeat(64),
          jobType: request.jobType,
          modelName: 'local-test-structured',
          policyRevision: policy.policyRevision,
          promptVersion: 'dev-006.v1',
          projectId: request.projectId,
          requestIdentityHash,
          requestId: request.requestId,
          requestedBy: request.actorId,
          retentionPolicyVersion: policy.retentionPolicyVersion,
          retryOfJobId: request.retryOfJobId ?? null,
          schemaVersion: 'dev-006.v1',
          status: 'pending',
          triggerDedupeKey: request.triggerDedupeKey ?? null,
        },
      });

      const frozenSegments: FrozenProviderSegment[] = [];
      const scopeIdentity: unknown[] = [];
      let inputOrder = 0;
      for (const [scopeOrder, session] of orderedSessions.entries()) {
        const finalWatermark = session.transcriptSegments.at(-1);
        const eligible = session.transcriptSegments.filter((segment) => {
          const projection = projectTrustedSpeakerRole(segment);
          return (
            segment.contentKind === 'conversation' &&
            (sourceContext === null || sourceContext.segments.has(segment.id)) &&
            trustedRoles.includes(projection.trustedEffectiveSpeakerRole as 'elder' | 'interviewer')
          );
        });
        const scopeEntries = eligible.map((segment) => {
          const text = segment.correctedText ?? segment.originalText;
          return `${segment.id}:${String(segment.textRevision)}:${String(segment.speakerRoleRevision)}:${effectiveTextDigest(text)}`;
        });
        const scopeReason = `${request.jobType}:${trustedRoles.join('+')}`;
        await tx.aiJobSessionScope.create({
          data: {
            aiJobId: jobId,
            eligibleSegmentCount: eligible.length,
            id: randomUUID(),
            inputOrder: scopeOrder,
            maxSegmentId: finalWatermark?.id ?? null,
            maxSegmentStartMs: finalWatermark?.startMs ?? null,
            scopeReason,
            segmentManifestHash: manifestHash(scopeEntries),
            sessionId: session.id,
            speakerRoleRevision: session.speakerRoleRevision,
          },
        });
        scopeIdentity.push({
          eligibleSegmentCount: eligible.length,
          maxSegmentId: finalWatermark?.id ?? null,
          maxSegmentStartMs: finalWatermark?.startMs ?? null,
          scopeReason,
          segmentManifestHash: manifestHash(scopeEntries),
          sessionId: session.id,
          speakerRoleRevision: session.speakerRoleRevision,
        });
        for (const segment of eligible) {
          const text = segment.correctedText ?? segment.originalText;
          const inputSegmentId = randomUUID();
          const roleAuthority =
            segment.correctedSpeakerRole === null
              ? segment.originalRoleAuthority
              : 'user_confirmed';
          const digest = effectiveTextDigest(text);
          const sourceSegment = sourceContext?.segments.get(segment.id);
          if (
            sourceSegment !== undefined &&
            (sourceSegment.contentKind !== segment.contentKind ||
              sourceSegment.effectiveTextDigest !== digest ||
              sourceSegment.roleAuthority !== roleAuthority ||
              sourceSegment.speakerRoleRevision !== segment.speakerRoleRevision ||
              sourceSegment.textRevision !== segment.textRevision ||
              sourceSegment.trustedEffectiveRole !==
                projectTrustedSpeakerRole(segment).trustedEffectiveSpeakerRole)
          ) {
            throw new Error('AI_CONTEXT_SNAPSHOT_SEGMENT_DRIFT');
          }
          await tx.aiJobInputSegment.create({
            data: {
              aiJobId: jobId,
              contentKind: segment.contentKind,
              effectiveTextDigest: digest,
              id: inputSegmentId,
              inputOrder,
              roleAuthority,
              sessionId: session.id,
              speakerRoleRevision: segment.speakerRoleRevision,
              textRevision: segment.textRevision,
              transcriptSegmentId: segment.id,
              trustedEffectiveRole: projectTrustedSpeakerRole(segment).trustedEffectiveSpeakerRole,
            },
          });
          frozenSegments.push({
            inputSegmentId,
            segmentId: segment.id,
            sessionId: session.id,
            startMs: segment.startMs,
            text,
            trustedRole: projectTrustedSpeakerRole(segment).trustedEffectiveSpeakerRole as
              'elder' | 'interviewer',
          });
          inputOrder += 1;
        }
      }
      if (sourceContext !== null && frozenSegments.length !== sourceContext.segments.size) {
        throw new Error('AI_CONTEXT_SNAPSHOT_SEGMENT_DRIFT');
      }

      const resolutions = await tx.memoryResolution.findMany({
        orderBy: { id: 'asc' },
        where: { id: { in: memoryIds }, projectId: request.projectId, status: 'current' },
      });
      if (resolutions.length !== memoryIds.length) throw new Error('AI_MEMORY_SCOPE_INVALID');
      const frozenMemories: FrozenAiJob['memories'][number][] = [];
      for (const [memoryOrder, resolution] of resolutions.entries()) {
        if (
          policy.blockedCanonicalKeys.includes(resolution.canonicalKey) ||
          !(await this.memoryResolutionIsEligible(tx, request.actorId, resolution))
        ) {
          throw new Error('AI_MEMORY_SCOPE_INELIGIBLE');
        }
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
        const sourceRevision = sourceContext?.memoryRevisions.get(resolution.id);
        if (sourceRevision !== undefined && sourceRevision !== resolution.resolutionRevision) {
          throw new Error('AI_CONTEXT_SNAPSHOT_MEMORY_DRIFT');
        }
      }

      const frozenActualQuestions = await this.freezeActualQuestions(
        tx,
        request.actorId,
        request.projectId,
        actualQuestionIds,
      );
      if (
        sourceContext !== null &&
        frozenActualQuestions.some((question) => {
          const source = sourceContext.actualQuestions.get(question.actualQuestionId);
          return (
            source === undefined ||
            source.analysisRevision !== question.analysisRevision ||
            source.normalizedDigest !== question.normalizedDigest
          );
        })
      ) {
        throw new Error('AI_CONTEXT_SNAPSHOT_ACTUAL_QUESTION_DRIFT');
      }
      const inputHash = sha256(
        canonicalJson({
          actualQuestions: frozenActualQuestions,
          actorId: request.actorId,
          jobType: request.jobType,
          memories: frozenMemories.map(({ resolutionId, resolutionRevision }) => ({
            resolutionId,
            resolutionRevision,
          })),
          policyRevision: policy.policyRevision,
          projectId: request.projectId,
          retryOfJobId: request.retryOfJobId ?? null,
          sourceContextSnapshotId: request.sourceContextSnapshotId ?? null,
          scopes: scopeIdentity,
          segments: frozenSegments.map(({ inputSegmentId, segmentId, sessionId, startMs }) => ({
            inputSegmentId,
            segmentId,
            sessionId,
            startMs,
          })),
          triggerDedupeKey: request.triggerDedupeKey ?? null,
          trustedRoles,
        }),
      );
      await tx.aiJob.update({
        data: { inputHash, startedAt: new Date(), status: 'running' },
        where: { id: jobId },
      });
      return {
        actualQuestions: frozenActualQuestions,
        id: jobId,
        inputHash,
        memories: frozenMemories,
        policyRevision: policy.policyRevision,
        projectId: request.projectId,
        replayed: false,
        requestedBy: request.actorId,
        retentionPolicyVersion: policy.retentionPolicyVersion,
        segments: frozenSegments,
        sessionIds,
        status: 'running',
      };
    });
  }

  public async callProvider<T>(job: FrozenAiJob, invoke: () => Promise<T>): Promise<T> {
    if (job.replayed) throw new Error(`AI_REQUEST_REPLAY_${job.status.toUpperCase()}`);
    try {
      await this.policy.assertAllowed(job.requestedBy, job.projectId, job.sessionIds);
    } catch (error) {
      await this.cancelJob(job.id, 'AI_POLICY_DRIFT');
      throw error;
    }
    const callId = randomUUID();
    const startedAt = new Date();
    await this.prisma.aiProviderCall.create({
      data: {
        aiJobId: job.id,
        callKind: 'primary',
        callNo: 1,
        id: callId,
        inputHash: job.inputHash,
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
          outputHash: sha256(canonicalJson(output)),
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
      await this.prisma.aiJob.updateMany({
        data: { completedAt: new Date(), failureCode: 'PROVIDER_FAILED', status: 'failed' },
        where: { id: job.id, status: 'running' },
      });
      throw error;
    }
  }

  public async callProviderWithSameInputRetry<T>(
    job: FrozenAiJob,
    invoke: (signal: AbortSignal) => Promise<unknown>,
    validate: (value: unknown) => T,
    deadlineAt: number,
  ): Promise<T> {
    if (job.replayed) throw new Error(`AI_REQUEST_REPLAY_${job.status.toUpperCase()}`);
    let lastError: unknown = new Error('AI_PROVIDER_UNAVAILABLE');
    for (const callNo of [1, 2] as const) {
      if (deadlineAt - Date.now() <= 0) {
        lastError = new Error('AI_PROVIDER_TIMEOUT');
        break;
      }
      try {
        await this.policy.assertAllowed(job.requestedBy, job.projectId, job.sessionIds);
      } catch (error) {
        await this.cancelJob(job.id, 'AI_POLICY_DRIFT');
        throw error;
      }
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        lastError = new Error('AI_PROVIDER_TIMEOUT');
        break;
      }
      const callId = randomUUID();
      const startedAt = new Date();
      await this.prisma.aiProviderCall.create({
        data: {
          aiJobId: job.id,
          callKind: callNo === 1 ? 'primary' : 'same_input_retry',
          callNo,
          id: callId,
          inputHash: job.inputHash,
          startedAt,
          status: 'running',
        },
      });
      try {
        const output = await withDeadline(invoke, remainingMs);
        if (Date.now() >= deadlineAt) throw new Error('AI_PROVIDER_TIMEOUT');
        const parsed = validate(output);
        if (Date.now() >= deadlineAt) throw new Error('AI_PROVIDER_TIMEOUT');
        await this.prisma.aiProviderCall.update({
          data: {
            completedAt: new Date(),
            latencyMs: Date.now() - startedAt.getTime(),
            outputHash: sha256(canonicalJson(output)),
            status: 'succeeded',
          },
          where: { id: callId },
        });
        return parsed;
      } catch (error) {
        lastError = error;
        await this.prisma.aiProviderCall.update({
          data: {
            completedAt: new Date(),
            errorCode: error instanceof Error ? error.message.slice(0, 80) : 'UNKNOWN',
            latencyMs: Date.now() - startedAt.getTime(),
            status: 'failed',
          },
          where: { id: callId },
        });
      }
    }
    await this.prisma.aiJob.updateMany({
      data: { completedAt: new Date(), failureCode: 'PROVIDER_FAILED', status: 'failed' },
      where: { id: job.id, status: 'running' },
    });
    throw lastError;
  }

  public async discardUncalledJob(jobId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const calls = await tx.aiProviderCall.count({ where: { aiJobId: jobId } });
      if (calls !== 0) return;
      await tx.aiJob.deleteMany({ where: { id: jobId, status: { in: ['pending', 'running'] } } });
    });
  }

  public async failOrphanedSystemJob(jobId: string): Promise<void> {
    await this.prisma.aiJob.updateMany({
      data: {
        completedAt: new Date(),
        failureCode: 'SYSTEM_COORDINATOR_RESTARTED',
        status: 'failed',
      },
      where: { id: jobId, status: { in: ['pending', 'running'] } },
    });
  }

  public async recordRejectedSystemJob(
    request: FreezeAiJobRequest,
    failureCode: string,
  ): Promise<FrozenAiJob | null> {
    const sessionIds = [...new Set(request.sessionIds)].sort();
    const memoryIds = [...new Set(request.memoryResolutionIds ?? [])].sort();
    const actualQuestionIds = [...new Set(request.actualQuestionIds ?? [])];
    const triggerDedupeKey = request.triggerDedupeKey;
    if (triggerDedupeKey === undefined) throw new Error('AI_SYSTEM_TRIGGER_REQUIRED');
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, `request:${request.requestId}`);
      await this.lock(tx, `trigger:${triggerDedupeKey}`);
      const existing = await tx.aiJob.findFirst({
        where: { OR: [{ requestId: request.requestId }, { triggerDedupeKey }] },
      });
      if (existing !== null) return this.hydrateReplay(tx, existing.id);
      const project = await tx.elderProject.findUnique({ where: { id: request.projectId } });
      const sessions = await tx.interviewSession.findMany({
        where: { id: { in: sessionIds }, projectId: request.projectId },
      });
      if (project === null || sessions.length !== sessionIds.length) return null;
      const now = new Date();
      const created = await tx.aiJob.create({
        data: {
          completedAt: now,
          contextBuilderVersion: 'system-rejection-v1',
          expiresAt: request.expiresAt,
          failureCode: failureCode.slice(0, 80),
          inputHash: sha256(
            canonicalJson({ failureCode, projectId: request.projectId, sessionIds }),
          ),
          jobType: request.jobType,
          modelName: 'provider-neutral-unavailable',
          policyRevision: project.aiPolicyRevision,
          promptVersion: 'system-rejection-v1',
          projectId: request.projectId,
          requestIdentityHash: this.requestIdentityHash(
            request,
            sessionIds,
            memoryIds,
            actualQuestionIds,
          ),
          requestId: request.requestId,
          requestedBy: request.actorId,
          retentionPolicyVersion: project.aiRetentionPolicyVersion,
          retryOfJobId: request.retryOfJobId ?? null,
          schemaVersion: 'system-rejection-v1',
          startedAt: now,
          status: 'cancelled',
          triggerDedupeKey,
        },
      });
      return this.hydrateReplay(tx, created.id);
    });
  }

  public async writeBack<T>(
    job: FrozenAiJob,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (job.replayed) throw new Error(`AI_REQUEST_REPLAY_${job.status.toUpperCase()}`);
    try {
      const outcome = await this.prisma.$transaction<T | CancellationResult>(async (tx) => {
        await this.lock(tx, `project:${job.projectId}`);
        for (const sessionId of job.sessionIds) await this.lock(tx, `session:${sessionId}`);
        const driftCode = await this.findDrift(tx, job);
        if (driftCode !== null) {
          await tx.aiJob.updateMany({
            data: { completedAt: new Date(), failureCode: driftCode, status: 'cancelled' },
            where: { id: job.id, status: 'running' },
          });
          return { cancelled: true, code: driftCode };
        }
        const result = await write(tx);
        const committed = await tx.aiJob.updateMany({
          data: { completedAt: new Date(), status: 'succeeded' },
          where: { id: job.id, status: 'running' },
        });
        if (committed.count !== 1) throw new Error('AI_JOB_NOT_RUNNING');
        return result;
      });
      if (this.isCancellation(outcome)) throw new Error(outcome.code);
      return outcome;
    } catch (error) {
      const jobState = await this.prisma.aiJob.findUnique({ where: { id: job.id } });
      if (jobState?.status === 'running') {
        await this.prisma.aiJob.update({
          data: {
            completedAt: new Date(),
            failureCode: error instanceof Error ? error.message.slice(0, 80) : 'WRITEBACK_FAILED',
            status: 'failed',
          },
          where: { id: job.id },
        });
      }
      throw error;
    }
  }

  private async findDrift(tx: Prisma.TransactionClient, job: FrozenAiJob): Promise<string | null> {
    const persistedJob = await tx.aiJob.findUnique({ where: { id: job.id } });
    if (persistedJob?.status !== 'running' || persistedJob.inputHash !== job.inputHash) {
      return 'AI_JOB_NOT_RUNNING';
    }
    let currentPolicy;
    try {
      currentPolicy = await this.policy.assertAllowed(
        job.requestedBy,
        job.projectId,
        job.sessionIds,
        tx,
      );
    } catch {
      return 'AI_POLICY_DRIFT';
    }
    if (currentPolicy.policyRevision !== job.policyRevision) return 'AI_POLICY_DRIFT';
    const scopes = await tx.aiJobSessionScope.findMany({ where: { aiJobId: job.id } });
    if (scopes.length !== job.sessionIds.length) return 'AI_SESSION_SCOPE_DRIFT';
    for (const scope of scopes) {
      const session = await tx.interviewSession.findUnique({
        include: {
          transcriptSegments: { orderBy: [{ startMs: 'desc' }, { id: 'desc' }], take: 1 },
        },
        where: { id: scope.sessionId },
      });
      const latestFinal = session?.transcriptSegments[0];
      if (
        session === null ||
        session.speakerRoleRevision !== scope.speakerRoleRevision ||
        (latestFinal?.startMs ?? null) !== scope.maxSegmentStartMs ||
        (latestFinal?.id ?? null) !== scope.maxSegmentId
      ) {
        return 'AI_SESSION_WATERMARK_DRIFT';
      }
    }
    for (const frozen of job.segments) {
      const membership = await tx.aiJobInputSegment.findUnique({
        where: { id: frozen.inputSegmentId },
      });
      const current = await tx.transcriptSegment.findUnique({ where: { id: frozen.segmentId } });
      if (
        membership === null ||
        current === null ||
        current.textRevision !== membership.textRevision ||
        current.speakerRoleRevision !== membership.speakerRoleRevision ||
        current.contentKind !== membership.contentKind ||
        projectTrustedSpeakerRole(current).trustedEffectiveSpeakerRole !==
          membership.trustedEffectiveRole ||
        effectiveTextDigest(current.correctedText ?? current.originalText) !==
          membership.effectiveTextDigest
      ) {
        return 'AI_INPUT_DRIFT';
      }
    }
    for (const memory of job.memories) {
      const resolution = await tx.memoryResolution.findUnique({
        where: { id: memory.resolutionId },
      });
      if (
        resolution === null ||
        resolution.status !== 'current' ||
        resolution.resolutionRevision !== memory.resolutionRevision ||
        currentPolicy.blockedCanonicalKeys.includes(resolution.canonicalKey) ||
        !(await this.memoryResolutionIsEligible(tx, job.requestedBy, resolution))
      ) {
        return 'AI_MEMORY_INPUT_DRIFT';
      }
    }
    for (const question of job.actualQuestions) {
      if (!(await this.actualQuestionIsCurrentEligible(tx, job.requestedBy, question))) {
        return 'AI_ACTUAL_QUESTION_INPUT_DRIFT';
      }
    }
    return null;
  }

  private async freezeActualQuestions(
    tx: Prisma.TransactionClient,
    actorId: string,
    projectId: string,
    ids: readonly string[],
  ): Promise<FrozenActualQuestion[]> {
    const rows = await tx.actualQuestion.findMany({ where: { id: { in: [...ids] } } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const result: FrozenActualQuestion[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      if (row === undefined) throw new Error('AI_ACTUAL_QUESTION_SCOPE_INVALID');
      const analysis = await tx.actualQuestionAnalysis.findUnique({
        where: { id: row.actualQuestionAnalysisId },
      });
      if (
        analysis === null ||
        analysis.projectId !== projectId ||
        !analysis.isCurrentPublished ||
        analysis.judgeability !== 'judgeable' ||
        analysis.status !== 'succeeded' ||
        analysis.aiDerivedOutputId === null ||
        !(await this.eligibility.isEligible(actorId, analysis.aiDerivedOutputId, tx))
      ) {
        throw new Error('AI_ACTUAL_QUESTION_SCOPE_INELIGIBLE');
      }
      result.push({
        actualQuestionId: row.id,
        analysisId: analysis.id,
        analysisRevision: analysis.analysisRevision,
        normalizedDigest: row.normalizedDigest,
      });
    }
    return result;
  }

  private async memoryResolutionIsEligible(
    tx: Prisma.TransactionClient,
    actorId: string,
    resolution: {
      aiDerivedOutputId: string | null;
      authority: string;
      memoryRetentionRootId: string | null;
    },
  ): Promise<boolean> {
    if (resolution.authority === 'automatic') {
      return (
        resolution.aiDerivedOutputId !== null &&
        (await this.eligibility.isEligible(actorId, resolution.aiDerivedOutputId, tx))
      );
    }
    if (resolution.memoryRetentionRootId === null) return false;
    const root = await tx.memoryRetentionRoot.findUnique({
      where: { id: resolution.memoryRetentionRootId },
    });
    return root !== null && root.retentionState === 'active' && root.expiresAt > new Date();
  }

  private async actualQuestionIsCurrentEligible(
    tx: Prisma.TransactionClient,
    actorId: string,
    frozen: FrozenActualQuestion,
  ): Promise<boolean> {
    const row = await tx.actualQuestion.findUnique({ where: { id: frozen.actualQuestionId } });
    if (row === null || row.normalizedDigest !== frozen.normalizedDigest) return false;
    const analysis = await tx.actualQuestionAnalysis.findUnique({
      where: { id: row.actualQuestionAnalysisId },
    });
    return (
      analysis !== null &&
      analysis.id === frozen.analysisId &&
      analysis.analysisRevision === frozen.analysisRevision &&
      analysis.isCurrentPublished &&
      analysis.judgeability === 'judgeable' &&
      analysis.status === 'succeeded' &&
      analysis.aiDerivedOutputId !== null &&
      (await this.eligibility.isEligible(actorId, analysis.aiDerivedOutputId, tx))
    );
  }

  private async assertReplayBinding(
    tx: Prisma.TransactionClient,
    jobId: string,
    request: FreezeAiJobRequest,
    sessionIds: readonly string[],
    memoryIds: readonly string[],
    requestIdentityHash: string,
    triggeredReplay = false,
  ): Promise<void> {
    const [job, scopes, memories] = await Promise.all([
      tx.aiJob.findUniqueOrThrow({ where: { id: jobId } }),
      tx.aiJobSessionScope.findMany({ orderBy: { sessionId: 'asc' }, where: { aiJobId: jobId } }),
      tx.aiJobInputMemory.findMany({
        orderBy: { memoryResolutionId: 'asc' },
        where: { aiJobId: jobId },
      }),
    ]);
    const same =
      job.requestIdentityHash === requestIdentityHash &&
      job.projectId === request.projectId &&
      job.requestedBy === request.actorId &&
      job.jobType === request.jobType &&
      job.retryOfJobId === (request.retryOfJobId ?? null) &&
      job.triggerDedupeKey === (request.triggerDedupeKey ?? null) &&
      job.contextBuilderVersion === (request.contextBuilderVersion ?? 'dev-006.v1') &&
      scopes.map(({ sessionId }) => sessionId).join('|') === sessionIds.join('|') &&
      scopes.every(
        ({ scopeReason }) =>
          scopeReason ===
          `${request.jobType}:${[...new Set(request.trustedRoles ?? [request.trustedRole])].sort().join('+')}`,
      ) &&
      memories.map(({ memoryResolutionId }) => memoryResolutionId).join('|') ===
        memoryIds.join('|');
    if (!same || (!triggeredReplay && job.requestId !== request.requestId)) {
      throw new Error('AI_REQUEST_IDENTITY_CONFLICT');
    }
  }

  private requestIdentityHash(
    request: FreezeAiJobRequest,
    sessionIds: readonly string[],
    memoryIds: readonly string[],
    actualQuestionIds: readonly string[],
  ): string {
    return sha256(
      canonicalJson({
        actorId: request.actorId,
        actualQuestionIds,
        contextBuilderVersion: request.contextBuilderVersion ?? 'dev-006.v1',
        jobType: request.jobType,
        memoryResolutionIds: memoryIds,
        projectId: request.projectId,
        retryOfJobId: request.retryOfJobId ?? null,
        sessionIds,
        sourceContextSnapshotId: request.sourceContextSnapshotId ?? null,
        triggerDedupeKey: request.triggerDedupeKey ?? null,
        trustedRole: request.trustedRole,
        trustedRoles: [...new Set(request.trustedRoles ?? [request.trustedRole])].sort(),
      }),
    );
  }

  private async hydrateReplay(tx: Prisma.TransactionClient, jobId: string): Promise<FrozenAiJob> {
    const job = await tx.aiJob.findUniqueOrThrow({ where: { id: jobId } });
    const scopes = await tx.aiJobSessionScope.findMany({
      orderBy: { sessionId: 'asc' },
      where: { aiJobId: jobId },
    });
    return {
      actualQuestions: [],
      id: job.id,
      inputHash: job.inputHash,
      memories: [],
      policyRevision: job.policyRevision,
      projectId: job.projectId,
      replayed: true,
      requestedBy: job.requestedBy,
      retentionPolicyVersion: job.retentionPolicyVersion,
      segments: [],
      sessionIds: scopes.map(({ sessionId }) => sessionId),
      status: job.status,
    };
  }

  private async sourceContextInput(
    tx: Prisma.TransactionClient,
    actorId: string,
    projectId: string,
    snapshotId: string | undefined,
  ): Promise<SourceContextInput | null> {
    if (snapshotId === undefined) return null;
    const snapshot = await tx.interviewContextSnapshot.findUnique({ where: { id: snapshotId } });
    if (
      snapshot === null ||
      snapshot.projectId !== projectId ||
      !(await this.eligibility.isEligible(actorId, snapshot.aiDerivedOutputId, tx))
    ) {
      throw new Error('AI_CONTEXT_SNAPSHOT_INELIGIBLE');
    }
    const [scopes, segments, memories, questions] = await Promise.all([
      tx.aiJobSessionScope.findMany({
        orderBy: { inputOrder: 'asc' },
        where: { aiJobId: snapshot.aiJobId },
      }),
      tx.aiJobInputSegment.findMany({ where: { aiJobId: snapshot.aiJobId } }),
      tx.contextSnapshotMemory.findMany({ where: { contextSnapshotId: snapshot.id } }),
      tx.aiOutputQuestionDependency.findMany({
        where: { aiDerivedOutputId: snapshot.aiDerivedOutputId, targetKind: 'actual_question' },
      }),
    ]);
    return {
      actualQuestionIds: questions.map(({ targetId }) => targetId),
      actualQuestions: new Map(
        questions.map((question) => [
          question.targetId,
          {
            analysisRevision: question.targetRevision,
            normalizedDigest: question.targetDigest,
          },
        ]),
      ),
      memoryResolutionIds: memories.map(({ memoryResolutionId }) => memoryResolutionId),
      memoryRevisions: new Map(
        memories.map((memory) => [memory.memoryResolutionId, memory.resolutionRevision]),
      ),
      segments: new Map(segments.map((segment) => [segment.transcriptSegmentId, segment])),
      sessionIds: scopes.map(({ sessionId }) => sessionId),
    };
  }

  private async cancelJob(jobId: string, code: string): Promise<void> {
    await this.prisma.aiJob.updateMany({
      data: { completedAt: new Date(), failureCode: code, status: 'cancelled' },
      where: { id: jobId, status: { in: ['pending', 'running'] } },
    });
  }

  private isCancellation(value: unknown): value is CancellationResult {
    return typeof value === 'object' && value !== null && 'cancelled' in value;
  }

  private async lock(tx: Prisma.TransactionClient, value: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${value}, 0))`;
  }
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join('|') === [...right].sort().join('|');
}
