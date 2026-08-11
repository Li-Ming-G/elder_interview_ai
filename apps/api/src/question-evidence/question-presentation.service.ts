import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type { ApiConfig } from '@elder-interview/config';
import type {
  SuggestionHistoryItem,
  SuggestionHistoryItemResponse,
  SuggestionHistoryPageResponse,
  SuggestionPresentationChangedPayload,
  SuggestionPresentationResponse,
  SuggestionRequestStatusResponse,
  SuggestionWithdrawalReason,
} from '@elder-interview/contracts';
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { API_CONFIG } from '../api-config.js';
import { AiJobCoordinatorService } from '../ai-runtime/ai-job-coordinator.service.js';
import { canonicalJson, manifestHash, sha256 } from '../ai-runtime/ai-provenance.js';
import { AiPolicyService } from '../ai-runtime/ai-policy.service.js';
import { AiDeletionActiveFixtureError } from '../ai-runtime/deletion-scope.reader.js';
import type { AuthPrincipal } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  Prisma,
  QuestionDisplaySnapshot,
  QuestionDisplayState,
  QuestionGenerationAttempt,
} from '../generated/prisma/client.js';
import {
  type QuestionEvidenceActorOrSystem,
  QuestionEvidenceWriter,
} from './question-evidence.service.js';
import {
  normalizeQuestionDigest,
  QUESTION_SIMILARITY_THRESHOLD,
  QuestionSimilarityMatcher,
} from './question-similarity.matcher.js';
import type {
  BeginQuestionGenerationCommand,
  PublishQuestionAttemptCommand,
  QuestionAttemptReceipt,
  QuestionPublicationResult,
  WithdrawQuestionPresentationCommand,
} from './question-presentation.types.js';

const AUTO_MIN_INTERVAL_MS = 20_000;
const AUTO_CURRENT_DWELL_MS = 15_000;
const AUTO_SCORE_DELTA = 0.12;
const MANUAL_MIN_INTERVAL_MS = 3_000;
const MANUAL_WINDOW_MS = 60_000;
const MANUAL_WINDOW_LIMIT = 6;
const SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export abstract class SuggestionPresentationNotifier {
  public abstract publish(
    sessionId: string,
    change: SuggestionPresentationChangedPayload,
  ): Promise<void>;
}

@Injectable()
export class NoopSuggestionPresentationNotifier extends SuggestionPresentationNotifier {
  public override publish(): Promise<void> {
    return Promise.resolve();
  }
}

@Injectable()
export class QuestionPresentationService extends QuestionEvidenceWriter {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly coordinator: AiJobCoordinatorService,
    private readonly policy: AiPolicyService,
    private readonly matcher: QuestionSimilarityMatcher,
    private readonly notifier: SuggestionPresentationNotifier,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {
    super();
  }

  public override async beginGenerationAttempt(
    command: BeginQuestionGenerationCommand,
    actorOrSystem: QuestionEvidenceActorOrSystem,
    requestId: string,
  ): Promise<QuestionAttemptReceipt> {
    const actorId = actorIdOf(actorOrSystem, command.job.requestedBy);
    return this.prisma.$transaction(async (tx) => {
      await lock(tx, `request:${requestId}`);
      await lock(tx, `project:${command.job.projectId}`);
      await lock(tx, `session:${command.sessionId}`);
      const replay = await tx.questionGenerationAttempt.findUnique({ where: { requestId } });
      if (replay !== null) {
        if (
          replay.aiJobId !== command.job.id ||
          replay.sessionId !== command.sessionId ||
          replay.basisPresentationRevision !== command.basisPresentationRevision ||
          replay.basisSnapshotId !== command.basisSnapshotId
        ) {
          throw conflict('IDEMPOTENCY_KEY_REUSED');
        }
        return {
          acceptedPresentationRevision: replay.basisPresentationRevision,
          attemptId: replay.id,
          manualIntentSequence: replay.manualIntentSequence,
          replayed: true,
          status: replay.status === 'pending' ? 'pending' : 'running',
          frozenInputHash: command.job.inputHash,
        };
      }
      const session = await tx.interviewSession.findUnique({ where: { id: command.sessionId } });
      if (session === null || session.projectId !== command.job.projectId) {
        throw new Error('AI_SESSION_SCOPE_INVALID');
      }
      await this.policy.assertAllowed(actorId, command.job.projectId, [command.sessionId], tx);
      const state = await ensureState(tx, command.sessionId, command.job.policyRevision);
      if (
        state.presentationRevision !== command.basisPresentationRevision ||
        state.currentSnapshotId !== command.basisSnapshotId
      ) {
        throw conflict('SUGGESTION_CURRENT_CHANGED');
      }
      const active = await tx.questionGenerationAttempt.findFirst({
        where: {
          attemptKind: command.attemptKind,
          sessionId: command.sessionId,
          status: { in: ['pending', 'running'] },
        },
      });
      if (active !== null) throw conflict('SUGGESTION_REQUEST_IN_PROGRESS');

      let manualIntentSequence = state.manualIntentSequence;
      const now = new Date();
      if (command.attemptKind === 'manual_next') {
        const lastAcceptedAt = state.lastManualAttemptAcceptedAt?.getTime() ?? 0;
        const acceptedInWindow = await tx.questionEvidenceEvent.count({
          where: {
            actorId,
            eventAt: { gte: new Date(now.getTime() - MANUAL_WINDOW_MS) },
            eventType: 'manual_next_requested',
            sessionId: command.sessionId,
          },
        });
        if (
          now.getTime() - lastAcceptedAt < MANUAL_MIN_INTERVAL_MS ||
          acceptedInWindow >= MANUAL_WINDOW_LIMIT
        ) {
          throw throttled(MANUAL_MIN_INTERVAL_MS);
        }
        manualIntentSequence += 1;
        await tx.questionDisplayState.update({
          data: { lastManualAttemptAcceptedAt: now, manualIntentSequence },
          where: { sessionId: command.sessionId },
        });
      }
      const attempt = await tx.questionGenerationAttempt.create({
        data: {
          aiJobId: command.job.id,
          attemptKind: command.attemptKind,
          basisPresentationRevision: command.basisPresentationRevision,
          basisSnapshotId: command.basisSnapshotId,
          journeyBasisHash: command.journeyBasisHash,
          journeyPolicyVersion: command.journeyPolicyVersion,
          journeyReasonCodes: [...command.journeyReasonCodes],
          journeyStage: command.journeyStage,
          contextBuilderDigest: command.contextBuilderDigest,
          contextBuilderVersion: command.contextBuilderVersion,
          contextSchemaDigest: command.contextSchemaDigest,
          contextSchemaVersion: command.contextSchemaVersion,
          manualIntentSequence,
          modelConfigDigest: command.modelConfigDigest,
          modelConfigVersion: command.modelConfigVersion,
          outputSchemaDigest: command.outputSchemaDigest,
          outputSchemaVersion: command.outputSchemaVersion,
          promptBundleDigest: command.promptBundleDigest,
          promptBundleVersion: command.promptBundleVersion,
          requestId,
          selectionPolicyVersion: command.selectionPolicyVersion,
          sessionId: command.sessionId,
          similarityPolicyVersion: command.similarityPolicyVersion,
          startedAt: now,
          status: 'running',
        },
      });
      for (const [inputOrder, reference] of command.bankReferences.entries()) {
        await tx.questionGenerationBankInputMembership.create({
          data: {
            aiJobId: command.job.id,
            bankVersion: reference.bankVersion,
            contentDigest: reference.contentDigest,
            inputOrder,
            licenseStatus: reference.licenseStatus,
            questionBankItemId: reference.itemId,
            questionId: reference.questionId,
          },
        });
      }
      const frozenInputHash = sha256(
        canonicalJson({
          aiJobInputHash: command.job.inputHash,
          bankReferences: command.bankReferences.map((reference) => ({
            bankVersion: reference.bankVersion,
            contentDigest: reference.contentDigest,
            itemId: reference.itemId,
            licenseStatus: reference.licenseStatus,
            questionId: reference.questionId,
          })),
          basisPresentationRevision: command.basisPresentationRevision,
          basisSnapshotId: command.basisSnapshotId,
          journeyBasisHash: command.journeyBasisHash,
          manualIntentSequence,
          versions: {
            contextBuilder: [command.contextBuilderVersion, command.contextBuilderDigest],
            contextSchema: [command.contextSchemaVersion, command.contextSchemaDigest],
            modelConfig: [command.modelConfigVersion, command.modelConfigDigest],
            outputSchema: [command.outputSchemaVersion, command.outputSchemaDigest],
            promptBundle: [command.promptBundleVersion, command.promptBundleDigest],
          },
        }),
      );
      await tx.aiJob.update({
        data: { inputHash: frozenInputHash },
        where: { id: command.job.id },
      });
      if (command.attemptKind === 'manual_next') {
        await createEvent(tx, {
          actorId,
          aiJobId: command.job.id,
          eventType: 'manual_next_requested',
          metadata: { attempt_id: attempt.id, manual_intent_sequence: manualIntentSequence },
          ownerKind: 'ai_job',
          sessionId: command.sessionId,
          snapshotId: state.currentSnapshotId,
        });
      }
      return {
        acceptedPresentationRevision: state.presentationRevision,
        attemptId: attempt.id,
        manualIntentSequence,
        replayed: false,
        status: 'running',
        frozenInputHash,
      };
    });
  }

