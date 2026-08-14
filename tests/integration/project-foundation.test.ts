import { randomUUID } from 'node:crypto';

import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PasswordService } from '../../apps/api/src/auth/password.service.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { LocalTestDeletionScopeFixtureReader } from '../../apps/api/src/ai-runtime/deletion-scope.reader.js';
import {
  FICTIONAL_CONTINUING_CONSENT_VERSION,
  SyntheticConsentContinuationPolicyReader,
  UnavailableConsentContinuationPolicyReader,
} from '../../apps/api/src/project-foundation/consent-continuation.policy.js';
import { RepeatInterviewDecisionService } from '../../apps/api/src/project-foundation/repeat-interview-decision.service.js';

const ORIGIN = 'http://127.0.0.1:4173';
const PASSWORD = 'Fictional-only-Password-42!';
const REMINDER_VERSION = 'recording-reminder-v1';
type SupertestApp = Parameters<typeof request>[0];

interface LoginBody {
  csrf_token: string;
}

interface ErrorBody {
  code: string;
}

interface IdBody {
  id: string;
}

describe('project, bundled consent and interview start vertical seam', () => {
  let app: INestApplication | null = null;
  let prisma: PrismaService;

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
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-project-throttle-pepper',
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-project-retention-pepper',
        DATABASE_URL: databaseUrl,
      }),
      { consentContinuationPolicyReader: new SyntheticConsentContinuationPolicyReader() },
    );
    await application().init();
    prisma = application().get(PrismaService);
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
    const passwordHash = await new PasswordService().hash(PASSWORD);
    await prisma.user.createMany({
      data: [
        {
          displayName: '虚构倾听员 A',
          email: 'project-listener-a@example.test',
          passwordHash,
          role: 'interviewer',
        },
        {
          displayName: '虚构倾听员 B',
          email: 'project-listener-b@example.test',
          passwordHash,
          role: 'interviewer',
        },
      ],
    });
  });

  afterAll(async () => {
    if (app !== null) {
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
      await app.close();
    }
  });

  it('keeps assignment, history, withdrawal and start gates transactional and isolated', async () => {
    const server = application().getHttpServer() as SupertestApp;
    const listenerA = request.agent(server);
    const listenerB = request.agent(server);
    const loginA = await listenerA
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'project-listener-a@example.test', password: PASSWORD });
    const loginB = await listenerB
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'project-listener-b@example.test', password: PASSWORD });
    expect(loginA.status).toBe(200);
    expect(loginB.status).toBe(200);
    const csrfA = (loginA.body as LoginBody).csrf_token;
    const csrfB = (loginB.body as LoginBody).csrf_token;

    const createdProject = await listenerA
      .post('/api/v1/projects')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        approximate_age: null,
        birth_year: null,
        current_city: null,
        display_name: '虚构长者甲',
        native_place: null,
        request_id: randomUUID(),
      });
    expect(createdProject.status).toBe(201);
    expect(createdProject.body).toMatchObject({ display_name: '虚构长者甲', status: 'draft' });
    const projectId = (createdProject.body as IdBody).id;
    expect(
      await prisma.projectAssignment.count({
        where: { projectId, revokedAt: null, user: { email: 'project-listener-a@example.test' } },
      }),
    ).toBe(1);

    const denied = await listenerB.get(`/api/v1/projects/${projectId}`).set('Origin', ORIGIN);
    expect(denied.status).toBe(403);
    expect((denied.body as ErrorBody).code).toBe('FORBIDDEN');
    expect((await listenerB.get('/api/v1/projects').set('Origin', ORIGIN)).body).toEqual({
      items: [],
    });

    const draftSession = await listenerA
      .post(`/api/v1/projects/${projectId}/sessions`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ request_id: randomUUID() });
    expect(draftSession.status).toBe(201);
    expect(draftSession.body).toMatchObject({
      project_id: projectId,
      sequence_no: 1,
      status: 'created',
    });
    const sessionId = (draftSession.body as IdBody).id;

    const failedDevice = await listenerA
      .post(`/api/v1/sessions/${sessionId}/device-check`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ input_detected: false, microphone_permission: 'granted' });
    expect(failedDevice.status).toBe(422);
    expect((failedDevice.body as ErrorBody).code).toBe('DEVICE_CHECK_FAILED');
    const checked = await listenerA
      .post(`/api/v1/sessions/${sessionId}/device-check`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ input_detected: true, microphone_permission: 'granted' });
    expect(checked.body).toMatchObject({ status: 'device_check' });

    const earlyStart = await listenerA
      .post(`/api/v1/sessions/${sessionId}/start`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        audio_stream_id: '00000000-0000-4000-8000-000000000111',
        mime_type: 'audio/webm;codecs=opus',
        recording_reminder_version: REMINDER_VERSION,
        request_id: '00000000-0000-4000-8000-000000000101',
      });
    expect(earlyStart.status).toBe(409);
    expect((earlyStart.body as ErrorBody).code).toBe('PROJECT_NOT_STARTABLE');

    const firstTerm = await listenerA
      .post(`/api/v1/projects/${projectId}/service-terms`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        currency: 'CNY',
        estimated_session_count: 2,
        expected_current_minutes: 30,
        included_minutes: 60,
        overtime_price_minor: 0,
        overtime_unit_minutes: 30,
        request_id: randomUUID(),
      });
    expect(firstTerm.status).toBe(201);
    expect(
      (await listenerA.get(`/api/v1/projects/${projectId}`).set('Origin', ORIGIN)).body,
    ).toMatchObject({
      status: 'draft',
    });

    const unverifiableVerbal = await listenerA
      .post(`/api/v1/projects/${projectId}/consents`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        consent_audio_object_id: '00000000-0000-4000-8000-000000000201',
        consent_method: 'recorded_verbal',
        consent_text_version: FICTIONAL_CONTINUING_CONSENT_VERSION,
        consent_type: 'recording_transcription_ai',
        consented_at: '2026-08-03T08:00:00.000Z',
        request_id: randomUUID(),
      });
    expect(unverifiableVerbal.status).toBe(409);
    expect((unverifiableVerbal.body as ErrorBody).code).toBe('CONSENT_AUDIO_NOT_VERIFIED');
    expect(await prisma.consentRecord.count({ where: { projectId } })).toBe(0);

    const firstConsent = await listenerA
      .post(`/api/v1/projects/${projectId}/consents`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        consent_audio_object_id: null,
        consent_method: 'electronic',
        consent_text_version: FICTIONAL_CONTINUING_CONSENT_VERSION,
        consent_type: 'recording_transcription_ai',
        consented_at: '2026-08-03T08:00:00.000Z',
        request_id: randomUUID(),
      });
    expect(firstConsent.status).toBe(201);
    expect(
      (await prisma.elderProject.findUniqueOrThrow({ where: { id: projectId } })).aiPolicyRevision,
    ).toBe(1);
    expect(
      (await listenerA.get(`/api/v1/projects/${projectId}`).set('Origin', ORIGIN)).body,
    ).toMatchObject({
      status: 'ready',
    });

    const startRequestId = '00000000-0000-4000-8000-000000000102';
    const startPayload = {
      audio_stream_id: '00000000-0000-4000-8000-000000000112',
      mime_type: 'audio/webm;codecs=opus',
      recording_reminder_version: REMINDER_VERSION,
      request_id: startRequestId,
    };
    const started = await listenerA
      .post(`/api/v1/sessions/${sessionId}/start`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send(startPayload);
    const repeatedStart = await listenerA
      .post(`/api/v1/sessions/${sessionId}/start`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send(startPayload);
    expect(started.body).toMatchObject({ id: sessionId, status: 'recording' });
    expect(repeatedStart.body).toEqual(started.body);
    expect(
      await prisma.auditLog.count({
        where: { action: 'interview_session.start', requestId: startRequestId },
      }),
    ).toBe(1);

    const secondTerm = await listenerA
      .post(`/api/v1/projects/${projectId}/service-terms`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        currency: 'CNY',
        estimated_session_count: 3,
        expected_current_minutes: 45,
        included_minutes: 90,
        overtime_price_minor: 0,
        overtime_unit_minutes: 30,
        request_id: randomUUID(),
      });
    expect(secondTerm.status).toBe(201);
    const terms = await prisma.serviceTerm.findMany({
      orderBy: { createdAt: 'asc' },
      where: { projectId },
    });
    expect(terms).toHaveLength(2);
    expect(terms[0]?.supersededAt).not.toBeNull();
    expect(terms[0]?.includedMinutes).toBe(60);
    expect(terms[1]?.supersededAt).toBeNull();

    const secondConsent = await listenerA
      .post(`/api/v1/projects/${projectId}/consents`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        consent_audio_object_id: null,
        consent_method: 'written',
        consent_text_version: 'mvp-v2',
        consent_type: 'recording_transcription_ai',
        consented_at: '2026-08-03T09:00:00.000Z',
        request_id: randomUUID(),
      });
    expect(secondConsent.status).toBe(201);
    const secondConsentId = (secondConsent.body as IdBody).id;
    const driftSession = await listenerA
      .post(`/api/v1/projects/${projectId}/sessions`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ request_id: randomUUID() });
    const driftSessionId = (driftSession.body as IdBody).id;
    await listenerA
      .post(`/api/v1/sessions/${driftSessionId}/device-check`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ input_detected: true, microphone_permission: 'granted' });
    const driftStart = await listenerA
      .post(`/api/v1/sessions/${driftSessionId}/start`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        audio_stream_id: randomUUID(),
        mime_type: 'audio/webm;codecs=opus',
        recording_reminder_version: REMINDER_VERSION,
        request_id: randomUUID(),
      });
    expect(driftStart.status).toBe(409);
    expect((driftStart.body as ErrorBody).code).toBe('CONSENT_REAUTHORIZATION_REQUIRED');
    expect(await prisma.audioObject.count({ where: { sessionId: driftSessionId } })).toBe(0);
    const revokeRequestId = '00000000-0000-4000-8000-000000000103';
    const revoked = await listenerA
      .post(`/api/v1/consents/${secondConsentId}/revoke`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ request_id: revokeRequestId });
    const repeatedRevoke = await listenerA
      .post(`/api/v1/consents/${secondConsentId}/revoke`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ request_id: revokeRequestId });
    expect(revoked.body).toMatchObject({ id: secondConsentId, status: 'revoked' });
    expect(repeatedRevoke.body).toEqual(revoked.body);
    expect(
      (await prisma.elderProject.findUniqueOrThrow({ where: { id: projectId } })).aiPolicyRevision,
    ).toBe(3);
    expect(await prisma.consentRecord.count({ where: { projectId } })).toBe(2);
    expect(
      await prisma.consentRecord.findUniqueOrThrow({
        where: { id: (firstConsent.body as IdBody).id },
      }),
    ).toMatchObject({
      status: 'valid',
    });
    expect(await prisma.elderProject.findUniqueOrThrow({ where: { id: projectId } })).toMatchObject(
      {
        status: 'restricted',
        statusBeforeRestriction: 'active',
      },
    );
    expect(
      await prisma.auditLog.count({
        where: { action: 'consent.revoke', requestId: revokeRequestId },
      }),
    ).toBe(1);

    const sessionAfterWithdrawal = await listenerA
      .post(`/api/v1/projects/${projectId}/sessions`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ request_id: randomUUID() });
    expect(sessionAfterWithdrawal.status).toBe(409);
    expect((sessionAfterWithdrawal.body as ErrorBody).code).toBe('PROJECT_NOT_STARTABLE');

    expect(csrfB).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('starts a checked and consented interview without inventing a service-term row', async () => {
    const listener = request.agent(application().getHttpServer() as SupertestApp);
    const login = await listener
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'project-listener-a@example.test', password: PASSWORD });
    const csrf = (login.body as LoginBody).csrf_token;
    const project = await listener
      .post('/api/v1/projects')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ display_name: '虚构无价格主链路', request_id: randomUUID() });
    const projectId = (project.body as IdBody).id;
    const createdSession = await listener
      .post(`/api/v1/projects/${projectId}/sessions`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ request_id: randomUUID() });
    const sessionId = (createdSession.body as IdBody).id;
    await listener
      .post(`/api/v1/sessions/${sessionId}/device-check`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ input_detected: true, microphone_permission: 'granted' });
    await listener
      .post(`/api/v1/projects/${projectId}/consents`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({
        consent_audio_object_id: null,
        consent_method: 'electronic',
        consent_text_version: FICTIONAL_CONTINUING_CONSENT_VERSION,
        consent_type: 'recording_transcription_ai',
        consented_at: '2026-08-13T00:00:00.000Z',
        request_id: randomUUID(),
      });

    expect(await prisma.serviceTerm.count({ where: { projectId } })).toBe(0);
    const started = await listener
      .post(`/api/v1/sessions/${sessionId}/start`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({
        audio_stream_id: randomUUID(),
        mime_type: 'audio/webm;codecs=opus',
        recording_reminder_version: REMINDER_VERSION,
        request_id: randomUUID(),
      });
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ id: sessionId, status: 'recording' });
    expect(await prisma.serviceTerm.count({ where: { projectId } })).toBe(0);
  });

  it('authoritatively replays all four creates and rejects changed bindings', async () => {
    const server = application().getHttpServer() as SupertestApp;
    const listenerA = request.agent(server);
    const listenerB = request.agent(server);
    const loginA = await listenerA
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'project-listener-a@example.test', password: PASSWORD });
    const loginB = await listenerB
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'project-listener-b@example.test', password: PASSWORD });
    const csrfA = (loginA.body as LoginBody).csrf_token;
    const csrfB = (loginB.body as LoginBody).csrf_token;

    const projectRequestId = randomUUID();
    const projectPayload = { display_name: '虚构 A2 幂等项目', request_id: projectRequestId };
    const created = await listenerA
      .post('/api/v1/projects')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send(projectPayload);
    const replayedProject = await listenerA
      .post('/api/v1/projects')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send(projectPayload);
    expect(replayedProject.body).toEqual(created.body);
    const projectId = (created.body as IdBody).id;
    expect(
      await prisma.elderProject.count({ where: { displayName: projectPayload.display_name } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'project.create', requestId: projectRequestId },
      }),
    ).toBe(1);
    const crossActor = await listenerB
      .post('/api/v1/projects')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfB)
      .send(projectPayload);
    expect((crossActor.body as ErrorBody).code).toBe('IDEMPOTENCY_KEY_REUSED');
    const changedProjectPayload = await listenerA
      .post('/api/v1/projects')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ display_name: '不同项目', request_id: projectRequestId });
    expect((changedProjectPayload.body as ErrorBody).code).toBe('IDEMPOTENCY_KEY_REUSED');

    const termRequestId = randomUUID();
    const termPayload = {
      currency: 'CNY',
      estimated_session_count: 1,
      expected_current_minutes: 30,
      included_minutes: 30,
      overtime_price_minor: 0,
      overtime_unit_minutes: 30,
      request_id: termRequestId,
    };
    const term = await listenerA
      .post(`/api/v1/projects/${projectId}/service-terms`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send(termPayload);
    const termReplay = await listenerA
      .post(`/api/v1/projects/${projectId}/service-terms`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send(termPayload);
    expect(termReplay.body).toEqual(term.body);
    expect(await prisma.serviceTerm.count({ where: { projectId } })).toBe(1);
    const otherProject = await listenerA
      .post('/api/v1/projects')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ display_name: '虚构 A2 其他目标', request_id: randomUUID() });
    const changedTarget = await listenerA
      .post(`/api/v1/projects/${(otherProject.body as IdBody).id}/service-terms`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send(termPayload);
    expect((changedTarget.body as ErrorBody).code).toBe('IDEMPOTENCY_KEY_REUSED');

    const consentRequestId = randomUUID();
    const consentPayload = {
      consent_audio_object_id: null,
      consent_method: 'electronic',
      consent_text_version: FICTIONAL_CONTINUING_CONSENT_VERSION,
      consent_type: 'recording_transcription_ai',
      consented_at: '2026-08-12T12:00:00.000Z',
      request_id: consentRequestId,
    };
    const consent = await listenerA
      .post(`/api/v1/projects/${projectId}/consents`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send(consentPayload);
    const consentReplay = await listenerA
      .post(`/api/v1/projects/${projectId}/consents`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send(consentPayload);
    expect(consentReplay.body).toEqual(consent.body);
    expect(await prisma.consentRecord.count({ where: { projectId } })).toBe(1);

    const sessionRequestId = randomUUID();
    const session = await listenerA
      .post(`/api/v1/projects/${projectId}/sessions`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ request_id: sessionRequestId });
    const sessionReplay = await listenerA
      .post(`/api/v1/projects/${projectId}/sessions`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ request_id: sessionRequestId });
    expect(sessionReplay.body).toEqual(session.body);
    expect(await prisma.interviewSession.count({ where: { projectId } })).toBe(1);

    const crossAction = await listenerA
      .post(`/api/v1/projects/${projectId}/sessions`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ request_id: consentRequestId });
    expect((crossAction.body as ErrorBody).code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('serializes concurrent session numbering', async () => {
    const server = application().getHttpServer() as SupertestApp;
    const listener = request.agent(server);
    const login = await listener
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'project-listener-a@example.test', password: PASSWORD });
    const csrf = (login.body as LoginBody).csrf_token;
    const project = await listener
      .post('/api/v1/projects')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ display_name: '虚构并发场次项目', request_id: randomUUID() });
    const projectId = (project.body as IdBody).id;

    const responses = await Promise.all(
      Array.from({ length: 5 }, async () =>
        listener
          .post(`/api/v1/projects/${projectId}/sessions`)
          .set('Origin', ORIGIN)
          .set('X-CSRF-Token', csrf)
          .send({ request_id: randomUUID() }),
      ),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    const sequenceNumbers = responses
      .map((response) => (response.body as { sequence_no: number }).sequence_no)
      .sort((left, right) => left - right);
    expect(sequenceNumbers).toEqual([1, 2, 3, 4, 5]);
  });

  it('uses one authoritative repeat decision for Home, next-session, and reminder-gated start', async () => {
    const listener = request.agent(application().getHttpServer() as SupertestApp);
    const login = await listener
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'project-listener-a@example.test', password: PASSWORD });
    const csrf = (login.body as LoginBody).csrf_token;
    const actor = await prisma.user.findUniqueOrThrow({
      where: { email: 'project-listener-a@example.test' },
    });

    async function repeatFixture(label: string): Promise<{ basisId: string; projectId: string }> {
      const project = await prisma.elderProject.create({
        data: { createdBy: actor.id, displayName: label, status: 'active' },
      });
      await prisma.projectAssignment.create({
        data: { assignmentRole: 'interviewer', projectId: project.id, userId: actor.id },
      });
      await prisma.consentRecord.create({
        data: {
          consentMethod: 'written',
          consentTextVersion: FICTIONAL_CONTINUING_CONSENT_VERSION,
          consentType: 'recording_transcription_ai',
          consentedAt: new Date('2026-08-14T00:00:00.000Z'),
          createdBy: actor.id,
          projectId: project.id,
          status: 'valid',
        },
      });
      const basis = await prisma.interviewSession.create({
        data: {
          createdBy: actor.id,
          endedAt: new Date('2026-08-14T00:10:00.000Z'),
          projectId: project.id,
          sequenceNo: 1,
          startedAt: new Date('2026-08-14T00:00:00.000Z'),
          status: 'completed',
        },
      });
      return { basisId: basis.id, projectId: project.id };
    }

    const fixture = await repeatFixture('虚构 B1 权威动作项目');
    const home = await listener.get('/api/v1/projects').set('Origin', ORIGIN);
    const row = (home.body as { items: Array<Record<string, unknown>> }).items.find(
      ({ id }) => id === fixture.projectId,
    );
    expect(row?.repeat_interview).toMatchObject({
      basis_sequence_no: 1,
      basis_session_id: fixture.basisId,
      next_sequence_no: 2,
      primary_action: 'start_next_session',
      reason: 'eligible',
    });

    const requestId = randomUUID();
    const payload = {
      basis_session_id: fixture.basisId,
      expected_basis_sequence_no: 1,
      request_id: requestId,
      workflow_version: 'repeat-interview-v1',
    };
    const created = await listener
      .post(`/api/v1/projects/${fixture.projectId}/next-session`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send(payload);
    const replay = await listener
      .post(`/api/v1/projects/${fixture.projectId}/next-session`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send(payload);
    expect(created.status).toBe(201);
    expect(replay.body).toEqual(created.body);
    expect(created.body).toMatchObject({
      basis_sequence_no: 1,
      basis_session_id: fixture.basisId,
      project_id: fixture.projectId,
      request_id: requestId,
      session: {
        project_id: fixture.projectId,
        recording_start_reminder: {
          action_label: '开始访谈',
          creates_consent_record: false,
          requires_explicit_action: true,
          version: REMINDER_VERSION,
        },
        sequence_no: 2,
        status: 'created',
      },
    });
    expect(
      await prisma.auditLog.count({ where: { action: 'next_session.create', requestId } }),
    ).toBe(1);
    const changedPayload = await listener
      .post(`/api/v1/projects/${fixture.projectId}/next-session`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ ...payload, expected_basis_sequence_no: 9 });
    expect(changedPayload.status).toBe(409);
    expect((changedPayload.body as ErrorBody).code).toBe('IDEMPOTENCY_KEY_REUSED');
    const nextSessionId = (created.body as { session: IdBody }).session.id;
    expect(await prisma.audioObject.count({ where: { sessionId: nextSessionId } })).toBe(0);
    expect(
      await prisma.sessionCaptureGeneration.count({ where: { sessionId: nextSessionId } }),
    ).toBe(0);
    expect(await prisma.speakerStream.count({ where: { sessionId: nextSessionId } })).toBe(0);
    expect(
      await prisma.speakerCalibrationAttempt.count({ where: { sessionId: nextSessionId } }),
    ).toBe(0);

    await listener
      .post(`/api/v1/sessions/${nextSessionId}/device-check`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ input_detected: true, microphone_permission: 'granted' });
    const staleStartRequestId = randomUUID();
    const staleStart = await listener
      .post(`/api/v1/sessions/${nextSessionId}/start`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({
        audio_stream_id: randomUUID(),
        mime_type: 'audio/webm;codecs=opus',
        recording_reminder_version: 'recording-reminder-v0',
        request_id: staleStartRequestId,
      });
    expect(staleStart.status).toBe(409);
    expect((staleStart.body as ErrorBody).code).toBe('RECORDING_REMINDER_VERSION_STALE');
    expect(await prisma.audioObject.count({ where: { sessionId: nextSessionId } })).toBe(0);
    expect(
      await prisma.sessionCaptureGeneration.count({ where: { sessionId: nextSessionId } }),
    ).toBe(0);

    const consentCountBeforeStart = await prisma.consentRecord.count({
      where: { projectId: fixture.projectId },
    });
    const startRequestId = randomUUID();
    const startPayload = {
      audio_stream_id: randomUUID(),
      mime_type: 'audio/webm;codecs=opus',
      recording_reminder_version: REMINDER_VERSION,
      request_id: startRequestId,
    };
    const started = await listener
      .post(`/api/v1/sessions/${nextSessionId}/start`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send(startPayload);
    const startedReplay = await listener
      .post(`/api/v1/sessions/${nextSessionId}/start`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send(startPayload);
    expect(started.status).toBe(201);
    expect(startedReplay.body).toEqual(started.body);
    expect(await prisma.consentRecord.count({ where: { projectId: fixture.projectId } })).toBe(
      consentCountBeforeStart,
    );
    const reminderDriftReplay = await listener
      .post(`/api/v1/sessions/${nextSessionId}/start`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ ...startPayload, recording_reminder_version: 'recording-reminder-v0' });
    expect(reminderDriftReplay.status).toBe(409);
    expect((reminderDriftReplay.body as ErrorBody).code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');

    const concurrentFixture = await repeatFixture('虚构 B1 并发项目');
    const changedProject = await listener
      .post(`/api/v1/projects/${concurrentFixture.projectId}/next-session`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send(payload);
    expect(changedProject.status).toBe(409);
    expect((changedProject.body as ErrorBody).code).toBe('IDEMPOTENCY_KEY_REUSED');
    const concurrentRequestIds = [randomUUID(), randomUUID()];
    const concurrentResponses = await Promise.all(
      concurrentRequestIds.map((concurrentRequestId) =>
        listener
          .post(`/api/v1/projects/${concurrentFixture.projectId}/next-session`)
          .set('Origin', ORIGIN)
          .set('X-CSRF-Token', csrf)
          .send({
            basis_session_id: concurrentFixture.basisId,
            expected_basis_sequence_no: 1,
            request_id: concurrentRequestId,
            workflow_version: 'repeat-interview-v1',
          }),
      ),
    );
    expect(concurrentResponses.map(({ status }) => status).sort()).toEqual([201, 409]);
    const loser = concurrentResponses.find(({ status }) => status === 409);
    const loserIndex = concurrentResponses.findIndex(({ status }) => status === 409);
    expect((loser?.body as ErrorBody).code).toBe('NEXT_SESSION_ALREADY_EXISTS');
    expect((loser?.body as { details: { sequence_no: number } }).details.sequence_no).toBe(2);
    const loserReplay = await listener
      .post(`/api/v1/projects/${concurrentFixture.projectId}/next-session`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({
        basis_session_id: concurrentFixture.basisId,
        expected_basis_sequence_no: 1,
        request_id: concurrentRequestIds[loserIndex],
        workflow_version: 'repeat-interview-v1',
      });
    expect(loserReplay.status).toBe(409);
    expect(loserReplay.body).toMatchObject({
      code: 'NEXT_SESSION_ALREADY_EXISTS',
      details: {
        sequence_no: 2,
        session_id: (loser?.body as { details: { session_id: string } }).details.session_id,
      },
      message: 'A current interview session already exists',
    });
    expect(
      await prisma.interviewSession.count({ where: { projectId: concurrentFixture.projectId } }),
    ).toBe(2);
  });

  it('fails closed when stale Home facts drift across project, assignment, consent, restriction, or deletion', async () => {
    const listener = request.agent(application().getHttpServer() as SupertestApp);
    const login = await listener
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'project-listener-a@example.test', password: PASSWORD });
    const csrf = (login.body as LoginBody).csrf_token;
    const actor = await prisma.user.findUniqueOrThrow({
      where: { email: 'project-listener-a@example.test' },
    });
    const deletion = application().get(LocalTestDeletionScopeFixtureReader);

    async function fixture(label: string): Promise<{ basisId: string; projectId: string }> {
      const project = await prisma.elderProject.create({
        data: { createdBy: actor.id, displayName: label, status: 'active' },
      });
      await prisma.projectAssignment.create({
        data: { assignmentRole: 'interviewer', projectId: project.id, userId: actor.id },
      });
      await prisma.consentRecord.create({
        data: {
          consentMethod: 'written',
          consentTextVersion: FICTIONAL_CONTINUING_CONSENT_VERSION,
          consentType: 'recording_transcription_ai',
          consentedAt: new Date(),
          createdBy: actor.id,
          projectId: project.id,
          status: 'valid',
        },
      });
      const basis = await prisma.interviewSession.create({
        data: { createdBy: actor.id, projectId: project.id, sequenceNo: 1, status: 'completed' },
      });
      return { basisId: basis.id, projectId: project.id };
    }

    function nextPayload(basisId: string): Record<string, unknown> {
      return {
        basis_session_id: basisId,
        expected_basis_sequence_no: 1,
        request_id: randomUUID(),
        workflow_version: 'repeat-interview-v1',
      };
    }

    const projectP = await fixture('虚构跨项目 P');
    const projectQ = await fixture('虚构跨项目 Q');
    const crossProject = await listener
      .post(`/api/v1/projects/${projectQ.projectId}/next-session`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send(nextPayload(projectP.basisId));
    expect(crossProject.status).toBe(409);
    expect((crossProject.body as ErrorBody).code).toBe('NEXT_SESSION_BASIS_STALE');
    expect(await prisma.interviewSession.count({ where: { projectId: projectQ.projectId } })).toBe(
      1,
    );

    const assignmentDrift = await fixture('虚构 assignment 漂移');
    await prisma.projectAssignment.updateMany({
      data: { revokedAt: new Date() },
      where: { projectId: assignmentDrift.projectId, userId: actor.id },
    });
    const denied = await listener
      .post(`/api/v1/projects/${assignmentDrift.projectId}/next-session`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send(nextPayload(assignmentDrift.basisId));
    expect(denied.status).toBe(404);
    expect(
      await prisma.interviewSession.count({ where: { projectId: assignmentDrift.projectId } }),
    ).toBe(1);

    const restrictionDrift = await fixture('虚构 restriction 漂移');
    await prisma.elderProject.update({
      data: { status: 'restricted', statusBeforeRestriction: 'active' },
      where: { id: restrictionDrift.projectId },
    });
    const restricted = await listener
      .post(`/api/v1/projects/${restrictionDrift.projectId}/next-session`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send(nextPayload(restrictionDrift.basisId));
    expect(restricted.status).toBe(409);
    expect((restricted.body as ErrorBody).code).toBe('PROJECT_NOT_STARTABLE');

    const consentDrift = await fixture('虚构 consent 漂移');
    await prisma.consentRecord.create({
      data: {
        consentMethod: 'written',
        consentTextVersion: 'incompatible-fictional-version',
        consentType: 'recording_transcription_ai',
        consentedAt: new Date(),
        createdAt: new Date(Date.now() + 1_000),
        createdBy: actor.id,
        projectId: consentDrift.projectId,
        status: 'valid',
      },
    });
    const reauthorization = await listener
      .post(`/api/v1/projects/${consentDrift.projectId}/next-session`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send(nextPayload(consentDrift.basisId));
    expect(reauthorization.status).toBe(409);
    expect((reauthorization.body as ErrorBody).code).toBe('CONSENT_REAUTHORIZATION_REQUIRED');
    expect(
      await prisma.interviewSession.count({ where: { projectId: consentDrift.projectId } }),
    ).toBe(1);

    const deletionDrift = await fixture('虚构 deletion 漂移');
    deletion.blockProject(deletionDrift.projectId);
    try {
      const home = await listener.get('/api/v1/projects').set('Origin', ORIGIN);
      const row = (home.body as { items: Array<Record<string, unknown>> }).items.find(
        ({ id }) => id === deletionDrift.projectId,
      );
      expect(row?.repeat_interview).toMatchObject({
        primary_action: null,
        reason: 'project_unavailable',
      });
      const blockedNext = await listener
        .post(`/api/v1/projects/${deletionDrift.projectId}/next-session`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', csrf)
        .send(nextPayload(deletionDrift.basisId));
      expect(blockedNext.status).toBe(409);
      expect((blockedNext.body as ErrorBody).code).toBe('PROJECT_NOT_STARTABLE');

      const checkedSession = await prisma.interviewSession.create({
        data: {
          createdBy: actor.id,
          projectId: deletionDrift.projectId,
          sequenceNo: 2,
          status: 'device_check',
        },
      });
      const blockedStart = await listener
        .post(`/api/v1/sessions/${checkedSession.id}/start`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', csrf)
        .send({
          audio_stream_id: randomUUID(),
          mime_type: 'audio/webm;codecs=opus',
          recording_reminder_version: REMINDER_VERSION,
          request_id: randomUUID(),
        });
      expect(blockedStart.status).toBe(409);
      expect((blockedStart.body as ErrorBody).code).toBe('PROJECT_NOT_STARTABLE');
      expect(await prisma.audioObject.count({ where: { sessionId: checkedSession.id } })).toBe(0);
      expect(
        await prisma.sessionCaptureGeneration.count({ where: { sessionId: checkedSession.id } }),
      ).toBe(0);
    } finally {
      deletion.clear();
    }

    const unavailableDecision = new RepeatInterviewDecisionService(
      prisma,
      new UnavailableConsentContinuationPolicyReader(),
      new LocalTestDeletionScopeFixtureReader(),
    );
    const unavailable = await unavailableDecision.read(actor.id, projectP.projectId);
    expect(unavailable.visibility).toBe('ordinary');
    if (unavailable.visibility === 'ordinary') {
      expect(unavailable.projection).toMatchObject({
        consent_continuation: { reason: 'policy_unavailable', status: 'unavailable' },
        primary_action: null,
        reason: 'consent_unavailable',
      });
    }
  });

  it('binds global idempotency keys and serializes start and revoke resources', async () => {
    const server = application().getHttpServer() as SupertestApp;
    const listenerA = request.agent(server);
    const listenerB = request.agent(server);
    const loginA = await listenerA
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'project-listener-a@example.test', password: PASSWORD });
    const loginB = await listenerB
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'project-listener-b@example.test', password: PASSWORD });
    const csrfA = (loginA.body as LoginBody).csrf_token;
    const csrfB = (loginB.body as LoginBody).csrf_token;
    const project = await listenerA
      .post('/api/v1/projects')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ display_name: '虚构幂等并发项目', request_id: randomUUID() });
    const projectId = (project.body as IdBody).id;
    await listenerA
      .post(`/api/v1/projects/${projectId}/service-terms`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        currency: 'CNY',
        estimated_session_count: 2,
        expected_current_minutes: 30,
        included_minutes: 60,
        overtime_price_minor: 0,
        overtime_unit_minutes: 30,
        request_id: randomUUID(),
      });
    const consent = await listenerA
      .post(`/api/v1/projects/${projectId}/consents`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        consent_audio_object_id: null,
        consent_method: 'electronic',
        consent_text_version: FICTIONAL_CONTINUING_CONSENT_VERSION,
        consent_type: 'recording_transcription_ai',
        consented_at: '2026-08-03T10:00:00.000Z',
        request_id: randomUUID(),
      });
    const consentId = (consent.body as IdBody).id;

    const sessionResponses = await Promise.all(
      [0, 1].map(async () => {
        const created = await listenerA
          .post(`/api/v1/projects/${projectId}/sessions`)
          .set('Origin', ORIGIN)
          .set('X-CSRF-Token', csrfA)
          .send({ request_id: randomUUID() });
        const sessionId = (created.body as IdBody).id;
        await listenerA
          .post(`/api/v1/sessions/${sessionId}/device-check`)
          .set('Origin', ORIGIN)
          .set('X-CSRF-Token', csrfA)
          .send({ input_detected: true, microphone_permission: 'granted' });
        return sessionId;
      }),
    );
    const [sessionId, otherSessionId] = sessionResponses as [string, string];
    const startRequestIds = [
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000302',
    ];
    const concurrentStreamId = '00000000-0000-4000-8000-000000000312';
    const starts = await Promise.all(
      startRequestIds.map(async (requestId) =>
        listenerA
          .post(`/api/v1/sessions/${sessionId}/start`)
          .set('Origin', ORIGIN)
          .set('X-CSRF-Token', csrfA)
          .send({
            audio_stream_id: concurrentStreamId,
            mime_type: 'audio/webm;codecs=opus',
            recording_reminder_version: REMINDER_VERSION,
            request_id: requestId,
          }),
      ),
    );
    expect(starts.map((response) => response.status).sort()).toEqual([201, 409]);
    const winnerIndex = starts.findIndex((response) => response.status === 201);
    const winnerRequestId = startRequestIds[winnerIndex];
    const firstSnapshot = starts[winnerIndex]?.body as Record<string, unknown>;
    expect(winnerRequestId).toBeDefined();
    await prisma.interviewSession.update({
      data: { status: 'completed' },
      where: { id: sessionId },
    });
    const replay = await listenerA
      .post(`/api/v1/sessions/${sessionId}/start`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        audio_stream_id: concurrentStreamId,
        mime_type: 'audio/webm;codecs=opus',
        recording_reminder_version: REMINDER_VERSION,
        request_id: winnerRequestId,
      });
    expect(replay.body).toEqual(firstSnapshot);

    const differentTarget = await listenerA
      .post(`/api/v1/sessions/${otherSessionId}/start`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        audio_stream_id: concurrentStreamId,
        mime_type: 'audio/webm;codecs=opus',
        recording_reminder_version: REMINDER_VERSION,
        request_id: winnerRequestId,
      });
    expect((differentTarget.body as ErrorBody).code).toBe('IDEMPOTENCY_KEY_REUSED');
    const listenerBUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'project-listener-b@example.test' },
    });
    await prisma.projectAssignment.create({
      data: { assignmentRole: 'interviewer', projectId, userId: listenerBUser.id },
    });
    const differentActor = await listenerB
      .post(`/api/v1/sessions/${sessionId}/start`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfB)
      .send({
        audio_stream_id: concurrentStreamId,
        mime_type: 'audio/webm;codecs=opus',
        recording_reminder_version: REMINDER_VERSION,
        request_id: winnerRequestId,
      });
    expect((differentActor.body as ErrorBody).code).toBe('IDEMPOTENCY_KEY_REUSED');
    const differentAction = await listenerA
      .post(`/api/v1/consents/${consentId}/revoke`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        audio_stream_id: concurrentStreamId,
        mime_type: 'audio/webm;codecs=opus',
        recording_reminder_version: REMINDER_VERSION,
        request_id: winnerRequestId,
      });
    expect((differentAction.body as ErrorBody).code).toBe('IDEMPOTENCY_KEY_REUSED');

    const revokeRequestIds = [
      '00000000-0000-4000-8000-000000000303',
      '00000000-0000-4000-8000-000000000304',
    ];
    const revokes = await Promise.all(
      revokeRequestIds.map(async (requestId) =>
        listenerA
          .post(`/api/v1/consents/${consentId}/revoke`)
          .set('Origin', ORIGIN)
          .set('X-CSRF-Token', csrfA)
          .send({ request_id: requestId }),
      ),
    );
    expect(revokes.map((response) => response.status).sort()).toEqual([201, 409]);
    const revokeWinnerIndex = revokes.findIndex((response) => response.status === 201);
    const revokeWinnerRequestId = revokeRequestIds[revokeWinnerIndex];
    expect(revokeWinnerRequestId).toBeDefined();
    expect(
      await prisma.idempotencyRecord.count({ where: { targetId: { in: [sessionId, consentId] } } }),
    ).toBe(2);
    expect(
      await prisma.auditLog.count({ where: { action: 'consent.revoke', entityId: consentId } }),
    ).toBe(1);

    const listenerAUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'project-listener-a@example.test' },
    });
    await prisma.projectAssignment.updateMany({
      data: { revokedAt: new Date() },
      where: { projectId, revokedAt: null, userId: listenerAUser.id },
    });
    const replayAfterAssignmentRevocation = await listenerA
      .post(`/api/v1/sessions/${sessionId}/start`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        audio_stream_id: concurrentStreamId,
        mime_type: 'audio/webm;codecs=opus',
        recording_reminder_version: REMINDER_VERSION,
        request_id: winnerRequestId,
      });
    expect(replayAfterAssignmentRevocation.status).toBe(403);
    expect((replayAfterAssignmentRevocation.body as ErrorBody).code).toBe('FORBIDDEN');
    const revokeReplayAfterAssignmentRevocation = await listenerA
      .post(`/api/v1/consents/${consentId}/revoke`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({ request_id: revokeWinnerRequestId });
    expect(revokeReplayAfterAssignmentRevocation.status).toBe(403);
    expect((revokeReplayAfterAssignmentRevocation.body as ErrorBody).code).toBe('FORBIDDEN');
  });

  it('serializes append-consent against revoke without corrupting current consent', async () => {
    const server = application().getHttpServer() as SupertestApp;
    const listener = request.agent(server);
    const login = await listener
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'project-listener-a@example.test', password: PASSWORD });
    const csrf = (login.body as LoginBody).csrf_token;
    const project = await listener
      .post('/api/v1/projects')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ display_name: '虚构授权竞态项目', request_id: randomUUID() });
    const projectId = (project.body as IdBody).id;
    await listener
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
    const original = await listener
      .post(`/api/v1/projects/${projectId}/consents`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({
        consent_audio_object_id: null,
        consent_method: 'electronic',
        consent_text_version: FICTIONAL_CONTINUING_CONSENT_VERSION,
        consent_type: 'recording_transcription_ai',
        consented_at: '2026-08-03T11:00:00.000Z',
        request_id: randomUUID(),
      });
    const originalId = (original.body as IdBody).id;
    const [appended, revoked] = await Promise.all([
      listener
        .post(`/api/v1/projects/${projectId}/consents`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', csrf)
        .send({
          consent_audio_object_id: null,
          consent_method: 'written',
          consent_text_version: 'mvp-v2',
          consent_type: 'recording_transcription_ai',
          consented_at: '2026-08-03T11:01:00.000Z',
          request_id: randomUUID(),
        }),
      listener
        .post(`/api/v1/consents/${originalId}/revoke`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', csrf)
        .send({ request_id: '00000000-0000-4000-8000-000000000305' }),
    ]);
    expect(appended.status).toBe(201);
    expect([201, 409]).toContain(revoked.status);
    const records = await prisma.consentRecord.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: { projectId },
    });
    expect(records).toHaveLength(2);
    expect(records[0]?.id).toBe((appended.body as IdBody).id);
    if (revoked.status === 201) {
      expect(
        (await prisma.elderProject.findUniqueOrThrow({ where: { id: projectId } })).status,
      ).toBe('restricted');
    } else {
      expect(records.find((record) => record.id === originalId)?.status).toBe('valid');
    }
  });

  it('rolls back project and audit when automatic assignment child write fails', async () => {
    const server = application().getHttpServer() as SupertestApp;
    const listener = request.agent(server);
    const login = await listener
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'project-listener-a@example.test', password: PASSWORD });
    const csrf = (login.body as LoginBody).csrf_token;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_assignment_for_test() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'test-only assignment failure'; END;
      $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER fail_assignment_for_test
      BEFORE INSERT ON project_assignment FOR EACH ROW EXECUTE FUNCTION fail_assignment_for_test()`);
    const auditCountBefore = await prisma.auditLog.count({ where: { action: 'project.create' } });
    try {
      const failed = await listener
        .post('/api/v1/projects')
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', csrf)
        .send({ display_name: '虚构原子回滚项目', request_id: randomUUID() });
      expect(failed.status).toBe(500);
      expect(await prisma.elderProject.count({ where: { displayName: '虚构原子回滚项目' } })).toBe(
        0,
      );
      expect(await prisma.auditLog.count({ where: { action: 'project.create' } })).toBe(
        auditCountBefore,
      );
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER fail_assignment_for_test ON project_assignment');
      await prisma.$executeRawUnsafe('DROP FUNCTION fail_assignment_for_test()');
    }
  });
});
