import type { ApiConfig } from '@elder-interview/config';
import type {
  PostSessionAnalysisLaneProjection,
  PostSessionAnalysisProjection,
  SecondSessionOpeningProjection,
} from '@elder-interview/contracts';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';
import { AiJobCoordinatorService } from '../ai-runtime/ai-job-coordinator.service.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AiJob, InterviewSession } from '../generated/prisma/client.js';
import { InterviewContextService } from '../memory/interview-context.service.js';
import { MemoryService } from '../memory/memory.service.js';
import { QuestionEvidenceService } from '../question-evidence/question-evidence.service.js';
import { QuestionOrchestrationService } from '../question-orchestration/question-orchestration.service.js';
import { projectTrustedSpeakerRole } from '../transcription/trusted-speaker-role.js';
import { ConsentContinuationPolicyReader } from './consent-continuation.policy.js';
import {
  calibrationAttemptGateIdentity,
  calibrationUnavailableGateIdentity,
  openingContextRequestId,
  openingContextTriggerKey,
  openingRequestId,
  openingTriggerKey,
  postSessionLaneRequestId,
  postSessionLaneTriggerKey,
  postSessionTriggerIdentity,
  secondSessionOpeningIdentity,
  type PostSessionLane,
} from './post-session-coordination.identity.js';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const RECONCILE_INTERVAL_MS = 5_000;
const ORPHAN_GRACE_MS = 30_000;
const TERMINAL_JOB_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

interface BasisFact {
  completedAt: Date;
  createdBy: string;
  id: string;
  projectId: string;
  sequenceNo: number;
}

interface AnalysisFacts {
  actual: LaneFact;
  memory: LaneFact;
  root: string;
}

interface LaneFact {
  job: AiJob | null;
  projection: PostSessionAnalysisLaneProjection;
}

interface CalibrationGate {
  confirmed: boolean;
  identity: string;
  updatedAt: Date;
}

@Injectable()
export class PostSessionCoordinationService implements OnModuleInit, OnModuleDestroy {
  private readonly active = new Map<string, Promise<void>>();
  private timer: ReturnType<typeof setInterval> | null = null;

  public constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: AiJobCoordinatorService,
    private readonly memories: MemoryService,
    private readonly questions: QuestionEvidenceService,
    private readonly contexts: InterviewContextService,
    private readonly openings: QuestionOrchestrationService,
    private readonly consentContinuation: ConsentContinuationPolicyReader,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  public onModuleInit(): void {
    queueMicrotask(() => {
      this.enqueue('startup', () => this.reconcileAll());
    });
    this.timer = setInterval(() => {
      this.enqueue('periodic', () => this.reconcileAll());
    }, RECONCILE_INTERVAL_MS);
    this.timer.unref();
  }

  public onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  public notifyFinalization(finalizationId: string): void {
    this.enqueue(`finalization:${finalizationId}`, async () => {
      const finalization = await this.prisma.sessionFinalization.findUnique({
        select: { sessionId: true },
        where: { id: finalizationId },
      });
      if (finalization !== null) await this.reconcileCompleted(finalization.sessionId);
    });
  }

  public notifyCalibration(sessionId: string): void {
    this.enqueue(`consumer:${sessionId}`, () => this.reconcileConsumer(sessionId));
  }

  public async project(session: InterviewSession): Promise<{
    postSessionAnalysis: PostSessionAnalysisProjection | null;
    secondSessionOpening: SecondSessionOpeningProjection | null;
  }> {
    const postSessionAnalysis =
      session.status === 'completed' ? await this.projectCompleted(session.id) : null;
    const secondSessionOpening =
      session.sequenceNo >= 2 ? await this.projectOpening(session) : null;
    return { postSessionAnalysis, secondSessionOpening };
  }

  private enqueue(key: string, work: () => Promise<void>): void {
    void this.execute(key, work);
  }

  private execute(key: string, work: () => Promise<void>): Promise<void> {
    const existing = this.active.get(key);
    if (existing !== undefined) return existing;
    const running = work().catch(() => undefined);
    this.active.set(key, running);
    void running.finally(() => {
      if (this.active.get(key) === running) this.active.delete(key);
    });
    return running;
  }

