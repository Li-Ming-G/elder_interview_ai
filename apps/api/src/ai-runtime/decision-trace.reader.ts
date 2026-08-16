import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
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
    await this.policy.assertAllowed(actorId, trace.projectId, [trace.sessionId]).catch(() => {
      throw new Error('DECISION_TRACE_UNAVAILABLE');
    });
    if (trace.aiJobId !== null) {
      const sourceJob = await this.prisma.aiJob.findUnique({ where: { id: trace.aiJobId } });
      if (
        sourceJob === null ||
        sourceJob.retentionState !== 'active' ||
        sourceJob.expiresAt <= new Date()
      ) {
        throw new Error('DECISION_TRACE_UNAVAILABLE');
      }
    }
    const transcriptIds = trace.transcriptMemberships.map((item) => item.segmentId);
    if (transcriptIds.length > 0) {
      const count = await this.prisma.transcriptSegment.count({
        where: { id: { in: transcriptIds }, sessionId: trace.sessionId },
      });
      if (count !== transcriptIds.length) throw new Error('DECISION_TRACE_UNAVAILABLE');
    }
    const memoryIds = trace.memoryMemberships.map((item) => item.memoryId);
    if (memoryIds.length > 0) {
      const memories = await this.prisma.memoryResolution.findMany({
        where: { id: { in: memoryIds }, projectId: trace.projectId, status: 'current' },
        select: { id: true, memoryRetentionRootId: true },
      });
      if (memories.length !== memoryIds.length) throw new Error('DECISION_TRACE_UNAVAILABLE');
      const rootIds = memories.flatMap((item) =>
        item.memoryRetentionRootId === null ? [] : [item.memoryRetentionRootId],
      );
      if (rootIds.length > 0) {
        const roots = await this.prisma.memoryRetentionRoot.count({
          where: { id: { in: rootIds }, retentionState: 'active', expiresAt: { gt: new Date() } },
        });
        if (roots !== rootIds.length) throw new Error('DECISION_TRACE_UNAVAILABLE');
      }
    }
    const snapshotIds = trace.p4Memberships
      .filter(
        (item) => item.sourceType === 'display_snapshot' || item.sourceType === 'presentation',
      )
      .map((item) => item.sourceId);
    if (snapshotIds.length > 0) {
      const count = await this.prisma.questionDisplaySnapshot.count({
        where: {
          id: { in: snapshotIds },
          sessionId: trace.sessionId,
          retentionState: 'active',
          expiresAt: { gt: new Date() },
        },
      });
      if (count !== snapshotIds.length) throw new Error('DECISION_TRACE_UNAVAILABLE');
    }
    const actualIds = trace.p4Memberships
      .filter((item) => item.sourceType === 'actual_question')
      .map((item) => item.sourceId);
    if (actualIds.length > 0) {
      const count = await this.prisma.actualQuestion.count({
        where: { id: { in: actualIds }, sessionId: trace.sessionId },
      });
      if (count !== actualIds.length) throw new Error('DECISION_TRACE_UNAVAILABLE');
    }
    const [actor, assignment, session] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: actorId }, select: { status: true } }),
      this.prisma.projectAssignment.findFirst({
        where: { projectId: trace.projectId, userId: actorId, revokedAt: null },
        select: { projectId: true },
      }),
      this.prisma.interviewSession.findUnique({
        where: { id: trace.sessionId },
        select: { projectId: true },
      }),
    ]);
    if (
      actor?.status !== 'active' ||
      assignment?.projectId !== trace.projectId ||
      session?.projectId !== trace.projectId
    ) {
      throw new Error('DECISION_TRACE_FORBIDDEN');
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
