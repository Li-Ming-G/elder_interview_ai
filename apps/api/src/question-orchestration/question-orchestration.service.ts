import { createHash } from 'node:crypto';

import type { ApiConfig } from '@elder-interview/config';
import type { SuggestionRequestAcceptedResponse } from '@elder-interview/contracts';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';
import {
  AiJobCoordinatorService,
  type FrozenAiJob,
} from '../ai-runtime/ai-job-coordinator.service.js';
import {
  DecisionTraceService,
  type DecisionTraceP4Input,
} from '../ai-runtime/decision-trace.service.js';
import { canonicalJson, manifestHash } from '../ai-runtime/ai-provenance.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import { InterviewContextService } from '../memory/interview-context.service.js';
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
  assembleP4DirectorContextV2,
  projectP4ContextV2ToDirectorV1,
  type P4DirectorActualQuestionInput,
  type P4DirectorDisplayedQuestionInput,
  type P4DirectorQuestionBankInput,
  type P4DirectorTranscriptInput,
} from './p4-context-v2-consumer.js';
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
    private readonly decisionTrace: DecisionTraceService,
    private readonly contexts: InterviewContextService,
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
    consumerSessionId: string;
    contextSnapshotId: string;
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
        interviewContextSnapshotId: input.contextSnapshotId,
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
    contextSnapshotId?: string;
    errorCode: string;
    projectId: string;
    requestId: string;
    triggerDedupeKey: string;
  }): Promise<string | null> {
    const context =
      input.contextSnapshotId === undefined
        ? null
        : await this.contexts.readForOpening(
            input.actorId,
            input.consumerSessionId,
            input.contextSnapshotId,
          );
    const job = await this.coordinator.recordRejectedSystemJob(
      {
        actorId: input.actorId,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
        jobType: 'question_generate',
        projectId: input.projectId,
        requestId: input.requestId,
        sessionIds:
          context?.scopeSessionIds ??
          (input.calibrationConfirmed
            ? [input.basisSessionId, input.consumerSessionId]
            : [input.basisSessionId]),
        triggerDedupeKey: input.triggerDedupeKey,
        trustedRole: 'elder',
        trustedRoles: ['elder', 'interviewer'],
      },
      input.errorCode,
    );
    if (job === null) return null;
    const attemptId = await this.presentations.recordSystemUnavailableAttempt(
      {
        attemptKind: 'second_session_opening',
        basisPresentationRevision: 0,
        basisSnapshotId: null,
        contextBuilderDigest: this.contract.contextBuilderDigest,
        contextBuilderVersion: DIRECTOR_CONTEXT_BUILDER_VERSION,
        contextSchemaDigest: this.contract.contextSchemaDigest,
        contextSchemaVersion: DIRECTOR_CONTEXT_SCHEMA_VERSION,
        failureCode: input.errorCode,
        interviewContextSnapshotId: context?.snapshotId ?? null,
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
    const trace = await this.decisionTrace.begin({
      aiJobId: job.id,
      attemptId,
      contextRevision: 0,
      decisionOutcome: 'unavailable',
      directorInvoked: false,
      generationId: stableUuid(`generation:${input.requestId}`),
      inputHash: createHash('sha256').update(input.requestId).digest('hex'),
      ownerActorId: input.actorId,
      projectId: input.projectId,
      requestId: input.requestId,
      sessionId: input.consumerSessionId,
      stage: 'preflight',
      triggerType: 'second_session_opening',
      workingRevision: null,
    });
    await this.decisionTrace.finalize(trace.id, {
      decisionOutcome: 'unavailable',
      errorCode: input.errorCode,
      publicationOutcome: 'policy_blocked',
      status: 'unavailable',
    });
    return attemptId;
  }

  public async failOrphanedSecondSessionOpening(attemptId: string): Promise<void> {
    const attempt = await this.prisma.questionGenerationAttempt.findUnique({
      select: { aiJobId: true },
      where: { id: attemptId },
    });
    if (attempt === null) return;
    await this.coordinator.failOrphanedSystemJob(attempt.aiJobId);
    await this.presentations.failAttempt(attemptId, 'SYSTEM_COORDINATOR_RESTARTED');
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
      interviewContextSnapshotId?: string;
      triggerDedupeKey?: string;
    } = {},
  ): Promise<PreparedQuestionAttempt> {
    const replay = await this.prisma.questionGenerationAttempt.findUnique({ where: { requestId } });
    if (replay !== null) {
      const replayTrace = await this.prisma.decisionTrace.findUnique({
        select: { id: true },
        where: { requestId },
      });
      const replayTraceId =
        replayTrace === null ? await this.decisionTrace.recoverAttempt(replay.id) : replayTrace.id;
      const replayJob = await this.prisma.aiJob.findUnique({ where: { id: replay.aiJobId } });
      if (
        replay.sessionId !== sessionId ||
        replayJob?.requestedBy !== actorId ||
        replay.basisPresentationRevision !== basis.presentationRevision ||
        replay.basisSnapshotId !== basis.snapshotId ||
        replay.interviewContextSnapshotId !== (options.interviewContextSnapshotId ?? null)
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
        traceId: replayTraceId,
      };
    }

    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (session === null) throw new Error('AI_SESSION_SCOPE_INVALID');
    const [openingContext, generation] = await Promise.all([
      options.interviewContextSnapshotId === undefined
        ? null
        : this.contexts.readForOpening(actorId, sessionId, options.interviewContextSnapshotId),
      this.presentations.generationContext(sessionId),
    ]);
    if (openingContext !== null && openingContext.projectId !== session.projectId) {
      throw new Error('AI_OPENING_CONTEXT_INVALID');
    }
    const [memories, actualAsked] =
      openingContext === null
        ? await Promise.all([
            this.memories.list(actorId, session.projectId),
            this.actualAsked.list(actorId, session.projectId),
          ])
        : [openingContext.memories, openingContext.actualAsked];
    const job = await this.coordinator.freeze({
      actorId,
      actualQuestionIds: actualAsked.map(({ id }) => id),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000),
      jobType: 'question_generate',
      memoryResolutionIds: memories.map(({ id }) => id),
      projectId: session.projectId,
      requestId,
      sessionIds: openingContext?.scopeSessionIds ?? [sessionId],
      ...(openingContext === null ? {} : { sourceContextSnapshotId: openingContext.snapshotId }),
      ...(options.triggerDedupeKey !== undefined
        ? { triggerDedupeKey: options.triggerDedupeKey }
        : attemptKind === 'automatic'
          ? { triggerDedupeKey: `question:${sessionId}:${requestId}` }
          : {}),
      trustedRole: 'elder',
      trustedRoles: ['elder', 'interviewer'],
    });
    if (job.replayed) {
      const replayAttempt = await this.prisma.questionGenerationAttempt.findUnique({
        where: { requestId },
      });
      if (replayAttempt !== null) await this.decisionTrace.recoverAttempt(replayAttempt.id);
      throw new Error(`AI_REQUEST_REPLAY_${job.status.toUpperCase()}`);
    }

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
          interviewContextSnapshotId: openingContext?.snapshotId ?? null,
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
    const [inputSegments, sessionScopes] = await Promise.all([
      this.prisma.aiJobInputSegment.findMany({
        orderBy: { inputOrder: 'asc' },
        where: { aiJobId: frozenJob.id },
      }),
      this.prisma.aiJobSessionScope.findMany({
        orderBy: { inputOrder: 'asc' },
        where: { aiJobId: frozenJob.id },
      }),
    ]);
    const trace = await this.decisionTrace.begin({
      aiJobId: frozenJob.id,
      attemptId: receipt.attemptId,
      contextRevision: basis.presentationRevision,
      decisionOutcome: 'unavailable',
      directorInvoked: false,
      generationId: stableUuid(`generation:${requestId}`),
      inputHash: frozenJob.inputHash,
      memoryMemberships: memories.map((memory, inputOrder) => ({
        inputOrder,
        layer: memory.layer,
        memoryId: memory.id,
        membershipRole: 'active',
        revision: memory.resolutionRevision,
      })),
      ownerActorId: actorId,
      projectId: session.projectId,
      requestId,
      sessionId,
      stage: 'prepare',
      transcriptMemberships: inputSegments.map((segment) => ({
        effectiveTextDigest: segment.effectiveTextDigest,
        inputOrder: segment.inputOrder,
        segmentId: segment.transcriptSegmentId,
        speakerRoleRevision: segment.speakerRoleRevision,
        textRevision: segment.textRevision,
      })),
      triggerType: attemptKind,
      workingRevision: null,
    });
    const persistedAttempt = await this.prisma.questionGenerationAttempt.findUniqueOrThrow({
      select: { createdAt: true },
      where: { id: receipt.attemptId },
    });
    let context: InterviewDirectorContextV1;
    try {
      context = await this.buildContext(
        frozenJob,
        memories,
        actualAsked,
        bankReferences,
        decision.stage,
        decision.reasonCodes,
        generation,
        inputSegments,
        sessionId,
      );
      this.contract.assertContext(context);
      const displaySourceIds = [
        ...context.recently_displayed.map((item) => item.snapshot_id),
        ...(context.current_presentation === null
          ? []
          : [context.current_presentation.snapshot_id]),
      ];
      const displaySources = await this.prisma.questionDisplaySnapshot.findMany({
        where: { id: { in: displaySourceIds } },
        select: {
          id: true,
          normalizedQuestionDigest: true,
          publishedPresentationRevision: true,
        },
      });
      const p4Memberships = traceP4Memberships(
        context,
        memories,
        actualAsked,
        inputSegments,
        bankReferences,
        displaySources,
        sessionScopes,
      );
      await this.decisionTrace.attachReferences(trace.id, {
        contextDigest: manifestHash(p4Memberships.map((item) => canonicalJson(item))),
        p4Memberships,
      });
    } catch (error) {
      await this.decisionTrace
        .finalize(trace.id, {
          decisionOutcome: 'system_error',
          errorCode: error instanceof Error ? error.message.slice(0, 80) : 'CONTEXT_BUILD_FAILED',
          directorInvoked: false,
          stage: 'context',
          status: 'failed',
        })
        .catch(() => undefined);
      await this.decisionTrace.recoverAttempt(receipt.attemptId).catch(() => undefined);
      throw error;
    }
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
      traceId: trace.id,
    };
  }

  private async complete(prepared: PreparedQuestionAttempt): Promise<void> {
    if (prepared.job === null || prepared.context === null) return;
    try {
      if (prepared.shouldContinueListening) {
        const publication = await this.writer.publishAttemptResult(
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
        await this.decisionTrace.finalize(prepared.traceId, {
          decisionOutcome: traceOutcomeForPublication(
            publication.publicationOutcome,
            'continue_listening',
          ),
          directorInvoked: false,
          publicationOutcome: publication.publicationOutcome,
          stage: 'publication',
          status: traceStatusForPublication(publication.publicationOutcome),
        });
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
      const publication = await this.writer.publishAttemptResult(
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
      await this.decisionTrace.finalize(prepared.traceId, {
        decisionOutcome: traceOutcomeForPublication(
          publication.publicationOutcome,
          candidate === null ? 'continue_listening' : 'question',
        ),
        directorInvoked: true,
        publicationOutcome: publication.publicationOutcome,
        stage: 'publication',
        status: traceStatusForPublication(publication.publicationOutcome),
      });
    } catch (error) {
      await this.decisionTrace
        .finalize(prepared.traceId, {
          decisionOutcome: 'system_error',
          errorCode: error instanceof Error ? error.message.slice(0, 80) : 'DIRECTOR_FAILED',
          directorInvoked: true,
          stage: 'director',
          status: 'failed',
        })
        .catch(() => undefined);
      await this.decisionTrace.recoverAttempt(prepared.attemptId).catch(() => undefined);
      throw error;
    }
  }

  private async buildContext(
    job: FrozenAiJob,
    memories: readonly CurrentMemoryItem[],
    actualAsked: Awaited<ReturnType<ActualAskedReader['list']>>,
    bankReferences: readonly QuestionBankInputReference[],
    journeyStage: 'rapport' | 'life_outline' | 'story_depth',
    journeyReasonCodes: readonly string[],
    generation: Awaited<ReturnType<QuestionPresentationService['generationContext']>>,
    inputSegments: readonly {
      effectiveTextDigest: string;
      inputOrder: number;
      speakerRoleRevision: number;
      textRevision: number;
      transcriptSegmentId: string;
    }[],
    consumerSessionId = job.sessionIds[0] ?? '',
  ): Promise<InterviewDirectorContextV1> {
    const [
      recentSnapshots,
      actualQuestionSources,
      actualQuestionEvidence,
      currentPresentationSnapshot,
    ] = await Promise.all([
      this.prisma.questionDisplaySnapshot.findMany({
        orderBy: [{ displaySequence: 'desc' }, { id: 'desc' }],
        take: 40,
        where: {
          expiresAt: { gt: new Date() },
          retentionState: 'active',
          sessionId: consumerSessionId,
        },
      }),
      this.prisma.actualQuestion.findMany({
        select: { id: true, sourceKind: true },
        where: { id: { in: job.actualQuestions.map(({ actualQuestionId }) => actualQuestionId) } },
      }),
      this.prisma.actualQuestionEvidence.findMany({
        orderBy: { evidenceOrder: 'asc' },
        select: { actualQuestionId: true, transcriptSegmentId: true },
        where: {
          actualQuestionId: {
            in: job.actualQuestions.map(({ actualQuestionId }) => actualQuestionId),
          },
        },
      }),
      generation.currentPresentation === null
        ? Promise.resolve(null)
        : this.prisma.questionDisplaySnapshot.findFirst({
            where: {
              id: generation.currentPresentation.id,
              retentionState: 'active',
              sessionId: consumerSessionId,
            },
          }),
    ]);
    const memoryById = new Map(memories.map((memory) => [memory.id, memory]));
    const actualById = new Map(actualAsked.map((question) => [question.id, question]));
    const actualSourceById = new Map(
      actualQuestionSources.map((question) => [question.id, question]),
    );
    const actualEvidenceById = new Map<string, string[]>();
    for (const evidence of actualQuestionEvidence) {
      const entries = actualEvidenceById.get(evidence.actualQuestionId) ?? [];
      entries.push(evidence.transcriptSegmentId);
      actualEvidenceById.set(evidence.actualQuestionId, entries);
    }
    const legacyContext: InterviewDirectorContextV1 = {
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
                memory_type: directorMemoryType(memory),
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
    const inputSegmentById = new Map(
      inputSegments.map((segment) => [segment.transcriptSegmentId, segment]),
    );
    const recentTranscript: P4DirectorTranscriptInput[] = job.segments
      .slice(-40)
      .map((segment, inputOrder) => {
        const membership = inputSegmentById.get(segment.segmentId);
        if (membership === undefined) throw new Error('P4_TRANSCRIPT_MEMBERSHIP_UNAVAILABLE');
        return {
          effectiveTextDigest: membership.effectiveTextDigest,
          inputOrder,
          segmentId: segment.segmentId,
          sessionId: segment.sessionId,
          speakerRoleRevision: membership.speakerRoleRevision,
          startMs: segment.startMs,
          text: segment.text,
          textRevision: membership.textRevision,
          trustedRole: segment.trustedRole,
        };
      });
    const p4ActualAsked: P4DirectorActualQuestionInput[] = job.actualQuestions.flatMap(
      (frozen, inputOrder) => {
        const item = actualById.get(frozen.actualQuestionId);
        const source = actualSourceById.get(frozen.actualQuestionId);
        const evidenceSegmentIds = actualEvidenceById.get(frozen.actualQuestionId);
        if (item === undefined || source === undefined || evidenceSegmentIds === undefined)
          return [];
        if (
          source.sourceKind !== 'interviewer_spontaneous' &&
          source.sourceKind !== 'matched_system_suggestion'
        ) {
          throw new Error('P4_ACTUAL_QUESTION_SOURCE_UNAVAILABLE');
        }
        if (evidenceSegmentIds.length === 0)
          throw new Error('P4_ACTUAL_QUESTION_EVIDENCE_UNAVAILABLE');
        return [
          {
            evidenceSegmentIds,
            inputOrder,
            normalizedDigest: item.normalizedDigest,
            questionId: item.id,
            questionText: item.questionText,
            source: source.sourceKind,
          },
        ];
      },
    );
    const p4Displayed: P4DirectorDisplayedQuestionInput[] = recentSnapshots.map(
      (snapshot, inputOrder) => ({
        displaySequence: snapshot.displaySequence,
        inputOrder,
        normalizedQuestionDigest: snapshot.normalizedQuestionDigest,
        questionText: snapshot.questionText,
        snapshotId: snapshot.id,
      }),
    );
    const currentSnapshot =
      generation.currentPresentation === null
        ? null
        : (currentPresentationSnapshot ??
          recentSnapshots.find(({ id }) => id === generation.currentPresentation?.id) ??
          null);
    if (generation.currentPresentation !== null && currentSnapshot === null)
      throw new Error('P4_CURRENT_PRESENTATION_UNAVAILABLE');
    const p4QuestionBank: P4DirectorQuestionBankInput[] = bankReferences.map(
      (reference, inputOrder) => ({
        bank: reference.bank,
        bankVersion: reference.bankVersion,
        contentDigest: reference.contentDigest,
        inputOrder,
        itemId: reference.itemId,
        purpose: reference.purpose,
        questionText: reference.questionText,
        sensitivity: reference.sensitivity,
        topic: reference.topic,
      }),
    );
    const p4Context = assembleP4DirectorContextV2({
      actualAsked: p4ActualAsked,
      currentPresentation:
        currentSnapshot === null
          ? null
          : {
              displaySequence: currentSnapshot.displaySequence,
              normalizedQuestionDigest: currentSnapshot.normalizedQuestionDigest,
              questionText: currentSnapshot.questionText,
              snapshotId: currentSnapshot.id,
            },
      displayed: p4Displayed,
      goal: goalFor(journeyStage),
      journeyReasonCodes,
      journeyStage,
      policyRevision: job.policyRevision,
      projectId: job.projectId,
      questionBank: p4QuestionBank,
      recentTranscript,
      sessionId: consumerSessionId,
    });
    return projectP4ContextV2ToDirectorV1(p4Context, legacyContext.current_memories);
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
  traceId: string;
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

export function directorMemoryType(
  memory: Pick<CurrentMemoryItem, 'memoryType' | 'semanticKind'>,
): string {
  const identity = memory.memoryType ?? memory.semanticKind;
  if (identity === null) throw new Error('AI_MEMORY_SEMANTIC_IDENTITY_UNAVAILABLE');
  return identity;
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

function traceP4Memberships(
  context: InterviewDirectorContextV1,
  memories: readonly CurrentMemoryItem[],
  actualAsked: readonly { id: string; analysisRevision: number; normalizedDigest: string }[],
  inputSegments: readonly {
    transcriptSegmentId: string;
    textRevision: number;
    effectiveTextDigest: string;
  }[],
  bankReferences: readonly QuestionBankInputReference[],
  displaySources: readonly {
    id: string;
    normalizedQuestionDigest: string;
    publishedPresentationRevision: number;
  }[],
  sessionScopes: readonly {
    segmentManifestHash: string;
    sessionId: string;
    speakerRoleRevision: number;
  }[],
): DecisionTraceP4Input[] {
  const refs: DecisionTraceP4Input[] = [];
  const memoryRevisions = new Map(memories.map((item) => [item.id, item.resolutionRevision]));
  const actualRevisions = new Map(
    actualAsked.map((item) => [
      item.id,
      { revision: item.analysisRevision, digest: item.normalizedDigest },
    ]),
  );
  const transcriptRevisions = new Map(
    inputSegments.map((item) => [
      item.transcriptSegmentId,
      { revision: item.textRevision, digest: item.effectiveTextDigest },
    ]),
  );
  const bankProvenance = new Map(
    bankReferences.map((item) => [
      item.itemId,
      { version: item.bankVersion, digest: item.contentDigest },
    ]),
  );
  const displayProvenance = new Map(
    displaySources.map((item) => [
      item.id,
      { revision: item.publishedPresentationRevision, digest: item.normalizedQuestionDigest },
    ]),
  );
  let inputOrder = 0;
  for (const scope of sessionScopes) {
    refs.push({
      inputOrder: inputOrder++,
      included: true,
      membershipDigest: scope.segmentManifestHash,
      revision: scope.speakerRoleRevision,
      revisionStatus: 'available',
      section: 'interview_state',
      sourceId: scope.sessionId,
      sourceType: 'session',
    });
  }
  for (const memory of context.current_memories) {
    refs.push({
      inputOrder: inputOrder++,
      included: true,
      revision: memoryRevisions.get(memory.memory_resolution_id) ?? null,
      revisionStatus: memoryRevisions.has(memory.memory_resolution_id)
        ? 'available'
        : 'unavailable',
      section: 'working_memory',
      sourceId: memory.memory_resolution_id,
      sourceType: 'memory',
    });
  }
  for (const segment of context.recent_transcript) {
    refs.push({
      inputOrder: inputOrder++,
      included: true,
      revision: transcriptRevisions.get(segment.segment_id)?.revision ?? null,
      revisionStatus: transcriptRevisions.has(segment.segment_id) ? 'available' : 'unavailable',
      membershipDigest: transcriptRevisions.get(segment.segment_id)?.digest ?? null,
      section: 'recent_transcript',
      sourceId: segment.segment_id,
      sourceType: 'transcript_segment',
    });
  }
  for (const question of context.actual_asked) {
    refs.push({
      inputOrder: inputOrder++,
      included: true,
      revision: actualRevisions.get(question.actual_question_id)?.revision ?? null,
      revisionStatus: actualRevisions.has(question.actual_question_id)
        ? 'available'
        : 'unavailable',
      membershipDigest: actualRevisions.get(question.actual_question_id)?.digest ?? null,
      section: 'actual_asked',
      sourceId: question.actual_question_id,
      sourceType: 'actual_question',
    });
  }
  for (const snapshot of context.recently_displayed) {
    refs.push({
      inputOrder: inputOrder++,
      included: true,
      revision: displayProvenance.get(snapshot.snapshot_id)?.revision ?? null,
      revisionStatus: displayProvenance.has(snapshot.snapshot_id) ? 'available' : 'unavailable',
      membershipDigest: displayProvenance.get(snapshot.snapshot_id)?.digest ?? null,
      section: 'recently_displayed',
      sourceId: snapshot.snapshot_id,
      sourceType: 'display_snapshot',
    });
  }
  if (context.current_presentation !== null) {
    refs.push({
      inputOrder: inputOrder++,
      included: true,
      revision: displayProvenance.get(context.current_presentation.snapshot_id)?.revision ?? null,
      revisionStatus: displayProvenance.has(context.current_presentation.snapshot_id)
        ? 'available'
        : 'unavailable',
      membershipDigest:
        displayProvenance.get(context.current_presentation.snapshot_id)?.digest ?? null,
      section: 'current_presentation',
      sourceId: context.current_presentation.snapshot_id,
      sourceType: 'presentation',
    });
  }
  for (const bank of context.bank_references) {
    refs.push({
      inputOrder: inputOrder++,
      included: true,
      revision: null,
      revisionStatus: 'unavailable',
      sourceVersion: bankProvenance.get(bank.question_bank_item_id)?.version ?? null,
      membershipDigest: bankProvenance.get(bank.question_bank_item_id)?.digest ?? null,
      section: 'question_bank',
      sourceId: bank.question_bank_item_id,
      sourceType: 'question_bank_item',
    });
  }
  return refs;
}

function stableUuid(value: string): string {
  const hex = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20, 32).join('')}`;
}

function traceStatusForPublication(
  publicationOutcome: string,
): 'succeeded' | 'cancelled' | 'stale' | 'unavailable' {
  if (publicationOutcome === 'superseded_by_manual') return 'cancelled';
  if (publicationOutcome === 'stale_basis') return 'stale';
  if (publicationOutcome === 'policy_blocked' || publicationOutcome.includes('blocked'))
    return 'unavailable';
  return 'succeeded';
}

function traceOutcomeForPublication(
  publicationOutcome: string,
  successOutcome: 'question' | 'continue_listening',
): 'question' | 'continue_listening' | 'unavailable' {
  return traceStatusForPublication(publicationOutcome) === 'succeeded'
    ? successOutcome
    : 'unavailable';
}
