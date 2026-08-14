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
import { CurrentMemoryReader, type CurrentMemoryItem } from '../memory/memory.service.js';
import { QuestionBankReader } from '../question-bank/question-bank.service.js';
import type {
  EligibleQuestionBankItem,
  QuestionConditionCode,
} from '../question-bank/question-bank.types.js';
import { QuestionBankError } from '../question-bank/question-bank.types.js';
import {
  JOURNEY_POLICY_VERSION,
  QuestionJourneyService,
  type FrozenJourneyContext,
  type JourneyInputSignal,
} from '../question-bank/question-journey.service.js';
import {
  ActualAskedReader,
  QuestionEvidenceWriter,
} from '../question-evidence/question-evidence.service.js';
import { QUESTION_SIMILARITY_VERSION } from '../question-evidence/question-similarity.matcher.js';
import { QuestionPresentationService } from '../question-evidence/question-presentation.service.js';
import type {
  QuestionAttemptKind,
  QuestionAttemptReceipt,
  QuestionBankInputReference,
  QuestionCandidateResult,
} from '../question-evidence/question-presentation.types.js';
import { RealtimeRuntimeService } from '../realtime-transcription/realtime-runtime.service.js';
import {
  DIRECTOR_CONTEXT_BUILDER_VERSION,
  DIRECTOR_CONTEXT_SCHEMA_VERSION,
  DIRECTOR_MODEL_CONFIG_VERSION,
  DIRECTOR_OUTPUT_SCHEMA_VERSION,
  DIRECTOR_PROMPT_BUNDLE_VERSION,
  type InterviewDirectorContextV1,
  QuestionDirectorContract,
} from './question-director-contract.js';
import { QuestionDirector } from './question-director.js';
import {
  latestSubstantiveElderAnswer,
  QUESTION_SELECTION_POLICY_VERSION,
  scoreQuestionSelectionV1,
} from './question-selection.js';

const DEBOUNCE_MS = 1_500;
const DEADLINE_MS = 8_000;
const AUTO_MIN_INTERVAL_MS = 20_000;

@Injectable()
export class QuestionOrchestrationService implements OnModuleInit, OnModuleDestroy {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private unsubscribeFinal: (() => void) | null = null;