  private async reconcileAll(): Promise<void> {
    const [completed, consumers] = await Promise.all([
      this.prisma.interviewSession.findMany({
        select: { id: true },
        where: { status: 'completed' },
      }),
      this.prisma.interviewSession.findMany({
        select: { id: true },
        where: { sequenceNo: { gte: 2 }, status: { notIn: ['failed'] } },
      }),
    ]);
    for (const session of completed) {
      this.enqueue(`completed:${session.id}`, () => this.reconcileCompleted(session.id));
    }
    for (const session of consumers) {
      this.enqueue(`consumer:${session.id}`, () => this.reconcileConsumer(session.id));
    }
  }

  private async reconcileCompleted(sessionId: string): Promise<void> {
    const basis = await this.basisFact(sessionId);
    if (basis === null) return;
    const root = postSessionTriggerIdentity(basis.id, basis.completedAt);
    await Promise.all([
      this.execute(`lane:${postSessionLaneTriggerKey(root, 'memory_extract')}`, () =>
        this.runLane(basis, root, 'memory_extract'),
      ),
      this.execute(`lane:${postSessionLaneTriggerKey(root, 'actual_question_reconcile')}`, () =>
        this.runLane(basis, root, 'actual_question_reconcile'),
      ),
    ]);
    const consumers = await this.prisma.interviewSession.findMany({
      select: { id: true },
      where: { projectId: basis.projectId, sequenceNo: basis.sequenceNo + 1 },
    });
    for (const consumer of consumers) {
      await this.execute(`consumer:${consumer.id}`, () => this.reconcileConsumer(consumer.id));
    }
  }

  private async runLane(basis: BasisFact, root: string, lane: PostSessionLane): Promise<void> {
    const triggerDedupeKey = postSessionLaneTriggerKey(root, lane);
    const existing = await this.prisma.aiJob.findFirst({ where: { triggerDedupeKey } });
    if (existing !== null) {
      const lastProgressAt = existing.startedAt ?? existing.createdAt;
      if (
        !TERMINAL_JOB_STATUSES.has(existing.status) &&
        Date.now() - lastProgressAt.getTime() >= ORPHAN_GRACE_MS
      ) {
        await this.jobs.failOrphanedSystemJob(existing.id);
      }
      return;
    }
    const requestId = postSessionLaneRequestId(root, lane);
    const expiresAt = new Date(basis.completedAt.getTime() + RETENTION_MS);
    try {
      if (lane === 'memory_extract') {
        const judgeable = await this.memoryJudgeable(basis.id);
        await this.memories.extract({
          actorId: basis.createdBy,
          expiresAt,
          judgeable,
          projectId: basis.projectId,
          requestId,
          sessionIds: [basis.id],
          triggerDedupeKey,
        });
      } else {
        await this.questions.reconcileActualQuestions({
          actorId: basis.createdBy,
          expiresAt,
          projectId: basis.projectId,
          requestId,
          sessionId: basis.id,
          triggerDedupeKey,
        });
      }
    } catch (error) {
      const persisted = await this.prisma.aiJob.findFirst({ where: { triggerDedupeKey } });
      if (persisted === null) {
        await this.jobs.recordRejectedSystemJob(
          {
            actorId: basis.createdBy,
            expiresAt,
            jobType: lane,
            projectId: basis.projectId,
            requestId,
            sessionIds: [basis.id],
            triggerDedupeKey,
            trustedRole: lane === 'memory_extract' ? 'elder' : 'interviewer',
          },
          stableErrorCode(error),
        );
      }
    }
  }

