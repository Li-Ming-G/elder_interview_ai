import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';

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
export class DecisionTraceService {
  public constructor(private readonly prisma: PrismaService) {}

  public async begin(input: DecisionTraceInput) {
    const existing = await this.prisma.decisionTrace.findUnique({
      where: { requestId: input.requestId },
    });
    if (existing !== null) return existing;

    const startedAt = input.startedAt ?? new Date();
    const generationId = input.generationId ?? randomUUID();
    return this.prisma.$transaction(async (tx) => {
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
  }

  public async finalize(
    traceId: string,
    result: {
      status: Exclude<DecisionTraceStatus, 'running'>;
      decisionOutcome?: DecisionTraceOutcome;
      errorCode?: string | null;
      completedAt?: Date;
    },
  ): Promise<void> {
    const completedAt = result.completedAt ?? new Date();
    const current = await this.prisma.decisionTrace.findUnique({ where: { id: traceId } });
    if (current === null) throw new Error('DECISION_TRACE_TERMINAL_OR_MISSING');
    const updated = await this.prisma.decisionTrace.updateMany({
      data: {
        completedAt,
        ...(result.decisionOutcome === undefined
          ? {}
          : { decisionOutcome: result.decisionOutcome }),
        durationMs: Math.max(0, completedAt.getTime() - current.startedAt.getTime()),
        errorCode: result.errorCode ?? null,
        status: result.status,
      },
      where: { id: traceId, status: 'running' },
    });
    if (updated.count !== 1) throw new Error('DECISION_TRACE_TERMINAL_OR_MISSING');
  }

  public async attachReferences(
    traceId: string,
    refs: Pick<DecisionTraceInput, 'p3Candidates' | 'p4Memberships' | 'evidenceCalls'>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
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
    });
  }
}

function toTranscriptRow(value: DecisionTraceTranscriptInput) {
  return {
    segmentId: value.segmentId,
    textRevision: value.textRevision,
    speakerRoleRevision: value.speakerRoleRevision,
    effectiveTextDigest: value.effectiveTextDigest,
    inputOrder: value.inputOrder,
  };
}

function toMemoryRow(value: DecisionTraceMemoryInput) {
  return {
    memoryId: value.memoryId,
    layer: value.layer,
    revision: value.revision,
    membershipRole: value.membershipRole,
    inputOrder: value.inputOrder,
  };
}

function toP3Row(value: DecisionTraceP3Input) {
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

function toP4Row(value: DecisionTraceP4Input) {
  return {
    section: value.section,
    sourceType: value.sourceType,
    sourceId: value.sourceId,
    revision: value.revision,
    membershipDigest: value.membershipDigest ?? null,
    inputOrder: value.inputOrder,
    included: value.included,
    dropReason: value.dropReason ?? null,
  };
}

function toEvidenceRow(value: DecisionTraceEvidenceInput) {
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
