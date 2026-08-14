import type { ApiConfig } from '@elder-interview/config';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../database/prisma.service.js';
import { SessionService } from './session.service.js';
import { sha256 } from './auth.utils.js';

const CONFIG = {
  authSessionAbsoluteTtlHours: 12,
  authSessionIdleTtlMinutes: 30,
} as ApiConfig;

interface SessionFixture {
  csrfTokenHash: string;
  expiresAt: Date;
  id: string;
  lastSeenAt: Date;
  revokedAt: Date | null;
  user: {
    displayName: string;
    id: string;
    role: 'interviewer';
    status: 'active';
  };
}

function validSession(): SessionFixture {
  const now = Date.now();
  return {
    csrfTokenHash: sha256('csrf-token'),
    expiresAt: new Date(now + 60_000),
    id: 'session-id',
    lastSeenAt: new Date(now - 1_000),
    revokedAt: null,
    user: {
      displayName: '虚构倾听员',
      id: 'user-id',
      role: 'interviewer',
      status: 'active',
    },
  };
}

describe('session revocation race boundaries', () => {
  it('fails authentication when the conditional touch loses to revocation', async () => {
    const prisma = {
      authSession: {
        findUnique: vi.fn().mockResolvedValue(validSession()),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;
    const service = new SessionService(prisma, CONFIG);
    await expect(service.authenticate('opaque-session')).rejects.toMatchObject({ status: 401 });
  });

  it('fails CSRF rotation when the session is no longer conditionally valid', async () => {
    const prisma = {
      authSession: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    } as unknown as PrismaService;
    const service = new SessionService(prisma, CONFIG);
    await expect(service.rotateCsrf('session-id')).rejects.toMatchObject({ status: 401 });
  });

  it('rejects CSRF verification for revoked, expired, idle, or disabled sessions', async () => {
    const session = validSession();
    const findUnique = vi.fn();
    const prisma = { authSession: { findUnique } } as unknown as PrismaService;
    const service = new SessionService(prisma, CONFIG);

    findUnique.mockResolvedValueOnce({ ...session, revokedAt: new Date() });
    await expect(service.verifyCsrf(session.id, 'csrf-token')).resolves.toBe(false);
    findUnique.mockResolvedValueOnce({ ...session, expiresAt: new Date(0) });
    await expect(service.verifyCsrf(session.id, 'csrf-token')).resolves.toBe(false);
    findUnique.mockResolvedValueOnce({ ...session, lastSeenAt: new Date(0) });
    await expect(service.verifyCsrf(session.id, 'csrf-token')).resolves.toBe(false);
    findUnique.mockResolvedValueOnce({ ...session, user: { ...session.user, status: 'disabled' } });
    await expect(service.verifyCsrf(session.id, 'csrf-token')).resolves.toBe(false);
  });
});
