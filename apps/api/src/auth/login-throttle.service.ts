import { createHmac } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import { API_CONFIG, type ApiConfigValue } from '../api-config.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuthThrottleKeyKind } from '../generated/prisma/enums.js';

const WINDOW_MS = 15 * 60 * 1000;
const LIMITS = { identity_ip: 5, ip: 30 } as const;

interface ThrottleKey {
  hash: string;
  kind: AuthThrottleKeyKind;
}
export interface LoginAttemptReservation {
  allowed: boolean;
  reservedCounts: Readonly<Record<AuthThrottleKeyKind, number>> | null;
}

@Injectable()
export class LoginThrottleService {
  public constructor(
    private readonly prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiConfigValue,
  ) {}

  /**
   * Reserves one provisional failure in a short transaction. Argon2 runs only after this
   * transaction commits. A reservation reaching a limit is denied fail-closed, preventing
   * concurrent requests at the threshold from racing a successful password response.
   */
  public async reserveAttempt(email: string, ip: string): Promise<LoginAttemptReservation> {
    const keys = this.keys(email, ip).sort((a, b) => a.hash.localeCompare(b.hash));
    return this.prisma.$transaction(async (transaction) => {
      for (const key of keys) {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key.hash}, 0))`;
      }
      const now = new Date();
      const existingRecords = await Promise.all(
        keys.map((key) =>
          transaction.authLoginThrottle.findUnique({
            where: { keyHash_keyKind: { keyHash: key.hash, keyKind: key.kind } },
          }),
        ),
      );
      if (
        existingRecords.some(
          (record) => record?.blockedUntil !== null && record !== null && record.blockedUntil > now,
        )
      ) {
        return { allowed: false, reservedCounts: null };
      }

      const reservedCounts = {
        [AuthThrottleKeyKind.identity_ip]: 0,
        [AuthThrottleKeyKind.ip]: 0,
      };
      let allowed = true;
      for (const [index, key] of keys.entries()) {
        const existing = existingRecords[index];
        const expired =
          existing === null ||
          existing === undefined ||
          now.getTime() - existing.windowStartedAt.getTime() >= WINDOW_MS;
        const failureCount = expired ? 1 : existing.failureCount + 1;
        reservedCounts[key.kind] = failureCount;
        const reachedLimit = failureCount >= LIMITS[key.kind];
        if (reachedLimit) allowed = false;
        await transaction.authLoginThrottle.upsert({
          create: {
            blockedUntil: reachedLimit ? new Date(now.getTime() + WINDOW_MS) : null,
            failureCount,
            keyHash: key.hash,
            keyKind: key.kind,
            windowStartedAt: now,
          },
          update: {
            blockedUntil: reachedLimit ? new Date(now.getTime() + WINDOW_MS) : null,
            failureCount,
            ...(expired ? { windowStartedAt: now } : {}),
          },
          where: { keyHash_keyKind: { keyHash: key.hash, keyKind: key.kind } },
        });
      }
      return { allowed, reservedCounts };
    });
  }

  /** Removes this request's provisional count while preserving later concurrent attempts. */
  public async finalizeSuccess(
    email: string,
    ip: string,
    reservation: LoginAttemptReservation,
  ): Promise<void> {
    const reservedCounts = reservation.reservedCounts;
    if (reservedCounts === null) return;
    const keys = this.keys(email, ip).sort((a, b) => a.hash.localeCompare(b.hash));
    await this.prisma.$transaction(async (transaction) => {
      for (const key of keys) {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key.hash}, 0))`;
      }
      for (const key of keys) {
        const existing = await transaction.authLoginThrottle.findUnique({
          where: { keyHash_keyKind: { keyHash: key.hash, keyKind: key.kind } },
        });
        if (existing === null) continue;
        const nextCount =
          key.kind === AuthThrottleKeyKind.identity_ip
            ? Math.max(0, existing.failureCount - reservedCounts[key.kind])
            : Math.max(0, existing.failureCount - 1);
        if (nextCount === 0) {
          await transaction.authLoginThrottle.delete({ where: { id: existing.id } });
        } else {
          await transaction.authLoginThrottle.update({
            data: { blockedUntil: null, failureCount: nextCount },
            where: { id: existing.id },
          });
        }
      }
    });
  }

  private digest(value: string): string {
    return createHmac('sha256', this.config.authLoginThrottlePepper)
      .update(value, 'utf8')
      .digest('hex');
  }

  private keys(email: string, ip: string): ThrottleKey[] {
    return [
      { hash: this.digest(`identity_ip\0${email}\0${ip}`), kind: AuthThrottleKeyKind.identity_ip },
      { hash: this.digest(`ip\0${ip}`), kind: AuthThrottleKeyKind.ip },
    ];
  }
}
