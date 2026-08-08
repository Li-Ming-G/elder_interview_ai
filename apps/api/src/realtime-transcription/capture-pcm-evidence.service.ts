import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class CapturePcmEvidenceService {
  public constructor(private readonly prisma: PrismaService) {}

  public async acceptAndPersist<TResult>(
    sessionId: string,
    audioStreamId: string,
    accept: () => Promise<TResult>,
  ): Promise<TResult> {
    return this.prisma.$transaction(async (tx) => {
      const location = await tx.interviewSession.findUnique({
        select: { projectId: true },
        where: { id: sessionId },
      });
      if (location === null) throw new Error('Capture evidence target is unavailable');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project:${location.projectId}`}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`session:${sessionId}`}, 0))`;
      const capture = await tx.sessionCaptureGeneration.findUnique({
        where: { audioStreamId },
      });
      if (
        capture === null ||
        capture.sessionId !== sessionId ||
        !['preparing', 'active'].includes(capture.status)
      ) {
        throw new Error('Capture evidence target is unavailable');
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`audio:${capture.audioObjectId}`}, 0))`;
      const current = await tx.sessionCaptureGeneration.findUnique({
        where: { id: capture.id },
      });
      if (
        current === null ||
        current.sessionId !== sessionId ||
        current.audioStreamId !== audioStreamId ||
        !['preparing', 'active'].includes(current.status)
      ) {
        throw new Error('Capture evidence target is unavailable');
      }
      const result = await accept();
      if (current.firstPcmAcceptedAt === null) {
        const persisted = await tx.sessionCaptureGeneration.updateMany({
          data: { firstPcmAcceptedAt: new Date() },
          where: { firstPcmAcceptedAt: null, id: current.id },
        });
        if (persisted.count !== 1) throw new Error('Capture evidence was not persisted');
      }
      return result;
    });
  }
}
