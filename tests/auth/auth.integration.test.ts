import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PasswordService } from '../../apps/api/src/auth/password.service.js';
import { SessionService } from '../../apps/api/src/auth/session.service.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { executeUserCommand } from '../../apps/api/src/cli/user-cli.js';

const ORIGIN = 'http://127.0.0.1:4173';
const PASSWORD = 'Fictional-only-Password-42!';
type SupertestApp = Parameters<typeof request>[0];
interface ErrorBody {
  code: string;
}
interface TokenBody {
  csrf_token: string;
}

describe('identity, opaque session, Origin and CSRF', () => {
  let app: INestApplication | null = null;
  let prisma: PrismaService;
  let userId: string;

  function application(): INestApplication {
    if (app === null) throw new Error('Application is not initialized');
    return app;
  }

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    app = await createApplication(
      loadApiConfig({
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: ORIGIN,
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-login-throttle-pepper',
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-retention-cleanup-pepper',
        DATABASE_URL: databaseUrl,
      }),
    );
    await application().init();
    prisma = application().get(PrismaService);
    await prisma.consentRecord.deleteMany();
    await prisma.audioChunk.deleteMany();
    await prisma.audioObject.deleteMany();
    await prisma.interviewSession.deleteMany();
    await prisma.serviceTerm.deleteMany();
    await prisma.projectAssignment.deleteMany();
    await prisma.elderProject.deleteMany();
    await prisma.idempotencyRecord.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.authSession.deleteMany();
    await prisma.authLoginThrottle.deleteMany();
    await prisma.user.deleteMany();
    const passwordHash = await new PasswordService().hash(PASSWORD);
    const user = await prisma.user.create({
      data: {
        displayName: '虚构倾听员 A',
        email: 'listener-a@example.test',
        passwordHash,
        role: 'interviewer',
      },
    });
    userId = user.id;
    await prisma.user.create({
      data: {
        disabledAt: new Date(),
        displayName: '虚构停用用户',
        email: 'disabled@example.test',
        passwordHash,
        role: 'interviewer',
        status: 'disabled',
      },
    });
    await prisma.user.create({
      data: { displayName: '虚构管理员', email: 'admin@example.test', passwordHash, role: 'admin' },
    });
    await prisma.user.create({
      data: {
        displayName: '并发测试用户',
        email: 'concurrent@example.test',
        passwordHash,
        role: 'interviewer',
      },
    });
  });

  afterAll(async () => {
    if (app !== null) await app.close();
  });

  it('rejects missing/invalid Origin before credential handling', async () => {
    const missing = await request(application().getHttpServer() as SupertestApp)
      .post('/api/v1/auth/login')
      .send({ email: 'listener-a@example.test', password: PASSWORD });
    expect(missing.status).toBe(403);
    const missingBody = missing.body as ErrorBody;
    expect(missingBody.code).toBe('INVALID_ORIGIN');
    expect(JSON.stringify(missingBody)).not.toContain(ORIGIN);
  });

  it('returns the same failure for absent, wrong-password and disabled accounts', async () => {
    const bodies = await Promise.all(
      [
        ['absent@example.test', PASSWORD],
        ['listener-a@example.test', 'Wrong-password-42!'],
        ['disabled@example.test', PASSWORD],
      ].map(async ([email, password]) => {
        const response = await request(application().getHttpServer() as SupertestApp)
          .post('/api/v1/auth/login')
          .set('Origin', ORIGIN)
          .send({ email, password });
        expect(response.status).toBe(401);
        return response.body as ErrorBody;
      }),
    );
    expect(bodies.map((body) => body.code)).toEqual([
      'INVALID_CREDENTIALS',
      'INVALID_CREDENTIALS',
      'INVALID_CREDENTIALS',
    ]);
    const auditedFailures = await prisma.auditLog.findMany({
      where: { action: 'auth.login_failed' },
    });
    expect(auditedFailures).toHaveLength(2);
    expect(auditedFailures.every((entry) => entry.actorId !== null)).toBe(true);
  });

  it('atomically denies concurrent guesses once four failures already exist', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await request(application().getHttpServer() as SupertestApp)
        .post('/api/v1/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: 'concurrent@example.test', password: 'Wrong-password-42!' });
      expect(response.status).toBe(401);
    }
    const responses = await Promise.all(
      [PASSWORD, 'Wrong-password-43!', PASSWORD].map(async (password) =>
        request(application().getHttpServer() as SupertestApp)
          .post('/api/v1/auth/login')
          .set('Origin', ORIGIN)
          .send({ email: 'concurrent@example.test', password }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
    const concurrentUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'concurrent@example.test' },
    });
    expect(await prisma.authSession.count({ where: { userId: concurrentUser.id } })).toBe(0);
  });

  it('uses Argon2id and stores only hashes for the session and CSRF token', async () => {
    const storedUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(storedUser.passwordHash).toMatch(/^\$argon2id\$/);
    const agent = request.agent(application().getHttpServer() as SupertestApp);
    const login = await agent
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: ' Listener-A@Example.Test ', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.headers['cache-control']).toBe('no-store');
    expect(login.headers['set-cookie'][0]).toContain('elder_interview_session=');
    expect(login.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(login.headers['set-cookie'][0]).toContain('SameSite=Strict');
    const loginBody = login.body as TokenBody;
    expect(loginBody).not.toHaveProperty('session_token');
    const session = await prisma.authSession.findFirstOrThrow({
      where: { userId, revokedAt: null },
    });
    expect(session.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(session.csrfTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(session.tokenHash).not.toBe(loginBody.csrf_token);

    const me = await agent.get('/api/v1/auth/me').set('Origin', ORIGIN);
    expect(me.status).toBe(200);
    expect(me.headers['cache-control']).toBe('no-store');
    expect(me.body as object).toEqual(
      expect.objectContaining({ role: 'interviewer', status: 'active' }),
    );

    const rotated = await agent.get('/api/v1/auth/csrf').set('Origin', ORIGIN);
    expect(rotated.status).toBe(200);
    const staleLogout = await agent
      .post('/api/v1/auth/logout')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', loginBody.csrf_token);
    expect(staleLogout.status).toBe(403);
    expect((staleLogout.body as ErrorBody).code).toBe('INVALID_CSRF_TOKEN');
    const logout = await agent
      .post('/api/v1/auth/logout')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', (rotated.body as TokenBody).csrf_token);
    expect(logout.status).toBe(200);
    expect(logout.headers['set-cookie'][0]).toContain('Max-Age=0');
    const afterLogout = await agent.get('/api/v1/auth/me').set('Cache-Control', 'no-cache');
    expect(afterLogout.status).toBe(401);
  });

  it('revokes all old sessions through the permission-change seam', async () => {
    const sessionService = application().get(SessionService);
    const created = await sessionService.create(userId);
    expect(await sessionService.authenticate(created.sessionToken)).toMatchObject({ id: userId });
    expect(await sessionService.revokeAllForUser(userId, 'permission_changed')).toBeGreaterThan(0);
    await expect(sessionService.authenticate(created.sessionToken)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('mounts the Nest role guard, returns 403, and audits a known actor denial', async () => {
    const interviewer = request.agent(application().getHttpServer() as SupertestApp);
    expect(
      (
        await interviewer
          .post('/api/v1/auth/login')
          .set('Origin', ORIGIN)
          .send({ email: 'listener-a@example.test', password: PASSWORD })
      ).status,
    ).toBe(200);
    const denied = await interviewer.get('/api/v1/auth/admin-proof').set('Origin', ORIGIN);
    expect(denied.status).toBe(403);
    expect((denied.body as ErrorBody).code).toBe('FORBIDDEN');
    expect(
      await prisma.auditLog.count({
        where: { action: 'auth.permission_denied', actorId: userId },
      }),
    ).toBeGreaterThan(0);

    const admin = request.agent(application().getHttpServer() as SupertestApp);
    expect(
      (
        await admin
          .post('/api/v1/auth/login')
          .set('Origin', ORIGIN)
          .send({ email: 'admin@example.test', password: PASSWORD })
      ).status,
    ).toBe(200);
    expect((await admin.get('/api/v1/auth/admin-proof').set('Origin', ORIGIN)).status).toBe(200);
  });

  it('runs all CLI mutations with operator audit and never restores revoked sessions', async () => {
    const answers = (): Promise<string> => Promise.resolve(PASSWORD);
    const cliUserId = await executeUserCommand(
      prisma,
      [
        'user:create',
        '--email',
        'cli-user@example.test',
        '--display-name',
        '虚构 CLI 用户',
        '--role',
        'interviewer',
        '--operator-ref',
        'ops-ticket-001',
      ],
      answers,
    );
    const sessions = application().get(SessionService);
    const beforePassword = await sessions.create(cliUserId);
    await executeUserCommand(
      prisma,
      ['user:set-password', '--email', 'cli-user@example.test', '--operator-ref', 'ops-ticket-002'],
      answers,
    );
    await expect(sessions.authenticate(beforePassword.sessionToken)).rejects.toMatchObject({
      status: 401,
    });

    const beforeDisable = await sessions.create(cliUserId);
    await executeUserCommand(prisma, [
      'user:disable',
      '--email',
      'cli-user@example.test',
      '--operator-ref',
      'ops-ticket-003',
    ]);
    await executeUserCommand(prisma, [
      'user:enable',
      '--email',
      'cli-user@example.test',
      '--operator-ref',
      'ops-ticket-004',
    ]);
    await expect(sessions.authenticate(beforeDisable.sessionToken)).rejects.toMatchObject({
      status: 401,
    });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: cliUserId } })).toMatchObject({
      disabledAt: null,
      status: 'active',
    });
    const audits = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'asc' },
      where: { entityId: cliUserId },
    });
    expect(audits.map((entry) => [entry.action, entry.actorReference])).toEqual([
      ['user.create', 'ops-ticket-001'],
      ['user.set_password', 'ops-ticket-002'],
      ['user.disable', 'ops-ticket-003'],
      ['user.enable', 'ops-ticket-004'],
    ]);
  });

  it('persists throttling keys as irreversible digests without raw identity or IP', async () => {
    const records = await prisma.authLoginThrottle.findMany();
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.keyHash).toMatch(/^[a-f0-9]{64}$/);
      expect(record.keyHash).not.toContain('listener');
      expect(record.keyHash).not.toContain('127.0.0.1');
    }
  });
});
