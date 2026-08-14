import { Injectable, UnauthorizedException, type OnModuleInit } from '@nestjs/common';
import type { AuthUser } from '@elder-interview/contracts';
import { setTimeout as delay } from 'node:timers/promises';

import { PrismaService } from '../database/prisma.service.js';
import { LoginThrottleService } from './login-throttle.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = '';

  public constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly throttle: LoginThrottleService,
  ) {}

  public async onModuleInit(): Promise<void> {
    this.dummyHash = await this.passwords.hash('not-a-real-account-password');
  }

  public async login(
    email: string,
    password: string,
    ip: string,
    requestId: string,
  ): Promise<{
    csrfToken: string;
    sessionToken: string;
    user: AuthUser;
  }> {
    const startedAt = Date.now();
    const reservation = await this.throttle.reserveAttempt(email, ip);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const valid = await this.passwords.verify(user?.passwordHash ?? this.dummyHash, password);
    if (!reservation.allowed || user === null || !valid || user.status !== 'active') {
      await this.prisma.auditLog.create({
        data:
          user === null
            ? {
                action: 'auth.login_failed',
                actorReference: this.throttle.anonymousActorReference(email),
                actorType: 'anonymous',
                entityType: 'authentication',
                metadata: {
                  client_ip_hash: this.throttle.auditClientIpHash(ip),
                  outcome: 'invalid_credentials',
                },
                requestId,
              }
            : {
                action: 'auth.login_failed',
                actorId: user.id,
                actorType: 'user',
                entityId: user.id,
                entityType: 'user',
                metadata: { outcome: 'invalid_credentials' },
                requestId,
              },
      });
      await delay(Math.max(0, 250 - (Date.now() - startedAt)));
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        details: {},
        message: 'Invalid credentials',
      });
    }
    await this.throttle.finalizeSuccess(email, ip, reservation);
    const session = await this.sessions.create(user.id);
    await this.prisma.auditLog.create({
      data: {
        action: 'auth.login_succeeded',
        actorId: user.id,
        actorType: 'user',
        entityId: user.id,
        entityType: 'user',
        metadata: {},
        requestId,
      },
    });
    return {
      ...session,
      user: { display_name: user.displayName, id: user.id, role: user.role, status: user.status },
    };
  }
}
