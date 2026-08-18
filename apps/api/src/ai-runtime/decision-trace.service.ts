import { randomUUID } from 'node:crypto';

import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import {
  Prisma,
  type DecisionTrace,
  type QuestionGenerationAttempt,
} from '../generated/prisma/client.js';
import { projectTrustedSpeakerRole } from '../transcription/trusted-speaker-role.js';
import { canonicalJson, effectiveTextDigest, manifestHash, sha256 } from './ai-provenance.js';

export type DecisionTraceOutcome =
  'question' | 'continue_listening' | 'system_error' | 'unavailable';
export type DecisionTraceStatus =
  'running' | 'succeeded' | 'failed' | 'cancelled' | 'stale' | 'unavailable';
export type DecisionTraceMemoryTriggerKind =
  'batch_threshold' | 'time_threshold' | 'session_final_flush';

export interface DecisionTraceTerminalResult {
  status: Exclude<DecisionTraceStatus, 'running'>;
  decisionOutcome?: DecisionTraceOutcome;
  errorCode?: string | null;
  completedAt?: Date;
  publicationOutcome?: string | null;
  stage?: string | null;
}

export const DECISION_TRACE_MEMORY_TRIGGER_VERSION = 'decision-trace-memory-trigger-v1';
export const DECISION_TRACE_USEFUL_CHARACTER_POLICY_VERSION =
  'memory-useful-characters-nfkc-ws-codepoint-v1';
const MEMORY_MAINTAINER_V12_CONTEXT_VERSION = 'memory-maintainer-v1.2';

export interface DecisionTraceInput {
  projectId: string;
  sessionId: string;
  ownerActorId: string;
  requestId: string;
  generationId?: string;
  aiJobId?: string | null;
  attemptId?: string | null;
  triggerType: string;
  decisionOutcome: DecisionTraceOutcome;
  directorInvoked: boolean;
  stage?: string | null;
  gateReason?: string | null;
  errorCode?: string | null;
  startedAt?: Date;
  contextRevision: number;
  workingRevision: number | null;
  activeThreadId?: string | null;
  inputHash: string;
  contextDigest?: string | null;
  stageTimingsMs?: Record<string, number>;
  expiresAt?: Date;
  transcriptMemberships?: readonly DecisionTraceTranscriptInput[];
  memoryMemberships?: readonly DecisionTraceMemoryInput[];
  p3Candidates?: readonly DecisionTraceP3Input[];
  p4Memberships?: readonly DecisionTraceP4Input[];
  evidenceCalls?: readonly DecisionTraceEvidenceInput[];
  memoryTriggerObservation?: DecisionTraceMemoryTriggerObservationInput;
}

export interface DecisionTraceMemoryTriggerObservationInput {
  aiJobId: string;
  triggerIdentity: string;
  triggerKind: DecisionTraceMemoryTriggerKind;
  selectedNewSegmentCount: number;
  cumulativeUsefulCharacters: number;
  minimumUsefulCharacters: number;
  selectedNewMemberships: readonly DecisionTraceMemoryTriggerSegmentInput[];
}

export interface DecisionTraceMemoryTriggerSegmentInput {
  transcriptSegmentId: string;
  textRevision: number;
  speakerRoleRevision: number;
  effectiveTextDigest: string;
  usefulCharacterCount: number;
  inputOrder: number;
}

export interface DecisionTraceTranscriptInput {
  segmentId: string;
  textRevision: number;
  speakerRoleRevision: number;
  effectiveTextDigest: string;
  inputOrder: number;
}

export interface DecisionTraceMemoryInput {
  memoryId: string;
  layer: string;
  revision: number | null;
  membershipRole: string;
  inputOrder: number;
}

export interface DecisionTraceP3Input {
  candidateId: string;
  memoryId: string;
  sourceLayer: string;
  retrievalSources: readonly string[];
  embeddingScore?: number | null;
  graphDistance?: number | null;
  rank: number;
  included: boolean;
  exclusionReason?: string | null;
}

export interface DecisionTraceP4Input {
  section: string;
  sourceType: string;
  sourceId: string;
  revision: number | null;
  revisionStatus: 'available' | 'unavailable';
  sourceVersion?: string | null;
  membershipDigest?: string | null;
  inputOrder: number;
  included: boolean;
  dropReason?: string | null;
}

export interface DecisionTraceEvidenceInput {
  callId: string;
  tool: string;
  targetType: string;
  targetId: string;
  resultIds: readonly string[];
  status: string;
  invocationNo: number;
  requestDigest?: string | null;
  resultDigest?: string | null;
}