  public constructor(
    private readonly prisma: PrismaService,
    private readonly coordinator: AiJobCoordinatorService,
    private readonly memories: CurrentMemoryReader,
    private readonly actualAsked: ActualAskedReader,
    private readonly bank: QuestionBankReader,
    private readonly journey: QuestionJourneyService,
    private readonly director: QuestionDirector,
    private readonly contract: QuestionDirectorContract,
    private readonly writer: QuestionEvidenceWriter,
    private readonly presentations: QuestionPresentationService,
    private readonly realtime: RealtimeRuntimeService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  public onModuleInit(): void {
    this.unsubscribeFinal = this.realtime.onFinalized(({ segmentId, sessionId }) => {
      this.scheduleAutomatic(sessionId, segmentId, DEBOUNCE_MS);
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
    await this.presentations.assertManualAvailability(
      actor.id,
      sessionId,
      input.requestId,
      input.expectedPresentationRevision,
      input.expectedSnapshotId,
    );
    const prepared = await this.prepare(actor.id, sessionId, 'manual_next', input.requestId, {
      presentationRevision: input.expectedPresentationRevision,
      snapshotId: input.expectedSnapshotId,
    });
    if (!prepared.replayed) {
      void this.complete(prepared).catch(async (error: unknown) => {
        await this.presentations.failAttempt(
          prepared.attemptId,
          error instanceof Error ? error.message.slice(0, 80) : 'AI_UNAVAILABLE',
        );
      });
    }
    return {
      accepted_presentation_revision: prepared.basis.presentationRevision,
      attempt_id: prepared.attemptId,
      request_id: input.requestId,
      retry_after_ms: 0,
      status: 'running',
    };
  }

  public async requestSecondSessionOpening(input: {
    actorId: string;
    basisSessionId: string;
    calibrationConfirmed: boolean;
    consumerSessionId: string;
    requestId: string;
    triggerDedupeKey: string;
  }): Promise<{ attemptId: string; replayed: boolean; requestId: string }> {
    const state = await this.presentations.generationContext(input.consumerSessionId);
    const prepared = await this.prepare(
      input.actorId,
      input.consumerSessionId,
      'second_session_opening',
      input.requestId,
      {
        presentationRevision: state.presentationRevision,
        snapshotId: state.currentSnapshotId,
      },
      {
        scopeSessionIds: input.calibrationConfirmed
          ? [input.basisSessionId, input.consumerSessionId]
          : [input.basisSessionId],
        triggerDedupeKey: input.triggerDedupeKey,
      },
    );
    if (!prepared.replayed) {
      void this.complete(prepared).catch(async (error: unknown) => {
        await this.presentations.failAttempt(
          prepared.attemptId,
          error instanceof Error ? error.message.slice(0, 80) : 'AI_UNAVAILABLE',
        );
      });
    }
    return {
      attemptId: prepared.attemptId,
      replayed: prepared.replayed,
      requestId: input.requestId,
    };
  }

  public async recordSecondSessionOpeningUnavailable(input: {
    actorId: string;
    basisSessionId: string;
    calibrationConfirmed: boolean;
    consumerSessionId: string;
    errorCode: string;
    projectId: string;
    requestId: string;
    triggerDedupeKey: string;
  }): Promise<string | null> {
    const job = await this.coordinator.recordRejectedSystemJob(
      {
        actorId: input.actorId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
        jobType: 'question_generate',
        projectId: input.projectId,
        requestId: input.requestId,
        sessionIds: input.calibrationConfirmed
          ? [input.basisSessionId, input.consumerSessionId]
          : [input.basisSessionId],
        triggerDedupeKey: input.triggerDedupeKey,
        trustedRole: 'elder',
        trustedRoles: ['elder', 'interviewer'],
      },
      input.errorCode,
    );
    if (job === null) return null;
    return this.presentations.recordSystemUnavailableAttempt(
      {
        attemptKind: 'second_session_opening',
        basisPresentationRevision: 0,
        basisSnapshotId: null,
        contextBuilderDigest: this.contract.contextBuilderDigest,
        contextBuilderVersion: DIRECTOR_CONTEXT_BUILDER_VERSION,
        contextSchemaDigest: this.contract.contextSchemaDigest,
        contextSchemaVersion: DIRECTOR_CONTEXT_SCHEMA_VERSION,
        failureCode: input.errorCode,
        job,
        journeyBasisHash: createHash('sha256').update(input.requestId).digest('hex'),
        journeyPolicyVersion: JOURNEY_POLICY_VERSION,
        journeyReasonCodes: ['stage.hold_no_decisive_signal'],
        journeyStage: 'rapport',
        modelConfigDigest: this.contract.modelConfigDigest,
        modelConfigVersion: DIRECTOR_MODEL_CONFIG_VERSION,
        outputSchemaDigest: this.contract.outputSchemaDigest,
        outputSchemaVersion: DIRECTOR_OUTPUT_SCHEMA_VERSION,
        promptBundleDigest: this.contract.promptBundleDigest,
        promptBundleVersion: DIRECTOR_PROMPT_BUNDLE_VERSION,
        selectionPolicyVersion: QUESTION_SELECTION_POLICY_VERSION,
        sessionId: input.consumerSessionId,
        similarityPolicyVersion: QUESTION_SIMILARITY_VERSION,
      },
      input.requestId,
    );
  }

  private async runAutomatic(sessionId: string, segmentId: string): Promise<void> {
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (session === null || session.status !== 'recording') return;
    const waitMs = await this.automaticProviderWaitMs(sessionId);
    if (waitMs > 0) {
      this.scheduleAutomatic(sessionId, segmentId, waitMs);
      return;
    }
    const requestId = stableUuid(`auto:${sessionId}:${segmentId}`);
    const state = await this.presentations.generationContext(sessionId);
    const prepared = await this.prepare(session.createdBy, sessionId, 'automatic', requestId, {
      presentationRevision: state.presentationRevision,
      snapshotId: state.currentSnapshotId,
    });
    if (!prepared.replayed) await this.complete(prepared);
  }

  private async prepare(
    actorId: string,
    sessionId: string,
    attemptKind: QuestionAttemptKind,
    requestId: string,
    basis: { presentationRevision: number; snapshotId: string | null },
    options: {
      scopeSessionIds?: readonly string[];
      triggerDedupeKey?: string;
    } = {},
  ): Promise<PreparedQuestionAttempt> {
    const replay = await this.prisma.questionGenerationAttempt.findUnique({ where: { requestId } });
    if (replay !== null) {
      const replayJob = await this.prisma.aiJob.findUnique({ where: { id: replay.aiJobId } });
      if (
        replay.sessionId !== sessionId ||
        replayJob?.requestedBy !== actorId ||
        replay.basisPresentationRevision !== basis.presentationRevision ||
        replay.basisSnapshotId !== basis.snapshotId
      ) {
        throw new Error('IDEMPOTENCY_KEY_REUSED');
      }
      return {
        actorId,
        attemptId: replay.id,
        attemptKind,
        basis,
        context: null,
        consumerSessionId: sessionId,
        deadlineAt: 0,
        job: null,
        shouldContinueListening: false,
        replayed: true,
        requestId,
      };
    }

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
      sessionIds: options.scopeSessionIds ?? [sessionId],
      ...(options.triggerDedupeKey !== undefined
        ? { triggerDedupeKey: options.triggerDedupeKey }
        : attemptKind === 'automatic'
          ? { triggerDedupeKey: `question:${sessionId}:${requestId}` }
          : {}),
      trustedRole: 'elder',
      trustedRoles: ['elder', 'interviewer'],
    });
    if (job.replayed) throw new Error(`AI_REQUEST_REPLAY_${job.status.toUpperCase()}`);

    const journeyContext = await this.journeyContext(job, generation.journeyStage, memories);
    const decision = this.journey.evaluate(journeyContext, JOURNEY_POLICY_VERSION);
    let references: readonly EligibleQuestionBankItem[] = [];
    if (decision.publicationAllowed) {
      try {
        references = await this.bank.listEligible(
          decision.stage,
          journeyFacts(journeyContext.signals),
          {
            environmentScope: ['local', 'test'].includes(this.config.appEnv)
              ? 'internal_demo'
              : 'product',
            policyDecision: 'allowed',
          },
        );
      } catch (error) {
        if (
          !(error instanceof QuestionBankError) ||
          error.code !== 'QUESTION_BANK_ACTIVE_RELEASE_UNAVAILABLE'
        ) {
          throw error;
        }
      }
    }
    const bankReferences = references.slice(0, 30).map(toBankInputReference);
    let receipt: QuestionAttemptReceipt;
    try {
      receipt = await this.writer.beginGenerationAttempt(
        {
          attemptKind,
          bankReferences,
          basisPresentationRevision: basis.presentationRevision,
          basisSnapshotId: basis.snapshotId,
          contextBuilderDigest: this.contract.contextBuilderDigest,
          contextBuilderVersion: DIRECTOR_CONTEXT_BUILDER_VERSION,
          contextSchemaDigest: this.contract.contextSchemaDigest,
          contextSchemaVersion: DIRECTOR_CONTEXT_SCHEMA_VERSION,
          job,
          journeyBasisHash: decision.basisHash,
          journeyPolicyVersion: decision.journeyPolicyVersion,
          journeyReasonCodes: decision.reasonCodes,
          journeyStage: decision.stage,
          modelConfigDigest: this.contract.modelConfigDigest,
          modelConfigVersion: DIRECTOR_MODEL_CONFIG_VERSION,
          outputSchemaDigest: this.contract.outputSchemaDigest,
          outputSchemaVersion: DIRECTOR_OUTPUT_SCHEMA_VERSION,
          promptBundleDigest: this.contract.promptBundleDigest,
          promptBundleVersion: DIRECTOR_PROMPT_BUNDLE_VERSION,
          selectionPolicyVersion: QUESTION_SELECTION_POLICY_VERSION,
          sessionId,
          similarityPolicyVersion: QUESTION_SIMILARITY_VERSION,
        },
        isSystemAttempt(attemptKind)
          ? { kind: 'system', trigger: requestId }
          : { actorId, kind: 'actor' },
        requestId,
      );
    } catch (error) {
      await this.coordinator.discardUncalledJob(job.id);
      throw error;
    }
    const frozenJob = { ...job, inputHash: receipt.frozenInputHash };
    const persistedAttempt = await this.prisma.questionGenerationAttempt.findUniqueOrThrow({
      select: { createdAt: true },
      where: { id: receipt.attemptId },
    });
    const context = await this.buildContext(
      frozenJob,
      memories,
      actualAsked,
      bankReferences,
      decision.stage,
      decision.reasonCodes,
      generation,
      sessionId,
    );
    this.contract.assertContext(context);
    return {
      actorId,
      attemptId: receipt.attemptId,
      attemptKind,
      basis,
      context,
      consumerSessionId: sessionId,
      deadlineAt: persistedAttempt.createdAt.getTime() + DEADLINE_MS,
      job: frozenJob,
      replayed: false,
      requestId,
      shouldContinueListening: decision.shouldContinueListening,
    };
  }

  private async complete(prepared: PreparedQuestionAttempt): Promise<void> {
    if (prepared.job === null || prepared.context === null) return;
    if (prepared.shouldContinueListening) {
      await this.writer.publishAttemptResult(
        {
          attemptId: prepared.attemptId,
          candidate: null,
          deadlineAt: prepared.deadlineAt,
          job: prepared.job,
          resultKind: 'continue_listening',
          sessionId: prepared.consumerSessionId,
        },
        isSystemAttempt(prepared.attemptKind)
          ? { kind: 'system', trigger: prepared.requestId }
          : { actorId: prepared.actorId, kind: 'actor' },
        prepared.requestId,
      );
      return;
    }
    const context = prepared.context;
    const output = await this.coordinator.callProviderWithSameInputRetry(
      prepared.job,
      () => this.director.generate({ context, prompt: this.contract.prompt }),
      (value) => this.contract.parseOutput(value, context),
      prepared.deadlineAt,
    );
    const candidate: QuestionCandidateResult | null =
      output.decision === 'suggest'
        ? {
            declaredBankReferences: output.declared_bank_references.map((reference) => ({
              questionBankItemId: reference.question_bank_item_id,
              usage: reference.usage,
            })),
            grounding: output.grounding,
            purpose: output.purpose,
            questionText: output.question,
            reasonText: output.reason,
            risk: output.risk,
            selectionScore: scoreQuestionSelectionV1({
              grounding: output.grounding,
              purpose: output.purpose,
              risk: output.risk,
              segments: prepared.job.segments,
              stage: prepared.context.interview_state.journey_stage,
            }),
          }
        : null;
    await this.writer.publishAttemptResult(
      {
        attemptId: prepared.attemptId,
        candidate,
        deadlineAt: prepared.deadlineAt,
        job: prepared.job,
        resultKind: candidate === null ? 'continue_listening' : 'suggestion',
        sessionId: prepared.consumerSessionId,
      },
      isSystemAttempt(prepared.attemptKind)
        ? { kind: 'system', trigger: prepared.requestId }
        : { actorId: prepared.actorId, kind: 'actor' },
      prepared.requestId,
    );
  }

  private async buildContext(
    job: FrozenAiJob,
    memories: readonly CurrentMemoryItem[],
    actualAsked: Awaited<ReturnType<ActualAskedReader['list']>>,
    bankReferences: readonly QuestionBankInputReference[],
    journeyStage: 'rapport' | 'life_outline' | 'story_depth',
    journeyReasonCodes: readonly string[],
    generation: Awaited<ReturnType<QuestionPresentationService['generationContext']>>,
    consumerSessionId = job.sessionIds[0] ?? '',
  ): Promise<InterviewDirectorContextV1> {
    const recentSnapshots = await this.prisma.questionDisplaySnapshot.findMany({
      orderBy: [{ displaySequence: 'desc' }, { id: 'desc' }],
      take: 40,
      where: {
        expiresAt: { gt: new Date() },
        retentionState: 'active',
        sessionId: consumerSessionId,
      },
    });
    const memoryById = new Map(memories.map((memory) => [memory.id, memory]));
    const actualById = new Map(actualAsked.map((question) => [question.id, question]));
    return {
      actual_asked: job.actualQuestions.flatMap((frozen) => {
        const item = actualById.get(frozen.actualQuestionId);
        return item === undefined ? [] : [{ actual_question_id: item.id, text: item.questionText }];
      }),
      bank_references: bankReferences.map((item) => ({
        bank: item.bank,
        purpose: item.purpose,
        question_bank_item_id: item.itemId,
        question_text: item.questionText,
        sensitivity: item.sensitivity,
        topic: item.topic,
      })),
      boundaries: [],
      context_schema_version: DIRECTOR_CONTEXT_SCHEMA_VERSION,
      current_memories: job.memories.flatMap((frozen) => {
        const memory = memoryById.get(frozen.resolutionId);
        return memory === undefined
          ? []
          : [
              {
                authority: memory.authority,
                memory_resolution_id: memory.id,
                memory_type: memory.memoryType,
                value: renderMemoryValue(memory.resolvedValue),
                value_kind: memoryValueKind(memory),
              },
            ];
      }),
      current_presentation:
        generation.currentPresentation === null
          ? null
          : {
              snapshot_id: generation.currentPresentation.id,
              text: generation.currentPresentation.questionText,
            },
      interview_state: {
        goal: goalFor(journeyStage),
        journey_reason_codes: [...journeyReasonCodes],
        journey_stage: journeyStage,
      },
      recent_transcript: job.segments.slice(-40).map((segment) => ({
        segment_id: segment.segmentId,
        start_ms: segment.startMs,
        text: segment.text,
        trusted_role: segment.trustedRole,
      })),
      recently_displayed: recentSnapshots
        .slice()
        .reverse()
        .map((snapshot) => ({ snapshot_id: snapshot.id, text: snapshot.questionText })),
    };
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
    const signals = inferDirectorJourneySignals(job, memories);
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

  private scheduleAutomatic(sessionId: string, segmentId: string, delayMs: number): void {
    const existing = this.timers.get(sessionId);
    if (existing !== undefined) clearTimeout(existing);
    this.timers.set(
      sessionId,
      setTimeout(
        () => {
          this.timers.delete(sessionId);
          void this.runAutomatic(sessionId, segmentId).catch(() => undefined);
        },
        Math.max(0, delayMs),
      ),
    );
  }

  private async automaticProviderWaitMs(sessionId: string): Promise<number> {
    const recentAttempts = await this.prisma.questionGenerationAttempt.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { aiJobId: true },
      take: 100,
      where: { attemptKind: 'automatic', sessionId },
    });
    if (recentAttempts.length === 0) return 0;
    const latestCall = await this.prisma.aiProviderCall.findFirst({
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: { startedAt: true },
      where: { aiJobId: { in: recentAttempts.map(({ aiJobId }) => aiJobId) } },
    });
    if (latestCall === null) return 0;
    return Math.max(0, latestCall.startedAt.getTime() + AUTO_MIN_INTERVAL_MS - Date.now());
  }
}