  private async reconcileConsumer(sessionId: string): Promise<void> {
    const consumer = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (consumer === null || consumer.sequenceNo < 2 || consumer.status === 'failed') return;
    const basisSession = await this.prisma.interviewSession.findFirst({
      include: { finalization: true },
      where: { projectId: consumer.projectId, sequenceNo: consumer.sequenceNo - 1 },
    });
    const completedAt = basisSession?.finalization?.completedAt;
    if (basisSession === null || basisSession.status !== 'completed' || completedAt == null) return;
    const gate = await this.calibrationGate(consumer);
    if (gate === null) return;
    const basis: BasisFact = {
      completedAt,
      createdBy: basisSession.createdBy,
      id: basisSession.id,
      projectId: basisSession.projectId,
      sequenceNo: basisSession.sequenceNo,
    };
    const analysis = await this.analysisFacts(basis);
    if (!laneTerminal(analysis.memory) || !laneTerminal(analysis.actual)) return;
    const identity = secondSessionOpeningIdentity({
      basisAnalysisTriggerIdentity: analysis.root,
      calibrationGateIdentity: gate.identity,
      consumerSessionId: consumer.id,
    });
    const requestId = openingRequestId(identity);
    const existing = await this.prisma.questionGenerationAttempt.findUnique({
      where: { requestId },
    });
    if (existing !== null) return;

    const consent = await this.prisma.consentRecord.findFirst({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: { consentType: 'recording_transcription_ai', projectId: consumer.projectId },
    });
    const continuation = await this.consentContinuation.evaluate(
      consent === null
        ? null
        : {
            id: consent.id,
            revokedAt: consent.revokedAt,
            status: consent.status,
            textVersion: consent.consentTextVersion,
          },
    );
    if (continuation.status !== 'covered') {
      await this.recordOpeningUnavailable(
        basis,
        consumer,
        gate,
        identity,
        `CONSENT_CONTINUATION_${continuation.status.toUpperCase()}`,
      );
      return;
    }

    const scopeSessionIds = gate.confirmed ? [basis.id, consumer.id] : [basis.id];
    const expiresAt = new Date(Date.now() + RETENTION_MS);
    try {
      await this.contexts.create({
        actorId: consumer.createdBy,
        contextBuilderVersion: `dev-008b2.v1:m=${analysis.memory.projection.status}:a=${analysis.actual.projection.status}`,
        consumerSessionId: consumer.id,
        expiresAt,
        projectId: consumer.projectId,
        requestId: openingContextRequestId(identity),
        scopeSessionIds,
        triggerDedupeKey: openingContextTriggerKey(identity),
        trustedRoles: ['elder', 'interviewer'],
      });
      await this.openings.requestSecondSessionOpening({
        actorId: consumer.createdBy,
        basisSessionId: basis.id,
        calibrationConfirmed: gate.confirmed,
        consumerSessionId: consumer.id,
        requestId,
        triggerDedupeKey: openingTriggerKey(identity),
      });
    } catch (error) {
      const attempt = await this.prisma.questionGenerationAttempt.findUnique({
        where: { requestId },
      });
      if (attempt === null) {
        await this.recordOpeningUnavailable(
          basis,
          consumer,
          gate,
          identity,
          stableErrorCode(error),
        ).catch(() => undefined);
      }
    }
  }

  private async recordOpeningUnavailable(
    basis: BasisFact,
    consumer: InterviewSession,
    gate: CalibrationGate,
    identity: string,
    errorCode: string,
  ): Promise<void> {
    await this.openings.recordSecondSessionOpeningUnavailable({
      actorId: consumer.createdBy,
      basisSessionId: basis.id,
      calibrationConfirmed: gate.confirmed,
      consumerSessionId: consumer.id,
      errorCode,
      projectId: consumer.projectId,
      requestId: openingRequestId(identity),
      triggerDedupeKey: openingTriggerKey(identity),
    });
  }

  private async projectCompleted(sessionId: string): Promise<PostSessionAnalysisProjection | null> {
    const basis = await this.basisFact(sessionId);
    if (basis === null) return null;
    const analysis = await this.analysisFacts(basis);
    return {
      actual_question_reconcile: analysis.actual.projection,
      memory_extract: analysis.memory.projection,
      trigger_identity: analysis.root,
    };
  }