@Injectable()
export class DecisionTraceService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;

  public constructor(private readonly prisma: PrismaService) {}

  public async onModuleInit(): Promise<void> {
    await this.reconcileMissingAttempts();
    await this.reconcileRunning();
    this.timer = setInterval(() => {
      void this.reconcileMissingAttempts()
        .then(() => this.reconcileRunning())
        .catch(() => undefined);
    }, 30_000);
    this.timer.unref();
  }

  public onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  public async begin(input: DecisionTraceInput): Promise<DecisionTrace> {
    return this.persist(input, null);
  }

  public beginInTransaction(
    tx: Prisma.TransactionClient,
    input: DecisionTraceInput,
  ): Promise<DecisionTrace> {
    return this.persistInTransaction(
      tx,
      input,
      null,
      input.startedAt ?? new Date(),
      input.generationId ?? randomUUID(),
      normalizeMemoryTriggerObservation(input),
    );
  }

  public async recordTerminal(
    input: DecisionTraceInput,
    result: DecisionTraceTerminalResult,
  ): Promise<DecisionTrace> {
    return this.persist(input, result);
  }

  public recordTerminalInTransaction(
    tx: Prisma.TransactionClient,
    input: DecisionTraceInput,
    result: DecisionTraceTerminalResult,
  ): Promise<DecisionTrace> {
    return this.persistInTransaction(
      tx,
      input,
      result,
      input.startedAt ?? new Date(),
      input.generationId ?? randomUUID(),
      normalizeMemoryTriggerObservation(input),
    );
  }

  private async persist(
    input: DecisionTraceInput,
    terminal: DecisionTraceTerminalResult | null,
  ): Promise<DecisionTrace> {
    const startedAt = input.startedAt ?? new Date();
    const generationId = input.generationId ?? randomUUID();
    const observation = normalizeMemoryTriggerObservation(input);
    try {
      return await this.prisma.$transaction((tx) =>
        this.persistInTransaction(tx, input, terminal, startedAt, generationId, observation),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.decisionTrace.findUnique({
          include: {
            memoryTriggerObservation: { include: { selectedNewMemberships: true } },
          },
          where: { requestId: input.requestId },
        });
        if (winner !== null) {
          assertMemoryTriggerReplay(winner, input, observation);
          return winner;
        }
      }
      throw error;
    }
  }

  private async persistInTransaction(
    tx: Prisma.TransactionClient,
    input: DecisionTraceInput,
    terminal: DecisionTraceTerminalResult | null,
    startedAt: Date,
    generationId: string,
    observation: NormalizedMemoryTriggerObservation | null,
  ): Promise<DecisionTrace> {
    await lockTraceRequest(tx, input.requestId);
    const replay = await tx.decisionTrace.findUnique({
      include: {
        memoryTriggerObservation: { include: { selectedNewMemberships: true } },
      },
      where: { requestId: input.requestId },
    });
    if (replay !== null) {
      assertMemoryTriggerReplay(replay, input, observation);
      if (terminal === null || replay.status !== 'running') return replay;
      const completedAt = terminal.completedAt ?? new Date();
      const durationMs = boundedDurationMs(replay.startedAt, completedAt);
      return tx.decisionTrace.update({
        data: terminalData(terminal, completedAt, durationMs, replay.stageTimingsJson),
        where: { id: replay.id },
      });
    }
    if (observation !== null) await assertMemoryTriggerSource(tx, input, observation);
    const completedAt = terminal?.completedAt ?? null;
    const durationMs = completedAt === null ? null : boundedDurationMs(startedAt, completedAt);
    return tx.decisionTrace.create({
      data: {
        activeThreadId: input.activeThreadId ?? null,
        aiJobId: input.aiJobId ?? null,
        attemptId: input.attemptId ?? null,
        contextDigest: input.contextDigest ?? null,
        contextRevision: input.contextRevision,
        createdAt: startedAt,
        decisionOutcome: input.decisionOutcome,
        directorInvoked: input.directorInvoked,
        expiresAt: input.expiresAt ?? new Date(startedAt.getTime() + 30 * 24 * 60 * 60 * 1_000),
        generationId,
        gateReason: input.gateReason ?? null,
        id: randomUUID(),
        inputHash: input.inputHash,
        memoryMemberships: { create: (input.memoryMemberships ?? []).map(toMemoryRow) },
        ownerActorId: input.ownerActorId,
        p3Candidates: { create: (input.p3Candidates ?? []).map(toP3Row) },
        p4Memberships: { create: (input.p4Memberships ?? []).map(toP4Row) },
        projectId: input.projectId,
        requestId: input.requestId,
        sessionId: input.sessionId,
        stage: input.stage ?? null,
        stageTimingsJson: input.stageTimingsMs ?? {},
        startedAt,
        status: 'running',
        transcriptMemberships: {
          create: (input.transcriptMemberships ?? []).map(toTranscriptRow),
        },
        triggerType: input.triggerType,
        workingRevision: input.workingRevision,
        evidenceCalls: { create: (input.evidenceCalls ?? []).map(toEvidenceRow) },
        errorCode: input.errorCode ?? null,
        ...(terminal === null
          ? {}
          : terminalData(terminal, completedAt ?? new Date(), durationMs ?? 0, {})),
        ...(observation === null
          ? {}
          : {
              memoryTriggerObservation: {
                create: {
                  aiJobId: observation.aiJobId,
                  cumulativeUsefulCharacters: observation.cumulativeUsefulCharacters,
                  id: randomUUID(),
                  minimumUsefulCharacters: observation.minimumUsefulCharacters,
                  observationVersion: DECISION_TRACE_MEMORY_TRIGGER_VERSION,
                  selectedNewManifestHash: observation.selectedNewManifestHash,
                  selectedNewMemberships: {
                    create: observation.selectedNewMemberships.map((membership) => ({
                      ...membership,
                      id: randomUUID(),
                    })),
                  },
                  selectedNewSegmentCount: observation.selectedNewSegmentCount,
                  triggerIdentity: observation.triggerIdentity,
                  triggerKind: observation.triggerKind,
                  usefulCharacterPolicyVersion: DECISION_TRACE_USEFUL_CHARACTER_POLICY_VERSION,
                },
              },
            }),
      },
    });
  }

  public async finalize(
    traceId: string,
    result: {
      status: Exclude<DecisionTraceStatus, 'running'>;
      decisionOutcome?: DecisionTraceOutcome;
      errorCode?: string | null;
      completedAt?: Date;
      directorInvoked?: boolean;
      publicationOutcome?: string | null;
      stage?: string | null;
    },
  ): Promise<void> {
    const completedAt = result.completedAt ?? new Date();
    const identity = await this.prisma.decisionTrace.findUnique({
      select: { requestId: true },
      where: { id: traceId },
    });
    if (identity === null) throw new Error('DECISION_TRACE_TERMINAL_OR_MISSING');
    await this.prisma.$transaction(async (tx) => {
      await lockTraceRequest(tx, identity.requestId);
      const current = await tx.decisionTrace.findUnique({ where: { id: traceId } });
      if (current === null || current.status !== 'running') {
        throw new Error('DECISION_TRACE_TERMINAL_OR_MISSING');
      }
      if (
        current.attemptId !== null &&
        (result.status === 'succeeded' ||
          result.status === 'cancelled' ||
          result.status === 'stale') &&
        (current.stage !== 'context_frozen' || current.contextDigest === null)
      ) {
        throw new Error('DECISION_TRACE_CONTEXT_NOT_FROZEN');
      }
      const directorInvoked =
        current.triggerType !== 'working_memory_maintain' &&
        current.aiJobId !== null &&
        (await tx.aiProviderCall.count({ where: { aiJobId: current.aiJobId } })) > 0;
      const durationMs = boundedDurationMs(current.startedAt, completedAt);
      const updated = await tx.decisionTrace.updateMany({
        data: {
          completedAt,
          ...(result.decisionOutcome === undefined
            ? {}
            : { decisionOutcome: result.decisionOutcome }),
          directorInvoked,
          ...(result.publicationOutcome === undefined
            ? {}
            : {
                publicationOutcome: result.publicationOutcome,
                gateReason:
                  result.publicationOutcome === null || result.publicationOutcome === 'published'
                    ? null
                    : result.publicationOutcome,
              }),
          ...(result.stage === undefined ? {} : { stage: result.stage }),
          durationMs,
          errorCode: result.errorCode ?? null,
          stageTimingsJson: terminalStageTimings(current.stageTimingsJson, durationMs),
          status: result.status,
        },
        where: { id: traceId, status: 'running' },
      });
      if (updated.count !== 1) throw new Error('DECISION_TRACE_TERMINAL_OR_MISSING');
    });
  }

  public async attachReferences(
    traceId: string,
    refs: Pick<DecisionTraceInput, 'p3Candidates' | 'p4Memberships' | 'evidenceCalls'> & {
      contextDigest?: string | null;
    },
  ): Promise<void> {
    const identity = await this.prisma.decisionTrace.findUnique({
      select: { requestId: true },
      where: { id: traceId },
    });
    if (identity === null) throw new Error('DECISION_TRACE_TERMINAL_OR_MISSING');
    await this.prisma.$transaction(
      async (tx) => {
        await lockTraceRequest(tx, identity.requestId);
        const trace = await tx.decisionTrace.findUnique({ where: { id: traceId } });
        if (trace === null || trace.status !== 'running') {
          throw new Error('DECISION_TRACE_TERMINAL_OR_MISSING');
        }
        const p3Candidates = refs.p3Candidates ?? [];
        const p4Memberships = refs.p4Memberships ?? [];
        const evidenceCalls = refs.evidenceCalls ?? [];
        if (p3Candidates.length > 0) {
          await tx.decisionTraceP3Candidate.createMany({
            data: p3Candidates.map((value) => ({ ...toP3Row(value), traceId, id: randomUUID() })),
            skipDuplicates: true,
          });
        }
        if (p4Memberships.length > 0) {
          await tx.decisionTraceP4Membership.deleteMany({ where: { traceId } });
          await tx.decisionTraceP4Membership.createMany({
            data: p4Memberships.map((value) => ({ ...toP4Row(value), traceId, id: randomUUID() })),
            skipDuplicates: true,
          });
        }
        if (evidenceCalls.length > 0) {
          await tx.decisionTraceEvidenceCall.createMany({
            data: evidenceCalls.map((value) => ({
              ...toEvidenceRow(value),
              traceId,
              id: randomUUID(),
            })),
            skipDuplicates: true,
          });
        }
        await tx.decisionTrace.update({
          data: { contextDigest: refs.contextDigest ?? null, stage: 'context_frozen' },
          where: { id: traceId },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  public async recoverAttempt(attemptId: string): Promise<string> {
    return this.prisma.$transaction(
      async (tx) => {
        const identity = await tx.questionGenerationAttempt.findUniqueOrThrow({
          select: { requestId: true },
          where: { id: attemptId },
        });
        await lockTraceRequest(tx, identity.requestId);
        let attempt = await tx.questionGenerationAttempt.findUniqueOrThrow({
          where: { id: attemptId },
        });
        const existing = await tx.decisionTrace.findUnique({
          where: { requestId: attempt.requestId },
        });
        const frozenReferenceCounts =
          existing === null
            ? null
            : await Promise.all([
                tx.decisionTraceP4Membership.count({ where: { traceId: existing.id } }),
                tx.decisionTraceTranscriptMembership.count({ where: { traceId: existing.id } }),
                tx.decisionTraceMemoryMembership.count({ where: { traceId: existing.id } }),
                tx.decisionTraceP3Candidate.count({ where: { traceId: existing.id } }),
                tx.decisionTraceEvidenceCall.count({ where: { traceId: existing.id } }),
              ]);
        // Once context has been frozen, all later orchestration stages carry
        // the same authoritative snapshot. Recovery may terminalize child
        // state, but must never replace that snapshot with a projection
        // rebuilt from mutable job rows. In particular, a crash after the
        // publication/attempt commit but before trace projection can leave the
        // trace in `director` or `publication`; those stages are still frozen.
        const hasFrozenReferences =
          existing !== null &&
          (existing.stage === 'context_frozen' ||
            existing.stage === 'director' ||
            existing.stage === 'publication') &&
          existing.contextDigest !== null &&
          (frozenReferenceCounts?.[0] ?? 0) > 0;
        const now = new Date();
        let preserveTerminalTrace = false;
        if (existing !== null && existing.status !== 'running') {
          if (attempt.status === 'pending' || attempt.status === 'running') {
            preserveTerminalTrace = await terminalizeAttemptFromTrace(tx, attempt, existing, now);
            attempt = await tx.questionGenerationAttempt.findUniqueOrThrow({
              where: { id: attemptId },
            });
          }
          await terminalizeRunningJobFromAttempt(tx, attempt, existing, now);
          const currentJob = await tx.aiJob.findUniqueOrThrow({ where: { id: attempt.aiJobId } });
          if (
            !preserveTerminalTrace &&
            traceMatchesAttempt(existing, attempt) &&
            currentJob.status !== 'pending' &&
            currentJob.status !== 'running'
          ) {
            return existing.id;
          }
        }
        const stale = attempt.createdAt < new Date(now.getTime() - 30_000);
        if (stale && (attempt.status === 'running' || attempt.status === 'pending')) {
          await tx.questionGenerationAttempt.update({
            data: {
              completedAt: now,
              failureCode: 'SYSTEM_COORDINATOR_RESTARTED',
              publicationOutcome: 'policy_blocked',
              resultKind: 'unavailable',
              status: 'failed',
            },
            where: { id: attempt.id },
          });
          await tx.aiJob.updateMany({
            data: {
              completedAt: now,
              failureCode: 'SYSTEM_COORDINATOR_RESTARTED',
              status: 'failed',
            },
            where: { id: attempt.aiJobId, status: { in: ['pending', 'running'] } },
          });
        }
        const [
          terminalAttempt,
          aiJob,
          segments,
          memories,
          actualQuestions,
          scopes,
          bank,
          snapshot,
        ] = await Promise.all([
          tx.questionGenerationAttempt.findUniqueOrThrow({ where: { id: attempt.id } }),
          tx.aiJob.findUniqueOrThrow({ where: { id: attempt.aiJobId } }),
          tx.aiJobInputSegment.findMany({
            orderBy: { inputOrder: 'asc' },
            where: { aiJobId: attempt.aiJobId },
          }),
          tx.aiJobInputMemory.findMany({
            orderBy: { inputOrder: 'asc' },
            where: { aiJobId: attempt.aiJobId },
          }),
          tx.aiJobInputActualQuestion.findMany({
            orderBy: { inputOrder: 'asc' },
            where: { aiJobId: attempt.aiJobId },
          }),
          tx.aiJobSessionScope.findMany({
            orderBy: { inputOrder: 'asc' },
            where: { aiJobId: attempt.aiJobId },
          }),
          tx.questionGenerationBankInputMembership.findMany({
            orderBy: { inputOrder: 'asc' },
            where: { aiJobId: attempt.aiJobId },
          }),
          attempt.basisSnapshotId === null
            ? null
            : tx.questionDisplaySnapshot.findUnique({ where: { id: attempt.basisSnapshotId } }),
        ]);
        const p4: DecisionTraceP4Input[] = [];
        for (const scope of scopes) {
          p4.push({
            section: 'interview_state',
            sourceType: 'session',
            sourceId: scope.sessionId,
            revision: scope.speakerRoleRevision,
            revisionStatus: 'available',
            sourceVersion: null,
            membershipDigest: scope.segmentManifestHash,
            inputOrder: p4.length,
            included: true,
            dropReason: null,
          });
        }
        for (const memory of memories) {
          p4.push({
            section: 'working_memory',
            sourceType: 'memory',
            sourceId: memory.memoryResolutionId,
            revision: memory.resolutionRevision,
            revisionStatus: 'available',
            sourceVersion: null,
            membershipDigest: null,
            inputOrder: p4.length,
            included: true,
            dropReason: null,
          });
        }
        for (const segment of segments) {
          p4.push({
            section: 'recent_transcript',
            sourceType: 'transcript_segment',
            sourceId: segment.transcriptSegmentId,
            revision: segment.textRevision,
            revisionStatus: 'available',
            sourceVersion: null,
            membershipDigest: segment.effectiveTextDigest,
            inputOrder: p4.length,
            included: true,
            dropReason: null,
          });
        }
        for (const actual of actualQuestions) {
          p4.push({
            section: 'actual_asked',
            sourceType: 'actual_question',
            sourceId: actual.actualQuestionId,
            revision: actual.analysisRevision,
            revisionStatus: 'available',
            sourceVersion: null,
            membershipDigest: actual.normalizedDigest,
            inputOrder: p4.length,
            included: true,
            dropReason: null,
          });
        }
        if (snapshot !== null) {
          p4.push({
            section: 'current_presentation',
            sourceType: 'presentation',
            sourceId: snapshot.id,
            revision: snapshot.publishedPresentationRevision,
            revisionStatus: 'available',
            sourceVersion: null,
            membershipDigest: snapshot.normalizedQuestionDigest,
            inputOrder: p4.length,
            included: true,
            dropReason: null,
          });
        }
        for (const reference of bank) {
          p4.push({
            section: 'question_bank',
            sourceType: 'question_bank_item',
            sourceId: reference.questionBankItemId ?? reference.questionId,
            revision: null,
            revisionStatus: 'unavailable',
            sourceVersion: reference.bankVersion,
            membershipDigest: reference.contentDigest,
            inputOrder: p4.length,
            included: true,
            dropReason: null,
          });
        }
        const invoked = (await tx.aiProviderCall.count({ where: { aiJobId: aiJob.id } })) > 0;
        const recoveredStatus = traceStatusFromAttempt(
          terminalAttempt.status,
          terminalAttempt.publicationOutcome,
        );
        const terminalOutcome =
          terminalAttempt.status === 'succeeded'
            ? terminalAttempt.resultKind === 'suggestion'
              ? 'question'
              : 'continue_listening'
            : 'unavailable';
        const completedAt = terminalAttempt.completedAt;
        const startedAt = terminalAttempt.startedAt ?? terminalAttempt.createdAt;
        const contextDigest = manifestHash(p4.map((item) => canonicalJson(item)));
        const recoveredDurationMs =
          completedAt === null ? null : boundedDurationMs(startedAt, completedAt);
        if (existing !== null) {
          if (!hasFrozenReferences) {
            await tx.decisionTraceP4Membership.deleteMany({ where: { traceId: existing.id } });
            await tx.decisionTraceTranscriptMembership.createMany({
              data: segments.map((segment) => ({
                id: randomUUID(),
                traceId: existing.id,
                segmentId: segment.transcriptSegmentId,
                textRevision: segment.textRevision,
                speakerRoleRevision: segment.speakerRoleRevision,
                effectiveTextDigest: segment.effectiveTextDigest,
                inputOrder: segment.inputOrder,
              })),
              skipDuplicates: true,
            });
            await tx.decisionTraceMemoryMembership.createMany({
              data: memories.map((memory) => ({
                id: randomUUID(),
                traceId: existing.id,
                memoryId: memory.memoryResolutionId,
                layer: 'unknown',
                revision: memory.resolutionRevision,
                membershipRole: 'active',
                inputOrder: memory.inputOrder,
              })),
              skipDuplicates: true,
            });
            await tx.decisionTraceP4Membership.createMany({
              data: p4.map((item) => ({
                ...toP4Row(item),
                id: randomUUID(),
                traceId: existing.id,
              })),
            });
          }
          await tx.decisionTrace.update({
            data: {
              attemptId: terminalAttempt.id,
              aiJobId: aiJob.id,
              contextDigest: hasFrozenReferences ? existing.contextDigest : contextDigest,
              directorInvoked: invoked,
              ...(preserveTerminalTrace
                ? {}
                : {
                    decisionOutcome: terminalOutcome,
                    status: recoveredStatus,
                    stage: 'recovered',
                    gateReason: publicationGateReason(terminalAttempt.publicationOutcome),
                    publicationOutcome: terminalAttempt.publicationOutcome,
                    errorCode: terminalAttempt.failureCode,
                    completedAt,
                    durationMs: recoveredDurationMs,
                    stageTimingsJson:
                      recoveredDurationMs === null ? {} : { total: recoveredDurationMs },
                  }),
            },
            where: { id: existing.id },
          });
          return existing.id;
        }
        const trace = await tx.decisionTrace.create({
          data: {
            id: randomUUID(),
            projectId: aiJob.projectId,
            sessionId: terminalAttempt.sessionId,
            ownerActorId: aiJob.requestedBy,
            requestId: terminalAttempt.requestId,
            generationId: stableUuid(`generation:${terminalAttempt.requestId}`),
            aiJobId: aiJob.id,
            attemptId: terminalAttempt.id,
            triggerType: terminalAttempt.attemptKind,
            decisionOutcome: terminalOutcome,
            directorInvoked: invoked,
            status: recoveredStatus,
            stage: 'recovered',
            gateReason: publicationGateReason(terminalAttempt.publicationOutcome),
            publicationOutcome: terminalAttempt.publicationOutcome,
            errorCode: terminalAttempt.failureCode,
            startedAt: terminalAttempt.startedAt ?? terminalAttempt.createdAt,
            completedAt,
            durationMs: recoveredDurationMs,
            contextRevision: terminalAttempt.basisPresentationRevision,
            workingRevision: null,
            inputHash: aiJob.inputHash,
            contextDigest,
            stageTimingsJson: recoveredDurationMs === null ? {} : { total: recoveredDurationMs },
            expiresAt: aiJob.expiresAt,
            transcriptMemberships: {
              create: segments.map((segment) => ({
                segmentId: segment.transcriptSegmentId,
                textRevision: segment.textRevision,
                speakerRoleRevision: segment.speakerRoleRevision,
                effectiveTextDigest: segment.effectiveTextDigest,
                inputOrder: segment.inputOrder,
              })),
            },
            memoryMemberships: {
              create: memories.map((memory) => ({
                memoryId: memory.memoryResolutionId,
                layer: 'unknown',
                revision: memory.resolutionRevision,
                membershipRole: 'active',
                inputOrder: memory.inputOrder,
              })),
            },
            p4Memberships: { create: p4.map(toP4Row) },
          },
        });
        return trace.id;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  public async reconcileRunning(maxAgeMs = 30_000): Promise<number> {
    const traces = await this.prisma.decisionTrace.findMany({
      where: { status: 'running', startedAt: { lt: new Date(Date.now() - maxAgeMs) } },
      select: { id: true, attemptId: true },
    });
    for (const trace of traces) {
      if (trace.attemptId !== null) await this.recoverAttempt(trace.attemptId);
      else {
        await this.prisma.decisionTrace.updateMany({
          data: {
            completedAt: new Date(),
            errorCode: 'SYSTEM_COORDINATOR_RESTARTED',
            stage: 'recovered',
            status: 'unavailable',
          },
          where: { id: trace.id, status: 'running' },
        });
      }
    }
    return traces.length;
  }

  public async reconcileMissingAttempts(maxAgeMs = 30_000): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const attempts = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT a.id
      FROM question_generation_attempt a
      LEFT JOIN decision_trace t ON t.attempt_id = a.id
      INNER JOIN ai_job j ON j.id = a.ai_job_id
      WHERE a.created_at < ${cutoff}
        AND (
          t.id IS NULL
          OR (
            t.status <> 'running'
            AND (
              a.status IN ('pending', 'running')
              OR j.status IN ('pending', 'running')
            )
          )
        )
      ORDER BY a.created_at ASC
      LIMIT 200
    `;
    let repaired = 0;
    for (const attempt of attempts) {
      await this.recoverAttempt(attempt.id);
      repaired += 1;
    }
    return repaired;
  }
}

interface NormalizedMemoryTriggerObservation extends Omit<
  DecisionTraceMemoryTriggerObservationInput,
  'selectedNewMemberships'
> {
  selectedNewManifestHash: string;
  selectedNewMemberships: DecisionTraceMemoryTriggerSegmentInput[];
}

export function countDecisionTraceUsefulCharacters(value: string): number {
  return Array.from(value.normalize('NFKC').replace(/\p{White_Space}+/gu, '')).length;
}

export function decisionTraceMemoryTriggerManifest(
  memberships: readonly DecisionTraceMemoryTriggerSegmentInput[],
): string {
  return manifestHash(
    memberships.map((membership) =>
      canonicalJson({
        effective_text_digest: membership.effectiveTextDigest,
        input_order: membership.inputOrder,
        speaker_role_revision: membership.speakerRoleRevision,
        text_revision: membership.textRevision,
        transcript_segment_id: membership.transcriptSegmentId,
        useful_character_count: membership.usefulCharacterCount,
      }),
    ),
  );
}

export function decisionTraceMemoryTriggerInputHash(input: {
  contextBuilderVersion: string;
  jobType: string;
  projectId: string;
  selectedNewManifestHash: string;
  sessionId: string;
  triggerIdentity: string;
}): string {
  return sha256(
    canonicalJson({
      context_builder_version: input.contextBuilderVersion,
      job_type: input.jobType,
      project_id: input.projectId,
      selected_new_manifest_hash: input.selectedNewManifestHash,
      session_id: input.sessionId,
      trigger_identity: input.triggerIdentity,
    }),
  );
}

function normalizeMemoryTriggerObservation(
  input: DecisionTraceInput,
): NormalizedMemoryTriggerObservation | null {
  const observation = input.memoryTriggerObservation;
  if (observation === undefined) return null;
  if (
    input.triggerType !== 'working_memory_maintain' ||
    input.aiJobId === null ||
    input.aiJobId === undefined ||
    observation.aiJobId !== input.aiJobId ||
    !observation.triggerIdentity.startsWith('memory-p1-v1.2:')
  ) {
    throw new Error('DECISION_TRACE_MEMORY_TRIGGER_SOURCE_INVALID');
  }
  const memberships = [...observation.selectedNewMemberships].sort(
    (left, right) => left.inputOrder - right.inputOrder,
  );
  const ids = new Set<string>();
  let usefulCharacters = 0;
  for (const [inputOrder, membership] of memberships.entries()) {
    if (
      membership.inputOrder !== inputOrder ||
      !Number.isInteger(membership.textRevision) ||
      membership.textRevision < 0 ||
      !Number.isInteger(membership.speakerRoleRevision) ||
      membership.speakerRoleRevision < 0 ||
      !Number.isInteger(membership.usefulCharacterCount) ||
      membership.usefulCharacterCount < 0 ||
      !/^[0-9a-f]{64}$/.test(membership.effectiveTextDigest) ||
      ids.has(membership.transcriptSegmentId)
    ) {
      throw new Error('DECISION_TRACE_MEMORY_TRIGGER_MEMBERSHIP_INVALID');
    }
    ids.add(membership.transcriptSegmentId);
    usefulCharacters += membership.usefulCharacterCount;
  }
  if (
    !Number.isInteger(observation.selectedNewSegmentCount) ||
    observation.selectedNewSegmentCount < 0 ||
    observation.selectedNewSegmentCount !== memberships.length ||
    !Number.isInteger(observation.cumulativeUsefulCharacters) ||
    observation.cumulativeUsefulCharacters < 0 ||
    observation.cumulativeUsefulCharacters !== usefulCharacters ||
    !Number.isInteger(observation.minimumUsefulCharacters) ||
    observation.minimumUsefulCharacters <= 0
  ) {
    throw new Error('DECISION_TRACE_MEMORY_TRIGGER_COUNTS_INVALID');
  }
  const selectedNewManifestHash = decisionTraceMemoryTriggerManifest(memberships);
  if (
    observation.triggerIdentity.includes(':final-unjudged:') &&
    (observation.triggerKind !== 'session_final_flush' ||
      !observation.triggerIdentity.endsWith(
        `:final-unjudged:${selectedNewManifestHash.slice(0, 32)}`,
      ))
  ) {
    throw new Error('DECISION_TRACE_MEMORY_TRIGGER_IDENTITY_INVALID');
  }
  return {
    ...observation,
    selectedNewManifestHash,
    selectedNewMemberships: memberships,
  };
}

async function assertMemoryTriggerSource(
  tx: Prisma.TransactionClient,
  input: DecisionTraceInput,
  observation: NormalizedMemoryTriggerObservation,
): Promise<void> {
  const job = await tx.aiJob.findUnique({ where: { id: observation.aiJobId } });
  if (
    job === null ||
    job.projectId !== input.projectId ||
    job.jobType !== 'working_memory_maintain' ||
    job.triggerDedupeKey !== observation.triggerIdentity ||
    job.inputHash !== input.inputHash
  ) {
    throw new Error('DECISION_TRACE_MEMORY_TRIGGER_SOURCE_INVALID');
  }
  const segmentIds = observation.selectedNewMemberships.map(
    ({ transcriptSegmentId }) => transcriptSegmentId,
  );
  const segments = await tx.transcriptSegment.findMany({ where: { id: { in: segmentIds } } });
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  for (const membership of observation.selectedNewMemberships) {
    const segment = byId.get(membership.transcriptSegmentId);
    if (
      segment === undefined ||
      segment.sessionId !== input.sessionId ||
      segment.contentKind !== 'conversation' ||
      projectTrustedSpeakerRole(segment).trustedEffectiveSpeakerRole !== 'elder' ||
      segment.textRevision !== membership.textRevision ||
      segment.speakerRoleRevision !== membership.speakerRoleRevision ||
      effectiveTextDigest(segment.correctedText ?? segment.originalText) !==
        membership.effectiveTextDigest ||
      countDecisionTraceUsefulCharacters(segment.correctedText ?? segment.originalText) !==
        membership.usefulCharacterCount
    ) {
      throw new Error('DECISION_TRACE_MEMORY_TRIGGER_SOURCE_DRIFT');
    }
  }
  const sourceMemberships = await tx.memoryMaintenanceInputSegment.findMany({
    orderBy: { inputOrder: 'asc' },
    where: { aiJobId: job.id },
  });
  const unjudged = job.failureCode === 'MEMORY_UNJUDGED';
  if (unjudged) {
    const scopes = await tx.aiJobSessionScope.findMany({
      where: { aiJobId: job.id },
    });
    const scope = scopes[0];
    if (
      scopes.length !== 1 ||
      scope === undefined ||
      scope.sessionId !== input.sessionId ||
      scope.eligibleSegmentCount !== observation.selectedNewSegmentCount ||
      scope.segmentManifestHash !== observation.selectedNewManifestHash
    ) {
      throw new Error('DECISION_TRACE_MEMORY_TRIGGER_SCOPE_INVALID');
    }
    const expectedInputHash = decisionTraceMemoryTriggerInputHash({
      contextBuilderVersion: MEMORY_MAINTAINER_V12_CONTEXT_VERSION,
      jobType: job.jobType,
      projectId: job.projectId,
      selectedNewManifestHash: observation.selectedNewManifestHash,
      sessionId: input.sessionId,
      triggerIdentity: observation.triggerIdentity,
    });
    if (job.inputHash !== expectedInputHash) {
      throw new Error('DECISION_TRACE_MEMORY_TRIGGER_INPUT_HASH_INVALID');
    }
    const providerCalls = await tx.aiProviderCall.count({ where: { aiJobId: job.id } });
    if (
      job.status !== 'cancelled' ||
      observation.triggerKind !== 'session_final_flush' ||
      !observation.triggerIdentity.endsWith(
        `:final-unjudged:${observation.selectedNewManifestHash.slice(0, 32)}`,
      ) ||
      (observation.selectedNewSegmentCount > 0 &&
        observation.cumulativeUsefulCharacters >= observation.minimumUsefulCharacters) ||
      providerCalls !== 0
    ) {
      throw new Error('DECISION_TRACE_MEMORY_TRIGGER_UNJUDGED_INVALID');
    }
  } else if (observation.cumulativeUsefulCharacters < observation.minimumUsefulCharacters) {
    throw new Error('DECISION_TRACE_MEMORY_TRIGGER_THRESHOLD_INVALID');
  }
  if (
    unjudged &&
    (sourceMemberships.length !== observation.selectedNewMemberships.length ||
      sourceMemberships.some((membership) => membership.membershipKind !== 'new'))
  ) {
    throw new Error('DECISION_TRACE_MEMORY_TRIGGER_JOB_MEMBERSHIP_INVALID');
  }
  const memberships = unjudged
    ? sourceMemberships
    : sourceMemberships.filter((membership) => membership.membershipKind === 'new');
  if (memberships.length !== observation.selectedNewMemberships.length) {
    throw new Error('DECISION_TRACE_MEMORY_TRIGGER_JOB_MEMBERSHIP_INVALID');
  }
  const inputRows = await tx.aiJobInputSegment.findMany({
    orderBy: { inputOrder: 'asc' },
    where: { aiJobId: job.id },
  });
  if (unjudged && inputRows.length !== observation.selectedNewMemberships.length) {
    throw new Error('DECISION_TRACE_MEMORY_TRIGGER_JOB_INPUT_INVALID');
  }
  const inputById = new Map(inputRows.map((row) => [row.id, row]));
  for (const [index, sourceMembership] of memberships.entries()) {
    const observed = observation.selectedNewMemberships[index];
    const inputRow = inputById.get(sourceMembership.aiJobInputSegmentId);
    if (
      observed === undefined ||
      inputRow === undefined ||
      (unjudged &&
        (sourceMembership.inputOrder !== index ||
          inputRow.inputOrder !== index ||
          inputRow.sessionId !== input.sessionId ||
          sourceMembership.aiJobInputSegmentId !== inputRow.id ||
          sourceMembership.transcriptSegmentId !== observed.transcriptSegmentId)) ||
      inputRow.transcriptSegmentId !== observed.transcriptSegmentId ||
      inputRow.textRevision !== observed.textRevision ||
      inputRow.speakerRoleRevision !== observed.speakerRoleRevision ||
      inputRow.effectiveTextDigest !== observed.effectiveTextDigest
    ) {
      throw new Error('DECISION_TRACE_MEMORY_TRIGGER_JOB_MEMBERSHIP_INVALID');
    }
  }
}

function assertMemoryTriggerReplay(
  replay: {
    aiJobId: string | null;
    memoryTriggerObservation?: null | {
      aiJobId: string;
      cumulativeUsefulCharacters: number;
      minimumUsefulCharacters: number;
      observationVersion: string;
      selectedNewManifestHash: string;
      selectedNewSegmentCount: number;
      triggerIdentity: string;
      triggerKind: string;
      usefulCharacterPolicyVersion: string;
      selectedNewMemberships: Array<{
        effectiveTextDigest: string;
        inputOrder: number;
        speakerRoleRevision: number;
        textRevision: number;
        transcriptSegmentId: string;
        usefulCharacterCount: number;
      }>;
    };
  },
  input: DecisionTraceInput,
  observation: NormalizedMemoryTriggerObservation | null,
): void {
  const persisted = replay.memoryTriggerObservation ?? null;
  if (observation === null) {
    if (persisted !== null) throw new Error('DECISION_TRACE_REQUEST_CONFLICT');
    return;
  }
  if (
    persisted === null ||
    replay.aiJobId !== observation.aiJobId ||
    persisted.aiJobId !== observation.aiJobId ||
    persisted.observationVersion !== DECISION_TRACE_MEMORY_TRIGGER_VERSION ||
    persisted.usefulCharacterPolicyVersion !== DECISION_TRACE_USEFUL_CHARACTER_POLICY_VERSION ||
    persisted.triggerIdentity !== observation.triggerIdentity ||
    persisted.triggerKind !== observation.triggerKind ||
    persisted.selectedNewSegmentCount !== observation.selectedNewSegmentCount ||
    persisted.cumulativeUsefulCharacters !== observation.cumulativeUsefulCharacters ||
    persisted.minimumUsefulCharacters !== observation.minimumUsefulCharacters ||
    persisted.selectedNewManifestHash !== observation.selectedNewManifestHash ||
    decisionTraceMemoryTriggerManifest(persisted.selectedNewMemberships) !==
      observation.selectedNewManifestHash ||
    canonicalJson(
      [...persisted.selectedNewMemberships]
        .sort((left, right) => left.inputOrder - right.inputOrder)
        .map(triggerMembershipIdentity),
    ) !== canonicalJson(observation.selectedNewMemberships.map(triggerMembershipIdentity))
  ) {
    throw new Error('DECISION_TRACE_REQUEST_CONFLICT');
  }
  if (input.aiJobId !== observation.aiJobId) throw new Error('DECISION_TRACE_REQUEST_CONFLICT');
}

function triggerMembershipIdentity(
  membership: DecisionTraceMemoryTriggerSegmentInput,
): DecisionTraceMemoryTriggerSegmentInput {
  return {
    effectiveTextDigest: membership.effectiveTextDigest,
    inputOrder: membership.inputOrder,
    speakerRoleRevision: membership.speakerRoleRevision,
    textRevision: membership.textRevision,
    transcriptSegmentId: membership.transcriptSegmentId,
    usefulCharacterCount: membership.usefulCharacterCount,
  };
}

function terminalData(
  terminal: {
    status: Exclude<DecisionTraceStatus, 'running'>;
    decisionOutcome?: DecisionTraceOutcome;
    errorCode?: string | null;
    publicationOutcome?: string | null;
    stage?: string | null;
  },
  completedAt: Date,
  durationMs: number,
  stageTimingsJson: Prisma.JsonValue,
): {
  completedAt: Date;
  decisionOutcome?: DecisionTraceOutcome;
  durationMs: number;
  errorCode: string | null;
  publicationOutcome?: string | null;
  stage?: string | null;
  stageTimingsJson: Prisma.InputJsonObject;
  status: Exclude<DecisionTraceStatus, 'running'>;
} {
  return {
    completedAt,
    ...(terminal.decisionOutcome === undefined
      ? {}
      : { decisionOutcome: terminal.decisionOutcome }),
    durationMs,
    errorCode: terminal.errorCode ?? null,
    ...(terminal.publicationOutcome === undefined
      ? {}
      : { publicationOutcome: terminal.publicationOutcome }),
    ...(terminal.stage === undefined ? {} : { stage: terminal.stage }),
    stageTimingsJson: terminalStageTimings(stageTimingsJson, durationMs),
    status: terminal.status,
  };
}

async function lockTraceRequest(tx: Prisma.TransactionClient, requestId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`request:${requestId}`}, 0))`;
}

async function terminalizeAttemptFromTrace(
  tx: Prisma.TransactionClient,
  attempt: QuestionGenerationAttempt,
  trace: DecisionTrace,
  now: Date,
): Promise<boolean> {
  const completedAt = trace.completedAt ?? now;
  if (trace.status === 'succeeded') {
    const updated = await tx.questionGenerationAttempt.updateMany({
      data: {
        completedAt,
        failureCode: null,
        publicationOutcome: terminalPublicationOutcome(trace),
        resultKind: trace.decisionOutcome === 'question' ? 'suggestion' : 'continue_listening',
        status: 'succeeded',
      },
      where: { id: attempt.id, status: { in: ['pending', 'running'] } },
    });
    return updated.count === 1;
  }
  if (trace.status === 'stale' || trace.status === 'cancelled') {
    const updated = await tx.questionGenerationAttempt.updateMany({
      data: {
        completedAt,
        failureCode: null,
        publicationOutcome: trace.status === 'stale' ? 'stale_basis' : 'superseded_by_manual',
        resultKind: 'unavailable',
        status: 'cancelled',
      },
      where: { id: attempt.id, status: { in: ['pending', 'running'] } },
    });
    return updated.count === 1;
  }
  const updated = await tx.questionGenerationAttempt.updateMany({
    data: {
      completedAt,
      failureCode: trace.errorCode ?? 'SYSTEM_COORDINATOR_RESTARTED',
      publicationOutcome: 'policy_blocked',
      resultKind: 'unavailable',
      status: 'failed',
    },
    where: { id: attempt.id, status: { in: ['pending', 'running'] } },
  });
  return updated.count === 1;
}

async function terminalizeRunningJobFromAttempt(
  tx: Prisma.TransactionClient,
  attempt: QuestionGenerationAttempt,
  trace: DecisionTrace,
  now: Date,
): Promise<void> {
  if (attempt.status === 'pending' || attempt.status === 'running') return;
  const succeeded = attempt.status === 'succeeded' || attempt.status === 'cancelled';
  await tx.aiJob.updateMany({
    data: {
      completedAt: attempt.completedAt ?? trace.completedAt ?? now,
      failureCode: succeeded
        ? null
        : (attempt.failureCode ?? trace.errorCode ?? 'SYSTEM_COORDINATOR_RESTARTED'),
      status: succeeded ? 'succeeded' : 'failed',
    },
    where: { id: attempt.aiJobId, status: { in: ['pending', 'running'] } },
  });
}

function traceMatchesAttempt(trace: DecisionTrace, attempt: QuestionGenerationAttempt): boolean {
  if (attempt.status === 'succeeded') {
    const expectedOutcome = attempt.resultKind === 'suggestion' ? 'question' : 'continue_listening';
    return trace.status === 'succeeded' && trace.decisionOutcome === expectedOutcome;
  }
  if (attempt.status === 'cancelled') {
    if (attempt.publicationOutcome === 'stale_basis') return trace.status === 'stale';
    return trace.status === 'cancelled';
  }
  if (attempt.status === 'failed') {
    return trace.status === 'failed' || trace.status === 'unavailable';
  }
  return trace.status === 'running';
}

function terminalPublicationOutcome(trace: DecisionTrace): string {
  if (
    trace.publicationOutcome === 'published' ||
    trace.publicationOutcome === 'not_better' ||
    trace.publicationOutcome === 'duplicate_filtered' ||
    trace.publicationOutcome === 'not_applicable'
  ) {
    return trace.publicationOutcome;
  }
  return 'published';
}

function toTranscriptRow(
  value: DecisionTraceTranscriptInput,
): Prisma.DecisionTraceTranscriptMembershipCreateWithoutTraceInput {
  return {
    segmentId: value.segmentId,
    textRevision: value.textRevision,
    speakerRoleRevision: value.speakerRoleRevision,
    effectiveTextDigest: value.effectiveTextDigest,
    inputOrder: value.inputOrder,
  };
}

function toMemoryRow(
  value: DecisionTraceMemoryInput,
): Prisma.DecisionTraceMemoryMembershipCreateWithoutTraceInput {
  return {
    memoryId: value.memoryId,
    layer: value.layer,
    revision: value.revision,
    membershipRole: value.membershipRole,
    inputOrder: value.inputOrder,
  };
}

function toP3Row(
  value: DecisionTraceP3Input,
): Prisma.DecisionTraceP3CandidateCreateWithoutTraceInput {
  return {
    candidateId: value.candidateId,
    memoryId: value.memoryId,
    sourceLayer: value.sourceLayer,
    retrievalSources: [...value.retrievalSources],
    embeddingScore: value.embeddingScore ?? null,
    graphDistance: value.graphDistance ?? null,
    rank: value.rank,
    included: value.included,
    exclusionReason: value.exclusionReason ?? null,
  };
}

function toP4Row(
  value: DecisionTraceP4Input,
): Prisma.DecisionTraceP4MembershipCreateWithoutTraceInput {
  return {
    section: value.section,
    sourceType: value.sourceType,
    sourceId: value.sourceId,
    revision: value.revision,
    revisionStatus: value.revisionStatus,
    sourceVersion: value.sourceVersion ?? null,
    membershipDigest: value.membershipDigest ?? null,
    inputOrder: value.inputOrder,
    included: value.included,
    dropReason: value.dropReason ?? null,
  };
}

function toEvidenceRow(
  value: DecisionTraceEvidenceInput,
): Prisma.DecisionTraceEvidenceCallCreateWithoutTraceInput {
  return {
    callId: value.callId,
    tool: value.tool,
    targetType: value.targetType,
    targetId: value.targetId,
    resultIds: [...value.resultIds],
    status: value.status,
    invocationNo: value.invocationNo,
    requestDigest: value.requestDigest ?? null,
    resultDigest: value.resultDigest ?? null,
  };
}

function stableUuid(value: string): string {
  const hex = sha256(value).slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = '8';
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20, 32).join('')}`;
}

function traceStatusFromAttempt(
  attemptStatus: string,
  publicationOutcome: string | null,
): DecisionTraceStatus {
  if (publicationOutcome === 'stale_basis') return 'stale';
  if (publicationOutcome === 'superseded_by_manual' || attemptStatus === 'cancelled')
    return 'cancelled';
  if (attemptStatus === 'succeeded') return 'succeeded';
  if (attemptStatus === 'failed') return 'unavailable';
  return 'running';
}

function publicationGateReason(publicationOutcome: string | null): string | null {
  return publicationOutcome === null || publicationOutcome === 'published'
    ? null
    : publicationOutcome;
}

function boundedDurationMs(startedAt: Date, completedAt: Date): number {
  return Math.min(2_147_483_647, Math.max(0, completedAt.getTime() - startedAt.getTime()));
}

function terminalStageTimings(value: Prisma.JsonValue, durationMs: number): Prisma.InputJsonObject {
  const timings: Record<string, Prisma.InputJsonValue> = {};
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, timing] of Object.entries(value)) {
      if (typeof timing === 'number' && Number.isInteger(timing) && timing >= 0) {
        timings[key] = timing;
      }
    }
  }
  timings.total = durationMs;
  return timings;
}
