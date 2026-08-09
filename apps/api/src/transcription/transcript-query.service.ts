import type { TranscriptPageResponse } from '@elder-interview/contracts';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  ProjectAccessService,
  ResourceAccessAuthorizer,
} from '../project-foundation/project-access.service.js';
import { mapTranscriptSegment } from './transcription.mapper.js';
import { mapTranscriptResponse } from './trusted-speaker-role.js';

export interface TranscriptPageQuery {
  cursor: string | null;
  limit: number;
}

@Injectable()
export class TranscriptQueryService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly authorization: ResourceAccessAuthorizer,
  ) {}

  public async listFinalSegments(
    actor: AuthPrincipal,
    sessionId: string,
    query: TranscriptPageQuery = { cursor: null, limit: 100 },
  ): Promise<TranscriptPageResponse> {
    const session = await this.prisma.interviewSession.findUnique({
      select: {
        project: {
          select: {
            consents: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              select: { revokedAt: true, status: true },
              take: 1,
              where: { consentType: 'recording_transcription_ai' },
            },
          },
        },
        projectId: true,
      },
      where: { id: sessionId },
    });
    if (session === null) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        details: {},
        message: 'Resource not found',
      });
    }
    const project = await this.access.assertCanAccess(actor, session.projectId);
    const consent = session.project.consents[0];
    if (consent?.status !== 'valid' || consent.revokedAt !== null) {
      throw new ForbiddenException({ code: 'FORBIDDEN', details: {}, message: 'Access denied' });
    }
    if (project.status === 'restricted') {
      await this.authorization.assertResourceAccess(actor, {
        assignedUserIds: project.assignedUserIds,
        ownerUserId: null,
        restrictedToDataAdmin: true,
      });
    }
    const cursor = query.cursor === null ? null : decodeCursor(query.cursor);
    const segments = await this.prisma.transcriptSegment.findMany({
      orderBy: [{ startMs: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      where: {
        sessionId,
        ...(cursor === null
          ? {}
          : {
              OR: [
                { startMs: { gt: cursor.startMs } },
                { id: { gt: cursor.id }, startMs: cursor.startMs },
              ],
            }),
      },
    });
    const hasMore = segments.length > query.limit;
    const page = segments.slice(0, query.limit).map(mapTranscriptSegment);
    const last = page.at(-1);
    return {
      items: page.map(mapTranscriptResponse),
      next_cursor: hasMore && last !== undefined ? encodeCursor(last.startMs, last.id) : null,
    };
  }
}

function encodeCursor(startMs: number, id: string): string {
  return Buffer.from(JSON.stringify({ id, start_ms: startMs }), 'utf8').toString('base64url');
}

function decodeCursor(value: string): { id: string; startMs: number } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (
      !Number.isSafeInteger(parsed.start_ms) ||
      Number(parsed.start_ms) < 0 ||
      typeof parsed.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)
    ) {
      throw new Error('invalid cursor');
    }
    return { id: parsed.id, startMs: Number(parsed.start_ms) };
  } catch {
    throw new UnprocessableEntityException({
      code: 'VALIDATION_ERROR',
      details: {},
      message: 'Request validation failed',
    });
  }
}
