import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type { AuthPrincipal } from '../auth/auth.types.js';
import { SessionService } from '../auth/session.service.js';
import { PrismaService } from '../database/prisma.service.js';

export type RealtimeSessionMode = 'produce' | 'resume-only';

@Injectable()
export class RealtimeAccessService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  public async authenticate(sessionToken: string, expectedUserId: string): Promise<AuthPrincipal> {
    const actor = await this.sessions.authenticate(sessionToken);
    if (actor.id !== expectedUserId) throw this.forbidden();
    return actor;
  }

  public async assertJoin(
    actor: AuthPrincipal,
    sessionId: string,
    csrfToken: string,
  ): Promise<RealtimeSessionMode> {
    if (!(await this.sessions.verifyCsrf(actor.sessionId, csrfToken))) {
      throw new ForbiddenException({
        code: 'INVALID_CSRF_TOKEN',
        details: {},
        message: 'Access denied',
      });
    }
    return this.assertFrame(actor, sessionId, true);
  }

  public async assertFrame(
    actor: AuthPrincipal,
    sessionId: string,
    allowResumeOnly = false,
  ): Promise<RealtimeSessionMode> {
    const session = await this.prisma.interviewSession.findUnique({
      select: {
        project: {
          select: {
            assignments: { select: { userId: true }, where: { revokedAt: null } },
            consents: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              select: { revokedAt: true, status: true },
              take: 1,
              where: { consentType: 'recording_transcription_ai' },
            },
            deletedAt: true,
            status: true,
          },
        },
        status: true,
      },
      where: { id: sessionId },
    });
    if (session === null || session.project.deletedAt !== null) throw this.notFound();
    const assigned = session.project.assignments.some(({ userId }) => userId === actor.id);
    const consent = session.project.consents[0];
    if (
      !assigned ||
      session.project.status !== 'active' ||
      consent?.status !== 'valid' ||
      consent.revokedAt !== null
    ) {
      throw this.forbidden();
    }
    if (session.status === 'recording' || session.status === 'reconnecting') return 'produce';
    if (allowResumeOnly && (session.status === 'stopping' || session.status === 'processing')) {
      return 'resume-only';
    }
    throw new ForbiddenException({
      code: 'SESSION_NOT_STREAMABLE',
      details: {},
      message: 'Session is not streamable',
    });
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({ code: 'FORBIDDEN', details: {}, message: 'Access denied' });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'NOT_FOUND', details: {}, message: 'Resource not found' });
  }
}