  public override async publishAttemptResult(
    command: PublishQuestionAttemptCommand,
    actorOrSystem: QuestionEvidenceActorOrSystem,
    requestId: string,
  ): Promise<QuestionPublicationResult> {
    void requestId;
    const actorId = actorIdOf(actorOrSystem, command.job.requestedBy);
    const outcome = await this.coordinator.writeBack(command.job, async (tx) => {
      const attempt = await tx.questionGenerationAttempt.findUniqueOrThrow({
        where: { id: command.attemptId },
      });
      const state = await ensureState(tx, command.sessionId, command.job.policyRevision);
      const staleBasis =
        state.presentationRevision !== attempt.basisPresentationRevision ||
        state.currentSnapshotId !== attempt.basisSnapshotId;
      const supersededByManual =
        attempt.attemptKind === 'automatic' &&
        state.manualIntentSequence !== attempt.manualIntentSequence;
      if (staleBasis || supersededByManual) {
        const publicationOutcome = supersededByManual ? 'superseded_by_manual' : 'stale_basis';
        await tx.questionGenerationAttempt.update({
          data: {
            completedAt: new Date(),
            publicationOutcome,
            resultKind: command.resultKind,
            status: 'cancelled',
          },
          where: { id: attempt.id },
        });
        return { change: null, publicationOutcome } as const;
      }
      await this.policy.assertAllowed(actorId, command.job.projectId, [command.sessionId], tx);

      if (command.resultKind === 'suggestion' && command.candidate !== null) {
        const gate = await this.canPublishCandidate(
          tx,
          attempt,
          state,
          command.candidate,
          command.job.actualQuestions,
        );
        if (gate !== null) {
          await tx.questionGenerationAttempt.update({
            data: {
              completedAt: new Date(),
              publicationOutcome: gate,
              resultKind: 'suggestion',
              status: 'succeeded',
            },
            where: { id: attempt.id },
          });
          return { change: null, publicationOutcome: gate } as const;
        }
        const publication = await this.publishCandidate(tx, command, attempt, state, actorId);
        return publication;
      }

      if (attempt.attemptKind === 'automatic' && state.visibility === 'visible') {
        await tx.questionGenerationAttempt.update({
          data: {
            completedAt: new Date(),
            publicationOutcome: 'not_applicable',
            resultKind: command.resultKind,
            status: 'succeeded',
          },
          where: { id: attempt.id },
        });
        return { change: null, publicationOutcome: 'not_applicable' } as const;
      }
      const revision = state.presentationRevision + 1;
      await tx.questionDisplayState.update({
        data: {
          policyRevisionChecked: command.job.policyRevision,
          presentationKind: command.resultKind,
          presentationRevision: revision,
          visibility: 'none',
          withdrawalReason: null,
        },
        where: { sessionId: command.sessionId },
      });
      await tx.questionGenerationAttempt.update({
        data: {
          completedAt: new Date(),
          publicationOutcome: 'published',
          resultKind: command.resultKind,
          status: 'succeeded',
        },
        where: { id: attempt.id },
      });
      await createEvent(tx, {
        actorId,
        aiJobId: command.job.id,
        eventType:
          attempt.attemptKind === 'manual_next'
            ? command.resultKind === 'unavailable'
              ? 'manual_next_failed'
              : 'manual_next_committed'
            : command.resultKind === 'unavailable'
              ? 'presentation_unavailable'
              : 'presentation_continue_listening',
        metadata: { attempt_id: attempt.id, presentation_revision: revision },
        ownerKind: 'ai_job',
        sessionId: command.sessionId,
        snapshotId: null,
      });
      return {
        change: {
          change_kind: attempt.attemptKind === 'manual_next' ? 'manual_next' : 'initial_display',
          kind: command.resultKind,
          presentation_revision: revision,
          snapshot_id: null,
        },
        publicationOutcome: 'published',
      } as const;
    });
    if (outcome.change !== null) {
      await this.notifier.publish(command.sessionId, outcome.change).catch(() => undefined);
    }
    return {
      ...outcome,
      current: await this.currentByActorId(actorId, command.sessionId),
    };
  }

