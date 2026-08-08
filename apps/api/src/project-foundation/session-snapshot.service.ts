import type { InterviewSessionResponse } from '@elder-interview/contracts';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { mapInterviewSessionSnapshot } from './project.mapper.js';

@Injectable()
export class SessionSnapshotService {
  public constructor(private readonly prisma: PrismaService) {}

  public async read(
    sessionId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<InterviewSessionResponse> {
    const session = await db.interviewSession.findUniqueOrThrow({ where: { id: sessionId } });
    const [finalization, capture] = await Promise.all([
      db.sessionFinalization.findUnique({
        include: { audioObject: true },
        where: { sessionId },
      }),
      db.sessionCaptureGeneration.findFirst({
        orderBy: { generationNo: 'desc' },
        where: { sessionId },
      }),
    ]);
    const audioObjectIds = [finalization?.audioObjectId, capture?.audioObjectId].filter(
      (value): value is string => value !== undefined,
    );
    const counts =
      audioObjectIds.length === 0
        ? []
        : await db.audioChunk.groupBy({
            _count: { _all: true },
            by: ['audioObjectId'],
            where: {
              audioObjectId: { in: [...new Set(audioObjectIds)] },
              uploadStatus: 'uploaded',
            },
          });
    const uploaded = new Map(
      counts.map((value) => [value.audioObjectId, value._count._all] as const),
    );
    return mapInterviewSessionSnapshot(
      session,
      finalization,
      finalization === null ? 0 : (uploaded.get(finalization.audioObjectId) ?? 0),
      capture,
      capture === null ? 0 : (uploaded.get(capture.audioObjectId) ?? 0),
    );
  }
}
