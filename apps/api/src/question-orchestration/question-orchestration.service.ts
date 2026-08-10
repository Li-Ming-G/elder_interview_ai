import { createHash } from 'node:crypto';

import type { ApiConfig } from '@elder-interview/config';
import type { SuggestionRequestAcceptedResponse } from '@elder-interview/contracts';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';
import {
  AiJobCoordinatorService,
  type FrozenAiJob,
} from '../ai-runtime/ai-job-coordinator.service.js';
import { manifestHash } from '../ai-runtime/ai-provenance.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  ActualAskedReader,
  QuestionEvidenceWriter,
} from '../question-evidence/question-evidence.service.js';
import {
  QUESTION_SIMILARITY_VERSION,
  QuestionSimilarityMatcher,
} from '../question-evidence/question-similarity.matcher.js';
import { QuestionPresentationService } from '../question-evidence/question-presentation.service.js';
import type { QuestionAttemptKind } from '../question-evidence/question-presentation.types.js';
import { CurrentMemoryReader, type CurrentMemoryItem } from '../memory/memory.service.js';
import { QuestionBankReader } from '../question-bank/question-bank.service.js';
import type {
  EligibleQuestionBankItem,
  QuestionConditionCode,
} from '../question-bank/question-bank.types.js';
import {
  JOURNEY_POLICY_VERSION,
  QuestionJourneyService,
  type FrozenJourneyContext,
  type JourneyInputSignal,
} from '../question-bank/question-journey.service.js';
import { RealtimeRuntimeService } from '../realtime-transcription/realtime-runtime.service.js';
import { QuestionDirector } from './question-director.js';

export const QUESTION_SELECTION_POLICY_VERSION = 'question-select-v1';
const DEBOUNCE_MS = 1_500;
const DEADLINE_MS = 8_000;

@Injectable()
export class QuestionOrchestrationService implements OnModuleInit, OnModuleDestroy {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly manualAdmissions = new Map<string, Promise<void>>();
  private unsubscribeFinal: (() => void) | null = null;