interface PreparedQuestionAttempt {
  actorId: string;
  attemptId: string;
  attemptKind: QuestionAttemptKind;
  basis: { presentationRevision: number; snapshotId: string | null };
  context: InterviewDirectorContextV1 | null;
  consumerSessionId: string;
  deadlineAt: number;
  job: FrozenAiJob | null;
  replayed: boolean;
  requestId: string;
  shouldContinueListening: boolean;
}

function isSystemAttempt(kind: QuestionAttemptKind): boolean {
  return kind === 'automatic' || kind === 'second_session_opening';
}

export function inferDirectorJourneySignals(
  job: FrozenAiJob,
  memories: readonly CurrentMemoryItem[],
): readonly JourneyInputSignal[] {
  const signals = new Set<JourneyInputSignal>();
  const elderText = latestSubstantiveElderAnswer(job.segments)
    .map(({ text }) => text.trim())
    .join(' ');
  if (elderText.length > 0 && elderText.length < 12) signals.add('response.low_detail');
  if (elderText.length >= 12) signals.add('response.concrete');
  if (/(不.{0,3}想说|不方便|算了|别问|不知道)/u.test(elderText)) {
    signals.add('response.reluctant');
  }
  if (/(后来|接着|然后|还有|再后来)/u.test(elderText) && elderText.length >= 28) {
    signals.add('engagement.continuous_narration');
  }
  if (/(愿意|可以|想讲|印象很深|最难忘)/u.test(elderText)) {
    signals.add('engagement.willing_to_deepen');
  }
  for (const memory of memories) {
    if (memory.memoryType === 'person') signals.add('context.person');
    if (memory.memoryType === 'event') signals.add('context.event');
    if (memory.memoryType === 'important_choice') signals.add('context.choice');
    if (memory.memoryType === 'unfinished_story') signals.add('context.unfinished_story');
    if (memory.memoryType === 'reason_clue') signals.add('context.turning_point');
  }
  return [...signals].sort();
}

