import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { effectiveTextDigest } from './ai-provenance.js';
import { AiOutputEligibilityService } from './ai-output-eligibility.service.js';
import { AiPolicyService } from './ai-policy.service.js';

const traceInclude = {
  transcriptMemberships: { orderBy: { inputOrder: 'asc' } },
  memoryMemberships: { orderBy: { inputOrder: 'asc' } },
  p3Candidates: { orderBy: { rank: 'asc' } },
  p4Memberships: { orderBy: { inputOrder: 'asc' } },
  evidenceCalls: { orderBy: { invocationNo: 'asc' } },
} satisfies Prisma.DecisionTraceInclude;

type DecisionTraceRead = Prisma.DecisionTraceGetPayload<{ include: typeof traceInclude }>;
type ProviderProvenance = Pick<
  Prisma.AiProviderCallGetPayload<{
    select: {
      callNo: true;
      status: true;
      providerRequestId: true;
      inputHash: true;
      outputHash: true;
      latencyMs: true;
      errorCode: true;
    };
  }>,
  'callNo' | 'status' | 'providerRequestId' | 'inputHash' | 'outputHash' | 'latencyMs' | 'errorCode'
>;

/**
 * Read-only, reference-only trace access. This deliberately never joins or
 * returns transcript, memory, question, prompt, or provider payload bodies.
 */