  private async projectOpening(
    consumer: InterviewSession,
  ): Promise<SecondSessionOpeningProjection | null> {
    const basisSession = await this.prisma.interviewSession.findFirst({
      include: { finalization: true },
      where: { projectId: consumer.projectId, sequenceNo: consumer.sequenceNo - 1 },
    });
    const completedAt = basisSession?.finalization?.completedAt;
    if (basisSession === null || completedAt == null) return null;
    const basis: BasisFact = {
      completedAt,
      createdBy: basisSession.createdBy,
      id: basisSession.id,
      projectId: basisSession.projectId,
      sequenceNo: basisSession.sequenceNo,
    };
    const analysis = await this.analysisFacts(basis);
    const gate = await this.calibrationGate(consumer);
    if (gate === null) {
      return {
        attempt_id: null,
        basis_analysis_trigger_identity: analysis.root,
        basis_session_id: basis.id,
        calibration_gate_identity: null,
        error_code: null,
        request_id: null,
        status: 'waiting_calibration',
        updated_at: consumer.updatedAt.toISOString(),
      };
    }
    if (!laneTerminal(analysis.memory) || !laneTerminal(analysis.actual)) {
      return {
        attempt_id: null,
        basis_analysis_trigger_identity: analysis.root,
        basis_session_id: basis.id,
        calibration_gate_identity: gate.identity,
        error_code: null,
        request_id: null,
        status: 'waiting_basis_analysis',
        updated_at: latestDate([
          gate.updatedAt,
          laneUpdatedAt(analysis.memory),
          laneUpdatedAt(analysis.actual),
        ]).toISOString(),
      };
    }
    const identity = secondSessionOpeningIdentity({
      basisAnalysisTriggerIdentity: analysis.root,
      calibrationGateIdentity: gate.identity,
      consumerSessionId: consumer.id,
    });
    const requestId = openingRequestId(identity);
    const attempt = await this.prisma.questionGenerationAttempt.findUnique({
      where: { requestId },
    });
    if (attempt === null) {
      return {
        attempt_id: null,
        basis_analysis_trigger_identity: analysis.root,
        basis_session_id: basis.id,
        calibration_gate_identity: gate.identity,
        error_code: null,
        request_id: null,
        status: 'ready',
        updated_at: latestDate([
          gate.updatedAt,
          laneUpdatedAt(analysis.memory),
          laneUpdatedAt(analysis.actual),
        ]).toISOString(),
      };
    }
    const unavailable =
      attempt.resultKind === 'unavailable' || attempt.failureCode === 'AI_PROVIDER_UNAVAILABLE';
    const status: SecondSessionOpeningProjection['status'] =
      attempt.status === 'pending' || attempt.status === 'running'
        ? 'running'
        : attempt.status === 'succeeded'
          ? 'succeeded'
          : attempt.status === 'cancelled'
            ? 'cancelled'
            : unavailable
              ? 'unavailable'
              : 'failed';
    return {
      attempt_id: attempt.id,
      basis_analysis_trigger_identity: analysis.root,
      basis_session_id: basis.id,
      calibration_gate_identity: gate.identity,
      error_code: attempt.failureCode,
      request_id: attempt.requestId,
      status,
      updated_at: (attempt.completedAt ?? attempt.startedAt ?? attempt.createdAt).toISOString(),
    };
  }

  private async basisFact(sessionId: string): Promise<BasisFact | null> {
    const session = await this.prisma.interviewSession.findUnique({
      include: { finalization: true },
      where: { id: sessionId },
    });
    const completedAt = session?.finalization?.completedAt;
    if (session === null || session.status !== 'completed' || completedAt == null) return null;
    return {
      completedAt,
      createdBy: session.createdBy,
      id: session.id,
      projectId: session.projectId,
      sequenceNo: session.sequenceNo,
    };
  }

  private async analysisFacts(basis: BasisFact): Promise<AnalysisFacts> {
    const root = postSessionTriggerIdentity(basis.id, basis.completedAt);
    const memoryKey = postSessionLaneTriggerKey(root, 'memory_extract');
    const actualKey = postSessionLaneTriggerKey(root, 'actual_question_reconcile');
    const jobs = await this.prisma.aiJob.findMany({
      where: { triggerDedupeKey: { in: [memoryKey, actualKey] } },
    });
    const calls = await this.prisma.aiProviderCall.findMany({
      select: { aiJobId: true, errorCode: true },
      where: { aiJobId: { in: jobs.map(({ id }) => id) }, status: 'failed' },
    });
    const actualJob = jobs.find(({ triggerDedupeKey }) => triggerDedupeKey === actualKey) ?? null;
    const actualAnalysis =
      actualJob === null
        ? null
        : await this.prisma.actualQuestionAnalysis.findUnique({ where: { aiJobId: actualJob.id } });
    const unavailableJobIds = new Set(
      calls
        .filter(({ errorCode }) => errorCode === 'AI_PROVIDER_UNAVAILABLE')
        .map(({ aiJobId }) => aiJobId),
    );
    const memoryJob = jobs.find(({ triggerDedupeKey }) => triggerDedupeKey === memoryKey) ?? null;
    return {
      actual: laneFact(actualJob, unavailableJobIds, actualAnalysis?.judgeability === 'unjudged'),
      memory: laneFact(memoryJob, unavailableJobIds, memoryJob?.failureCode === 'MEMORY_UNJUDGED'),
      root,
    };
  }