function journeyFacts(signals: readonly JourneyInputSignal[]): readonly QuestionConditionCode[] {
  const allowed = new Set<string>([
    'response.reluctant',
    'response.low_detail',
    'topic.exhausted',
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

function toBankInputReference(item: EligibleQuestionBankItem): QuestionBankInputReference {
  return {
    bank: item.bank,
    bankVersion: item.bankVersion,
    contentDigest: item.contentDigest,
    itemId: item.itemId,
    licenseStatus: item.licenseStatus,
    purpose: item.purpose,
    questionId: item.questionId,
    questionText: item.questionText,
    sensitivity: item.sensitivity,
    topic: item.topic,
  };
}

function renderMemoryValue(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 500);
  return JSON.stringify(value).slice(0, 500);
}

function memoryValueKind(memory: CurrentMemoryItem): 'exact' | 'range' | 'unknown' {
  if (memory.resolutionKind === 'unknown') return 'unknown';
  if (memory.resolutionKind === 'range' || Array.isArray(memory.resolvedValue)) return 'range';
  return 'exact';
}

function goalFor(stage: 'rapport' | 'life_outline' | 'story_depth'): string {
  if (stage === 'story_depth') return '顺着已经出现的具体故事线索，帮助长者自愿讲出更多细节。';
  if (stage === 'life_outline') return '补全人物、地点、事件和时间线索，形成大致人生轮廓。';
  return '用低压力、开放的问题建立信任和谈话节奏。';
}

function stableUuid(value: string): string {
  const hex = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20, 32).join('')}`;
}