@Injectable()
export class DecisionTraceReader {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AiPolicyService,
    private readonly eligibility: AiOutputEligibilityService,
  ) {}

  public async read(
    actorId: string,
    traceId: string,
  ): Promise<{ trace: DecisionTraceRead; providerProvenance: ProviderProvenance[] | null }> {
    const trace = await this.prisma.decisionTrace.findUnique({
      where: { id: traceId },
      include: traceInclude,
    });
    if (trace === null || trace.retentionState !== 'active' || trace.expiresAt <= new Date()) {
      throw new Error('DECISION_TRACE_UNAVAILABLE');
    }
    const actor = await this.prisma.user.findUnique({
      select: { status: true },
      where: { id: actorId },
    });
    if (actor?.status !== 'active') throw new Error('DECISION_TRACE_UNAVAILABLE');
    let scopeSessionIds: string[] = [trace.sessionId];
    let frozenScopes: Array<{
      segmentManifestHash: string;
      sessionId: string;
      speakerRoleRevision: number;
    }> = [];
    if (trace.aiJobId !== null) {
      const [sourceJob, scopes] = await Promise.all([
        this.prisma.aiJob.findUnique({ where: { id: trace.aiJobId } }),
        this.prisma.aiJobSessionScope.findMany({
          orderBy: { inputOrder: 'asc' },
          where: { aiJobId: trace.aiJobId },
        }),
      ]);
      if (
        sourceJob === null ||
        sourceJob.projectId !== trace.projectId ||
        sourceJob.retentionState !== 'active' ||
        sourceJob.expiresAt <= new Date() ||
        scopes.length === 0
      ) {
        throw new Error('DECISION_TRACE_UNAVAILABLE');
      }
      frozenScopes = scopes;
      scopeSessionIds = scopes.map(({ sessionId }) => sessionId);
      if (!scopeSessionIds.includes(trace.sessionId)) throw new Error('DECISION_TRACE_UNAVAILABLE');
    }
    await this.policy.assertAllowed(actorId, trace.projectId, scopeSessionIds).catch(() => {
      throw new Error('DECISION_TRACE_UNAVAILABLE');
    });
    const sessions = await this.prisma.interviewSession.findMany({
      where: { id: { in: scopeSessionIds }, projectId: trace.projectId },
      select: { id: true },
    });
    if (sessions.length !== new Set(scopeSessionIds).size)
      throw new Error('DECISION_TRACE_UNAVAILABLE');
    const scopeBySessionId = new Map(frozenScopes.map((scope) => [scope.sessionId, scope]));
    for (const membership of trace.p4Memberships.filter((item) => item.sourceType === 'session')) {
      const scope = scopeBySessionId.get(membership.sourceId);
      if (
        trace.aiJobId === null
          ? membership.sourceId !== trace.sessionId
          : scope === undefined ||
            membership.revisionStatus !== 'available' ||
            membership.revision !== scope.speakerRoleRevision ||
            membership.membershipDigest !== scope.segmentManifestHash
      ) {
        throw new Error('DECISION_TRACE_UNAVAILABLE');
      }
    }

    for (const membership of trace.transcriptMemberships) {
      const segment = await this.prisma.transcriptSegment.findUnique({
        where: { id: membership.segmentId },
      });
      if (
        segment === null ||
        !scopeSessionIds.includes(segment.sessionId) ||
        segment.textRevision !== membership.textRevision ||
        segment.speakerRoleRevision !== membership.speakerRoleRevision ||
        effectiveTextDigest(segment.correctedText ?? segment.originalText) !==
          membership.effectiveTextDigest
      ) {
        throw new Error('DECISION_TRACE_UNAVAILABLE');
      }
    }
    for (const membership of trace.memoryMemberships) {
      const memory = await this.prisma.memoryResolution.findUnique({
        where: { id: membership.memoryId },
        select: { resolutionRevision: true },
      });
      if (
        memory === null ||
        memory.resolutionRevision !== membership.revision ||
        !(await this.eligibility.isMemoryResolutionEligible(
          actorId,
          trace.projectId,
          membership.memoryId,
        ))
      ) {
        throw new Error('DECISION_TRACE_UNAVAILABLE');
      }
    }
    const snapshotIds = trace.p4Memberships
      .filter(
        (item) => item.sourceType === 'display_snapshot' || item.sourceType === 'presentation',
      )
      .map((item) => item.sourceId);
    if (snapshotIds.length > 0) {
      const snapshots = await this.prisma.questionDisplaySnapshot.findMany({
        where: { id: { in: snapshotIds }, retentionState: 'active', expiresAt: { gt: new Date() } },
      });
      if (
        snapshots.length !== new Set(snapshotIds).size ||
        snapshots.some((snapshot) => !scopeSessionIds.includes(snapshot.sessionId))
      )
        throw new Error('DECISION_TRACE_UNAVAILABLE');
      const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
      for (const membership of trace.p4Memberships.filter(
        (item) => item.sourceType === 'display_snapshot' || item.sourceType === 'presentation',
      )) {
        const snapshot = snapshotsById.get(membership.sourceId);
        if (
          snapshot === undefined ||
          membership.revisionStatus !== 'available' ||
          membership.revision !== snapshot.publishedPresentationRevision ||
          membership.membershipDigest !== snapshot.normalizedQuestionDigest
        )
          throw new Error('DECISION_TRACE_UNAVAILABLE');
      }
    }
    const actualIds = trace.p4Memberships
      .filter((item) => item.sourceType === 'actual_question')
      .map((item) => item.sourceId);
    if (actualIds.length > 0) {
      for (const membership of trace.p4Memberships.filter(
        (item) => item.sourceType === 'actual_question',
      )) {
        const question = await this.prisma.actualQuestion.findUnique({
          where: { id: membership.sourceId },
        });
        const analysis =
          question === null
            ? null
            : await this.prisma.actualQuestionAnalysis.findUnique({
                where: { id: question.actualQuestionAnalysisId },
              });
        if (
          question === null ||
          analysis === null ||
          membership.revisionStatus !== 'available' ||
          membership.revision !== analysis.analysisRevision ||
          membership.membershipDigest !== question.normalizedDigest ||
          !(await this.eligibility.isActualQuestionEligible(
            actorId,
            trace.projectId,
            question.id,
            scopeSessionIds,
          ))
        ) {
          throw new Error('DECISION_TRACE_UNAVAILABLE');
        }
      }
    }
    const providerProvenance =
      trace.aiJobId === null
        ? null
        : await this.prisma.aiProviderCall.findMany({
            where: { aiJobId: trace.aiJobId },
            orderBy: { callNo: 'asc' },
            select: {
              callNo: true,
              status: true,
              providerRequestId: true,
              inputHash: true,
              outputHash: true,
              latencyMs: true,
              errorCode: true,
            },
          });
    return { trace, providerProvenance };
  }
}
