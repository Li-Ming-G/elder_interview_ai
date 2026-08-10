import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AiJobCoordinatorService } from '../ai-runtime/ai-job-coordinator.service.js';
import { AiOutputEligibilityService } from '../ai-runtime/ai-output-eligibility.service.js';
import { EMPTY_MANIFEST_HASH, manifestHash, sha256 } from '../ai-runtime/ai-provenance.js';
import { StructuredAiProvider } from '../ai-runtime/structured-ai.provider.js';
import { PrismaService } from '../database/prisma.service.js';
import { projectTrustedSpeakerRole } from '../transcription/trusted-speaker-role.js';
import {
  normalizeQuestionDigest,
  QUESTION_SIMILARITY_THRESHOLD,
  QUESTION_SIMILARITY_VERSION,
  QuestionSimilarityMatcher,
} from './question-similarity.matcher.js';
import type {
  BeginQuestionGenerationCommand,
  PublishQuestionAttemptCommand,
  QuestionAttemptReceipt,
  QuestionPublicationResult,
  WithdrawQuestionPresentationCommand,
} from './question-presentation.types.js';

export type QuestionEvidenceActorOrSystem =
  { actorId: string; kind: 'actor' } | { kind: 'system'; trigger: string };

/**
 * Stable DEV-007 write seam. DEV-006 owns and exports the port; generation and
 * presentation orchestration deliberately remain unavailable until DEV-007.
 */
export abstract class QuestionEvidenceWriter {
  public abstract beginGenerationAttempt(
    command: BeginQuestionGenerationCommand,
    actorOrSystem: QuestionEvidenceActorOrSystem,
    requestId: string,
  ): Promise<QuestionAttemptReceipt>;
  public abstract publishAttemptResult(
    command: PublishQuestionAttemptCommand,
    actorOrSystem: QuestionEvidenceActorOrSystem,
    requestId: string,
  ): Promise<QuestionPublicationResult>;
  public abstract withdrawPresentation(
    command: WithdrawQuestionPresentationCommand,
    actorOrSystem: QuestionEvidenceActorOrSystem,
    requestId: string,
  ): Promise<void>;
}

export interface ActualAskedItem {
  analysisRevision: number;
  id: string;
  normalizedDigest: string;
  questionText: string;
  sessionId: string;
}

@Injectable()
export class ActualAskedReader {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: AiOutputEligibilityService,
  ) {}

  public async list(actorId: string, projectId: string): Promise<readonly ActualAskedItem[]> {
    const analyses = await this.prisma.actualQuestionAnalysis.findMany({
      orderBy: [{ sessionId: 'asc' }, { analysisRevision: 'asc' }],
      where: {
        isCurrentPublished: true,
        judgeability: 'judgeable',
        projectId,
        status: 'succeeded',
      },
    });
    const result: ActualAskedItem[] = [];
    for (const analysis of analyses) {
      if (
        analysis.aiDerivedOutputId === null ||
        !(await this.eligibility.isEligible(actorId, analysis.aiDerivedOutputId))
      )
        continue;
      const questions = await this.prisma.actualQuestion.findMany({
        orderBy: [{ askedAtMs: 'asc' }, { id: 'asc' }],
        where: { actualQuestionAnalysisId: analysis.id },
      });
      result.push(
        ...questions.map((question) => ({
          analysisRevision: analysis.analysisRevision,
          id: question.id,
          normalizedDigest: question.normalizedDigest,
          questionText: question.questionText,
          sessionId: question.sessionId,
        })),
      );
    }
    return result;
  }
}

