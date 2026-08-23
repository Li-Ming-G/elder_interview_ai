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
import {
  DecisionTraceService,
  countDecisionTraceUsefulCharacters,
  decisionTraceMemoryTriggerInputHash,
  decisionTraceMemoryTriggerManifest,
  type DecisionTraceInput,
  type DecisionTraceMemoryTriggerObservationInput,
} from '../ai-runtime/decision-trace.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AiJob, Prisma, TranscriptSegment } from '../generated/prisma/client.js';
import { RealtimeRuntimeService } from '../realtime-transcription/realtime-runtime.service.js';
import { projectTrustedSpeakerRole } from '../transcription/trusted-speaker-role.js';
import {
  validateMemoryMaintainerRevisionParity,
  type RevisionObservation,
} from './memory-maintainer-contract-v1-1.js';
import {
  countMemoryMaintainerUsefulCharactersV12,
  validateMemoryProducerCutoverV12,
} from './memory-maintainer-contract-v1-2.js';
import {
  MemoryMaintainerProvider,
  type MemoryMaintainerContextV12,
  type MemoryMaintainerOperationV12,
  type MemoryMaintainerOutputV12,
  type MemoryMaintainerTriggerKind,
} from './memory-maintainer.provider.js';
import { MemoryMaintainerV12Validator } from './memory-maintainer.validator.js';
import {
  classifyMemoryGateEvidenceRole,
  memoryGateEligibility,
  MemoryGateCorrectionService,
  type MemoryGateAuthoritySnapshot,
  type MemoryGateCandidate,
  type MemoryGateEvidenceReference,
  type MemoryGateSemanticState,
} from './memory-gate-correction.service.js';

export const MEMORY_MAINTAINER_RUNTIME_CONFIG = Symbol('MEMORY_MAINTAINER_RUNTIME_CONFIG');
const CONTRACT_VERSION = 'memory-maintainer-v1.2';
const TRIGGER_NAMESPACE = 'memory-p1-v1.2';
const MAX_CONTEXT_SEGMENTS = 80;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export interface MemoryMaintainerRuntimeConfig {
  contractMerged: boolean;
  contractReviewStatus: 'review' | 'pass';
  enabled: boolean;
  legacyMemoryExtractEnabled: boolean;
  loadedContractVersion: 'memory-maintainer-v1.2';
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
  cumulativeUsefulCharacters: number;
  newSegments: TranscriptSegment[];
  overlapSegments: TranscriptSegment[];
  projectId: string;
  sessionId: string;
  triggerIdentity: string;
  triggerKind: MemoryMaintainerTriggerKind;
}

interface SelectedNewSource {
  actorId: string;
  cumulativeUsefulCharacters: number;
  newSegments: TranscriptSegment[];
  projectId: string;
  sessionId: string;
}

interface BatchSelection {
  batch: SelectedBatch | null;
  source: SelectedNewSource;
}

interface PreparedAttempt {
  attemptNo: number;
  currentResolutionIds: string[];
  prior: AiJob | null;
  triggerIdentity: string;
}

