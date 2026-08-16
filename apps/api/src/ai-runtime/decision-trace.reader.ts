import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';

/**
 * Read-only, reference-only trace access. This deliberately never joins or
 * returns transcript, memory, question, prompt, or provider payload bodies.
 */
@Injectable()
export class DecisionTraceReader {
  public constructor(private readonly prisma: PrismaService) {}

  public async read(actorId: string, traceId: string) {
    const trace = await this.prisma.decisionTrace.findUnique({
      where: { id: traceId },
      include: {
        transcriptMemberships: { orderBy: { inputOrder: 'asc' } },
        memoryMemberships: { orderBy: { inputOrder: 'asc' } },
        p3Candidates: { orderBy: { rank: 'asc' } },
        p4Memberships: { orderBy: { inputOrder: 'asc' } },
        evidenceCalls: { orderBy: { invocationNo: 'asc' } },
      },
    });
    if (trace === null || trace.retentionState !== 'active' || trace.expiresAt <= new Date()) {
      throw new Error('DECISION_TRACE_UNAVAILABLE');
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
