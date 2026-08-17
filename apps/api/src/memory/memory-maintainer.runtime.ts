import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import {
  AiJobCoordinatorService,
  type FrozenAiJob,
} from '../ai-runtime/ai-job-coordinator.service.js';
import {
  EMPTY_MANIFEST_HASH,
  canonicalJson,
  effectiveTextDigest,
  manifestHash,
  sha256,
} from '../ai-runtime/ai-provenance.js';
import { DecisionTraceService } from '../ai-runtime/decision-trace.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AiJob, Prisma, TranscriptSegment } from '../generated/prisma/client.js';
import { RealtimeRuntimeService } from '../realtime-transcription/realtime-runtime.service.js';
import { projectTrustedSpeakerRole } from '../transcription/trusted-speaker-role.js';
import {
  validateMemoryProducerCutover,
  validateMemoryMaintainerRevisionParity,
  type RevisionObservation,
} from './memory-maintainer-contract-v1-1.js';
import {
  MemoryMaintainerProvider,
  type MemoryMaintainerContextV11,
  type MemoryMaintainerOperationV11,
  type MemoryMaintainerOutputV11,
  type MemoryMaintainerTriggerKind,
} from './memory-maintainer.provider.js';
import { MemoryMaintainerV11Validator } from './memory-maintainer.validator.js';

export const MEMORY_MAINTAINER_RUNTIME_CONFIG = Symbol('MEMORY_MAINTAINER_RUNTIME_CONFIG');
const CONTRACT_VERSION = 'memory-maintainer-v1.1';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export interface MemoryMaintainerRuntimeConfig {
  contractMerged: boolean;
  contractReviewStatus: 'review' | 'pass';
  enabled: boolean;
  legacyMemoryExtractEnabled: boolean;
  loadedContractVersion: 'memory-maintainer-v1.1';
  batchThreshold: number;
  timeThresholdMs: number;
  minimumUsefulCharacters: number;
  overlapSegments: number;
  scanIntervalMs: number;
  staleJobMs: number;
  providerDeadlineMs: number;
  postSessionMemoryLane:
    'legacy_memory_extract' | 'delegate_p1_final_flush' | 'project_p1_terminal_outcome';
  unconsumedFinalAuthority: 'legacy_memory_extract' | 'p1';
}

export abstract class MemoryMaintainerClock {
  public abstract now(): Date;
}

@Injectable()
export class SystemMemoryMaintainerClock extends MemoryMaintainerClock {
  public override now(): Date {
    return new Date();
  }
}

export type MemoryMaintainerFailpointStage =
  | 'before_freeze'
  | 'after_freeze'
  | 'after_provider'
  | 'during_writeback'
  | 'after_operations'
  | 'after_boundaries'
  | 'after_snapshot'
  | 'after_writeback';

export abstract class MemoryMaintainerFailpoint {
  public abstract hit(stage: MemoryMaintainerFailpointStage): Promise<void>;
}

@Injectable()
export class NoopMemoryMaintainerFailpoint extends MemoryMaintainerFailpoint {
  public override hit(): Promise<void> {
    return Promise.resolve();
  }
}

interface SelectedBatch {
  actorId: string;
  newSegments: TranscriptSegment[];
  overlapSegments: TranscriptSegment[];
  projectId: string;
  sessionId: string;
  triggerIdentity: string;
  triggerKind: MemoryMaintainerTriggerKind;
}

interface PreparedAttempt {
  attemptNo: number;
  currentResolutionIds: string[];
  prior: AiJob | null;
  triggerIdentity: string;
}

@Injectable()
export class MemoryMaintainerRuntime implements OnModuleInit, OnModuleDestroy {
  private readonly active = new Map<string, Promise<void>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeFinal: (() => void) | null = null;