  public override async withdrawPresentation(
    command: WithdrawQuestionPresentationCommand,
    actorOrSystem: QuestionEvidenceActorOrSystem,
    requestId: string,
  ): Promise<void> {
    void requestId;
    const actorId = actorIdOf(actorOrSystem, null);
    const change = await this.prisma.$transaction(async (tx) => {
      await lock(tx, `project:${command.projectId}`);
      await lock(tx, `session:${command.sessionId}`);
      const state = await ensureState(tx, command.sessionId, 0);
      if (state.visibility === 'withdrawn' && state.withdrawalReason === command.reason)
        return null;
      const revision = state.presentationRevision + 1;
      await tx.questionDisplayState.update({
        data: {
          presentationRevision: revision,
          visibility: 'withdrawn',
          withdrawalReason: command.reason,
        },
        where: { sessionId: command.sessionId },
      });
      if (state.currentSnapshotId !== null) {
        await createEvent(tx, {
          actorId,
          eventType: 'hard_withdrawn',
          metadata: { presentation_revision: revision, reason: command.reason },
          ownerKind: 'display_snapshot',
          sessionId: command.sessionId,
          snapshotId: state.currentSnapshotId,
        });
      }
      return {
        change_kind: 'hard_withdrawal',
        kind: 'withdrawn',
        presentation_revision: revision,
        snapshot_id: state.currentSnapshotId,
      } satisfies SuggestionPresentationChangedPayload;
    });
    if (change !== null)
      await this.notifier.publish(command.sessionId, change).catch(() => undefined);
  }

  public async current(
    actor: AuthPrincipal,
    sessionId: string,
  ): Promise<SuggestionPresentationResponse> {
    await this.assertActorAccess(actor.id, sessionId);
    return this.currentByActorId(actor.id, sessionId);
  }

  public async history(
    actor: AuthPrincipal,
    sessionId: string,
    input: { anchor: string | null; cursor: string | null; limit: number },
  ): Promise<SuggestionHistoryPageResponse> {
    const session = await this.assertActorAccess(actor.id, sessionId);
    const [dynamicSafe, displayState] = await Promise.all([
      this.safeProjection(actor.id, session.projectId, sessionId),
      this.prisma.questionDisplayState.findUnique({ where: { sessionId } }),
    ]);
    const safe =
      dynamicSafe ??
      (displayState?.visibility === 'withdrawn'
        ? (displayState.withdrawalReason as SuggestionWithdrawalReason | null)
        : null);
    const decoded =
      input.cursor === null ? null : this.decodeCursor(input.cursor, sessionId, input.limit);
    const anchor =
      input.anchor === null
        ? await this.createAnchor(sessionId, input.limit)
        : this.decodeAnchor(input.anchor, sessionId, input.limit);
    if (decoded !== null && decoded.anchor !== anchor.token) throw invalidCursor();
    const direction = decoded?.direction ?? 'older';
    const rows = await this.prisma.questionDisplaySnapshot.findMany({
      orderBy:
        direction === 'older'
          ? [{ displaySequence: 'desc' }, { id: 'desc' }]
          : [{ displaySequence: 'asc' }, { id: 'asc' }],
      take: input.limit + 1,
      where: {
        displaySequence: { lte: anchor.sequence },
        retentionState: 'active',
        sessionId,
        ...(decoded === null
          ? {}
          : direction === 'older'
            ? {
                OR: [
                  { displaySequence: { lt: decoded.sequence } },
                  { displaySequence: decoded.sequence, id: { lt: decoded.id } },
                ],
              }
            : {
                OR: [
                  { displaySequence: { gt: decoded.sequence } },
                  { displaySequence: decoded.sequence, id: { gt: decoded.id } },
                ],
              }),
      },
    });
    const hasMore = rows.length > input.limit;
    const pageRows = rows.slice(0, input.limit);
    if (direction === 'newer') pageRows.reverse();
    const items = pageRows.map((row, index): SuggestionHistoryItem =>
      this.projectHistoryItem(row, safe, {
        anchor: anchor.token,
        hasNewer: direction === 'newer' ? index > 0 || hasMore : index > 0 || decoded !== null,
        hasOlder:
          direction === 'older'
            ? index < pageRows.length - 1 || hasMore
            : index < pageRows.length - 1 || decoded !== null,
        limit: input.limit,
        sessionId,
      }),
    );
    const boundary = direction === 'older' ? items.at(-1) : items.at(0);
    return {
      anchor: anchor.token,
      items,
      next_cursor:
        hasMore && boundary !== undefined
          ? this.encodeSigned({
              anchor: anchor.token,
              direction,
              id: boundary.snapshot_id,
              limit: input.limit,
              sequence: boundary.display_sequence,
              sessionId,
              type: 'cursor',
              version: 1,
            })
          : null,
      session_id: sessionId,
    };
  }

  public async historyItem(
    actor: AuthPrincipal,
    sessionId: string,
    snapshotId: string,
  ): Promise<SuggestionHistoryItemResponse> {
    const session = await this.assertActorAccess(actor.id, sessionId);
    const [dynamicSafe, displayState, row, anchor] = await Promise.all([
      this.safeProjection(actor.id, session.projectId, sessionId),
      this.prisma.questionDisplayState.findUnique({ where: { sessionId } }),
      this.prisma.questionDisplaySnapshot.findFirst({
        where: { id: snapshotId, retentionState: 'active', sessionId },
      }),
      this.createAnchor(sessionId, 20),
    ]);
    if (row === null || row.expiresAt <= new Date()) throw historyItemUnavailable();
    const safe =
      dynamicSafe ??
      (displayState?.visibility === 'withdrawn'
        ? (displayState.withdrawalReason as SuggestionWithdrawalReason | null)
        : null);
    const [older, newer] = await Promise.all([
      this.prisma.questionDisplaySnapshot.findFirst({
        orderBy: [{ displaySequence: 'desc' }, { id: 'desc' }],
        where: {
          OR: [
            { displaySequence: { lt: row.displaySequence } },
            { displaySequence: row.displaySequence, id: { lt: row.id } },
          ],
          retentionState: 'active',
          sessionId,
        },
      }),
      this.prisma.questionDisplaySnapshot.findFirst({
        orderBy: [{ displaySequence: 'asc' }, { id: 'asc' }],
        where: {
          OR: [
            { displaySequence: { gt: row.displaySequence } },
            { displaySequence: row.displaySequence, id: { gt: row.id } },
          ],
          retentionState: 'active',
          sessionId,
        },
      }),
    ]);
    return {
      anchor: anchor.token,
      item: this.projectHistoryItem(row, safe, {
        anchor: anchor.token,
        hasNewer: newer !== null,
        hasOlder: older !== null,
        limit: 20,
        sessionId,
      }),
      session_id: sessionId,
    };
  }