  public constructor(
    private readonly prisma: PrismaService,
    private readonly coordinator: AiJobCoordinatorService,
    private readonly memories: CurrentMemoryReader,
    private readonly actualAsked: ActualAskedReader,
    private readonly bank: QuestionBankReader,
    private readonly journey: QuestionJourneyService,
    private readonly matcher: QuestionSimilarityMatcher,
    private readonly director: QuestionDirector,
    private readonly writer: QuestionEvidenceWriter,
    private readonly presentations: QuestionPresentationService,
    private readonly realtime: RealtimeRuntimeService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  public onModuleInit(): void {
    this.unsubscribeFinal = this.realtime.onFinalized(({ segmentId, sessionId }) => {
      const existing = this.timers.get(sessionId);
      if (existing !== undefined) clearTimeout(existing);
      const timer = setTimeout(() => {
        this.timers.delete(sessionId);
        void this.runAutomatic(sessionId, segmentId).catch(() => undefined);
      }, DEBOUNCE_MS);
      this.timers.set(sessionId, timer);
    });
  }

  public onModuleDestroy(): void {
    this.unsubscribeFinal?.();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  public async requestManualNext(
    actor: AuthPrincipal,
    sessionId: string,
    input: {
      expectedPresentationRevision: number;
      expectedSnapshotId: string | null;
      requestId: string;
    },
  ): Promise<SuggestionRequestAcceptedResponse> {
    const prepared = await this.withManualAdmission(sessionId, async () => {
      await this.presentations.assertManualAvailability(actor.id, sessionId, input.requestId);
      return this.prepare(actor.id, sessionId, 'manual_next', input.requestId, {
        presentationRevision: input.expectedPresentationRevision,
        snapshotId: input.expectedSnapshotId,
      });
    });
    void Promise.race([
      this.complete(prepared),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error('AI_UNAVAILABLE'));
        }, DEADLINE_MS);
      }),
    ]).catch(async (error: unknown) => {
      await this.presentations.failAttempt(
        prepared.attemptId,
        error instanceof Error ? error.message.slice(0, 80) : 'AI_UNAVAILABLE',
      );
    });
    return {
      accepted_presentation_revision: prepared.basis.presentationRevision,
      attempt_id: prepared.attemptId,
      request_id: input.requestId,
      retry_after_ms: 0,
      status: 'running',
    };
  }

  private async withManualAdmission<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.manualAdmissions.get(sessionId);
    if (previous !== undefined) await previous.catch(() => undefined);
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.manualAdmissions.set(sessionId, current);
    try {
      return await work();
    } finally {
      release();
      if (this.manualAdmissions.get(sessionId) === current) this.manualAdmissions.delete(sessionId);
    }
  }

  private async runAutomatic(sessionId: string, segmentId: string): Promise<void> {
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (session === null || session.status !== 'recording') return;
    const requestId = stableUuid(`auto:${sessionId}:${segmentId}`);
    const context = await this.presentations.generationContext(sessionId);
    const prepared = await this.prepare(session.createdBy, sessionId, 'automatic', requestId, {
      presentationRevision: context.presentationRevision,
      snapshotId: context.currentSnapshotId,
    });
    await this.complete(prepared);
  }

  private async prepare(
    actorId: string,
    sessionId: string,
    attemptKind: QuestionAttemptKind,
    requestId: string,
    basis: { presentationRevision: number; snapshotId: string | null },
  ): Promise<PreparedQuestionAttempt> {
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (session === null) throw new Error('AI_SESSION_SCOPE_INVALID');
    const [memories, actualAsked, generation] = await Promise.all([
      this.memories.list(actorId, session.projectId),
      this.actualAsked.list(actorId, session.projectId),
      this.presentations.generationContext(sessionId),
    ]);
    const job = await this.coordinator.freeze({
      actorId,
      actualQuestionIds: actualAsked.map(({ id }) => id),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
      jobType: 'question_generate',
      memoryResolutionIds: memories.map(({ id }) => id),
      projectId: session.projectId,
      requestId,
      sessionIds: [sessionId],
      ...(attemptKind === 'automatic'
        ? { triggerDedupeKey: `question:${sessionId}:${requestId}` }
        : {}),
      trustedRole: 'elder',
    });
    if (job.replayed) {
      const attempt = await this.prisma.questionGenerationAttempt.findUnique({
        where: { aiJobId: job.id },
      });
      if (attempt === null) throw new Error(`AI_REQUEST_REPLAY_${job.status.toUpperCase()}`);
      return {
        actorId,
        actualAsked,
        attemptId: attempt.id,
        attemptKind,
        basis,
        eligible: [],
        job,
        journeyStage: attempt.journeyStage as 'rapport' | 'life_outline' | 'story_depth',
        memories,
        requestId,
      };
    }
    const journeyContext = await this.journeyContext(job, generation.journeyStage, memories);
    const decision = this.journey.evaluate(journeyContext, JOURNEY_POLICY_VERSION);
    const eligible = decision.publicationAllowed
      ? await this.bank.listEligible(decision.stage, journeyFacts(journeyContext.signals), {
          environmentScope: ['local', 'test'].includes(this.config.appEnv)
            ? 'internal_demo'
            : 'product',
          policyDecision: 'allowed',
        })
      : [];
    const receipt = await this.writer.beginGenerationAttempt(
      {
        attemptKind,
        basisPresentationRevision: basis.presentationRevision,
        basisSnapshotId: basis.snapshotId,
        job,
        journeyBasisHash: decision.basisHash,
        journeyPolicyVersion: decision.journeyPolicyVersion,
        journeyReasonCodes: decision.reasonCodes,
        journeyStage: decision.stage,
        selectionPolicyVersion: QUESTION_SELECTION_POLICY_VERSION,
        sessionId,
        similarityPolicyVersion: QUESTION_SIMILARITY_VERSION,
      },
      attemptKind === 'automatic'
        ? { kind: 'system', trigger: requestId }
        : { actorId, kind: 'actor' },
      requestId,
    );
    return {
      actorId,
      actualAsked,
      attemptId: receipt.attemptId,
      attemptKind,
      basis,
      eligible: decision.shouldContinueListening ? [] : eligible,
      job,
      journeyStage: decision.stage,
      memories,
      requestId,
    };
  }

  private async complete(prepared: PreparedQuestionAttempt): Promise<void> {
    if (prepared.job.replayed) return;
    const generation = await this.presentations.generationContext(prepared.job.sessionIds[0] ?? '');
    const excluded = [
      ...generation.recentQuestions,
      ...prepared.actualAsked.map(({ questionText }) => questionText),
    ];
    const eligible: EligibleQuestionBankItem[] = [];
    for (const item of prepared.eligible) {
      let duplicate = false;
      for (const prior of excluded) {
        if ((await this.matcher.score(item.questionText, prior)) >= 0.88) {
          duplicate = true;
          break;
        }
      }
      if (!duplicate) eligible.push(item);
    }
    const candidate = await this.coordinator.callProvider(prepared.job, () =>
      this.director.select({
        attemptKind: prepared.attemptKind,
        eligible,
        journeyStage: prepared.journeyStage,
        memories: prepared.memories,
      }),
    );
    await this.writer.publishAttemptResult(
      {
        attemptId: prepared.attemptId,
        candidate,
        job: prepared.job,
        resultKind: candidate === null ? 'continue_listening' : 'suggestion',
        sessionId: prepared.job.sessionIds[0] ?? '',
      },
      prepared.attemptKind === 'automatic'
        ? { kind: 'system', trigger: prepared.requestId }
        : { actorId: prepared.actorId, kind: 'actor' },
      prepared.requestId,
    );
  }

  private async journeyContext(
    job: FrozenAiJob,
    currentStage: 'rapport' | 'life_outline' | 'story_depth' | null,
    memories: readonly CurrentMemoryItem[],
  ): Promise<FrozenJourneyContext> {
    const scopes = await this.prisma.aiJobSessionScope.findMany({
      orderBy: { inputOrder: 'asc' },
      where: { aiJobId: job.id },
    });
    const signals = inferSignals(job, memories);
    return {
      boundaryPolicyRevision: job.policyRevision,
      currentStage,
      memoryManifestHash: manifestHash(
        job.memories.map(
          ({ resolutionId, resolutionRevision }) => `${resolutionId}:${String(resolutionRevision)}`,
        ),
      ),
      policyRevision: job.policyRevision,
      signals,
      transcriptWatermarks: scopes.map((scope) => ({
        maxSegmentId: scope.maxSegmentId,
        maxSegmentStartMs: scope.maxSegmentStartMs,
        sessionId: scope.sessionId,
        speakerRoleRevision: scope.speakerRoleRevision,
      })),
      trustedRoleWatermarkHash: manifestHash(
        scopes.map(
          (scope) =>
            `${scope.sessionId}:${String(scope.speakerRoleRevision)}:${scope.maxSegmentId ?? ''}:${String(scope.maxSegmentStartMs ?? '')}`,
        ),
      ),
    };
  }
}