  public constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: AiJobCoordinatorService,
    private readonly provider: MemoryMaintainerProvider,
    private readonly validator: MemoryMaintainerV11Validator,
    private readonly traces: DecisionTraceService,
    private readonly realtime: RealtimeRuntimeService,
    private readonly clock: MemoryMaintainerClock,
    private readonly failpoint: MemoryMaintainerFailpoint,
    @Inject(MEMORY_MAINTAINER_RUNTIME_CONFIG)
    private readonly config: MemoryMaintainerRuntimeConfig,
  ) {}

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public onModuleInit(): void {
    if (!this.config.enabled) return;
    const cutover = validateMemoryProducerCutover({
      contract_merged: this.config.contractMerged,
      contract_review_status: this.config.contractReviewStatus,
      legacy_memory_extract_enabled: this.config.legacyMemoryExtractEnabled,
      loaded_contract_version: this.config.loadedContractVersion,
      p1_runtime_enabled: true,
      post_session_memory_lane: this.config.postSessionMemoryLane,
      unconsumed_final_authority: this.config.unconsumedFinalAuthority,
    });
    if (!cutover.valid) throw new Error(cutover.errors[0] ?? 'MEMORY_P1_CUTOVER_INVALID');
    this.unsubscribeFinal = this.realtime.onFinalized(({ sessionId }) => {
      this.wake(sessionId, false);
    });
    queueMicrotask(() => {
      this.enqueue('startup', () => this.reconcileAll());
    });
    this.timer = setInterval(() => {
      this.enqueue('periodic', () => this.reconcileAll());
    }, this.config.scanIntervalMs);
    this.timer.unref();
  }

  public onModuleDestroy(): void {
    this.unsubscribeFinal?.();
    this.unsubscribeFinal = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  public requestFinalFlush(sessionId: string): Promise<void> {
    if (!this.config.enabled) return Promise.resolve();
    return this.execute(`session:${sessionId}`, () => this.reconcileSession(sessionId, true));
  }

  public async terminalJobForSession(sessionId: string): Promise<AiJob | null> {
    const byIdentity = await this.prisma.aiJob.findFirst({
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
      where: {
        jobType: 'working_memory_maintain',
        triggerDedupeKey: { startsWith: `memory-p1-v1.1:${sessionId}:` },
      },
    });
    if (byIdentity !== null) return byIdentity;
    const memberships = await this.prisma.memoryMaintenanceInputSegment.findMany({
      select: { aiJobId: true },
      where: {
        membershipKind: 'new',
        transcriptSegmentId: { in: await this.sessionSegmentIds(sessionId) },
      },
    });
    if (memberships.length === 0) return null;
    return this.prisma.aiJob.findFirst({
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
      where: {
        id: { in: memberships.map(({ aiJobId }) => aiJobId) },
        jobType: 'working_memory_maintain',
      },
    });
  }

  public reconcilePersistedState(): Promise<void> {
    return this.execute('startup-manual', () => this.reconcileAll());
  }

  private wake(sessionId: string, finalFlush: boolean): void {
    this.enqueue(`session:${sessionId}`, () => this.reconcileSession(sessionId, finalFlush));
  }

  private enqueue(key: string, work: () => Promise<void>): void {
    void this.execute(key, work).catch(() => undefined);
  }

  private execute(key: string, work: () => Promise<void>): Promise<void> {
    const existing = this.active.get(key);
    if (existing !== undefined) return existing;
    const running = work();
    this.active.set(key, running);
    void running
      .finally(() => {
        if (this.active.get(key) === running) this.active.delete(key);
      })
      .catch(() => undefined);
    return running;
  }

  private async reconcileAll(): Promise<void> {
    await this.terminalizeStaleJobs();
    const sessions = await this.prisma.transcriptSegment.findMany({
      distinct: ['sessionId'],
      select: { sessionId: true },
      where: { contentKind: 'conversation' },
    });
    for (const { sessionId } of sessions) {
      await this.execute(`session:${sessionId}`, () => this.reconcileSession(sessionId, false));
    }
  }

  private async terminalizeStaleJobs(): Promise<void> {
    const cutoff = new Date(this.clock.now().getTime() - this.config.staleJobMs);
    const stale = await this.prisma.aiJob.findMany({
      select: { id: true },
      where: {
        jobType: 'working_memory_maintain',
        OR: [{ startedAt: { lte: cutoff } }, { startedAt: null, createdAt: { lte: cutoff } }],
        status: { in: ['pending', 'running'] },
      },
    });
    for (const job of stale) await this.jobs.failOrphanedSystemJob(job.id);
  }

  private async reconcileSession(sessionId: string, finalFlush: boolean): Promise<void> {
    const batch = await this.selectBatch(sessionId, finalFlush);
    if (batch === null) {
      if (finalFlush) await this.ensureUnjudgedFinal(sessionId);
      return;
    }
    await this.runBatch(batch);
  }

  private async ensureUnjudgedFinal(sessionId: string): Promise<void> {
    if ((await this.terminalJobForSession(sessionId)) !== null) return;
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (session === null || session.status === 'failed') return;
    const segments = await this.prisma.transcriptSegment.findMany({
      orderBy: [{ startMs: 'asc' }, { id: 'asc' }],
      where: { contentKind: 'conversation', sessionId },
    });
    const manifest = segments.map(
      (segment) =>
        `${segment.id}:${String(segment.textRevision)}:${effectiveTextDigest(segment.correctedText ?? segment.originalText)}`,
    );
    const triggerDedupeKey = `memory-p1-v1.1:${sessionId}:final-unjudged:${sha256(canonicalJson(manifest)).slice(0, 32)}`;
    await this.jobs.recordRejectedSystemJob(
      {
        actorId: session.createdBy,
        contextBuilderVersion: CONTRACT_VERSION,
        expiresAt: new Date(this.clock.now().getTime() + RETENTION_MS),
        jobType: 'working_memory_maintain',
        projectId: session.projectId,
        requestId: stableUuid(`${triggerDedupeKey}:attempt:1`),
        sessionIds: [sessionId],
        triggerDedupeKey,
        trustedRole: 'elder',
      },
      'MEMORY_UNJUDGED',
    );
  }

  private async selectBatch(sessionId: string, finalFlush: boolean): Promise<SelectedBatch | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`memory-maintainer:${sessionId}`}, 0))`;
      const session = await tx.interviewSession.findUnique({ where: { id: sessionId } });
      if (session === null || session.status === 'failed') return null;
      const segments = await tx.transcriptSegment.findMany({
        orderBy: [{ startMs: 'asc' }, { id: 'asc' }],
        where: { contentKind: 'conversation', sessionId },
      });
      const consumed = new Set(
        (
          await tx.memoryWorkingConsumption.findMany({
            select: { transcriptSegmentId: true },
            where: { sessionId },
          })
        ).map(({ transcriptSegmentId }) => transcriptSegmentId),
      );
      const pendingElder = segments.filter(
        (segment) =>
          !consumed.has(segment.id) &&
          projectTrustedSpeakerRole(segment).trustedEffectiveSpeakerRole === 'elder',
      );
      if (pendingElder.length === 0) return null;
      const useful = pendingElder.some(
        (segment) =>
          normalizeUseful(segment.correctedText ?? segment.originalText).length >=
          this.config.minimumUsefulCharacters,
      );
      if (!useful) return null;
      const oldest = pendingElder[0];
      if (oldest === undefined) return null;
      const triggerKind = decideMemoryMaintainerTrigger({
        batchReached: pendingElder.length >= this.config.batchThreshold,
        finalFlush,
        minimumUseful: useful,
        timeReached:
          this.clock.now().getTime() - oldest.createdAt.getTime() >= this.config.timeThresholdMs,
      });
      if (triggerKind === null) return null;
      const newSegments = pendingElder.slice(0, 80 - this.config.overlapSegments);
      const first = newSegments[0];
      if (first === undefined) return null;
      const overlapSegments = segments
        .filter(
          (segment) =>
            segment.startMs < first.startMs &&
            ['elder', 'interviewer'].includes(
              projectTrustedSpeakerRole(segment).trustedEffectiveSpeakerRole,
            ),
        )
        .slice(-this.config.overlapSegments);
      const identityManifest = newSegments.map(
        (segment) =>
          `${segment.id}:${String(segment.textRevision)}:${effectiveTextDigest(segment.correctedText ?? segment.originalText)}`,
      );
      const triggerIdentity = `memory-p1-v1.1:${sessionId}:${sha256(canonicalJson(identityManifest)).slice(0, 40)}`;
      return {
        actorId: session.createdBy,
        newSegments,
        overlapSegments,
        projectId: session.projectId,
        sessionId,
        triggerIdentity,
        triggerKind,
      };
    });
  }

  private async runBatch(batch: SelectedBatch): Promise<void> {
    await this.failpoint.hit('before_freeze');
    const prepared = await this.prepareAttempt(batch);
    if (prepared === null) return;
    const { attemptNo, currentResolutionIds, prior, triggerIdentity } = prepared;
    const requestId = stableUuid(`${triggerIdentity}:attempt:${String(attemptNo)}`);
    const ordered = [...batch.overlapSegments, ...batch.newSegments];
    const kindBySegment = new Map<string, 'new' | 'overlap'>([
      ...batch.overlapSegments.map((segment) => [segment.id, 'overlap'] as const),
      ...batch.newSegments.map((segment) => [segment.id, 'new'] as const),
    ]);
    const job = await this.jobs.freeze({
      actorId: batch.actorId,
      contextBuilderVersion: CONTRACT_VERSION,
      exactSegmentIds: ordered.map(({ id }) => id),
      expiresAt: new Date(this.clock.now().getTime() + RETENTION_MS),
      jobType: 'working_memory_maintain',
      memoryResolutionIds: currentResolutionIds,
      projectId: batch.projectId,
      requestId,
      ...(prior === null ? {} : { retryOfJobId: prior.id }),
      sessionIds: [batch.sessionId],
      triggerDedupeKey: triggerIdentity,
      trustedRole: 'elder',
      trustedRoles: ['elder', 'interviewer'],
      afterFreeze: async (tx, frozen) => {
        for (const [inputOrder, segment] of frozen.segments.entries()) {
          const membershipKind = kindBySegment.get(segment.segmentId);
          if (membershipKind === undefined) throw new Error('MEMORY_INPUT_MEMBERSHIP_MISSING');
          await tx.memoryMaintenanceInputSegment.create({
            data: {
              aiJobId: frozen.id,
              aiJobInputSegmentId: segment.inputSegmentId,
              id: randomUUID(),
              inputOrder,
              membershipKind,
              transcriptSegmentId: segment.segmentId,
            },
          });
        }
      },
    });
    if (job.replayed) return;
    await this.failpoint.hit('after_freeze');
    const context = await this.buildContext(job, batch.triggerKind, triggerIdentity);
    const validatedContext = this.validator.validateContext(context);
    const trace = await this.traces.begin({
      activeThreadId: validatedContext.active_thread?.thread_id ?? null,
      aiJobId: job.id,
      contextDigest: sha256(canonicalJson(validatedContext)),
      contextRevision: 1,
      decisionOutcome: 'continue_listening',
      directorInvoked: false,
      inputHash: job.inputHash,
      ownerActorId: job.requestedBy,
      projectId: job.projectId,
      requestId: stableUuid(`memory-trace:${job.id}`),
      sessionId: batch.sessionId,
      transcriptMemberships: validatedContext.transcript_membership.map((segment, inputOrder) => ({
        effectiveTextDigest: segment.effective_text_digest,
        inputOrder,
        segmentId: segment.segment_id,
        speakerRoleRevision: segment.speaker_role_revision,
        textRevision: segment.text_revision,
      })),
      triggerType: 'working_memory_maintain',
      workingRevision: null,
    });
    this.assertRevisionParity(
      job,
      validatedContext,
      validatedContext.transcript_membership.map(({ segment_id, text_revision }) => ({
        segment_id,
        text_revision,
      })),
    );
    try {
      const output = await this.jobs.callProviderWithSameInputRetry(
        job,
        () => this.provider.maintain(validatedContext),
        (value) => this.validator.validateOutput(validatedContext, value),
        Date.now() + this.config.providerDeadlineMs,
      );
      await this.failpoint.hit('after_provider');
      await this.writeBack(job, batch, validatedContext, output);
      await this.traces.finalize(trace.id, { status: 'succeeded' });
    } catch (error) {
      await this.traces
        .finalize(trace.id, {
          decisionOutcome: 'system_error',
          errorCode:
            error instanceof Error ? error.message.slice(0, 80) : 'MEMORY_MAINTAINER_FAILED',
          status: 'failed',
        })
        .catch(() => undefined);
      throw error;
    }
    await this.failpoint.hit('after_writeback');
  }

  private async prepareAttempt(batch: SelectedBatch): Promise<PreparedAttempt | null> {
    let triggerIdentity = batch.triggerIdentity;
    for (let depth = 0; depth < 16; depth += 1) {
      const prior = await this.prisma.aiJob.findFirst({
        orderBy: { attemptNo: 'desc' },
        where: { jobType: 'working_memory_maintain', triggerDedupeKey: triggerIdentity },
      });
      if (prior === null) {
        return {
          attemptNo: 1,
          currentResolutionIds: (await this.currentAuthority(batch.projectId)).map(({ id }) => id),
          prior: null,
          triggerIdentity,
        };
      }
      if (['pending', 'running', 'succeeded'].includes(prior.status)) return null;
      if (prior.status === 'failed') {
        return {
          attemptNo: prior.attemptNo + 1,
          currentResolutionIds: (
            await this.prisma.aiJobInputMemory.findMany({
              orderBy: { inputOrder: 'asc' },
              select: { memoryResolutionId: true },
              where: { aiJobId: prior.id },
            })
          ).map(({ memoryResolutionId }) => memoryResolutionId),
          prior,
          triggerIdentity,
        };
      }
      if (prior.status !== 'cancelled' || prior.failureCode !== 'AI_MEMORY_INPUT_DRIFT')
        return null;
      const authority = await this.currentAuthority(batch.projectId);
      const authorityDigest = sha256(canonicalJson(authority));
      triggerIdentity = `${batch.triggerIdentity}:rebase:${sha256(`${prior.id}:${authorityDigest}`).slice(0, 24)}`;
    }
    throw new Error('MEMORY_REBASE_DEPTH_EXCEEDED');
  }

  private currentAuthority(projectId: string): Promise<
    {
      canonicalKey: string;
      id: string;
      memoryType: string;
      resolutionRevision: number;
      semanticKind: string | null;
      semanticStatus: string | null;
      threadId: string | null;
    }[]
  > {
    return this.prisma.memoryResolution.findMany({
      orderBy: { id: 'asc' },
      select: {
        canonicalKey: true,
        id: true,
        memoryType: true,
        resolutionRevision: true,
        semanticKind: true,
        semanticStatus: true,
        threadId: true,
      },
      where: {
        layer: 'working',
        projectId,
        provenanceState: 'active',
        semanticKind: { not: null },
        semanticStatus: { not: null },
        status: 'current',
        threadId: { not: null },
      },
    });
  }

  private async buildContext(
    job: FrozenAiJob,
    triggerKind: MemoryMaintainerTriggerKind,
    triggerIdentity: string,
  ): Promise<MemoryMaintainerContextV11> {
    const inputKinds = await this.prisma.memoryMaintenanceInputSegment.findMany({
      where: { aiJobId: job.id },
    });
    const kindByInput = new Map(
      inputKinds.map((item) => [item.aiJobInputSegmentId, item.membershipKind]),
    );
    const resolutions = await this.prisma.memoryResolution.findMany({
      orderBy: { id: 'asc' },
      where: {
        id: { in: job.memories.map(({ resolutionId }) => resolutionId) },
        provenanceState: 'active',
      },
    });
    const members = await this.prisma.memoryResolutionMember.findMany({
      orderBy: [{ memoryResolutionId: 'asc' }, { memberOrder: 'asc' }],
      where: { memoryResolutionId: { in: resolutions.map(({ id }) => id) } },
    });
    const claims = await this.prisma.memoryClaim.findMany({
      where: { id: { in: members.map(({ memoryClaimId }) => memoryClaimId) } },
    });
    const claimById = new Map(claims.map((claim) => [claim.id, claim]));
    const sessionId = job.sessionIds[0];
    if (sessionId === undefined) throw new Error('MEMORY_SESSION_REQUIRED');
    const activeThread = await this.prisma.memoryThreadRevision.findFirst({
      where: { sourceSessionId: sessionId, status: 'active', supersededAt: null },
    });
    const boundaries = await this.prisma.memoryBoundary.findMany({
      where: { projectId: job.projectId },
    });
    const boundaryRevisions = await this.prisma.memoryBoundaryRevision.findMany({
      where: {
        boundaryId: { in: boundaries.map(({ id }) => id) },
        status: 'active',
        supersededAt: null,
      },
    });
    return {
      context_schema_version: 'memory-maintainer-context-v1.1',
      trigger: { identity: triggerIdentity, kind: triggerKind },
      transcript_membership: job.segments.map((segment) => {
        if (
          segment.textRevision === undefined ||
          segment.speakerRoleRevision === undefined ||
          segment.effectiveTextDigest === undefined
        )
          throw new Error('MEMORY_FROZEN_REVISION_REQUIRED');
        return {
          content_kind: 'conversation' as const,
          effective_text_digest: segment.effectiveTextDigest,
          membership_kind: kindByInput.get(segment.inputSegmentId) ?? 'overlap',
          segment_id: segment.segmentId,
          session_id: segment.sessionId,
          speaker_role_revision: segment.speakerRoleRevision,
          start_ms: segment.startMs,
          text: segment.text,
          text_revision: segment.textRevision,
          trusted_role: segment.trustedRole,
        };
      }),
      active_thread:
        activeThread === null
          ? null
          : {
              revision: activeThread.revision,
              status: activeThread.status,
              thread_id: activeThread.threadId,
              topic_key: activeThread.topicKey,
            },
      current_working_memory: resolutions.map((resolution) => {
        if (
          resolution.threadId === null ||
          resolution.semanticKind === null ||
          resolution.semanticStatus === null ||
          resolution.layer !== 'working' ||
          resolution.status !== 'current' ||
          resolution.resolutionKind === 'review_required'
        )
          throw new Error('MEMORY_CONTEXT_AUTHORITY_UNAVAILABLE');
        const resolutionMembers = members.filter(
          ({ memoryResolutionId }) => memoryResolutionId === resolution.id,
        );
        return {
          canonical_key: resolution.canonicalKey,
          claims: resolutionMembers.map(({ memoryClaimId }) => {
            const claim = claimById.get(memoryClaimId);
            if (claim === undefined) throw new Error('MEMORY_CONTEXT_CLAIM_MISSING');
            return {
              claim_id: claim.id,
              value: jsonValue(claim.valueJson),
              value_kind: claim.valueKind,
            };
          }),
          memory_type: resolution.memoryType,
          resolution_id: resolution.id,
          resolution_kind: resolution.resolutionKind,
          resolution_status: 'current' as const,
          revision: resolution.resolutionRevision,
          semantic_kind: resolution.semanticKind,
          semantic_status: resolution.semanticStatus,
          thread_id: resolution.threadId,
          value:
            resolution.resolvedValueJson === null ? null : jsonValue(resolution.resolvedValueJson),
          value_kind:
            resolution.semanticStatus === 'disputed'
              ? null
              : resolutionKindToValueKind(resolution.resolutionKind),
        };
      }),
      session_mid_index: [],
      active_boundaries: boundaryRevisions.map((boundary) => ({
        abstract_scope: boundary.abstractScope,
        boundary_id: boundary.boundaryId,
        code: 'elder_explicit_boundary' as const,
        revision: boundary.revision,
        status: 'active' as const,
      })),
    };
  }

  private assertRevisionParity(
    job: FrozenAiJob,
    context: MemoryMaintainerContextV11,
    trace: readonly RevisionObservation[],
  ): void {
    const database = job.segments.map((segment) => ({
      segment_id: segment.segmentId,
      text_revision: segment.textRevision ?? -1,
    }));
    const parity = validateMemoryMaintainerRevisionParity({
      database,
      context_membership: context.transcript_membership.map(({ segment_id, text_revision }) => ({
        segment_id,
        text_revision,
      })),
      decision_trace_membership: trace,
      writeback_cas: database,
    });
    if (!parity.valid) throw new Error(parity.errors[0] ?? 'MEMORY_REVISION_PARITY_INVALID');
  }

  private async writeBack(
    job: FrozenAiJob,
    batch: SelectedBatch,
    context: MemoryMaintainerContextV11,
    output: MemoryMaintainerOutputV11,
  ): Promise<void> {
    await this.jobs.writeBack(job, async (tx) => {
      await this.failpoint.hit('during_writeback');
      const traceMemberships = await tx.decisionTraceTranscriptMembership.findMany({
        where: { trace: { aiJobId: job.id } },
      });
      const database = await tx.transcriptSegment.findMany({
        where: { id: { in: job.segments.map(({ segmentId }) => segmentId) } },
      });
      const parity = validateMemoryMaintainerRevisionParity({
        database: database.map(({ id, textRevision }) => ({
          segment_id: id,
          text_revision: textRevision,
        })),
        context_membership: context.transcript_membership.map(({ segment_id, text_revision }) => ({
          segment_id,
          text_revision,
        })),
        decision_trace_membership: traceMemberships.map(({ segmentId, textRevision }) => ({
          segment_id: segmentId,
          text_revision: textRevision,
        })),
        writeback_cas: database.map(({ id, textRevision }) => ({
          segment_id: id,
          text_revision: textRevision,
        })),
      });
      if (!parity.valid) throw new Error(parity.errors[0] ?? 'MEMORY_REVISION_PARITY_INVALID');
      await this.assertContextAuthorityCurrent(tx, job, context);
      await this.applyOperations(tx, job, batch, context, output.operations);
      await this.failpoint.hit('after_operations');
      await this.applyBoundaries(tx, job, batch, output);
      await this.failpoint.hit('after_boundaries');
      await this.commitSnapshot(tx, job, batch);
      await this.failpoint.hit('after_snapshot');
    });
  }

  private async assertContextAuthorityCurrent(
    tx: Prisma.TransactionClient,
    job: FrozenAiJob,
    context: MemoryMaintainerContextV11,
  ): Promise<void> {
    for (const memory of context.current_working_memory) {
      const current = await tx.memoryResolution.findUnique({ where: { id: memory.resolution_id } });
      if (
        current === null ||
        current.projectId !== job.projectId ||
        current.status !== 'current' ||
        current.provenanceState !== 'active' ||
        current.layer !== 'working' ||
        current.canonicalKey !== memory.canonical_key ||
        current.memoryType !== memory.memory_type ||
        current.semanticKind !== memory.semantic_kind ||
        current.semanticStatus !== memory.semantic_status ||
        current.resolutionRevision !== memory.revision ||
        current.threadId !== memory.thread_id
      )
        throw new Error('MEMORY_RESOLUTION_CONTEXT_DRIFT');
    }
    if (context.active_thread !== null) {
      const thread = await tx.memoryThreadRevision.findFirst({
        where: { threadId: context.active_thread.thread_id, supersededAt: null },
      });
      if (
        thread === null ||
        thread.revision !== context.active_thread.revision ||
        thread.status !== context.active_thread.status
      )
        throw new Error('MEMORY_THREAD_CONTEXT_DRIFT');
    }
    for (const boundary of context.active_boundaries) {
      const current = await tx.memoryBoundaryRevision.findFirst({
        where: { boundaryId: boundary.boundary_id, supersededAt: null },
      });
      if (
        current === null ||
        current.revision !== boundary.revision ||
        current.status !== boundary.status
      )
        throw new Error('MEMORY_BOUNDARY_CONTEXT_DRIFT');
    }
  }

  private async applyOperations(
    tx: Prisma.TransactionClient,
    job: FrozenAiJob,
    batch: SelectedBatch,
    context: MemoryMaintainerContextV11,
    operations: readonly MemoryMaintainerOperationV11[],
  ): Promise<void> {
    const inputBySegment = new Map(job.segments.map((segment) => [segment.segmentId, segment]));
    const touchedTargets = new Set<string>();
    const semanticSlots = new Set<string>();
    for (const operation of operations) {
      if (operation.kind === 'DUPLICATE') continue;
      const state = operation.proposed_state;
      if (state === null) throw new Error('MEMORY_PROPOSED_STATE_REQUIRED');
      const slot = `${state.semantic_kind}:${state.memory_type}:${state.canonical_key}`;
      if (semanticSlots.has(slot)) throw new Error('MEMORY_BATCH_SEMANTIC_SLOT_DUPLICATE');
      semanticSlots.add(slot);
      const target =
        operation.target_resolution_id === null
          ? null
          : await tx.memoryResolution.findUnique({ where: { id: operation.target_resolution_id } });
      if (operation.target_resolution_id !== null && target === null)
        throw new Error('MEMORY_TARGET_CAS_FAILED');
      if (target !== null) {
        if (touchedTargets.has(target.id)) throw new Error('MEMORY_BATCH_TARGET_DUPLICATE');
        touchedTargets.add(target.id);
        if (
          target.projectId !== job.projectId ||
          target.status !== 'current' ||
          target.layer !== 'working' ||
          target.provenanceState !== 'active' ||
          target.authority === 'human_confirmed' ||
          target.canonicalKey !== state.canonical_key ||
          target.memoryType !== state.memory_type ||
          target.semanticKind !== state.semantic_kind ||
          target.threadId !== operation.anchor_thread_id ||
          target.resolutionRevision !== operation.expected_resolution_revision ||
          !job.memories.some(({ resolutionId }) => resolutionId === target.id)
        )
          throw new Error('MEMORY_TARGET_CAS_FAILED');
      }
      const threadId = await this.resolveThread(
        tx,
        job,
        batch.sessionId,
        operation,
        state.canonical_key,
        target?.threadId ?? null,
      );
      const claimIds: string[] = [];
      for (const claim of state.claims) {
        if (state.semantic_status === 'disputed') {
          if (claim.claim_id === null) throw new Error('MEMORY_DISPUTED_CLAIM_ID_REQUIRED');
          const member = await tx.memoryResolutionMember.findFirst({
            where: { memoryClaimId: claim.claim_id, memoryResolutionId: target?.id ?? '' },
          });
          if (member === null || claimIds.includes(claim.claim_id))
            throw new Error('MEMORY_DISPUTED_CLAIM_NOT_ELIGIBLE');
          claimIds.push(claim.claim_id);
        } else {
          if (claim.claim_id !== null) throw new Error('MEMORY_NEW_CLAIM_ID_MUST_BE_NULL');
          claimIds.push(
            await this.createClaim(tx, job, batch, threadId, state, claim, inputBySegment),
          );
        }
      }
      if (state.semantic_status === 'disputed' && claimIds.length < 2)
        throw new Error('MEMORY_DISPUTED_REQUIRES_TWO_CLAIMS');
      const resolutionId = randomUUID();
      const derivedId = randomUUID();
      const evidence = [
        ...new Set(
          operation.evidence_segment_ids
            .map((id) => inputBySegment.get(id)?.inputSegmentId)
            .filter((id): id is string => id !== undefined),
        ),
      ];
      const memoryInput =
        target === null ? undefined : job.memories.find(({ resolutionId: id }) => id === target.id);
      const expectedMemoryManifestHash =
        memoryInput === undefined || target === null
          ? EMPTY_MANIFEST_HASH
          : manifestHash([
              `${memoryInput.inputMemoryId}:${target.id}:${String(target.resolutionRevision)}`,
            ]);
      await tx.aiDerivedOutput.create({
        data: {
          aiJobId: job.id,
          businessOutputId: resolutionId,
          expectedMemoryCount: memoryInput === undefined ? 0 : 1,
          expectedMemoryManifestHash,
          expectedQuestionCount: 0,
          expectedQuestionManifestHash: EMPTY_MANIFEST_HASH,
          expectedSegmentCount: evidence.length,
          expectedSegmentManifestHash: await inputManifest(tx, evidence),
          id: derivedId,
          outputType: 'memory_resolution',
          projectId: job.projectId,
        },
      });
      if (target !== null)
        await tx.memoryResolution.update({
          data: { status: 'superseded' },
          where: { id: target.id },
        });
      await tx.memoryResolution.create({
        data: {
          aiDerivedOutputId: derivedId,
          aiJobId: job.id,
          authority: 'automatic',
          canonicalKey: state.canonical_key,
          id: resolutionId,
          layer: 'working',
          memoryType: state.memory_type,
          projectId: job.projectId,
          provenanceState: 'active',
          resolutionKind: state.resolution_kind,
          resolutionRevision: (target?.resolutionRevision ?? 0) + 1,
          resolvedValueJson: (state.semantic_status === 'disputed'
            ? { claim_ids: claimIds }
            : { value: state.value }) as Prisma.InputJsonValue,
          semanticKind: state.semantic_kind,
          semanticStatus: state.semantic_status,
          sourceSessionId: batch.sessionId,
          status: 'current',
          supersedesResolutionId: target?.id ?? null,
          threadId,
        },
      });
      for (const [memberOrder, memoryClaimId] of claimIds.entries()) {
        await tx.memoryResolutionMember.create({
          data: { id: randomUUID(), memberOrder, memoryClaimId, memoryResolutionId: resolutionId },
        });
      }
      for (const [dependencyOrder, aiJobInputSegmentId] of evidence.entries()) {
        await tx.aiOutputSegmentDependency.create({
          data: {
            aiDerivedOutputId: derivedId,
            aiJobInputSegmentId,
            dependencyOrder,
            id: randomUUID(),
          },
        });
      }
      if (memoryInput !== undefined) {
        await tx.aiOutputMemoryDependency.create({
          data: {
            aiDerivedOutputId: derivedId,
            aiJobInputMemoryId: memoryInput.inputMemoryId,
            dependencyOrder: 0,
            id: randomUUID(),
          },
        });
      }
    }
  }

  private async resolveThread(
    tx: Prisma.TransactionClient,
    job: FrozenAiJob,
    sessionId: string,
    operation: MemoryMaintainerOperationV11,
    topicKey: string,
    targetThreadId: string | null,
  ): Promise<string> {
    const existingThreadId = targetThreadId ?? operation.anchor_thread_id;
    if (existingThreadId !== null && operation.kind !== 'BRANCH' && operation.kind !== 'RELATED') {
      const current = await tx.memoryThreadRevision.findFirst({
        where: { threadId: existingThreadId, supersededAt: null },
      });
      if (current === null || current.revision !== operation.expected_anchor_thread_revision)
        throw new Error('MEMORY_THREAD_CAS_FAILED');
      await this.parkCurrentActive(tx, job.id, sessionId, existingThreadId);
      await tx.memoryThreadRevision.update({
        data: { supersededAt: this.clock.now() },
        where: { id: current.id },
      });
      await tx.memoryThreadRevision.create({
        data: {
          aiJobId: job.id,
          id: randomUUID(),
          revision: current.revision + 1,
          sourceSessionId: sessionId,
          status: 'active',
          supersedesThreadRevisionId: current.id,
          threadId: existingThreadId,
          topicKey,
        },
      });
      return existingThreadId;
    }
    if (operation.anchor_thread_id !== null) {
      const anchor = await tx.memoryThreadRevision.findFirst({
        where: { threadId: operation.anchor_thread_id, supersededAt: null },
      });
      if (anchor === null || anchor.revision !== operation.expected_anchor_thread_revision)
        throw new Error('MEMORY_THREAD_ANCHOR_CAS_FAILED');
    }
    await this.parkCurrentActive(tx, job.id, sessionId, null);
    const threadId = randomUUID();
    await tx.memoryThread.create({
      data: {
        anchorThreadId: operation.anchor_thread_id,
        createdByAiJobId: job.id,
        id: threadId,
        originSessionId: sessionId,
        projectId: job.projectId,
      },
    });
    await tx.memoryThreadRevision.create({
      data: {
        aiJobId: job.id,
        id: randomUUID(),
        revision: 1,
        sourceSessionId: sessionId,
        status: 'active',
        threadId,
        topicKey,
      },
    });
    return threadId;
  }

  private async parkCurrentActive(
    tx: Prisma.TransactionClient,
    jobId: string,
    sessionId: string,
    exceptThreadId: string | null,
  ): Promise<void> {
    const active = await tx.memoryThreadRevision.findFirst({
      where: { sourceSessionId: sessionId, status: 'active', supersededAt: null },
    });
    if (active === null || active.threadId === exceptThreadId) return;
    await tx.memoryThreadRevision.update({
      data: { supersededAt: this.clock.now() },
      where: { id: active.id },
    });
    await tx.memoryThreadRevision.create({
      data: {
        aiJobId: jobId,
        id: randomUUID(),
        revision: active.revision + 1,
        sourceSessionId: sessionId,
        status: 'parked',
        supersedesThreadRevisionId: active.id,
        threadId: active.threadId,
        topicKey: active.topicKey,
      },
    });
  }

  private async createClaim(
    tx: Prisma.TransactionClient,
    job: FrozenAiJob,
    batch: SelectedBatch,
    threadId: string,
    state: NonNullable<MemoryMaintainerOperationV11['proposed_state']>,
    claim: NonNullable<MemoryMaintainerOperationV11['proposed_state']>['claims'][number],
    inputBySegment: ReadonlyMap<string, FrozenAiJob['segments'][number]>,
  ): Promise<string> {
    const evidence = claim.evidence_segment_ids.map((segmentId) => {
      const input = inputBySegment.get(segmentId);
      if (input === undefined) throw new Error('MEMORY_CLAIM_EVIDENCE_OUTSIDE_INPUT');
      return input;
    });
    const claimId = randomUUID();
    const derivedId = randomUUID();
    await tx.aiDerivedOutput.create({
      data: {
        aiJobId: job.id,
        businessOutputId: claimId,
        expectedMemoryCount: 0,
        expectedMemoryManifestHash: EMPTY_MANIFEST_HASH,
        expectedQuestionCount: 0,
        expectedQuestionManifestHash: EMPTY_MANIFEST_HASH,
        expectedSegmentCount: evidence.length,
        expectedSegmentManifestHash: await inputManifest(
          tx,
          evidence.map(({ inputSegmentId }) => inputSegmentId),
        ),
        id: derivedId,
        outputType: 'memory_claim',
        projectId: job.projectId,
      },
    });
    const valueJson = { value: claim.value } as Prisma.InputJsonValue;
    await tx.memoryClaim.create({
      data: {
        aiDerivedOutputId: derivedId,
        aiJobId: job.id,
        authority: 'automatic',
        canonicalKey: state.canonical_key,
        explicitCorrection: false,
        id: claimId,
        layer: 'working',
        memoryType: state.memory_type,
        normalizedValueDigest: sha256(canonicalJson(valueJson)),
        projectId: job.projectId,
        provenanceState: 'active',
        semanticKind: state.semantic_kind,
        sourceSessionId: batch.sessionId,
        threadId,
        valueJson,
        valueKind: claim.value_kind,
      },
    });
    for (const [evidenceOrder, item] of evidence.entries()) {
      await tx.memoryClaimEvidence.create({
        data: {
          aiJobInputSegmentId: item.inputSegmentId,
          evidenceOrder,
          id: randomUUID(),
          memoryClaimId: claimId,
          transcriptSegmentId: item.segmentId,
        },
      });
      await tx.aiOutputSegmentDependency.create({
        data: {
          aiDerivedOutputId: derivedId,
          aiJobInputSegmentId: item.inputSegmentId,
          dependencyOrder: evidenceOrder,
          id: randomUUID(),
        },
      });
    }
    return claimId;
  }

  private async applyBoundaries(
    tx: Prisma.TransactionClient,
    job: FrozenAiJob,
    batch: SelectedBatch,
    output: MemoryMaintainerOutputV11,
  ): Promise<void> {
    const inputs = new Map(job.segments.map((segment) => [segment.segmentId, segment]));
    for (const candidate of output.boundary_candidates) {
      const boundaryId = randomUUID();
      const revisionId = randomUUID();
      await tx.memoryBoundary.create({
        data: { createdByAiJobId: job.id, id: boundaryId, projectId: job.projectId },
      });
      await tx.memoryBoundaryRevision.create({
        data: {
          abstractScope: candidate.abstract_scope,
          aiJobId: job.id,
          boundaryId,
          code: candidate.code,
          id: revisionId,
          revision: 1,
          status: 'active',
        },
      });
      for (const [evidenceOrder, segmentId] of candidate.evidence_segment_ids.entries()) {
        const input = inputs.get(segmentId);
        if (input === undefined) throw new Error('MEMORY_BOUNDARY_EVIDENCE_OUTSIDE_INPUT');
        await tx.memoryBoundaryEvidence.create({
          data: {
            aiJobInputSegmentId: input.inputSegmentId,
            boundaryRevisionId: revisionId,
            evidenceOrder,
            id: randomUUID(),
            transcriptSegmentId: segmentId,
          },
        });
      }
    }
  }

  private async commitSnapshot(
    tx: Prisma.TransactionClient,
    job: FrozenAiJob,
    batch: SelectedBatch,
  ): Promise<void> {
    const resolutions = await tx.memoryResolution.findMany({
      orderBy: { id: 'asc' },
      where: {
        layer: 'working',
        projectId: job.projectId,
        provenanceState: 'active',
        semanticKind: { not: null },
        semanticStatus: { not: null },
        status: 'current',
        threadId: { not: null },
      },
    });
    const threads = await tx.memoryThreadRevision.findMany({
      orderBy: { threadId: 'asc' },
      where: { sourceSessionId: batch.sessionId, supersededAt: null },
    });
    const boundaries = await tx.memoryBoundary.findMany({ where: { projectId: job.projectId } });
    const boundaryRevisions = await tx.memoryBoundaryRevision.findMany({
      orderBy: { boundaryId: 'asc' },
      where: {
        boundaryId: { in: boundaries.map(({ id }) => id) },
        status: 'active',
        supersededAt: null,
      },
    });
    const resolutionEntries = resolutions.map(
      (item) =>
        `${item.id}:${String(item.resolutionRevision)}:${item.semanticStatus ?? 'null'}:${item.threadId ?? 'null'}`,
    );
    const threadEntries = threads.map(
      (item) => `${item.threadId}:${String(item.revision)}:${item.status}`,
    );
    const boundaryEntries = boundaryRevisions.map(
      (item) => `${item.boundaryId}:${String(item.revision)}:${item.status}`,
    );
    const snapshotId = randomUUID();
    await tx.memoryWorkingSnapshot.create({
      data: {
        aiJobId: job.id,
        boundaryManifestHash: manifestHash(boundaryEntries),
        contractVersion: CONTRACT_VERSION,
        expectedBoundaryCount: boundaryEntries.length,
        expectedResolutionCount: resolutionEntries.length,
        expectedThreadCount: threadEntries.length,
        id: snapshotId,
        policyRevision: job.policyRevision,
        projectId: job.projectId,
        resolutionManifestHash: manifestHash(resolutionEntries),
        sourceSessionId: batch.sessionId,
        threadManifestHash: manifestHash(threadEntries),
        triggerIdentity: batch.triggerIdentity,
        triggerKind: batch.triggerKind,
      },
    });
    for (const [inputOrder, item] of resolutions.entries())
      await tx.memoryWorkingSnapshotResolution.create({
        data: {
          id: randomUUID(),
          inputOrder,
          membershipDigest: sha256(resolutionEntries[inputOrder] ?? ''),
          memoryResolutionId: item.id,
          resolutionRevision: item.resolutionRevision,
          snapshotId,
        },
      });
    for (const [inputOrder, item] of threads.entries())
      await tx.memoryWorkingSnapshotThread.create({
        data: {
          id: randomUUID(),
          inputOrder,
          membershipDigest: sha256(threadEntries[inputOrder] ?? ''),
          revision: item.revision,
          snapshotId,
          threadId: item.threadId,
          threadRevisionId: item.id,
        },
      });
    for (const [inputOrder, item] of boundaryRevisions.entries())
      await tx.memoryWorkingSnapshotBoundary.create({
        data: {
          boundaryId: item.boundaryId,
          boundaryRevisionId: item.id,
          id: randomUUID(),
          inputOrder,
          membershipDigest: sha256(boundaryEntries[inputOrder] ?? ''),
          revision: item.revision,
          snapshotId,
        },
      });
    const memberships = await tx.memoryMaintenanceInputSegment.findMany({
      where: { aiJobId: job.id, membershipKind: 'new' },
    });
    const inputRows = await tx.aiJobInputSegment.findMany({
      where: { id: { in: memberships.map(({ aiJobInputSegmentId }) => aiJobInputSegmentId) } },
    });
    for (const input of inputRows)
      await tx.memoryWorkingConsumption.create({
        data: {
          aiJobInputSegmentId: input.id,
          effectiveTextDigest: input.effectiveTextDigest,
          id: randomUUID(),
          memoryWorkingSnapshotId: snapshotId,
          projectId: job.projectId,
          sessionId: batch.sessionId,
          textRevision: input.textRevision,
          transcriptSegmentId: input.transcriptSegmentId,
        },
      });
  }

  private async sessionSegmentIds(sessionId: string): Promise<string[]> {
    return (
      await this.prisma.transcriptSegment.findMany({ select: { id: true }, where: { sessionId } })
    ).map(({ id }) => id);
  }
}

function stableUuid(value: string): string {
  const hex = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function normalizeUseful(value: string): string {
  return value.replaceAll(/\s+/gu, '').trim();
}

export function decideMemoryMaintainerTrigger(input: {
  batchReached: boolean;
  finalFlush: boolean;
  minimumUseful: boolean;
  timeReached: boolean;
}): MemoryMaintainerTriggerKind | null {
  if (!input.minimumUseful) return null;
  if (input.finalFlush) return 'session_final_flush';
  if (input.batchReached) return 'batch_threshold';
  if (input.timeReached) return 'time_threshold';
  return null;
}

function jsonValue(value: Prisma.JsonValue): unknown {
  return value;
}

function resolutionKindToValueKind(value: string): 'exact' | 'range' | 'unknown' {
  if (value === 'range') return 'range';
  if (value === 'unknown') return 'unknown';
  return 'exact';
}

async function inputManifest(
  tx: Prisma.TransactionClient,
  ids: readonly string[],
): Promise<string> {
  if (ids.length === 0) return EMPTY_MANIFEST_HASH;
  const rows = await tx.aiJobInputSegment.findMany({ where: { id: { in: [...ids] } } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return manifestHash(
    ids.map((id) => {
      const row = byId.get(id);
      if (row === undefined) throw new Error('MEMORY_INPUT_MANIFEST_MISSING');
      return `${row.id}:${row.transcriptSegmentId}:${String(row.textRevision)}:${String(row.speakerRoleRevision)}:${row.effectiveTextDigest}`;
    }),
  );
}
