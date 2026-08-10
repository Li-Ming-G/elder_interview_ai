import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PasswordService } from '../../apps/api/src/auth/password.service.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';

const ORIGIN = 'http://127.0.0.1:4173';
const PASSWORD = 'Fictional-only-Password-42!';
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
        DATABASE_URL: databaseUrl,
      }),
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
    expect((await listenerB.get('/api/v1/projects').set('Origin', ORIGIN)).body).toEqual([]);

    const draftSession = await listenerA
      .post(`/api/v1/projects/${projectId}/sessions`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({});
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
        consent_text_version: 'mvp-v1',
        consent_type: 'recording_transcription_ai',
        consented_at: '2026-08-03T08:00:00.000Z',
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
        consent_text_version: 'mvp-v1',
        consent_type: 'recording_transcription_ai',
        consented_at: '2026-08-03T08:00:00.000Z',
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
      });
    expect(secondConsent.status).toBe(201);
    const secondConsentId = (secondConsent.body as IdBody).id;
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
      .send({});
    expect(sessionAfterWithdrawal.status).toBe(409);
    expect((sessionAfterWithdrawal.body as ErrorBody).code).toBe('PROJECT_NOT_STARTABLE');

    expect(csrfB).toMatch(/^[A-Za-z0-9_-]+$/);
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
      .send({ display_name: '虚构并发场次项目' });
    const projectId = (project.body as IdBody).id;

    const responses = await Promise.all(
      Array.from({ length: 5 }, async () =>
        listener
          .post(`/api/v1/projects/${projectId}/sessions`)
          .set('Origin', ORIGIN)
          .set('X-CSRF-Token', csrf)
          .send({}),
      ),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    const sequenceNumbers = responses
      .map((response) => (response.body as { sequence_no: number }).sequence_no)
      .sort((left, right) => left - right);
    expect(sequenceNumbers).toEqual([1, 2, 3, 4, 5]);
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
      .send({ display_name: '虚构幂等并发项目' });
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
      });
    const consent = await listenerA
      .post(`/api/v1/projects/${projectId}/consents`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrfA)
      .send({
        consent_audio_object_id: null,
        consent_method: 'electronic',
        consent_text_version: 'mvp-v1',
        consent_type: 'recording_transcription_ai',
        consented_at: '2026-08-03T10:00:00.000Z',
      });
    const consentId = (consent.body as IdBody).id;

    const sessionResponses = await Promise.all(
      [0, 1].map(async () => {
        const created = await listenerA
          .post(`/api/v1/projects/${projectId}/sessions`)
          .set('Origin', ORIGIN)
          .set('X-CSRF-Token', csrfA)
          .send({});
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
      .send({ display_name: '虚构授权竞态项目' });
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
      });
    const original = await listener
      .post(`/api/v1/projects/${projectId}/consents`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({
        consent_audio_object_id: null,
        consent_method: 'electronic',
        consent_text_version: 'mvp-v1',
        consent_type: 'recording_transcription_ai',
        consented_at: '2026-08-03T11:00:00.000Z',
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
        .send({ display_name: '虚构原子回滚项目' });
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
