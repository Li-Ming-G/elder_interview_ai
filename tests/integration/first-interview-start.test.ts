import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PasswordService } from '../../apps/api/src/auth/password.service.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';

const ORIGIN = 'http://127.0.0.1:4173';
const PASSWORD = 'Fictional-only-First-Interview-42!';
const MIME = 'audio/webm;codecs=opus';
const REMINDER_VERSION = 'recording-reminder-v1';
const MVP_V1 = 'mvp-v1';
type Agent = ReturnType<typeof request.agent>;
type SupertestApp = Parameters<typeof request>[0];

interface ErrorBody {
  code: string;
}

interface IdBody {
  id: string;
}

interface LoginBody {
  csrf_token: string;
}

describe('first-interview current-consent start authority', () => {
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
    storageRoot = await mkdtemp(join(tmpdir(), 'elder-first-interview-integration-'));
    app = await createApplication(
      loadApiConfig({
        APP_ENV: 'test',
        AUDIO_CHUNK_MAX_BYTES: '1048576',
        AUDIO_STORAGE_ROOT: storageRoot,
        AUTH_ALLOWED_ORIGINS: ORIGIN,
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-first-interview-throttle-pepper',
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-first-interview-retention-pepper',
        DATABASE_URL: databaseUrl,
      }),
    );
    await application().init();
    prisma = application().get(PrismaService);
    await cleanDatabase(prisma);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    const passwordHash = await new PasswordService().hash(PASSWORD);
    await prisma.user.create({
      data: {
        displayName: '虚构首次访谈倾听员',
        email: 'first-interview-listener@example.test',
        passwordHash,
        role: 'interviewer',
      },
    });
  });

  afterAll(async () => {
    if (app !== null) {
      await cleanDatabase(prisma);
      await app.close();
    }
    await rm(storageRoot, { force: true, recursive: true });
  });

  it('starts a real first interview with current recorded-verbal mvp-v1 consent under the default continuation binding', async () => {
    const listener = request.agent(application().getHttpServer() as SupertestApp);
    const csrf = await login(listener);
    const projectId = await createProject(listener, csrf, '虚构首次访谈 happy path');
    const sessionId = await createCheckedFirstSession(listener, csrf, projectId);
    await appendServiceTerm(listener, csrf, projectId);

    const consentAudio = await listener
      .post(`/api/v1/projects/${projectId}/audio-objects`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({
        mime_type: MIME,
        purpose: 'consent',
        request_id: randomUUID(),
        session_id: null,
      });
    expect(consentAudio.status).toBe(201);
    const consentAudioObjectId = (consentAudio.body as IdBody).id;
    const bytes = Buffer.from('fictional-first-interview-recorded-verbal-consent');
    const uploaded = await upload(listener, csrf, consentAudioObjectId, bytes);
    expect(uploaded.status).toBe(200);
    const completed = await listener
      .post(`/api/v1/audio-objects/${consentAudioObjectId}/complete`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ expected_chunk_count: 1, request_id: randomUUID() });
    expect(completed.status).toBe(201);

    const consent = await listener
      .post(`/api/v1/projects/${projectId}/consents`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({
        consent_audio_object_id: consentAudioObjectId,
        consent_method: 'recorded_verbal',
        consent_text_version: MVP_V1,
        consent_type: 'recording_transcription_ai',
        consented_at: '2026-08-27T08:00:00.000Z',
        request_id: randomUUID(),
      });
    expect(consent.status).toBe(201);
    expect(consent.body).toMatchObject({ status: 'valid' });
    expect(
      (await listener.get(`/api/v1/projects/${projectId}`).set('Origin', ORIGIN)).body,
    ).toMatchObject({ status: 'ready' });

    const started = await startSession(listener, csrf, sessionId);
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ id: sessionId, sequence_no: 1, status: 'recording' });
  });

  it('recovers a legacy first-session draft with current formal consent at start time', async () => {
    const listener = request.agent(application().getHttpServer() as SupertestApp);
    const csrf = await login(listener);
    const actor = await prisma.user.findUniqueOrThrow({
      where: { email: 'first-interview-listener@example.test' },
    });
    const projectId = await createProject(listener, csrf, '虚构遗留首次访谈');
    const sessionId = await createCheckedFirstSession(listener, csrf, projectId);
    await appendServiceTerm(listener, csrf, projectId);

    await prisma.consentRecord.create({
      data: {
        consentMethod: 'written',
        consentTextVersion: MVP_V1,
        consentType: 'recording_transcription_ai',
        consentedAt: new Date('2026-08-27T08:00:00.000Z'),
        createdBy: actor.id,
        projectId,
        status: 'valid',
      },
    });

    expect(
      (await listener.get(`/api/v1/projects/${projectId}`).set('Origin', ORIGIN)).body,
    ).toMatchObject({ status: 'draft' });
    expect(await prisma.elderProject.count({ where: { id: projectId } })).toBe(1);
    expect(await prisma.interviewSession.count({ where: { projectId } })).toBe(1);
    expect(
      await prisma.consentRecord.count({
        where: { consentType: 'recording_transcription_ai', projectId },
      }),
    ).toBe(1);

    const started = await startSession(listener, csrf, sessionId);

    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ id: sessionId, sequence_no: 1, status: 'recording' });
    expect(
      (await listener.get(`/api/v1/projects/${projectId}`).set('Origin', ORIGIN)).body,
    ).toMatchObject({ status: 'active' });
    expect(await prisma.elderProject.count({ where: { id: projectId } })).toBe(1);
    expect(await prisma.interviewSession.count({ where: { projectId } })).toBe(1);
    expect(
      await prisma.consentRecord.count({
        where: { consentType: 'recording_transcription_ai', projectId },
      }),
    ).toBe(1);
  });

  it('keeps a first session without current formal consent blocked', async () => {
    const listener = request.agent(application().getHttpServer() as SupertestApp);
    const csrf = await login(listener);
    const projectId = await createProject(listener, csrf, '虚构无授权首次访谈');
    const sessionId = await createCheckedFirstSession(listener, csrf, projectId);
    await appendServiceTerm(listener, csrf, projectId);

    expect(
      (await listener.get(`/api/v1/projects/${projectId}`).set('Origin', ORIGIN)).body,
    ).toMatchObject({ status: 'draft' });
    const blocked = await startSession(listener, csrf, sessionId);
    expect(blocked.status).toBe(409);
    expect((blocked.body as ErrorBody).code).toBe('PROJECT_NOT_STARTABLE');
    expect(await prisma.audioObject.count({ where: { sessionId } })).toBe(0);
  });

  it.each([
    { revokedAt: new Date('2026-08-27T08:05:00.000Z'), status: 'revoked' as const },
    { revokedAt: null, status: 'pending' as const },
  ])('keeps $status current consent from authorizing the first session', async (consentState) => {
    const listener = request.agent(application().getHttpServer() as SupertestApp);
    const csrf = await login(listener);
    const actor = await prisma.user.findUniqueOrThrow({
      where: { email: 'first-interview-listener@example.test' },
    });
    const projectId = await createProject(listener, csrf, `虚构 ${consentState.status} 授权`);
    const sessionId = await createCheckedFirstSession(listener, csrf, projectId);
    await prisma.consentRecord.create({
      data: {
        consentMethod: 'written',
        consentTextVersion: MVP_V1,
        consentType: 'recording_transcription_ai',
        consentedAt: new Date('2026-08-27T08:00:00.000Z'),
        createdBy: actor.id,
        projectId,
        revokedAt: consentState.revokedAt,
        status: consentState.status,
      },
    });
    await appendServiceTerm(listener, csrf, projectId);

    expect(
      (await listener.get(`/api/v1/projects/${projectId}`).set('Origin', ORIGIN)).body,
    ).toMatchObject({ status: 'draft' });
    const blocked = await startSession(listener, csrf, sessionId);
    expect(blocked.status).toBe(409);
    expect((blocked.body as ErrorBody).code).toBe('PROJECT_NOT_STARTABLE');
    expect(await prisma.audioObject.count({ where: { sessionId } })).toBe(0);
  });

  it('keeps a later session with mvp-v1 consent fail-closed under unavailable continuation policy', async () => {
    const listener = request.agent(application().getHttpServer() as SupertestApp);
    const csrf = await login(listener);
    const actor = await prisma.user.findUniqueOrThrow({
      where: { email: 'first-interview-listener@example.test' },
    });
    const project = await prisma.elderProject.create({
      data: { createdBy: actor.id, displayName: '虚构后续访谈', status: 'active' },
    });
    await prisma.projectAssignment.create({
      data: { assignmentRole: 'interviewer', projectId: project.id, userId: actor.id },
    });
    await prisma.consentRecord.create({
      data: {
        consentMethod: 'written',
        consentTextVersion: MVP_V1,
        consentType: 'recording_transcription_ai',
        consentedAt: new Date('2026-08-27T08:00:00.000Z'),
        createdBy: actor.id,
        projectId: project.id,
        status: 'valid',
      },
    });
    await prisma.interviewSession.create({
      data: {
        createdBy: actor.id,
        endedAt: new Date('2026-08-27T08:30:00.000Z'),
        projectId: project.id,
        sequenceNo: 1,
        startedAt: new Date('2026-08-27T08:00:00.000Z'),
        status: 'completed',
      },
    });
    const repeatSession = await prisma.interviewSession.create({
      data: {
        createdBy: actor.id,
        projectId: project.id,
        sequenceNo: 2,
        status: 'device_check',
      },
    });

    const blocked = await startSession(listener, csrf, repeatSession.id);
    expect(blocked.status).toBe(409);
    expect((blocked.body as ErrorBody).code).toBe('CONSENT_POLICY_UNAVAILABLE');
    expect(await prisma.audioObject.count({ where: { sessionId: repeatSession.id } })).toBe(0);
  });
});

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
      request_id: randomUUID(),
    });
  expect(response.status).toBe(201);
}