@Injectable()
export class QuestionEvidenceService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly coordinator: AiJobCoordinatorService,
    private readonly eligibility: AiOutputEligibilityService,
    private readonly provider: StructuredAiProvider,
    private readonly matcher: QuestionSimilarityMatcher,
  ) {}

  public async reconcileActualQuestions(input: {
    actorId: string;
    expiresAt: Date;
    projectId: string;
    requestId: string;
    sessionId: string;
  }): Promise<{ analysisId: string; judgeability: 'judgeable' | 'unjudged'; published: boolean }> {
    const [session, finalization] = await Promise.all([
      this.prisma.interviewSession.findUnique({
        include: { transcriptSegments: true },
        where: { id: input.sessionId },
      }),
      this.prisma.sessionFinalization.findUnique({ where: { sessionId: input.sessionId } }),
    ]);
    if (session === null || session.projectId !== input.projectId)
      throw new Error('AI_SESSION_SCOPE_INVALID');
    const hasUnknownConversation = session.transcriptSegments.some(
      (segment) =>
        segment.contentKind === 'conversation' &&
        projectTrustedSpeakerRole(segment).trustedEffectiveSpeakerRole === 'unknown',
    );
    const judgeable = finalization?.transcriptStatus === 'drained' && !hasUnknownConversation;
    const job = await this.coordinator.freeze({
      actorId: input.actorId,
      expiresAt: input.expiresAt,
      jobType: 'actual_question_reconcile',
      projectId: input.projectId,
      requestId: input.requestId,
      sessionIds: [input.sessionId],
      trustedRole: 'interviewer',
    });
    if (job.replayed) {
      const existing = await this.prisma.actualQuestionAnalysis.findUnique({
        where: { aiJobId: job.id },
      });
      if (job.status === 'succeeded' && existing !== null) {
        return {
          analysisId: existing.id,
          judgeability: existing.judgeability as 'judgeable' | 'unjudged',
          published: existing.isCurrentPublished,
        };
      }
      throw new Error(`AI_REQUEST_REPLAY_${job.status.toUpperCase()}`);
    }
    const now = new Date();
    const [displaySnapshots, evidenceEvents] = await Promise.all([
      this.prisma.questionDisplaySnapshot.findMany({
        orderBy: [{ displaySequence: 'asc' }, { id: 'asc' }],
        where: { expiresAt: { gt: now }, retentionState: 'active', sessionId: input.sessionId },
      }),
      this.prisma.questionEvidenceEvent.findMany({
        orderBy: [{ eventAt: 'asc' }, { id: 'asc' }],
        where: { sessionId: input.sessionId },
      }),
    ]);
    const consumableEvents: typeof evidenceEvents = [];
    for (const event of evidenceEvents) {
      const digest = sha256(`${event.eventType}:${event.eventAt.toISOString()}:${event.requestId}`);
      if (
        await this.eligibility.isQuestionTargetEligible(
          input.actorId,
          'evidence_event',
          event.id,
          0,
          digest,
          this.prisma,
        )
      ) {
        consumableEvents.push(event);
      }
    }
    const questionDependencies = [
      ...displaySnapshots.map((snapshot) => ({
        digest: snapshot.normalizedQuestionDigest,
        id: snapshot.id,
        kind: 'display_snapshot',
        revision: snapshot.publishedPresentationRevision,
      })),
      ...consumableEvents.map((event) => ({
        digest: sha256(`${event.eventType}:${event.eventAt.toISOString()}:${event.requestId}`),
        id: event.id,
        kind: 'evidence_event',
        revision: 0,
      })),
    ];
    const questions = judgeable
      ? await this.coordinator.callProvider(job, () =>
          this.provider.extractActualQuestions(job.segments),
        )
      : [];
    const matchesBySnapshot = new Map<string, number>();
    for (const snapshot of displaySnapshots) {
      let bestIndex = -1;
      let bestScore = 0;
      for (const [index, question] of questions.entries()) {
        const digest = normalizeQuestionDigest(question.questionText);
        const score =
          digest === snapshot.normalizedQuestionDigest
            ? 1
            : await this.matcher.score(snapshot.questionText, question.questionText);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      }
      if (bestIndex >= 0 && bestScore >= QUESTION_SIMILARITY_THRESHOLD) {
        matchesBySnapshot.set(snapshot.id, bestIndex);
      }
    }
    const analysisId = randomUUID();
    await this.coordinator.writeBack(job, async (tx) => {
      for (const dependency of questionDependencies) {
        if (
          !(await this.eligibility.isQuestionTargetEligible(
            input.actorId,
            dependency.kind,
            dependency.id,
            dependency.revision,
            dependency.digest,
            tx,
          ))
        ) {
          throw new Error('AI_QUESTION_DEPENDENCY_DRIFT');
        }
      }
      const previous = await tx.actualQuestionAnalysis.findFirst({
        orderBy: { analysisRevision: 'desc' },
        where: { sessionId: input.sessionId },
      });
      if (!judgeable) {
        await tx.actualQuestionAnalysis.create({
          data: {
            aiJobId: job.id,
            analysisRevision: (previous?.analysisRevision ?? 0) + 1,
            id: analysisId,
            judgeability: 'unjudged',
            projectId: input.projectId,
            semanticMatchVersion: QUESTION_SIMILARITY_VERSION,
            sessionId: input.sessionId,
            status: 'succeeded',
            transcriptStatus: finalization?.transcriptStatus ?? 'not_started',
          },
        });
        return;
      }
      const outputId = randomUUID();
      const segmentInputs = await tx.aiJobInputSegment.findMany({
        orderBy: { inputOrder: 'asc' },
        where: { aiJobId: job.id },
      });
      const segmentManifest = segmentInputs.map(
        (segment) =>
          `${segment.id}:${segment.transcriptSegmentId}:${String(segment.textRevision)}:${String(segment.speakerRoleRevision)}:${segment.effectiveTextDigest}`,
      );
      await tx.aiDerivedOutput.create({
        data: {
          aiJobId: job.id,
          businessOutputId: analysisId,
          expectedMemoryCount: 0,
          expectedMemoryManifestHash: EMPTY_MANIFEST_HASH,
          expectedQuestionCount: questionDependencies.length,
          expectedQuestionManifestHash: manifestHash(
            questionDependencies.map(
              (item) => `${item.kind}:${item.id}:${String(item.revision)}:${item.digest}`,
            ),
          ),
          expectedSegmentCount: segmentInputs.length,
          expectedSegmentManifestHash: manifestHash(segmentManifest),
          id: outputId,
          outputType: 'actual_question_catalog',
          projectId: input.projectId,
        },
      });
      await tx.actualQuestionAnalysis.updateMany({
        data: { isCurrentPublished: false, status: 'superseded' },
        where: { isCurrentPublished: true, sessionId: input.sessionId },
      });
      await tx.actualQuestionAnalysis.create({
        data: {
          aiDerivedOutputId: outputId,
          aiJobId: job.id,
          analysisRevision: (previous?.analysisRevision ?? 0) + 1,
          id: analysisId,
          isCurrentPublished: true,
          judgeability: 'judgeable',
          projectId: input.projectId,
          publishedAt: new Date(),
          replacesAnalysisId: previous?.isCurrentPublished === true ? previous.id : null,
          semanticMatchVersion: QUESTION_SIMILARITY_VERSION,
          sessionId: input.sessionId,
          status: 'succeeded',
          transcriptStatus: 'drained',
        },
      });
      for (const [order, segment] of segmentInputs.entries()) {
        await tx.aiOutputSegmentDependency.create({
          data: {
            aiDerivedOutputId: outputId,
            aiJobInputSegmentId: segment.id,
            dependencyOrder: order,
            id: randomUUID(),
          },
        });
      }
      for (const [dependencyOrder, item] of questionDependencies.entries()) {
        await tx.aiOutputQuestionDependency.create({
          data: {
            aiDerivedOutputId: outputId,
            dependencyOrder,
            id: randomUUID(),
            targetDigest: item.digest,
            targetId: item.id,
            targetKind: item.kind,
            targetRevision: item.revision,
          },
        });
      }
      const createdQuestionIds: string[] = [];
      const matchedQuestionIndexes = new Set(matchesBySnapshot.values());
      for (const [questionIndex, question] of questions.entries()) {
        const actualQuestionId = randomUUID();
        await tx.actualQuestion.create({
          data: {
            actualQuestionAnalysisId: analysisId,
            askedAtMs: question.askedAtMs,
            id: actualQuestionId,
            normalizedDigest: normalizeQuestionDigest(question.questionText),
            questionText: question.questionText,
            sessionId: input.sessionId,
            sourceKind: matchedQuestionIndexes.has(questionIndex)
              ? 'matched_system_suggestion'
              : question.sourceKind,
          },
        });
        createdQuestionIds.push(actualQuestionId);
        for (const [evidenceOrder, segmentId] of question.evidenceSegmentIds.entries()) {
          const membership = segmentInputs.find(
            (segment) => segment.transcriptSegmentId === segmentId,
          );
          if (membership === undefined) throw new Error('AI_EVIDENCE_OUTSIDE_FROZEN_INPUT');
          await tx.actualQuestionEvidence.create({
            data: {
              actualQuestionId,
              aiJobInputSegmentId: membership.id,
              evidenceOrder,
              id: randomUUID(),
              transcriptSegmentId: segmentId,
            },
          });
        }
      }
      const replaceSnapshotIds = new Set(
        consumableEvents
          .filter((event) =>
            ['automatic_replace_succeeded', 'manual_next_committed'].includes(event.eventType),
          )
          .flatMap((event) => (event.snapshotId === null ? [] : [event.snapshotId])),
      );
      for (const snapshot of displaySnapshots) {
        const matchedIndex = matchesBySnapshot.get(snapshot.id);
        const matchedActualQuestionId =
          matchedIndex === undefined ? undefined : createdQuestionIds[matchedIndex];
        await tx.suggestionOutcome.create({
          data: {
            actualQuestionAnalysisId: analysisId,
            id: randomUUID(),
            matchedActualQuestionId: matchedActualQuestionId ?? null,
            outcome:
              matchedActualQuestionId !== undefined
                ? 'actual_asked'
                : replaceSnapshotIds.has(snapshot.id)
                  ? 'explicitly_replaced'
                  : 'not_observed',
            questionDisplaySnapshotId: snapshot.id,
            semanticMatchVersion: QUESTION_SIMILARITY_VERSION,
          },
        });
      }
    });
    return { analysisId, judgeability: judgeable ? 'judgeable' : 'unjudged', published: judgeable };
  }
}

export { normalizeQuestionDigest } from './question-similarity.matcher.js';
