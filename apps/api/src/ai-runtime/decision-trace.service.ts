import { randomUUID } from 'node:crypto';

import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type DecisionTrace } from '../generated/prisma/client.js';
import { canonicalJson, manifestHash, sha256 } from './ai-provenance.js';

export type DecisionTraceOutcome =
  'question' | 'continue_listening' | 'system_error' | 'unavailable';
export type DecisionTraceStatus =
  'running' | 'succeeded' | 'failed' | 'cancelled' | 'stale' | 'unavailable';

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
    const existing = await this.prisma.decisionTrace.findUnique({
      where: { requestId: input.requestId },
    });
    if (existing !== null) return existing;

    const startedAt = input.startedAt ?? new Date();
    const generationId = input.generationId ?? randomUUID();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tx.decisionTrace.findUnique({ where: { requestId: input.requestId } });
        if (replay !== null) return replay;
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
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.decisionTrace.findUnique({
          where: { requestId: input.requestId },
        });
        if (winner !== null) return winner;
      }
      throw error;
    }
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
    const current = await this.prisma.decisionTrace.findUnique({ where: { id: traceId } });
    if (current === null) throw new Error('DECISION_TRACE_TERMINAL_OR_MISSING');
    const directorInvoked =
      current.aiJobId !== null &&
      (await this.prisma.aiProviderCall.count({ where: { aiJobId: current.aiJobId } })) > 0;
    const durationMs = Math.max(0, completedAt.getTime() - current.startedAt.getTime());
    const updated = await this.prisma.decisionTrace.updateMany({
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
  }

  public async attachReferences(
    traceId: string,
    refs: Pick<DecisionTraceInput, 'p3Candidates' | 'p4Memberships' | 'evidenceCalls'> & {
      contextDigest?: string | null;
    },
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
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
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async recoverAttempt(attemptId: string): Promise<string> {
    return this.prisma.$transaction(
      async (tx) => {
        const identity = await tx.questionGenerationAttempt.findUniqueOrThrow({
          select: { requestId: true },
          where: { id: attemptId },
        });
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`trace:${identity.requestId}`}, 0))`;
        const attempt = await tx.questionGenerationAttempt.findUniqueOrThrow({
          where: { id: attemptId },
        });
        const existing = await tx.decisionTrace.findUnique({
          where: { requestId: attempt.requestId },
        });
        if (existing !== null && existing.status !== 'running') return existing.id;
        const now = new Date();
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
          completedAt === null ? null : Math.max(0, completedAt.getTime() - startedAt.getTime());
        if (existing !== null) {
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
            data: p4.map((item) => ({ ...toP4Row(item), id: randomUUID(), traceId: existing.id })),
          });
          await tx.decisionTrace.update({
            data: {
              attemptId: terminalAttempt.id,
              aiJobId: aiJob.id,
              contextDigest,
              decisionOutcome: terminalOutcome,
              directorInvoked: invoked,
              status: recoveredStatus,
              stage: 'recovered',
              gateReason: publicationGateReason(terminalAttempt.publicationOutcome),
              publicationOutcome: terminalAttempt.publicationOutcome,
              errorCode: terminalAttempt.failureCode,
              completedAt,
              durationMs: recoveredDurationMs,
              stageTimingsJson: recoveredDurationMs === null ? {} : { total: recoveredDurationMs },
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
      WHERE t.id IS NULL AND a.created_at < ${cutoff}
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