  public async status(
    actor: AuthPrincipal,
    sessionId: string,
    requestId: string,
  ): Promise<SuggestionRequestStatusResponse> {
    await this.assertActorAccess(actor.id, sessionId);
    const attempt = await this.prisma.questionGenerationAttempt.findUnique({
      where: { requestId },
    });
    if (attempt === null || attempt.sessionId !== sessionId) throw notFound();
    const job = await this.prisma.aiJob.findUnique({ where: { id: attempt.aiJobId } });
    if (job === null || job.requestedBy !== actor.id) throw new ForbiddenException(forbiddenBody());
    return {
      attempt_id: attempt.id,
      current: await this.currentByActorId(actor.id, sessionId),
      error_code: attempt.failureCode,
      publication_outcome:
        attempt.publicationOutcome as SuggestionRequestStatusResponse['publication_outcome'],
      request_id: requestId,
      result_kind: attempt.resultKind as SuggestionRequestStatusResponse['result_kind'],
      status: attempt.status as SuggestionRequestStatusResponse['status'],
    };
  }

  public async generationContext(sessionId: string): Promise<{
    currentQuestion: string | null;
    currentSnapshotId: string | null;
    journeyStage: 'rapport' | 'life_outline' | 'story_depth' | null;
    presentationRevision: number;
    recentQuestions: readonly string[];
  }> {
    const [state, latestAttempt, recent] = await Promise.all([
      this.prisma.questionDisplayState.findUnique({ where: { sessionId } }),
      this.prisma.questionGenerationAttempt.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: { sessionId, status: 'succeeded' },
      }),
      this.prisma.questionDisplaySnapshot.findMany({
        orderBy: [{ displaySequence: 'desc' }, { id: 'desc' }],
        take: 20,
        where: { retentionState: 'active', sessionId },
      }),
    ]);
    const current =
      state?.currentSnapshotId === null || state?.currentSnapshotId === undefined
        ? null
        : (recent.find(({ id }) => id === state.currentSnapshotId) ??
          (await this.prisma.questionDisplaySnapshot.findUnique({
            where: { id: state.currentSnapshotId },
          })));
    return {
      currentQuestion: current?.questionText ?? null,
      currentSnapshotId: state?.currentSnapshotId ?? null,
      journeyStage:
        (latestAttempt?.journeyStage as 'rapport' | 'life_outline' | 'story_depth' | undefined) ??
        null,
      presentationRevision: state?.presentationRevision ?? 0,
      recentQuestions: recent.map(({ questionText }) => questionText),
    };
  }

  public async assertManualAvailability(
    actorId: string,
    sessionId: string,
    requestId: string,
    expectedPresentationRevision: number,
    expectedSnapshotId: string | null,
  ): Promise<void> {
    const { projectId } = await this.assertActorAccess(actorId, sessionId);
    const rejection = await this.prisma.$transaction(async (tx) => {
      await lock(tx, `request:${requestId}`);
      await lock(tx, `project:${projectId}`);
      await lock(tx, `session:${sessionId}`);
      const replay = await tx.questionGenerationAttempt.findUnique({ where: { requestId } });
      if (replay !== null) return null;
      const persisted = await tx.idempotencyRecord.findUnique({ where: { requestId } });
      if (persisted !== null) {
        if (
          persisted.action !== 'question_suggestion.manual_next_throttled' ||
          persisted.actorId !== actorId ||
          persisted.targetType !== 'interview_session' ||
          persisted.targetId !== sessionId ||
          readNumber(persisted.responsePayload, 'expected_presentation_revision') !==
            expectedPresentationRevision ||
          readStringOrNull(persisted.responsePayload, 'expected_snapshot_id') !== expectedSnapshotId
        ) {
          throw conflict('IDEMPOTENCY_KEY_REUSED');
        }
        return throttleRetryAfter(persisted.responsePayload) ?? MANUAL_MIN_INTERVAL_MS;
      }
      const active = await tx.questionGenerationAttempt.findFirst({
        where: {
          attemptKind: 'manual_next',
          sessionId,
          status: { in: ['pending', 'running'] },
        },
      });
      if (active !== null) {
        throw new ConflictException({
          code: 'SUGGESTION_REQUEST_IN_PROGRESS',
          details: { request_id: active.requestId, retry_after_ms: 250 },
          message: 'A suggestion request is already in progress',
        });
      }
      const state = await tx.questionDisplayState.findUnique({ where: { sessionId } });
      if (
        (state?.presentationRevision ?? 0) !== expectedPresentationRevision ||
        (state?.currentSnapshotId ?? null) !== expectedSnapshotId
      ) {
        throw conflict('SUGGESTION_CURRENT_CHANGED');
      }
      const now = Date.now();
      const accepted = await tx.questionEvidenceEvent.findMany({
        orderBy: [{ eventAt: 'asc' }, { id: 'asc' }],
        select: { eventAt: true },
        where: {
          actorId,
          eventAt: { gte: new Date(now - MANUAL_WINDOW_MS) },
          eventType: 'manual_next_requested',
          sessionId,
        },
      });
      const intervalRemaining = Math.max(
        0,
        MANUAL_MIN_INTERVAL_MS - (now - (state?.lastManualAttemptAcceptedAt?.getTime() ?? 0)),
      );
      const windowRemaining =
        accepted.length >= MANUAL_WINDOW_LIMIT && accepted[0] !== undefined
          ? Math.max(0, accepted[0].eventAt.getTime() + MANUAL_WINDOW_MS - now)
          : 0;
      const retryAfterMs = Math.max(intervalRemaining, windowRemaining);
      if (retryAfterMs <= 0) return null;
      await tx.idempotencyRecord.create({
        data: {
          action: 'question_suggestion.manual_next_throttled',
          actorId,
          requestId,
          responsePayload: {
            code: 'AI_SUGGESTION_THROTTLED',
            expected_presentation_revision: expectedPresentationRevision,
            expected_snapshot_id: expectedSnapshotId,
            retry_after_ms: retryAfterMs,
          },
          targetId: sessionId,
          targetType: 'interview_session',
        },
      });
      return retryAfterMs;
    });
    if (rejection !== null) throw throttled(rejection);
  }

  public async failAttempt(attemptId: string, code = 'AI_UNAVAILABLE'): Promise<void> {
    const attempt = await this.prisma.questionGenerationAttempt.findUnique({
      where: { id: attemptId },
    });
    if (attempt === null || !['pending', 'running'].includes(attempt.status)) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.questionGenerationAttempt.update({
        data: {
          completedAt: new Date(),
          failureCode: code,
          publicationOutcome: 'policy_blocked',
          resultKind: 'unavailable',
          status: 'failed',
        },
        where: { id: attemptId },
      });
      await createEvent(tx, {
        actorId: null,
        aiJobId: attempt.aiJobId,
        eventType:
          attempt.attemptKind === 'manual_next' ? 'manual_next_failed' : 'presentation_unavailable',
        metadata: { attempt_id: attemptId, code },
        ownerKind: 'ai_job',
        sessionId: attempt.sessionId,
        snapshotId: attempt.basisSnapshotId,
      });
    });
  }

  private async publishCandidate(
    tx: Prisma.TransactionClient,
    command: PublishQuestionAttemptCommand,
    attempt: QuestionGenerationAttempt,
    state: QuestionDisplayState,
    actorId: string,
  ): Promise<{ change: SuggestionPresentationChangedPayload; publicationOutcome: 'published' }> {
    const candidate = command.candidate;
    if (candidate === null) throw new Error('QUESTION_CANDIDATE_REQUIRED');
    const candidateId = randomUUID();
    const outputId = randomUUID();
    const evidenceSegmentIds = candidate.grounding
      .filter((item): item is { kind: 'segment'; id: string } => item.kind === 'segment')
      .map(({ id }) => id);
    const memoryResolutionIds = candidate.grounding
      .filter((item): item is { kind: 'memory'; id: string } => item.kind === 'memory')
      .map(({ id }) => id);
    const segmentInputs = command.job.segments.filter(({ segmentId }) =>
      evidenceSegmentIds.includes(segmentId),
    );
    const memoryInputs = command.job.memories.filter(({ resolutionId }) =>
      memoryResolutionIds.includes(resolutionId),
    );
    if (
      segmentInputs.length !== new Set(evidenceSegmentIds).size ||
      memoryInputs.length !== new Set(memoryResolutionIds).size
    ) {
      throw new Error('AI_EVIDENCE_OUTSIDE_FROZEN_INPUT');
    }
    const segmentMemberships = await tx.aiJobInputSegment.findMany({
      orderBy: { inputOrder: 'asc' },
      where: { id: { in: segmentInputs.map(({ inputSegmentId }) => inputSegmentId) } },
    });
    const memoryMemberships = await tx.aiJobInputMemory.findMany({
      orderBy: { inputOrder: 'asc' },
      where: { id: { in: memoryInputs.map(({ inputMemoryId }) => inputMemoryId) } },
    });
    const segmentManifest = segmentMemberships.map(
      (item) =>
        `${item.id}:${item.transcriptSegmentId}:${String(item.textRevision)}:${String(item.speakerRoleRevision)}:${item.effectiveTextDigest}`,
    );
    const memoryManifest = memoryMemberships.map(
      (item) => `${item.id}:${item.memoryResolutionId}:${String(item.resolutionRevision)}`,
    );
    const questionManifest = command.job.actualQuestions.map(
      (item) =>
        `actual_question:${item.actualQuestionId}:${String(item.analysisRevision)}:${item.normalizedDigest}`,
    );
    await tx.aiDerivedOutput.create({
      data: {
        aiJobId: command.job.id,
        businessOutputId: candidateId,
        expectedMemoryCount: memoryManifest.length,
        expectedMemoryManifestHash: manifestHash(memoryManifest),
        expectedQuestionCount: questionManifest.length,
        expectedQuestionManifestHash: manifestHash(questionManifest),
        expectedSegmentCount: segmentManifest.length,
        expectedSegmentManifestHash: manifestHash(segmentManifest),
        id: outputId,
        outputType: 'question_candidate',
        projectId: command.job.projectId,
      },
    });
    await tx.questionCandidate.create({
      data: {
        aiDerivedOutputId: outputId,
        generationOrigin: 'model_generated',
        id: candidateId,
        journeyPolicyVersion: attempt.journeyPolicyVersion,
        journeyStage: attempt.journeyStage,
        normalizedQuestionDigest: normalizeQuestionDigest(candidate.questionText),
        purpose: candidate.purpose,
        questionGenerationAttemptId: attempt.id,
        questionText: candidate.questionText,
        reasonText: candidate.reasonText,
        risk: candidate.risk,
        selectionPolicyVersion: attempt.selectionPolicyVersion,
        selectionScore: candidate.selectionScore,
        similarityPolicyVersion: attempt.similarityPolicyVersion,
      },
    });
    const seen = await tx.questionGenerationBankInputMembership.findMany({
      where: { aiJobId: command.job.id },
    });
    const seenByItemId = new Map(
      seen.flatMap((item) =>
        item.questionBankItemId === null ? [] : [[item.questionBankItemId, item] as const],
      ),
    );
    for (const reference of candidate.declaredBankReferences) {
      const input = seenByItemId.get(reference.questionBankItemId);
      if (input === undefined) throw new Error('AI_BANK_REFERENCE_OUTSIDE_FROZEN_INPUT');
      const item = await tx.questionBankItem.findUnique({
        include: { release: true },
        where: { id: reference.questionBankItemId },
      });
      if (
        item === null ||
        item.questionId !== input.questionId ||
        item.release.bankVersion !== input.bankVersion
      ) {
        throw new Error('AI_BANK_REFERENCE_OUTSIDE_FROZEN_INPUT');
      }
      await tx.questionCandidateBankReference.create({
        data: {
          bank: item.bank,
          bankVersion: input.bankVersion,
          purpose: item.purpose,
          questionBankItemId: reference.questionBankItemId,
          questionCandidateId: candidateId,
          questionId: input.questionId,
          referenceUsage: reference.usage,
        },
      });
    }
    for (const [dependencyOrder, item] of segmentMemberships.entries()) {
      await tx.aiOutputSegmentDependency.create({
        data: {
          aiDerivedOutputId: outputId,
          aiJobInputSegmentId: item.id,
          dependencyOrder,
          id: randomUUID(),
        },
      });
    }
    for (const [dependencyOrder, item] of memoryMemberships.entries()) {
      await tx.aiOutputMemoryDependency.create({
        data: {
          aiDerivedOutputId: outputId,
          aiJobInputMemoryId: item.id,
          dependencyOrder,
          id: randomUUID(),
        },
      });
    }
    for (const [dependencyOrder, item] of command.job.actualQuestions.entries()) {
      await tx.aiOutputQuestionDependency.create({
        data: {
          aiDerivedOutputId: outputId,
          dependencyOrder,
          id: randomUUID(),
          targetDigest: item.normalizedDigest,
          targetId: item.actualQuestionId,
          targetKind: 'actual_question',
          targetRevision: item.analysisRevision,
        },
      });
    }
    const now = new Date();
    const revision = state.presentationRevision + 1;
    const snapshotId = randomUUID();
    await tx.questionDisplaySnapshot.create({
      data: {
        boundaryPolicyRevision: command.job.policyRevision,
        contextBuilderVersion: attempt.contextBuilderVersion,
        displaySequence: state.nextDisplaySequence,
        displayedAt: now,
        evidenceManifestHash: manifestHash(segmentManifest),
        expiresAt: new Date(now.getTime() + SNAPSHOT_TTL_MS),
        id: snapshotId,
        journeyPolicyVersion: attempt.journeyPolicyVersion,
        journeyStage: attempt.journeyStage,
        memoryManifestHash: manifestHash(memoryManifest),
        modelName: 'local-test-question-director',
        normalizedQuestionDigest: normalizeQuestionDigest(candidate.questionText),
        promptVersion: attempt.promptBundleVersion,
        publishedPresentationRevision: revision,
        purpose: candidate.purpose,
        questionCandidateId: candidateId,
        questionText: candidate.questionText,
        reasonText: candidate.reasonText,
        retentionPolicyVersion: command.job.retentionPolicyVersion,
        roleWatermarkHash: manifestHash(
          command.job.segments.map(
            ({ segmentId, inputSegmentId }) => `${inputSegmentId}:${segmentId}`,
          ),
        ),
        schemaVersion: attempt.outputSchemaVersion,
        selectionPolicyVersion: attempt.selectionPolicyVersion,
        selectionScore: candidate.selectionScore,
        sessionId: command.sessionId,
        similarityPolicyVersion: attempt.similarityPolicyVersion,
      },
    });
    await tx.questionDisplayState.update({
      data: {
        currentSnapshotId: snapshotId,
        lastAutoPublishedAt: attempt.attemptKind === 'automatic' ? now : state.lastAutoPublishedAt,
        nextDisplaySequence: state.nextDisplaySequence + 1,
        policyRevisionChecked: command.job.policyRevision,
        presentationKind: 'suggestion',
        presentationRevision: revision,
        visibility: 'visible',
        withdrawalReason: null,
      },
      where: { sessionId: command.sessionId },
    });
    await tx.questionGenerationAttempt.update({
      data: {
        completedAt: now,
        publicationOutcome: 'published',
        resultKind: 'suggestion',
        status: 'succeeded',
      },
      where: { id: attempt.id },
    });
    await createEvent(tx, {
      actorId,
      eventType:
        attempt.attemptKind === 'manual_next'
          ? 'manual_next_committed'
          : state.currentSnapshotId === null
            ? 'displayed'
            : 'automatic_replace_succeeded',
      metadata: { attempt_id: attempt.id, presentation_revision: revision },
      ownerKind: 'display_snapshot',
      sessionId: command.sessionId,
      snapshotId,
    });
    return {
      change: {
        change_kind:
          attempt.attemptKind === 'manual_next'
            ? 'manual_next'
            : state.currentSnapshotId === null
              ? 'initial_display'
              : 'automatic_replace',
        kind: 'suggestion',
        presentation_revision: revision,
        snapshot_id: snapshotId,
      },
      publicationOutcome: 'published',
    };
  }

  private async canPublishCandidate(
    tx: Prisma.TransactionClient,
    attempt: QuestionGenerationAttempt,
    state: QuestionDisplayState,
    candidate: NonNullable<PublishQuestionAttemptCommand['candidate']>,
    actualQuestions: readonly { actualQuestionId: string; normalizedDigest: string }[],
  ): Promise<'duplicate_filtered' | 'not_better' | null> {
    const seen = await tx.questionGenerationBankInputMembership.findMany({
      where: { aiJobId: attempt.aiJobId },
    });
    for (const input of seen) {
      if (input.questionBankItemId === null) return 'duplicate_filtered';
      const item = await tx.questionBankItem.findUnique({
        include: { release: true },
        where: { id: input.questionBankItemId },
      });
      const expectedScope = ['local', 'test'].includes(this.config.appEnv)
        ? 'internal_demo'
        : 'product';
      if (
        item === null ||
        !item.enabled ||
        item.release.status !== 'active' ||
        item.release.environmentScope !== expectedScope ||
        item.release.bankVersion !== input.bankVersion ||
        item.release.contentDigest !== input.contentDigest ||
        item.questionId !== input.questionId ||
        item.licenseStatus !== input.licenseStatus ||
        ![
          'project_original',
          'verified',
          ...(expectedScope === 'internal_demo' ? ['fixture_only'] : []),
        ].includes(item.licenseStatus)
      ) {
        return 'duplicate_filtered';
      }
    }
    const recent = await tx.questionDisplaySnapshot.findMany({
      orderBy: [{ displaySequence: 'desc' }, { id: 'desc' }],
      take: 20,
      where: { retentionState: 'active', sessionId: attempt.sessionId },
    });
    for (const prior of recent) {
      if (
        prior.normalizedQuestionDigest === normalizeQuestionDigest(candidate.questionText) ||
        (await this.matcher.score(prior.questionText, candidate.questionText)) >=
          QUESTION_SIMILARITY_THRESHOLD
      ) {
        return 'duplicate_filtered';
      }
    }
    for (const prior of actualQuestions) {
      const actual = await tx.actualQuestion.findUnique({ where: { id: prior.actualQuestionId } });
      if (
        actual !== null &&
        (actual.normalizedDigest === normalizeQuestionDigest(candidate.questionText) ||
          (await this.matcher.score(actual.questionText, candidate.questionText)) >=
            QUESTION_SIMILARITY_THRESHOLD)
      ) {
        return 'duplicate_filtered';
      }
    }
    if (attempt.attemptKind !== 'automatic' || state.currentSnapshotId === null) return null;
    const current = await tx.questionDisplaySnapshot.findUnique({
      where: { id: state.currentSnapshotId },
    });
    const now = Date.now();
    if (current === null) return null;
    if (current.journeyStage !== attempt.journeyStage) return null;
    if (
      now - current.displayedAt.getTime() < AUTO_CURRENT_DWELL_MS ||
      now - (state.lastAutoPublishedAt?.getTime() ?? 0) < AUTO_MIN_INTERVAL_MS ||
      candidate.selectionScore - Number(current.selectionScore) < AUTO_SCORE_DELTA
    ) {
      return 'not_better';
    }
    return null;
  }

  private async currentByActorId(
    actorId: string,
    sessionId: string,
  ): Promise<SuggestionPresentationResponse> {
    const session = await this.assertActorAccess(actorId, sessionId);
    const [state, historyCount] = await Promise.all([
      this.prisma.questionDisplayState.findUnique({ where: { sessionId } }),
      this.prisma.questionDisplaySnapshot.count({ where: { sessionId } }),
    ]);
    if (state === null) return emptyCurrent(sessionId);
    const safe = await this.safeProjection(actorId, session.projectId, sessionId);
    if (safe !== null) {
      if (state.visibility !== 'withdrawn' || state.withdrawalReason !== safe) {
        await this.withdrawPresentation(
          { projectId: session.projectId, reason: safe, sessionId },
          { actorId, kind: 'actor' },
          randomUUID(),
        );
      }
      const withdrawn = await this.prisma.questionDisplayState.findUniqueOrThrow({
        where: { sessionId },
      });
      return {
        ...emptyCurrent(sessionId),
        history: { has_previous: historyCount > 1 },
        kind: 'withdrawn',
        presentation_revision: withdrawn.presentationRevision,
        snapshot_id: withdrawn.currentSnapshotId,
        withdrawal_reason: safe,
      };
    }
    if (state.visibility === 'withdrawn') {
      return {
        ...emptyCurrent(sessionId),
        history: { has_previous: historyCount > 1 },
        kind: 'withdrawn',
        presentation_revision: state.presentationRevision,
        snapshot_id: state.currentSnapshotId,
        withdrawal_reason:
          (state.withdrawalReason as SuggestionWithdrawalReason | null) ?? 'policy_unavailable',
      };
    }
    if (state.presentationKind !== 'suggestion' || state.currentSnapshotId === null) {
      return {
        ...emptyCurrent(sessionId),
        history: { has_previous: historyCount > 1 },
        kind: state.presentationKind as 'continue_listening' | 'unavailable',
        presentation_revision: state.presentationRevision,
      };
    }
    const snapshot = await this.prisma.questionDisplaySnapshot.findUnique({
      where: { id: state.currentSnapshotId },
    });
    if (
      snapshot === null ||
      snapshot.retentionState !== 'active' ||
      snapshot.expiresAt <= new Date()
    ) {
      return {
        ...emptyCurrent(sessionId),
        kind: 'withdrawn',
        presentation_revision: state.presentationRevision,
        snapshot_id: state.currentSnapshotId,
        withdrawal_reason: 'policy_unavailable',
      };
    }
    return {
      display_sequence: snapshot.displaySequence,
      displayed_at: snapshot.displayedAt.toISOString(),
      history: { has_previous: historyCount > 1 },
      kind: 'suggestion',
      presentation_revision: state.presentationRevision,
      question: snapshot.questionText,
      reason: snapshot.reasonText,
      session_id: sessionId,
      snapshot_id: snapshot.id,
      withdrawal_reason: null,
    };
  }

  private async assertActorAccess(
    actorId: string,
    sessionId: string,
  ): Promise<{ projectId: string }> {
    const session = await this.prisma.interviewSession.findUnique({ where: { id: sessionId } });
    if (session === null) throw notFound();
    const assignment = await this.prisma.projectAssignment.findFirst({
      where: { projectId: session.projectId, revokedAt: null, userId: actorId },
    });
    if (assignment === null) throw new ForbiddenException(forbiddenBody());
    return { projectId: session.projectId };
  }

  private async safeProjection(
    actorId: string,
    projectId: string,
    sessionId: string,
  ): Promise<SuggestionWithdrawalReason | null> {
    const [project, consent] = await Promise.all([
      this.prisma.elderProject.findUnique({ where: { id: projectId } }),
      this.prisma.consentRecord.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        where: { consentType: 'recording_transcription_ai', projectId },
      }),
    ]);
    if (project === null || project.deletedAt !== null || project.status === 'restricted') {
      return 'restricted';
    }
    if (consent?.status !== 'valid' || consent.revokedAt !== null) return 'consent_revoked';
    try {
      await this.policy.assertAllowed(actorId, projectId, [sessionId]);
      return null;
    } catch (error) {
      return error instanceof AiDeletionActiveFixtureError
        ? 'deletion_active'
        : 'policy_unavailable';
    }
  }

  private async createAnchor(
    sessionId: string,
    limit: number,
  ): Promise<{ sequence: number; token: string }> {
    const latest = await this.prisma.questionDisplaySnapshot.findFirst({
      orderBy: [{ displaySequence: 'desc' }, { id: 'desc' }],
      where: { sessionId },
    });
    const sequence = latest?.displaySequence ?? 0;
    return {
      sequence,
      token: this.encodeSigned({ limit, sequence, sessionId, type: 'anchor', version: 1 }),
    };
  }

  private projectHistoryItem(
    row: QuestionDisplaySnapshot,
    safe: SuggestionWithdrawalReason | null,
    navigation: {
      anchor: string;
      hasNewer: boolean;
      hasOlder: boolean;
      limit: number;
      sessionId: string;
    },
  ): SuggestionHistoryItem {
    const cursor = (direction: 'newer' | 'older'): string =>
      this.encodeSigned({
        anchor: navigation.anchor,
        direction,
        id: row.id,
        limit: navigation.limit,
        sequence: row.displaySequence,
        sessionId: navigation.sessionId,
        type: 'cursor',
        version: 1,
      });
    const projection =
      safe !== null || row.expiresAt <= new Date()
        ? {
            kind: 'withdrawn' as const,
            question: null,
            reason: null,
            withdrawal_reason: safe ?? ('policy_unavailable' as const),
          }
        : {
            kind: 'suggestion' as const,
            question: row.questionText,
            reason: row.reasonText,
            withdrawal_reason: null,
          };
    return {
      display_sequence: row.displaySequence,
      displayed_at: row.displayedAt.toISOString(),
      newer_cursor: navigation.hasNewer ? cursor('newer') : null,
      older_cursor: navigation.hasOlder ? cursor('older') : null,
      snapshot_id: row.id,
      ...projection,
    };
  }

  private decodeAnchor(
    token: string,
    sessionId: string,
    limit: number,
  ): { sequence: number; token: string } {
    const value = this.decodeSigned(token);
    if (
      value.type !== 'anchor' ||
      value.sessionId !== sessionId ||
      value.limit !== limit ||
      typeof value.sequence !== 'number'
    ) {
      throw invalidCursor();
    }
    return { sequence: value.sequence, token };
  }

  private decodeCursor(
    token: string,
    sessionId: string,
    limit: number,
  ): { anchor: string; direction: 'newer' | 'older'; id: string; sequence: number } {
    const value = this.decodeSigned(token);
    if (
      value.type !== 'cursor' ||
      value.sessionId !== sessionId ||
      value.limit !== limit ||
      typeof value.anchor !== 'string' ||
      (value.direction !== undefined &&
        value.direction !== 'newer' &&
        value.direction !== 'older') ||
      typeof value.id !== 'string' ||
      typeof value.sequence !== 'number'
    ) {
      throw invalidCursor();
    }
    return {
      anchor: value.anchor,
      direction: value.direction === 'newer' ? 'newer' : 'older',
      id: value.id,
      sequence: value.sequence,
    };
  }

  private encodeSigned(value: Record<string, unknown>): string {
    const encoded = Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const signature = createHmac('sha256', this.config.aiRetentionCleanupPepper)
      .update(encoded)
      .digest('base64url');
    return `${encoded}.${signature}`;
  }

  private decodeSigned(token: string): Record<string, unknown> {
    const [encoded, provided, extra] = token.split('.');
    if (encoded === undefined || provided === undefined || extra !== undefined)
      throw invalidCursor();
    const expected = createHmac('sha256', this.config.aiRetentionCleanupPepper)
      .update(encoded)
      .digest('base64url');
    const left = Buffer.from(provided);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) throw invalidCursor();
    try {
      const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw invalidCursor();
      return value as Record<string, unknown>;
    } catch (error) {
      if (error instanceof UnprocessableEntityException) throw error;
      throw invalidCursor();
    }
  }
}