interface MemoryGateRuntimeAuthority {
  evidenceBySegmentId: ReadonlyMap<string, MemoryGateEvidenceReference>;
  snapshot: MemoryGateAuthoritySnapshot;
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
    private readonly validator: MemoryMaintainerV12Validator,
    private readonly traces: DecisionTraceService,
    private readonly realtime: RealtimeRuntimeService,
    private readonly clock: MemoryMaintainerClock,
    private readonly failpoint: MemoryMaintainerFailpoint,
    @Inject(MEMORY_MAINTAINER_RUNTIME_CONFIG)
    private readonly config: MemoryMaintainerRuntimeConfig,
    private readonly gate: MemoryGateCorrectionService = new MemoryGateCorrectionService(),
  ) {}

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public onModuleInit(): void {
    if (!this.config.enabled) return;
    const cutover = validateMemoryProducerCutoverV12({
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
        OR: [
          { triggerDedupeKey: { startsWith: `${TRIGGER_NAMESPACE}:${sessionId}:` } },
          { triggerDedupeKey: { startsWith: `memory-p1-v1.1:${sessionId}:` } },
        ],
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
    await this.reconcileMemoryDecisionTraces();
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

  private async reconcileMemoryDecisionTraces(): Promise<void> {
    const candidates = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT j.id
      FROM ai_job j
      LEFT JOIN decision_trace t ON t.ai_job_id = j.id
      WHERE j.job_type = 'working_memory_maintain'
        AND j.trigger_dedupe_key LIKE ${`${TRIGGER_NAMESPACE}:%`}
        AND (
          t.id IS NULL
          OR (t.status = 'running' AND j.status NOT IN ('pending', 'running'))
        )
      ORDER BY j.created_at ASC
      LIMIT 200
    `;
    const jobs = await this.prisma.aiJob.findMany({
      orderBy: { createdAt: 'asc' },
      where: { id: { in: candidates.map(({ id }) => id) } },
    });
    for (const job of jobs) {
      const trace = await this.prisma.decisionTrace.findFirst({ where: { aiJobId: job.id } });
      if (trace === null) {
        if (['pending', 'running'].includes(job.status)) {
          await this.recoverFreshMissingMemoryTrace(job.id);
        } else {
          await this.repairMissingMemoryTrace(job);
        }
        continue;
      }
      if (trace.status !== 'running' || ['pending', 'running'].includes(job.status)) continue;
      const terminal = memoryTraceTerminalProjection(job);
      await this.traces
        .finalize(trace.id, {
          completedAt: job.completedAt ?? new Date(),
          decisionOutcome: terminal.decisionOutcome,
          errorCode: terminal.errorCode,
          stage: 'recovered',
          status: terminal.status,
        })
        .catch((error: unknown) => {
          if (!(error instanceof Error) || error.message !== 'DECISION_TRACE_TERMINAL_OR_MISSING')
            throw error;
        });
    }
  }

  private async repairMissingMemoryTrace(job: AiJob): Promise<void> {
    await this.prisma.$transaction((tx) => this.recordMissingMemoryTraceInTransaction(tx, job));
  }

  private async recoverFreshMissingMemoryTrace(jobId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM ai_job WHERE id = ${jobId}::uuid FOR UPDATE`;
      const job = await tx.aiJob.findUnique({ where: { id: jobId } });
      if (job === null || !['pending', 'running'].includes(job.status)) return;
      const trace = await tx.decisionTrace.findFirst({ where: { aiJobId: job.id } });
      if (trace !== null) return;
      const now = new Date(this.clock.now());
      const updated = await tx.aiJob.updateMany({
        data: {
          completedAt: now,
          failureCode: 'SYSTEM_COORDINATOR_RESTARTED',
          status: 'failed',
        },
        where: { id: job.id, status: { in: ['pending', 'running'] } },
      });
      if (updated.count !== 1) return;
      await this.recordMissingMemoryTraceInTransaction(
        tx,
        {
          ...job,
          completedAt: now,
          failureCode: 'SYSTEM_COORDINATOR_RESTARTED',
          status: 'failed',
        },
        {
          decisionOutcome: 'unavailable',
          errorCode: 'MEMORY_TRACE_PROVENANCE_UNAVAILABLE',
          status: 'unavailable',
        },
      );
    });
  }

  private async recordMissingMemoryTraceInTransaction(
    tx: Prisma.TransactionClient,
    job: AiJob,
    terminalOverride?: {
      decisionOutcome: 'continue_listening' | 'system_error' | 'unavailable';
      errorCode: string | null;
      status: 'cancelled' | 'failed' | 'succeeded' | 'unavailable';
    },
  ): Promise<void> {
    const scope = await tx.aiJobSessionScope.findFirst({
      orderBy: { inputOrder: 'asc' },
      where: { aiJobId: job.id },
    });
    if (scope === null) return;
    const inputs = await tx.aiJobInputSegment.findMany({
      orderBy: { inputOrder: 'asc' },
      where: { aiJobId: job.id },
    });
    const terminal =
      terminalOverride ??
      (job.status === 'succeeded'
        ? {
            decisionOutcome: 'unavailable' as const,
            errorCode: 'MEMORY_TRACE_PROVENANCE_UNAVAILABLE',
            status: 'unavailable' as const,
          }
        : memoryTraceTerminalProjection(
            job,
            job.failureCode === 'MEMORY_UNJUDGED' ? 'MEMORY_TRIGGER_PROVENANCE_UNAVAILABLE' : null,
          ));
    await this.traces.recordTerminalInTransaction(
      tx,
      {
        aiJobId: job.id,
        contextDigest: null,
        contextRevision: 0,
        decisionOutcome: terminal.decisionOutcome,
        directorInvoked: false,
        generationId: stableUuid(`memory-generation:${job.id}`),
        inputHash: job.inputHash,
        ownerActorId: job.requestedBy,
        projectId: job.projectId,
        requestId: stableUuid(`memory-trace:${job.id}`),
        sessionId: scope.sessionId,
        stage: 'recovered',
        startedAt: job.startedAt ?? job.createdAt,
        transcriptMemberships: inputs.map((input) => ({
          effectiveTextDigest: input.effectiveTextDigest,
          inputOrder: input.inputOrder,
          segmentId: input.transcriptSegmentId,
          speakerRoleRevision: input.speakerRoleRevision,
          textRevision: input.textRevision,
        })),
        triggerType: 'working_memory_maintain',
        workingRevision: null,
      },
      {
        completedAt: job.completedAt ?? new Date(),
        decisionOutcome: terminal.decisionOutcome,
        errorCode: terminal.errorCode,
        stage: 'recovered',
        status: terminal.status,
      },
    );
  }

  private async reconcileSession(sessionId: string, finalFlush: boolean): Promise<void> {
    const selection = await this.selectBatch(sessionId, finalFlush);
    if (selection === null) return;
    if (selection.batch === null) {
      if (finalFlush) await this.ensureUnjudgedFinal(selection.source);
      return;
    }
    await this.runBatch(selection.batch);
  }

  private async ensureUnjudgedFinal(source: SelectedNewSource): Promise<void> {
    const existingTerminal = await this.terminalJobForSession(source.sessionId);
    if (source.newSegments.length === 0 && existingTerminal !== null) return;
    const observationMemberships = source.newSegments.map((segment, inputOrder) =>
      memoryTriggerSegmentObservation(segment, inputOrder),
    );
    const triggerDedupeKey = `${TRIGGER_NAMESPACE}:${source.sessionId}:final-unjudged:${decisionTraceMemoryTriggerManifest(observationMemberships).slice(0, 32)}`;
    await this.jobs.recordRejectedSystemJob(
      {
        actorId: source.actorId,
        contextBuilderVersion: CONTRACT_VERSION,
        exactSegmentIds: source.newSegments.map(({ id }) => id),
        expiresAt: new Date(this.clock.now().getTime() + RETENTION_MS),
        jobType: 'working_memory_maintain',
        projectId: source.projectId,
        requestId: stableUuid(`${triggerDedupeKey}:attempt:1`),
        sessionIds: [source.sessionId],
        triggerDedupeKey,
        trustedRole: 'elder',
        afterFreeze: async (tx, frozen) => {
          const frozenMemberships = await this.freezeUnjudgedSource(tx, frozen, source);
          const observation: DecisionTraceMemoryTriggerObservationInput = {
            aiJobId: frozen.id,
            cumulativeUsefulCharacters: frozenMemberships.reduce(
              (total, membership) => total + membership.usefulCharacterCount,
              0,
            ),
            minimumUsefulCharacters: this.config.minimumUsefulCharacters,
            selectedNewMemberships: frozenMemberships,
            selectedNewSegmentCount: frozenMemberships.length,
            triggerIdentity: triggerDedupeKey,
            triggerKind: 'session_final_flush',
          };
          await this.traces.recordTerminalInTransaction(
            tx,
            memoryDecisionTraceInput(frozen, source.sessionId, observation, {
              decisionOutcome: 'unavailable',
              gateReason: 'minimum_useful_characters',
              stage: 'final_flush_gate',
            }),
            {
              decisionOutcome: 'unavailable',
              errorCode: 'MEMORY_UNJUDGED',
              stage: 'final_flush_gate',
              status: 'unavailable',
            },
          );
        },
      },
      'MEMORY_UNJUDGED',
    );
  }

  private async freezeUnjudgedSource(
    tx: Prisma.TransactionClient,
    job: FrozenAiJob,
    source: SelectedNewSource,
  ): Promise<DecisionTraceMemoryTriggerObservationInput['selectedNewMemberships']> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`memory-maintainer:${source.sessionId}`}, 0))`;
    await tx.$queryRaw`SELECT id FROM interview_session WHERE id = ${source.sessionId}::uuid FOR UPDATE`;
    const segments = await tx.transcriptSegment.findMany({
      orderBy: [{ startMs: 'asc' }, { id: 'asc' }],
      where: { contentKind: 'conversation', sessionId: source.sessionId },
    });
    const consumed = new Set(
      (
        await tx.memoryWorkingConsumption.findMany({
          select: { transcriptSegmentId: true },
          where: { sessionId: source.sessionId },
        })
      ).map(({ transcriptSegmentId }) => transcriptSegmentId),
    );
    const selected = segments
      .filter(
        (segment) =>
          !consumed.has(segment.id) &&
          projectTrustedSpeakerRole(segment).trustedEffectiveSpeakerRole === 'elder',
      )
      .slice(0, Math.max(0, MAX_CONTEXT_SEGMENTS - Math.max(0, this.config.overlapSegments)));
    const expected = source.newSegments.map((segment, inputOrder) =>
      memoryTriggerSegmentObservation(segment, inputOrder),
    );
    const frozen = selected.map((segment, inputOrder) =>
      memoryTriggerSegmentObservation(segment, inputOrder),
    );
    if (
      decisionTraceMemoryTriggerManifest(frozen) !== decisionTraceMemoryTriggerManifest(expected) ||
      frozen.reduce((sum, item) => sum + item.usefulCharacterCount, 0) !==
        source.cumulativeUsefulCharacters
    ) {
      throw new Error('MEMORY_UNJUDGED_SOURCE_DRIFT');
    }
    for (const [inputOrder, segment] of selected.entries()) {
      const membership = frozen[inputOrder];
      if (membership === undefined) throw new Error('MEMORY_UNJUDGED_SOURCE_MISSING');
      const aiJobInputSegmentId = randomUUID();
      const trustedRole = projectTrustedSpeakerRole(segment).trustedEffectiveSpeakerRole;
      if (trustedRole !== 'elder') throw new Error('MEMORY_UNJUDGED_SOURCE_UNTRUSTED');
      const roleAuthority =
        segment.correctedSpeakerRole === null ? segment.originalRoleAuthority : 'user_confirmed';
      await tx.aiJobInputSegment.create({
        data: {
          aiJobId: job.id,
          contentKind: segment.contentKind,
          effectiveTextDigest: membership.effectiveTextDigest,
          id: aiJobInputSegmentId,
          inputOrder,
          roleAuthority,
          sessionId: source.sessionId,
          speakerRoleRevision: membership.speakerRoleRevision,
          textRevision: membership.textRevision,
          transcriptSegmentId: membership.transcriptSegmentId,
          trustedEffectiveRole: trustedRole,
        },
      });
      await tx.memoryMaintenanceInputSegment.create({
        data: {
          aiJobId: job.id,
          aiJobInputSegmentId,
          id: randomUUID(),
          inputOrder,
          membershipKind: 'new',
          transcriptSegmentId: membership.transcriptSegmentId,
        },
      });
    }
    const selectedNewManifestHash = decisionTraceMemoryTriggerManifest(frozen);
    const scopeUpdated = await tx.aiJobSessionScope.updateMany({
      data: {
        eligibleSegmentCount: selected.length,
        scopeReason: 'working_memory_maintain:system_rejection:elder',
        segmentManifestHash: selectedNewManifestHash,
      },
      where: { aiJobId: job.id, sessionId: source.sessionId },
    });
    if (scopeUpdated.count !== 1) throw new Error('MEMORY_UNJUDGED_SCOPE_MISSING');
    const triggerIdentity = `${TRIGGER_NAMESPACE}:${source.sessionId}:final-unjudged:${selectedNewManifestHash.slice(0, 32)}`;
    const inputHash = decisionTraceMemoryTriggerInputHash({
      contextBuilderVersion: CONTRACT_VERSION,
      jobType: 'working_memory_maintain',
      projectId: source.projectId,
      selectedNewManifestHash,
      sessionId: source.sessionId,
      triggerIdentity,
    });
    const inputUpdated = await tx.aiJob.updateMany({
      data: { inputHash },
      where: {
        failureCode: 'MEMORY_UNJUDGED',
        id: job.id,
        status: 'cancelled',
      },
    });
    if (inputUpdated.count !== 1) throw new Error('MEMORY_UNJUDGED_JOB_DRIFT');
    job.inputHash = inputHash;
    return frozen;
  }

  private async selectBatch(
    sessionId: string,
    finalFlush: boolean,
  ): Promise<BatchSelection | null> {
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
      const maximumNewSegments = Math.max(
        0,
        MAX_CONTEXT_SEGMENTS - Math.max(0, this.config.overlapSegments),
      );
      const newSegments = pendingElder.slice(0, maximumNewSegments);
      const cumulativeUsefulCharacters = countUsefulCharacters(
        newSegments.map((segment) => segment.correctedText ?? segment.originalText),
      );
      const source: SelectedNewSource = {
        actorId: session.createdBy,
        cumulativeUsefulCharacters,
        newSegments,
        projectId: session.projectId,
        sessionId,
      };
      const oldest = newSegments[0];
      if (oldest === undefined) return { batch: null, source };
      const useful = cumulativeUsefulCharacters >= this.config.minimumUsefulCharacters;
      if (!useful) return { batch: null, source };
      const triggerKind = decideMemoryMaintainerTrigger({
        batchReached: newSegments.length >= this.config.batchThreshold,
        finalFlush,
        minimumUseful: useful,
        timeReached:
          this.clock.now().getTime() - oldest.createdAt.getTime() >= this.config.timeThresholdMs,
      });
      if (triggerKind === null) return { batch: null, source };
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
      const triggerIdentity = `${TRIGGER_NAMESPACE}:${sessionId}:${sha256(canonicalJson(identityManifest)).slice(0, 40)}`;
      return {
        batch: {
          actorId: session.createdBy,
          cumulativeUsefulCharacters,
          newSegments,
          overlapSegments,
          projectId: session.projectId,
          sessionId,
          triggerIdentity,
          triggerKind,
        },
        source,
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
        const triggerObservation = memoryTriggerObservation(
          frozen,
          batch,
          triggerIdentity,
          this.config.minimumUsefulCharacters,
        );
        const activeThread = await tx.memoryThreadRevision.findFirst({
          select: { threadId: true },
          where: { sourceSessionId: batch.sessionId, status: 'active', supersededAt: null },
        });
        await this.traces.beginInTransaction(
          tx,
          memoryDecisionTraceInput(frozen, batch.sessionId, triggerObservation, {
            activeThreadId: activeThread?.threadId ?? null,
            decisionOutcome: 'continue_listening',
            stage: 'prepare',
          }),
        );
      },
    });
    if (job.replayed) return;
    const triggerObservation = memoryTriggerObservation(
      job,
      batch,
      triggerIdentity,
      this.config.minimumUsefulCharacters,
    );
    const trace = await this.prisma.decisionTrace.findFirstOrThrow({
      select: { id: true },
      where: { aiJobId: job.id },
    });
    await this.failpoint.hit('after_freeze');
    const context = await this.buildContext(job, batch, triggerObservation);
    const validatedContext = this.validator.validateContext(context);
    await this.traces.attachReferences(trace.id, {
      contextDigest: sha256(canonicalJson(validatedContext)),
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
    batch: SelectedBatch,
    triggerObservation: DecisionTraceMemoryTriggerObservationInput,
  ): Promise<MemoryMaintainerContextV12> {
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
      context_schema_version: 'memory-maintainer-context-v1.2',
      trigger: {
        cumulative_useful_characters: triggerObservation.cumulativeUsefulCharacters,
        identity: triggerObservation.triggerIdentity,
        kind: triggerObservation.triggerKind,
        minimum_useful_characters: triggerObservation.minimumUsefulCharacters,
        selected_new_segment_count: triggerObservation.selectedNewSegmentCount,
      },
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
          memory_tag: resolution.memoryType,
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
    context: MemoryMaintainerContextV12,
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
    context: MemoryMaintainerContextV12,
    output: MemoryMaintainerOutputV12,
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
      const gateAuthority = await this.readGateRuntimeAuthority(tx, job);
      this.assertGateForOperations(job, context, output.operations, gateAuthority);
      this.assertGateForBoundaries(output, gateAuthority);
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
    context: MemoryMaintainerContextV12,
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
    context: MemoryMaintainerContextV12,
    operations: readonly MemoryMaintainerOperationV12[],
  ): Promise<void> {
    const inputBySegment = new Map(job.segments.map((segment) => [segment.segmentId, segment]));
    const touchedTargets = new Set<string>();
    const semanticSlots = new Set<string>();
    for (const operation of operations) {
      if (operation.kind === 'DUPLICATE') continue;
      const state = operation.proposed_state;
      if (state === null) throw new Error('MEMORY_PROPOSED_STATE_REQUIRED');
      const slot = `${state.semantic_kind}:${state.canonical_key}`;
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
      const priorMemberIds =
        target === null
          ? []
          : (
              await tx.memoryResolutionMember.findMany({
                orderBy: { memberOrder: 'asc' },
                where: { memoryResolutionId: target.id },
              })
            ).map(({ memoryClaimId }) => memoryClaimId);
      const claimIds: string[] = state.semantic_status === 'disputed' ? [] : [...priorMemberIds];
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
      if (target !== null) {
        const superseded = await tx.memoryResolution.updateMany({
          data: { status: 'superseded' },
          where: {
            id: target.id,
            resolutionRevision: target.resolutionRevision,
            status: 'current',
          },
        });
        if (superseded.count !== 1) throw new Error('MEMORY_TARGET_CAS_FAILED');
      }
      await tx.memoryResolution.create({
        data: {
          aiDerivedOutputId: derivedId,
          aiJobId: job.id,
          authority: 'automatic',
          canonicalKey: state.canonical_key,
          id: resolutionId,
          layer: 'working',
          memoryType: state.memory_tag ?? null,
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

  private assertGateForOperations(
    job: FrozenAiJob,
    context: MemoryMaintainerContextV12,
    operations: readonly MemoryMaintainerOperationV12[],
    authority: MemoryGateRuntimeAuthority,
  ): void {
    const inputBySegment = new Map(job.segments.map((segment) => [segment.segmentId, segment]));
    for (const operation of operations) {
      if (operation.kind === 'DUPLICATE') continue;
      const state = operation.proposed_state;
      if (state === null) throw new Error('MEMORY_PROPOSED_STATE_REQUIRED');
      if (operation.target_resolution_id !== null) {
        const target = context.current_working_memory.find(
          ({ resolution_id }) => resolution_id === operation.target_resolution_id,
        );
        if (
          target === undefined ||
          target.canonical_key !== state.canonical_key ||
          target.semantic_kind !== state.semantic_kind ||
          target.thread_id !== operation.anchor_thread_id ||
          target.revision !== operation.expected_resolution_revision
        )
          throw new Error('MEMORY_TARGET_CAS_FAILED');
      }
      const evidence = operation.evidence_segment_ids.map((segmentId) => {
        const reference = authority.evidenceBySegmentId.get(segmentId);
        if (reference === undefined) throw new Error('MEMORY_GATE_EVIDENCE_AUTHORITY_UNAVAILABLE');
        return reference;
      });
      const targetMemory =
        operation.target_resolution_id === null
          ? null
          : context.current_working_memory.find(
              ({ resolution_id }) => resolution_id === operation.target_resolution_id,
            );
      const candidate: MemoryGateCandidate = {
        candidateId: operation.operation_id,
        proposalSource: 'llm_proposal',
        candidateKind: state.semantic_kind,
        operation:
          operation.target_resolution_id === null
            ? 'create'
            : state.semantic_status === 'uncertain'
              ? 'mark_uncertain'
              : state.semantic_status === 'disputed'
                ? 'mark_disputed'
                : 'correct',
        target:
          targetMemory === undefined || targetMemory === null
            ? null
            : {
                authorityId: targetMemory.resolution_id,
                revisionId: targetMemory.resolution_id,
                revisionNo: targetMemory.revision,
                resolutionStatus: targetMemory.resolution_status,
                semanticStatus: targetMemory.semantic_status,
                semanticKind: targetMemory.semantic_kind,
                targetType: 'memory_resolution',
              },
        expectedRevision: operation.expected_resolution_revision,
        proposedState: this.gateSemanticState(state, inputBySegment, authority),
        evidence,
        evidenceManifestDigest: authority.snapshot.evidenceManifestDigest,
      };
      this.gate.assertWritable(candidate, authority.snapshot);
    }
  }

  private assertGateForBoundaries(
    output: MemoryMaintainerOutputV12,
    authority: MemoryGateRuntimeAuthority,
  ): void {
    for (const boundary of output.boundary_candidates) {
      const evidence = boundary.evidence_segment_ids.map((segmentId) => {
        const reference = authority.evidenceBySegmentId.get(segmentId);
        if (reference === undefined) throw new Error('MEMORY_GATE_EVIDENCE_AUTHORITY_UNAVAILABLE');
        return reference;
      });
      const candidate: MemoryGateCandidate = {
        candidateId: boundary.candidate_id,
        proposalSource: 'llm_proposal',
        candidateKind: 'boundary',
        operation: 'activate',
        target: null,
        expectedRevision: null,
        proposedState: {
          abstractScope: boundary.abstract_scope,
          code: 'elder_explicit_boundary',
          reviewRequired: false,
          status: 'active',
        },
        evidence,
        evidenceManifestDigest: authority.snapshot.evidenceManifestDigest,
      };
      this.gate.assertWritable(candidate, authority.snapshot);
    }
  }

  private gateSemanticState(
    state: NonNullable<MemoryMaintainerOperationV12['proposed_state']>,
    inputBySegment: ReadonlyMap<string, FrozenAiJob['segments'][number]>,
    authority: MemoryGateRuntimeAuthority,
  ): MemoryGateSemanticState {
    return {
      canonicalKey: state.canonical_key,
      claims: state.claims.map((claim) => ({
        claimId: claim.claim_id,
        claimKey: claim.claim_key,
        evidenceIds: claim.evidence_segment_ids.map((segmentId) => {
          const segment = inputBySegment.get(segmentId);
          if (segment === undefined) throw new Error('MEMORY_GATE_EVIDENCE_OUTSIDE_INPUT');
          const evidence = authority.evidenceBySegmentId.get(segmentId);
          if (evidence === undefined) throw new Error('MEMORY_GATE_EVIDENCE_AUTHORITY_UNAVAILABLE');
          return evidence.evidenceId;
        }),
      })),
      resolutionKind: state.resolution_kind,
      reviewRequired: state.semantic_status !== 'current',
      semanticKind: state.semantic_kind,
      semanticStatus: state.semantic_status,
      value: state.semantic_status === 'disputed' ? null : state.value,
      valueKind: state.semantic_status === 'disputed' ? null : state.value_kind,
    };
  }

  private async readGateRuntimeAuthority(
    tx: Prisma.TransactionClient,
    job: FrozenAiJob,
  ): Promise<MemoryGateRuntimeAuthority> {
    const [storedJob, project, consent, assignment, scopes, inputs] = await Promise.all([
      tx.aiJob.findUnique({ where: { id: job.id } }),
      tx.elderProject.findUnique({ where: { id: job.projectId } }),
      tx.consentRecord.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: { consentType: 'recording_transcription_ai', projectId: job.projectId },
      }),
      tx.projectAssignment.findFirst({
        where: { projectId: job.projectId, revokedAt: null, userId: job.requestedBy },
      }),
      tx.aiJobSessionScope.findMany({ orderBy: { inputOrder: 'asc' }, where: { aiJobId: job.id } }),
      tx.aiJobInputSegment.findMany({ orderBy: { inputOrder: 'asc' }, where: { aiJobId: job.id } }),
    ]);
    const policyAuthorized =
      storedJob !== null &&
      project !== null &&
      storedJob.projectId === job.projectId &&
      storedJob.inputHash === job.inputHash &&
      storedJob.policyRevision === job.policyRevision &&
      storedJob.retentionPolicyVersion === job.retentionPolicyVersion &&
      storedJob.requestedBy === job.requestedBy &&
      project.aiPolicyRevision === storedJob.policyRevision &&
      project.aiRetentionPolicyVersion === storedJob.retentionPolicyVersion &&
      project.deletedAt === null &&
      !['restricted', 'deleted'].includes(project.status) &&
      assignment !== null &&
      consent?.status === 'valid' &&
      consent.revokedAt === null;
    const retentionEligible =
      storedJob !== null &&
      storedJob.retentionState === 'active' &&
      storedJob.expiresAt > new Date();
    if (
      storedJob === null ||
      project === null ||
      storedJob.projectId !== job.projectId ||
      storedJob.inputHash !== job.inputHash ||
      storedJob.policyRevision !== job.policyRevision ||
      storedJob.retentionPolicyVersion !== job.retentionPolicyVersion ||
      storedJob.requestedBy !== job.requestedBy ||
      project.aiPolicyRevision !== storedJob.policyRevision ||
      project.aiRetentionPolicyVersion !== storedJob.retentionPolicyVersion ||
      !policyAuthorized ||
      scopes.map(({ sessionId }) => sessionId).join('|') !== job.sessionIds.join('|')
    )
      throw new Error('MEMORY_GATE_AUTHORITY_SNAPSHOT_UNAVAILABLE');

    const inputById = new Map(inputs.map((input) => [input.id, input]));
    const transcriptIds = inputs.map(({ transcriptSegmentId }) => transcriptSegmentId);
    const transcripts = await tx.transcriptSegment.findMany({
      where: { id: { in: transcriptIds } },
    });
    const transcriptById = new Map(transcripts.map((segment) => [segment.id, segment]));
    const authorityRows = await tx.memoryEvidenceAuthority.findMany({
      where: {
        projectId: job.projectId,
        sourceId: { in: transcriptIds },
        sourceKind: 'transcript_segment',
      },
    });
    const authorityBySourceId = new Map<string, (typeof authorityRows)[number]>();
    for (const row of authorityRows) {
      const current = authorityBySourceId.get(row.sourceId);
      if (current === undefined || row.authorityRevision > current.authorityRevision)
        authorityBySourceId.set(row.sourceId, row);
    }
    const evidenceBySegmentId = new Map<string, MemoryGateEvidenceReference>();
    for (const frozen of job.segments) {
      const input = inputById.get(frozen.inputSegmentId);
      const transcript =
        input === undefined ? undefined : transcriptById.get(input.transcriptSegmentId);
      if (
        input === undefined ||
        transcript === undefined ||
        input.sessionId !== frozen.sessionId ||
        input.transcriptSegmentId !== frozen.segmentId ||
        input.textRevision !== frozen.textRevision ||
        input.speakerRoleRevision !== frozen.speakerRoleRevision ||
        input.effectiveTextDigest !== frozen.effectiveTextDigest ||
        input.trustedEffectiveRole !== frozen.trustedRole ||
        input.contentKind !== 'conversation' ||
        transcript.textRevision !== input.textRevision ||
        transcript.speakerRoleRevision !== input.speakerRoleRevision ||
        projectTrustedSpeakerRole(transcript).trustedEffectiveSpeakerRole !==
          input.trustedEffectiveRole ||
        effectiveTextDigest(transcript.correctedText ?? transcript.originalText) !==
          input.effectiveTextDigest
      )
        throw new Error('MEMORY_GATE_STALE_EVIDENCE');
      const authorityRow = authorityBySourceId.get(frozen.segmentId);
      if (
        authorityRow !== undefined &&
        (authorityRow.projectId !== job.projectId ||
          authorityRow.sessionId !== frozen.sessionId ||
          authorityRow.authorityRevision < 1 ||
          authorityRow.sourceKind !== 'transcript_segment' ||
          authorityRow.transcriptTextRevision !== input.textRevision ||
          authorityRow.speakerRoleRevision !== input.speakerRoleRevision ||
          authorityRow.effectiveTextDigest !== input.effectiveTextDigest)
      )
        throw new Error('MEMORY_GATE_STALE_EVIDENCE');
      const evidenceId = authorityRow?.evidenceId ?? frozen.inputSegmentId;
      evidenceBySegmentId.set(frozen.segmentId, {
        authorityRevision: authorityRow?.authorityRevision ?? 1,
        contentKind: 'conversation_final',
        effectiveTextDigest: input.effectiveTextDigest,
        evidenceId,
        evidenceRole: classifyMemoryGateEvidenceRole(
          input.trustedEffectiveRole,
          transcript.correctedText ?? transcript.originalText,
        ),
        eligibility: memoryGateEligibility(policyAuthorized, retentionEligible),
        projectId: job.projectId,
        sessionId: input.sessionId,
        sourceId: input.transcriptSegmentId,
        sourceKind: 'transcript_segment',
        speakerRoleRevision: input.speakerRoleRevision,
        textRevision: input.textRevision,
        trustedRole: input.trustedEffectiveRole,
      });
    }
    return {
      evidenceBySegmentId,
      snapshot: {
        authorityContract: 'memory-claim-resolution-v1',
        currentSessionId: job.sessionIds[0] ?? '',
        deletionScopeDigest: storedJob.inputHash,
        evidenceManifestDigest: storedJob.inputHash,
        policyRevision: String(storedJob.policyRevision),
        projectId: storedJob.projectId,
        snapshotRevision: 1,
        sourceSessionIds: job.sessionIds,
      },
    };
  }

  private async resolveThread(
    tx: Prisma.TransactionClient,
    job: FrozenAiJob,
    sessionId: string,
    operation: MemoryMaintainerOperationV12,
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
    state: NonNullable<MemoryMaintainerOperationV12['proposed_state']>,
    claim: NonNullable<MemoryMaintainerOperationV12['proposed_state']>['claims'][number],
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
        memoryType: state.memory_tag ?? null,
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
    output: MemoryMaintainerOutputV12,
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

function memoryTriggerSegmentObservation(
  segment: Pick<
    TranscriptSegment,
    'id' | 'textRevision' | 'speakerRoleRevision' | 'correctedText' | 'originalText'
  >,
  inputOrder: number,
): DecisionTraceMemoryTriggerObservationInput['selectedNewMemberships'][number] {
  const text = segment.correctedText ?? segment.originalText;
  return {
    effectiveTextDigest: effectiveTextDigest(text),
    inputOrder,
    speakerRoleRevision: segment.speakerRoleRevision,
    textRevision: segment.textRevision,
    transcriptSegmentId: segment.id,
    usefulCharacterCount: countDecisionTraceUsefulCharacters(text),
  };
}

function memoryTriggerObservation(
  job: FrozenAiJob,
  batch: SelectedBatch,
  triggerIdentity: string,
  minimumUsefulCharacters: number,
): DecisionTraceMemoryTriggerObservationInput {
  const frozenById = new Map(job.segments.map((segment) => [segment.segmentId, segment]));
  const selectedNewMemberships = batch.newSegments.map((selected, inputOrder) => {
    const segment = frozenById.get(selected.id);
    if (
      segment === undefined ||
      segment.textRevision === undefined ||
      segment.speakerRoleRevision === undefined ||
      segment.effectiveTextDigest === undefined ||
      segment.trustedRole !== 'elder'
    ) {
      throw new Error('MEMORY_TRIGGER_OBSERVATION_SOURCE_MISSING');
    }
    return {
      effectiveTextDigest: segment.effectiveTextDigest,
      inputOrder,
      speakerRoleRevision: segment.speakerRoleRevision,
      textRevision: segment.textRevision,
      transcriptSegmentId: segment.segmentId,
      usefulCharacterCount: countDecisionTraceUsefulCharacters(segment.text),
    };
  });
  return {
    aiJobId: job.id,
    cumulativeUsefulCharacters: selectedNewMemberships.reduce(
      (total, membership) => total + membership.usefulCharacterCount,
      0,
    ),
    minimumUsefulCharacters,
    selectedNewMemberships,
    selectedNewSegmentCount: selectedNewMemberships.length,
    triggerIdentity,
    triggerKind: batch.triggerKind,
  };
}

function memoryDecisionTraceInput(
  job: FrozenAiJob,
  sessionId: string,
  observation: DecisionTraceMemoryTriggerObservationInput,
  options: {
    activeThreadId?: string | null;
    decisionOutcome: 'continue_listening' | 'unavailable';
    gateReason?: string | null;
    stage: string;
  },
): DecisionTraceInput {
  const frozenById = new Map(job.segments.map((segment) => [segment.segmentId, segment]));
  const transcriptMemberships =
    job.segments.length > 0
      ? job.segments.map((segment, inputOrder) => {
          if (
            segment.effectiveTextDigest === undefined ||
            segment.speakerRoleRevision === undefined ||
            segment.textRevision === undefined
          ) {
            throw new Error('MEMORY_FROZEN_REVISION_REQUIRED');
          }
          return {
            effectiveTextDigest: segment.effectiveTextDigest,
            inputOrder,
            segmentId: segment.segmentId,
            speakerRoleRevision: segment.speakerRoleRevision,
            textRevision: segment.textRevision,
          };
        })
      : observation.selectedNewMemberships.map((membership) => {
          const frozen = frozenById.get(membership.transcriptSegmentId);
          return {
            effectiveTextDigest: membership.effectiveTextDigest,
            inputOrder: membership.inputOrder,
            segmentId: membership.transcriptSegmentId,
            speakerRoleRevision: frozen?.speakerRoleRevision ?? membership.speakerRoleRevision,
            textRevision: frozen?.textRevision ?? membership.textRevision,
          };
        });
  return {
    activeThreadId: options.activeThreadId ?? null,
    aiJobId: job.id,
    contextDigest: null,
    contextRevision: options.stage === 'final_flush_gate' ? 0 : 1,
    decisionOutcome: options.decisionOutcome,
    directorInvoked: false,
    gateReason: options.gateReason ?? null,
    generationId: stableUuid(`memory-generation:${job.id}`),
    inputHash: job.inputHash,
    memoryTriggerObservation: observation,
    ownerActorId: job.requestedBy,
    projectId: job.projectId,
    requestId: stableUuid(`memory-trace:${job.id}`),
    sessionId,
    stage: options.stage,
    transcriptMemberships,
    triggerType: 'working_memory_maintain',
    workingRevision: null,
  };
}

function memoryTraceTerminalProjection(
  job: Pick<AiJob, 'failureCode' | 'status'>,
  provenanceError: string | null = null,
): {
  decisionOutcome: 'continue_listening' | 'system_error' | 'unavailable';
  errorCode: string | null;
  status: 'cancelled' | 'failed' | 'succeeded' | 'unavailable';
} {
  if (job.status === 'succeeded') {
    return { decisionOutcome: 'continue_listening', errorCode: null, status: 'succeeded' };
  }
  if (job.status === 'cancelled' && job.failureCode === 'MEMORY_UNJUDGED') {
    return {
      decisionOutcome: 'unavailable',
      errorCode: provenanceError ?? 'MEMORY_UNJUDGED',
      status: 'unavailable',
    };
  }
  if (job.status === 'cancelled') {
    return {
      decisionOutcome: 'unavailable',
      errorCode: provenanceError ?? job.failureCode,
      status: 'cancelled',
    };
  }
  return {
    decisionOutcome: 'system_error',
    errorCode: provenanceError ?? job.failureCode ?? 'SYSTEM_COORDINATOR_RESTARTED',
    status: 'failed',
  };
}

export function countUsefulCharacters(values: readonly string[]): number {
  return values.reduce(
    (total, value) => total + countMemoryMaintainerUsefulCharactersV12(value),
    0,
  );
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