  private async calibrationGate(session: InterviewSession): Promise<CalibrationGate | null> {
    const latest = await this.prisma.speakerCalibrationAttempt.findFirst({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: { sessionId: session.id },
    });
    if (latest !== null) {
      if (!['confirmed', 'failed', 'skipped'].includes(latest.status) || latest.resolvedAt === null)
        return null;
      const status = latest.status as 'confirmed' | 'failed' | 'skipped';
      return {
        confirmed: status === 'confirmed',
        identity: calibrationAttemptGateIdentity({
          attemptId: latest.id,
          speakerStreamId: latest.speakerStreamId,
          status,
        }),
        updatedAt: latest.resolvedAt,
      };
    }
    if (['local', 'test'].includes(this.config.appEnv)) return null;
    const capture = await this.prisma.sessionCaptureGeneration.findFirst({
      orderBy: [{ generationNo: 'desc' }, { id: 'desc' }],
      where: { sessionId: session.id },
    });
    if (capture === null) return null;
    return {
      confirmed: false,
      identity: calibrationUnavailableGateIdentity(capture.id),
      updatedAt: capture.updatedAt,
    };
  }

  private async memoryJudgeable(sessionId: string): Promise<boolean> {
    const [finalization, segments] = await Promise.all([
      this.prisma.sessionFinalization.findUnique({ where: { sessionId } }),
      this.prisma.transcriptSegment.findMany({
        where: { contentKind: 'conversation', sessionId },
      }),
    ]);
    return (
      finalization?.transcriptStatus === 'drained' &&
      segments.every(
        (segment) => projectTrustedSpeakerRole(segment).trustedEffectiveSpeakerRole !== 'unknown',
      )
    );
  }
}

function laneFact(
  job: AiJob | null,
  unavailableJobIds: ReadonlySet<string>,
  unjudged: boolean,
): LaneFact {
  if (job === null) {
    return {
      job: null,
      projection: {
        attempt_no: 0,
        error_code: null,
        job_id: null,
        request_id: null,
        retryable: false,
        status: 'not_started',
        updated_at: null,
      },
    };
  }
  const unavailable = unavailableJobIds.has(job.id);
  const status: PostSessionAnalysisLaneProjection['status'] =
    job.status === 'succeeded' && unjudged
      ? 'unjudged'
      : job.status === 'succeeded'
        ? 'succeeded'
        : job.status === 'cancelled'
          ? 'cancelled'
          : job.status === 'failed' && unavailable
            ? 'unavailable'
            : job.status;
  return {
    job,
    projection: {
      attempt_no: 1,
      error_code: unjudged ? null : job.failureCode,
      job_id: job.id,
      request_id: job.requestId,
      retryable: ['failed', 'cancelled', 'unavailable'].includes(status),
      status,
      updated_at: (job.completedAt ?? job.startedAt ?? job.createdAt).toISOString(),
    },
  };
}

function laneTerminal(fact: LaneFact): boolean {
  return ['succeeded', 'unjudged', 'failed', 'cancelled', 'unavailable'].includes(
    fact.projection.status,
  );
}

function laneUpdatedAt(fact: LaneFact): Date | null {
  const value = fact.projection.updated_at;
  return value === null ? null : new Date(value);
}

function latestDate(values: readonly (Date | null)[]): Date {
  return new Date(
    Math.max(...values.flatMap((value) => (value === null ? [] : [value.getTime()]))),
  );
}

function stableErrorCode(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message.slice(0, 80);
  return 'AI_TRIGGER_REJECTED';
}