async function ensureState(
  tx: Prisma.TransactionClient,
  sessionId: string,
  policyRevision: number,
): Promise<QuestionDisplayState> {
  return tx.questionDisplayState.upsert({
    create: {
      manualIntentSequence: 0,
      nextDisplaySequence: 1,
      policyRevisionChecked: policyRevision,
      presentationKind: 'continue_listening',
      presentationRevision: 0,
      sessionId,
      visibility: 'none',
    },
    update: {},
    where: { sessionId },
  });
}

async function createEvent(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string | null;
    aiJobId?: string;
    eventType: string;
    metadata: Prisma.InputJsonValue;
    ownerKind: 'ai_job' | 'display_snapshot';
    sessionId: string;
    snapshotId: string | null;
  },
): Promise<void> {
  const snapshotOwner = input.ownerKind === 'display_snapshot' ? input.snapshotId : null;
  if (input.ownerKind === 'display_snapshot' && snapshotOwner === null) {
    throw new Error('QUESTION_EVENT_DISPLAY_OWNER_REQUIRED');
  }
  if (input.ownerKind === 'ai_job' && input.aiJobId === undefined) {
    throw new Error('QUESTION_EVENT_JOB_OWNER_REQUIRED');
  }
  await tx.questionEvidenceEvent.create({
    data: {
      actorId: input.actorId,
      eventAt: new Date(),
      eventType: input.eventType,
      id: randomUUID(),
      metadataJson: input.metadata,
      requestId: randomUUID(),
      retentionAiJobId: input.ownerKind === 'ai_job' ? (input.aiJobId ?? null) : null,
      retentionDisplaySnapshotId: snapshotOwner,
      retentionOwnerKind: input.ownerKind,
      sessionId: input.sessionId,
      snapshotId: input.snapshotId,
    },
  });
}