interface PreparedQuestionAttempt {
  actorId: string;
  actualAsked: Awaited<ReturnType<ActualAskedReader['list']>>;
  attemptId: string;
  attemptKind: QuestionAttemptKind;
  basis: { presentationRevision: number; snapshotId: string | null };
  eligible: Awaited<ReturnType<QuestionBankReader['listEligible']>>;
  job: FrozenAiJob;
  journeyStage: 'rapport' | 'life_outline' | 'story_depth';
  memories: readonly CurrentMemoryItem[];
  requestId: string;
}

function inferSignals(
  job: FrozenAiJob,
  memories: readonly CurrentMemoryItem[],
): readonly JourneyInputSignal[] {
  const signals = new Set<JourneyInputSignal>();
  if (job.segments.some(({ text }) => text.trim().length >= 8)) signals.add('response.concrete');
  for (const memory of memories) {
    if (memory.memoryType === 'person') signals.add('context.person');
    if (memory.memoryType === 'event') signals.add('context.event');
    if (memory.memoryType === 'important_choice') signals.add('context.choice');
    if (memory.memoryType === 'unfinished_story') signals.add('context.unfinished_story');
  }
  return [...signals].sort();
}

function journeyFacts(signals: readonly JourneyInputSignal[]): readonly QuestionConditionCode[] {
  const allowed = new Set<string>([
    'response.reluctant',
    'response.low_detail',
    'topic.exhausted',
    'engagement.continuous_narration',
    'engagement.willing_to_deepen',
    'response.concrete',
    'context.person',
    'context.event',
    'context.choice',
    'context.turning_point',
    'context.emotion',
    'context.unfinished_story',
  ]);
  return signals.filter((signal) => allowed.has(signal)) as QuestionConditionCode[];
}

function stableUuid(value: string): string {
  const hex = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20, 32).join('')}`;
}
