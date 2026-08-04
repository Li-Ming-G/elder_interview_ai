import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PasswordService } from '../../apps/api/src/auth/password.service.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';

const ORIGIN = 'http://127.0.0.1:4173';
const PASSWORD = 'Fictional-only-Audio-Password-42!';
const MIME = 'audio/webm;codecs=opus';
type SupertestApp = Parameters<typeof request>[0];
type Agent = ReturnType<typeof request.agent>;

interface LoginBody {
  csrf_token: string;
}

interface IdBody {
  id: string;
}

interface ErrorBody {
  code: string;
}

describe('audio object, immutable chunks and canonical manifest', () => {
  let app: INestApplication | null = null;
  let prisma: PrismaService;
  let storageRoot: string;

  function application(): INestApplication {
    if (app === null) throw new Error('Application is not initialized');
    return app;
  }

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    storageRoot = await mkdtemp(join(tmpdir(), 'elder-audio-integration-'));
    app = await createApplication(
      loadApiConfig({
        APP_ENV: 'test',
        AUDIO_CHUNK_MAX_BYTES: '1048576',
        AUDIO_STORAGE_ROOT: storageRoot,
        AUTH_ALLOWED_ORIGINS: ORIGIN,
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-audio-throttle-pepper',
        DATABASE_URL: databaseUrl,
      }),
    );
    await application().init();
    prisma = application().get(PrismaService);
    await cleanDatabase(prisma);
    const passwordHash = await new PasswordService().hash(PASSWORD);
    await prisma.user.createMany({
      data: [
        {
          displayName: '虚构音频倾听员 A',
          email: 'audio-listener-a@example.test',
          passwordHash,
          role: 'interviewer',
        },
        {
          displayName: '虚构音频倾听员 B',
          email: 'audio-listener-b@example.test',
          passwordHash,
          role: 'interviewer',
        },
      ],
    });
  });

  afterAll(async () => {
    if (app !== null) {
      await cleanDatabase(prisma);
      await app.close();
    }
    await rm(storageRoot, { force: true, recursive: true });
  });

  it('supports draft consent audio, out-of-order retry, complete and recorded verbal consent', async () => {
    const server = application().getHttpServer() as SupertestApp;
    const listenerA = request.agent(server);
    const listenerB = request.agent(server);
    const csrfA = await login(listenerA, 'audio-listener-a@example.test');
    const csrfB = await login(listenerB, 'audio-listener-b@example.test');
    const projectId = await createProject(listenerA, csrfA, '虚构授权音频项目');
    const session = await listenerA
      .post(`/api/v1/projects/${projectId}/sessions`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({});
    const sessionId = (session.body as IdBody).id;

    const invalidInterview = await listenerA
      .post(`/api/v1/projects/${projectId}/audio-objects`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        mime_type: MIME,
        purpose: 'interview',
        request_id: requestId(1),
        session_id: sessionId,
      });
    expect(invalidInterview.status).toBe(409);
    expect((invalidInterview.body as ErrorBody).code).toBe('INVALID_AUDIO_STATE');

    const initialized = await listenerA
      .post(`/api/v1/projects/${projectId}/audio-objects`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        mime_type: MIME,
        purpose: 'consent',
        request_id: requestId(2),
        session_id: null,
      });
    const repeatedInit = await listenerA
      .post(`/api/v1/projects/${projectId}/audio-objects`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        mime_type: MIME,
        purpose: 'consent',
        request_id: requestId(2),
        session_id: null,
      });
    expect(initialized.status).toBe(201);
    expect(repeatedInit.body).toEqual(initialized.body);
    expect(initialized.body).not.toHaveProperty('object_key');
    const audioObjectId = (initialized.body as IdBody).id;

    const deniedManifest = await listenerB
      .get(`/api/v1/audio-objects/${audioObjectId}/manifest`)
      .set('Origin', ORIGIN);
    expect(deniedManifest.status).toBe(403);
    expect((deniedManifest.body as ErrorBody).code).toBe('FORBIDDEN');

    const chunk0 = Buffer.from('fictional-consent-audio-zero');
    const chunk1 = Buffer.from('fictional-consent-audio-one');
    const uploaded1 = await upload(listenerA, csrfA, audioObjectId, 1, 5000, 10000, chunk1, 3);
    const uploaded0 = await upload(listenerA, csrfA, audioObjectId, 0, 0, 5000, chunk0, 4);
    const replay0 = await upload(listenerA, csrfA, audioObjectId, 0, 0, 5000, chunk0, 4);
    const retry0 = await upload(listenerA, csrfA, audioObjectId, 0, 0, 5000, chunk0, 5);
    expect(uploaded1.status).toBe(200);
    expect(uploaded0.status).toBe(200);
    expect(replay0.body).toEqual(uploaded0.body);
    expect(retry0.body).toEqual(uploaded0.body);
    expect(retry0.body).not.toHaveProperty('object_key');
    expect(await prisma.audioChunk.count({ where: { audioObjectId } })).toBe(2);

    const reusedForOtherSequence = await upload(
      listenerA,
      csrfA,
      audioObjectId,
      1,
      5000,
      10000,
      chunk1,
      4,
    );
    expect(reusedForOtherSequence.status).toBe(409);
    expect((reusedForOtherSequence.body as ErrorBody).code).toBe('IDEMPOTENCY_KEY_REUSED');

    const conflict = await upload(
      listenerA,
      csrfA,
      audioObjectId,
      0,
      0,
      5000,
      Buffer.from('different-fictional-audio'),
      6,
    );
    expect(conflict.status).toBe(409);
    expect((conflict.body as ErrorBody).code).toBe('AUDIO_CHUNK_CONFLICT');

    const incomplete = await listenerA
      .post(`/api/v1/audio-objects/${audioObjectId}/complete`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ expected_chunk_count: 3, request_id: requestId(7) });
    expect(incomplete.status).toBe(409);
    expect((incomplete.body as ErrorBody).code).toBe('AUDIO_MANIFEST_INCOMPLETE');

    const completed = await listenerA
      .post(`/api/v1/audio-objects/${audioObjectId}/complete`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ expected_chunk_count: 2, request_id: requestId(8) });
    const repeatedComplete = await listenerA
      .post(`/api/v1/audio-objects/${audioObjectId}/complete`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ expected_chunk_count: 2, request_id: requestId(8) });
    expect(completed.status).toBe(201);
    expect(repeatedComplete.body).toEqual(completed.body);
    expect(completed.body).toMatchObject({
      chunk_count: 2,
      purpose: 'consent',
      status: 'complete',
      total_size_bytes: chunk0.byteLength + chunk1.byteLength,
    });
    expect(completed.body).not.toHaveProperty('object_key');
    expect(JSON.stringify(completed.body)).not.toContain(storageRoot);
    const manifest = await listenerA
      .get(`/api/v1/audio-objects/${audioObjectId}/manifest`)
      .set('Origin', ORIGIN);
    expect(manifest.body).toEqual(completed.body);

    const afterComplete = await upload(
      listenerA,
      csrfA,
      audioObjectId,
      2,
      10000,
      15000,
      Buffer.from('late-fictional-audio'),
      9,
    );
    expect(afterComplete.status).toBe(409);
    expect((afterComplete.body as ErrorBody).code).toBe('AUDIO_OBJECT_COMPLETE');

    await appendServiceTerm(listenerA, csrfA, projectId);
    const consent = await listenerA
      .post(`/api/v1/projects/${projectId}/consents`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        consent_audio_object_id: audioObjectId,
        consent_method: 'recorded_verbal',
        consent_text_version: 'mvp-v1',
        consent_type: 'recording_transcription_ai',
        consented_at: '2026-08-04T08:00:00.000Z',
      });
    expect(consent.status).toBe(201);
    expect(consent.body).toMatchObject({
      consent_audio_object_id: audioObjectId,
      consent_method: 'recorded_verbal',
      status: 'valid',
    });

    const otherProjectId = await createProject(listenerA, csrfA, '虚构跨项目授权');
    await appendServiceTerm(listenerA, csrfA, otherProjectId);
    const crossProjectConsent = await listenerA
      .post(`/api/v1/projects/${otherProjectId}/consents`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        consent_audio_object_id: audioObjectId,
        consent_method: 'recorded_verbal',
        consent_text_version: 'mvp-v1',
        consent_type: 'recording_transcription_ai',
        consented_at: '2026-08-04T08:01:00.000Z',
      });
    expect(crossProjectConsent.status).toBe(409);
    expect((crossProjectConsent.body as ErrorBody).code).toBe('CONSENT_AUDIO_NOT_VERIFIED');

    await listenerA
      .post(`/api/v1/sessions/${sessionId}/device-check`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ input_detected: true, microphone_permission: 'granted' });
    const started = await listenerA
      .post(`/api/v1/sessions/${sessionId}/start`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ request_id: requestId(10) });
    expect(started.body).toMatchObject({ status: 'recording' });
    const interviewObject = await listenerA
      .post(`/api/v1/projects/${projectId}/audio-objects`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        mime_type: MIME,
        purpose: 'interview',
        request_id: requestId(11),
        session_id: sessionId,
      });
    expect(interviewObject.status).toBe(201);
    expect(interviewObject.body).toMatchObject({ purpose: 'interview', session_id: sessionId });
    expect(csrfB).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('detects storage tampering and adopts a matching orphan after database failure', async () => {
    const server = application().getHttpServer() as SupertestApp;
    const listener = request.agent(server);
    const csrf = await login(listener, 'audio-listener-a@example.test');
    const projectId = await createProject(listener, csrf, '虚构故障注入音频');
    const object = await listener
      .post(`/api/v1/projects/${projectId}/audio-objects`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({
        mime_type: MIME,
        purpose: 'consent',
        request_id: requestId(20),
        session_id: null,
      });
    const audioObjectId = (object.body as IdBody).id;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_audio_chunk_for_test() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'test-only audio database failure'; END;
      $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_audio_chunk_for_test
      BEFORE INSERT ON audio_chunk FOR EACH ROW EXECUTE FUNCTION fail_audio_chunk_for_test()`);
    const bytes = Buffer.from('fictional-orphan-audio');
    try {
      const failed = await upload(listener, csrf, audioObjectId, 0, 0, 5000, bytes, 21);
      expect(failed.status).toBe(500);
      expect(await prisma.audioChunk.count({ where: { audioObjectId } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER fail_audio_chunk_for_test ON audio_chunk');
      await prisma.$executeRawUnsafe('DROP FUNCTION fail_audio_chunk_for_test()');
    }
    const adopted = await upload(listener, csrf, audioObjectId, 0, 0, 5000, bytes, 22);
    expect(adopted.status).toBe(200);
    const chunk = await prisma.audioChunk.findFirstOrThrow({ where: { audioObjectId } });
    await writeFile(join(storageRoot, chunk.objectKey), Buffer.from('tampered-fictional-audio'));
    const incomplete = await listener
      .post(`/api/v1/audio-objects/${audioObjectId}/complete`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ expected_chunk_count: 1, request_id: requestId(23) });
    expect(incomplete.status).toBe(409);
    expect((incomplete.body as ErrorBody).code).toBe('AUDIO_MANIFEST_INCOMPLETE');
    await writeFile(join(storageRoot, chunk.objectKey), bytes);
    const completed = await listener
      .post(`/api/v1/audio-objects/${audioObjectId}/complete`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ expected_chunk_count: 1, request_id: requestId(26) });
    expect(completed.status).toBe(201);
    await writeFile(join(storageRoot, chunk.objectKey), Buffer.from('tampered-after-complete'));
    await appendServiceTerm(listener, csrf, projectId);
    const unverifiedConsent = await listener
      .post(`/api/v1/projects/${projectId}/consents`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({
        consent_audio_object_id: audioObjectId,
        consent_method: 'recorded_verbal',
        consent_text_version: 'mvp-v1',
        consent_type: 'recording_transcription_ai',
        consented_at: '2026-08-04T09:00:00.000Z',
      });
    expect(unverifiedConsent.status).toBe(409);
    expect((unverifiedConsent.body as ErrorBody).code).toBe('CONSENT_AUDIO_NOT_VERIFIED');
  });

  it('rechecks the current assignment before accepting a chunk', async () => {
    const server = application().getHttpServer() as SupertestApp;
    const listener = request.agent(server);
    const csrf = await login(listener, 'audio-listener-a@example.test');
    const projectId = await createProject(listener, csrf, '虚构撤销分配音频');
    const object = await listener
      .post(`/api/v1/projects/${projectId}/audio-objects`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({
        mime_type: MIME,
        purpose: 'consent',
        request_id: requestId(24),
        session_id: null,
      });
    const actor = await prisma.user.findUniqueOrThrow({
      where: { email: 'audio-listener-a@example.test' },
    });
    await prisma.projectAssignment.updateMany({
      data: { revokedAt: new Date() },
      where: { projectId, revokedAt: null, userId: actor.id },
    });
    const denied = await upload(
      listener,
      csrf,
      (object.body as IdBody).id,
      0,
      0,
      5000,
      Buffer.from('fictional-revoked-assignment-audio'),
      25,
    );
    expect(denied.status).toBe(403);
    expect((denied.body as ErrorBody).code).toBe('FORBIDDEN');
  });

  it('does not ACK or persist uploaded metadata when private storage is unavailable', async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    const blockedRoot = join(storageRoot, 'not-a-directory');
    await writeFile(blockedRoot, 'test-only blocker');
    const isolated = await createApplication(
      loadApiConfig({
        APP_ENV: 'test',
        AUDIO_STORAGE_ROOT: blockedRoot,
        AUTH_ALLOWED_ORIGINS: ORIGIN,
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-audio-throttle-pepper',
        DATABASE_URL: databaseUrl,
      }),
    );
    await isolated.init();
    try {
      const server = isolated.getHttpServer() as SupertestApp;
      const listener = request.agent(server);
      const csrf = await login(listener, 'audio-listener-a@example.test');
      const projectId = await createProject(listener, csrf, '虚构存储失败音频');
      const object = await listener
        .post(`/api/v1/projects/${projectId}/audio-objects`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', csrf)
        .send({
          mime_type: MIME,
          purpose: 'consent',
          request_id: requestId(30),
          session_id: null,
        });
      const audioObjectId = (object.body as IdBody).id;
      const failed = await upload(
        listener,
        csrf,
        audioObjectId,
        0,
        0,
        5000,
        Buffer.from('fictional-storage-failure'),
        31,
      );
      expect(failed.status).toBe(503);
      expect((failed.body as ErrorBody).code).toBe('AUDIO_STORAGE_UNAVAILABLE');
      expect(await prisma.audioChunk.count({ where: { audioObjectId } })).toBe(0);
      expect(
        (await prisma.audioObject.findUniqueOrThrow({ where: { id: audioObjectId } })).status,
      ).toBe('initiated');
    } finally {
      await isolated.close();
    }
  });
});

async function cleanDatabase(prisma: PrismaService): Promise<void> {
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
}

async function login(agent: Agent, email: string): Promise<string> {
  const response = await agent
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return (response.body as LoginBody).csrf_token;
}

async function createProject(agent: Agent, csrf: string, displayName: string): Promise<string> {
  const response = await agent
    .post('/api/v1/projects')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrf)
    .send({ display_name: displayName });
  expect(response.status).toBe(201);
  return (response.body as IdBody).id;
}

async function appendServiceTerm(agent: Agent, csrf: string, projectId: string): Promise<void> {
  const response = await agent
    .post(`/api/v1/projects/${projectId}/service-terms`)
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrf)
    .send({
      currency: 'CNY',
      estimated_session_count: 1,
      expected_current_minutes: 30,
      included_minutes: 30,
      overtime_price_minor: 0,
      overtime_unit_minutes: 30,
    });
  expect(response.status).toBe(201);
}

async function upload(
  agent: Agent,
  csrf: string,
  audioObjectId: string,
  sequenceNo: number,
  startMs: number,
  endMs: number,
  bytes: Buffer,
  requestNumber: number,
): Promise<Response> {
  return agent
    .put(`/api/v1/audio-objects/${audioObjectId}/chunks/${String(sequenceNo)}`)
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrf)
    .set('Content-Type', MIME)
    .set('X-Request-Id', requestId(requestNumber))
    .set('X-Chunk-Start-Ms', String(startMs))
    .set('X-Chunk-End-Ms', String(endMs))
    .set('X-Chunk-SHA256', sha256(bytes))
    .send(bytes);
}

function requestId(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