async function cleanDatabase(prisma: PrismaService): Promise<void> {
  await prisma.speakerCalibrationAttemptSegment.deleteMany();
  await prisma.speakerCalibrationAttempt.deleteMany();
  await prisma.transcriptSegment.deleteMany();
  await prisma.speakerMapping.deleteMany();
  await prisma.speakerStream.deleteMany();
  await prisma.consentRecord.deleteMany();
  await prisma.audioChunk.deleteMany();
  await prisma.sessionCaptureGeneration.deleteMany();
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

async function createCheckedFirstSession(
  agent: Agent,
  csrf: string,
  projectId: string,
): Promise<string> {
  const created = await agent
    .post(`/api/v1/projects/${projectId}/sessions`)
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrf)
    .send({ request_id: randomUUID() });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ sequence_no: 1, status: 'created' });
  const sessionId = (created.body as IdBody).id;
  const checked = await agent
    .post(`/api/v1/sessions/${sessionId}/device-check`)
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrf)
    .send({ input_detected: true, microphone_permission: 'granted' });
  expect(checked.status).toBe(201);
  expect(checked.body).toMatchObject({ sequence_no: 1, status: 'device_check' });
  return sessionId;
}

async function createProject(agent: Agent, csrf: string, displayName: string): Promise<string> {
  const response = await agent
    .post('/api/v1/projects')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrf)
    .send({ display_name: displayName, request_id: randomUUID() });
  expect(response.status).toBe(201);
  return (response.body as IdBody).id;
}

async function login(agent: Agent): Promise<string> {
  const response = await agent
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email: 'first-interview-listener@example.test', password: PASSWORD });
  expect(response.status).toBe(200);
  return (response.body as LoginBody).csrf_token;
}

function startSession(agent: Agent, csrf: string, sessionId: string): Promise<Response> {
  return agent
    .post(`/api/v1/sessions/${sessionId}/start`)
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrf)
    .send({
      audio_stream_id: randomUUID(),
      mime_type: MIME,
      recording_reminder_version: REMINDER_VERSION,
      request_id: randomUUID(),
    });
}

function upload(
  agent: Agent,
  csrf: string,
  audioObjectId: string,
  bytes: Buffer,
): Promise<Response> {
  return agent
    .put(`/api/v1/audio-objects/${audioObjectId}/chunks/0`)
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrf)
    .set('Content-Type', MIME)
    .set('X-Request-Id', randomUUID())
    .set('X-Chunk-Start-Ms', '0')
    .set('X-Chunk-End-Ms', '5000')
    .set('X-Chunk-SHA256', createHash('sha256').update(bytes).digest('hex'))
    .send(bytes);
}
