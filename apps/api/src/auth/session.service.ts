import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import { API_CONFIG, type ApiConfigValue } from '../api-config.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthPrincipal } from './auth.types.js';
import { constantTimeHashEqual, opaqueToken, sha256 } from './auth.utils.js';

@Injectable()
export class SessionService {
  public constructor(
    private readonly prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiConfigValue,
  ) {}

  public async create(userId: string): Promise<{ csrfToken: string; sessionToken: string }> {
    const now = new Date();
    const sessionToken = opaqueToken();
    const csrfToken = opaqueToken();
    await this.prisma.authSession.create({
      data: {
        csrfTokenHash: sha256(csrfToken),
        expiresAt: new Date(now.getTime() + this.config.authSessionAbsoluteTtlHours * 3_600_000),
        lastSeenAt: now,
        tokenHash: sha256(sessionToken),
        userId,
      },
    });
    return { csrfToken, sessionToken };
  }

  public async authenticate(sessionToken: string | null): Promise<AuthPrincipal> {
    if (sessionToken === null) throw this.authRequired();
    const tokenHash = sha256(sessionToken);
    const session = await this.prisma.authSession.findUnique({
      include: { user: true },
      where: { tokenHash },
    });
    const now = new Date();
    const idleExpiry =
      session === null
        ? 0
        : session.lastSeenAt.getTime() + this.config.authSessionIdleTtlMinutes * 60_000;
    if (
      session === null ||
      session.revokedAt !== null ||
      session.expiresAt <= now ||
      idleExpiry <= now.getTime() ||
      session.user.status !== 'active'
    ) {
      if (session !== null && session.revokedAt === null) {
        await this.prisma.authSession.updateMany({
          data: {
            revokedAt: now,
            revokedReason: session.user.status !== 'active' ? 'user_disabled' : 'expired',
          },
          where: { id: session.id, revokedAt: null },
        });
      }
      throw this.authRequired();
    }
    const touched = await this.prisma.authSession.updateMany({
      data: { lastSeenAt: now },
      where: {
        expiresAt: { gt: now },
        id: session.id,
        lastSeenAt: {
          gt: new Date(now.getTime() - this.config.authSessionIdleTtlMinutes * 60_000),
        },
        revokedAt: null,
        user: { status: 'active' },
      },
    });
    if (touched.count !== 1) throw this.authRequired();
    return {
      displayName: session.user.displayName,
      id: session.user.id,
      role: session.user.role,
      sessionId: session.id,
      sessionTokenHash: tokenHash,
      status: session.user.status,
    };
  }

  public async rotateCsrf(sessionId: string): Promise<string> {
    const csrfToken = opaqueToken();
    const now = new Date();
    const rotated = await this.prisma.authSession.updateMany({
      data: { csrfTokenHash: sha256(csrfToken) },
      where: {
        expiresAt: { gt: now },
        id: sessionId,
        lastSeenAt: {
          gt: new Date(now.getTime() - this.config.authSessionIdleTtlMinutes * 60_000),
        },
        revokedAt: null,
        user: { status: 'active' },
      },
    });
    if (rotated.count !== 1) throw this.authRequired();
    return csrfToken;
  }

  public async verifyCsrf(sessionId: string, token: string | undefined): Promise<boolean> {
    if (token === undefined) return false;
    const session = await this.prisma.authSession.findUnique({
      include: { user: true },
      where: { id: sessionId },
    });
    const now = Date.now();
    return (
      session !== null &&
      session.revokedAt === null &&
      session.expiresAt.getTime() > now &&
      session.lastSeenAt.getTime() + this.config.authSessionIdleTtlMinutes * 60_000 > now &&
      session.user.status === 'active' &&
      constantTimeHashEqual(sha256(token), session.csrfTokenHash)
    );
  }

  public async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      data: { revokedAt: new Date(), revokedReason: reason },
      where: { id: sessionId, revokedAt: null },
    });
  }

  /** Reusable identity-domain seam for future role/assignment permission changes. */
  public async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const result = await this.prisma.authSession.updateMany({
      data: { revokedAt: new Date(), revokedReason: reason },
      where: { userId, revokedAt: null },
    });
    return result.count;
  }

  private authRequired(): UnauthorizedException {
    return new UnauthorizedException({
      code: 'AUTH_REQUIRED',
      details: {},
      message: 'Authentication required',
    });
  }
}