function actorIdOf(actor: QuestionEvidenceActorOrSystem, fallback: string | null): string {
  if (actor.kind === 'actor') return actor.actorId;
  if (fallback !== null) return fallback;
  throw new Error('QUESTION_ACTOR_REQUIRED');
}

function emptyCurrent(sessionId: string): SuggestionPresentationResponse {
  return {
    display_sequence: null,
    displayed_at: null,
    history: { has_previous: false },
    kind: 'continue_listening',
    presentation_revision: 0,
    question: null,
    reason: null,
    session_id: sessionId,
    snapshot_id: null,
    withdrawal_reason: null,
  };
}

async function lock(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

function conflict(code: string): ConflictException {
  return new ConflictException({ code, details: {}, message: 'Suggestion conflict' });
}

function invalidCursor(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'INVALID_SUGGESTION_CURSOR',
    details: {},
    message: 'Suggestion cursor is invalid',
  });
}

function notFound(): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', details: {}, message: 'Resource not found' });
}

function historyItemUnavailable(): GoneException {
  return new GoneException({
    code: 'SUGGESTION_HISTORY_ITEM_UNAVAILABLE',
    details: {},
    message: 'Suggestion history item is unavailable',
  });
}

function forbiddenBody(): { code: string; details: object; message: string } {
  return { code: 'FORBIDDEN', details: {}, message: 'Access denied' };
}

function throttled(retryAfterMs: number): HttpException {
  return new HttpException(
    {
      code: 'AI_SUGGESTION_THROTTLED',
      details: { retry_after_ms: retryAfterMs },
      message: 'Suggestion request throttled',
    },
    429,
  );
}

function throttleRetryAfter(payload: Prisma.JsonValue): number | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const value = payload.retry_after_ms;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function readNumber(value: unknown, key: string): number | null {
  if (typeof value !== 'object' || value === null || !(key in value)) return null;
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === 'number' ? nested : null;
}

function readStringOrNull(value: unknown, key: string): string | null | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const nested = (value as Record<string, unknown>)[key];
  return typeof nested === 'string' || nested === null ? nested : undefined;
}
