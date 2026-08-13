import { randomUUID } from 'node:crypto';
import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PasswordService } from '../../apps/api/src/auth/password.service.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import {
  CausalQueue,
  RealtimeRuntimeService,
} from '../../apps/api/src/realtime-transcription/realtime-runtime.service.js';
import { TranscriptIngestionService } from '../../apps/api/src/transcription/transcript-ingestion.service.js';

const ORIGIN = 'http://127.0.0.1:4173';
const PASSWORD = 'Fictional-Speaker-Password-42!';

describe('speaker calibration HTTP authorization and idempotency', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    app = await createApplication(
      loadApiConfig({
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: ORIGIN,
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-speaker-api-pepper',
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-speaker-api-retention-pepper',
        DATABASE_URL: databaseUrl,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    await clean(prisma);
  });

  afterAll(async () => {
    await clean(prisma);
    await app.close();
  });

  it('covers CSRF, assignment, observed labels, replay conflict, and current snapshot facts', async () => {
    const passwordHash = await new PasswordService().hash(PASSWORD);
    const [assigned, outsider] = await Promise.all([
      prisma.user.create({
        data: {
          displayName: '虚构授权访谈员',
          email: 'speaker-api-assigned@example.test',
          passwordHash,
          role: 'interviewer',
        },
      }),
      prisma.user.create({
        data: {
          displayName: '虚构未分配访谈员',
          email: 'speaker-api-outsider@example.test',
          passwordHash,
          role: 'interviewer',
        },
      }),
    ]);
    const project = await prisma.elderProject.create({
      data: {
        assignments: { create: { userId: assigned.id } },
        consents: {
          create: {
            consentMethod: 'electronic',
            consentTextVersion: 'test-v1',
            consentedAt: new Date(),
            createdBy: assigned.id,
            status: 'valid',
          },
        },
        createdBy: assigned.id,
        displayName: '虚构 HTTP 校准项目',
        status: 'active',
      },
    });
    const session = await prisma.interviewSession.create({
      data: { createdBy: assigned.id, projectId: project.id, sequenceNo: 1, status: 'recording' },
    });
    const audio = await prisma.audioObject.create({
      data: {
        createdBy: assigned.id,
        mimeType: 'audio/webm;codecs=opus',
        projectId: project.id,
        purpose: 'interview',
        sessionId: session.id,
      },
    });
    const generation = await prisma.sessionCaptureGeneration.create({
      data: {
        audioObjectId: audio.id,
        audioStreamId: randomUUID(),
        confirmedActiveAt: new Date(),
        generationNo: 0,
        sessionId: session.id,
        status: 'active',
        timelineOffsetMs: 0,
      },
    });
    const runtimes = app.get(RealtimeRuntimeService);
    const runtime = await runtimes.create(
      session.id,
      generation.audioStreamId,
      generation.id,
      new CausalQueue(),
    );
    runtimes.claim(runtime, {});

    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const assignedAgent = request.agent(server);
    const outsiderAgent = request.agent(server);
    const assignedLogin = await assignedAgent
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: assigned.email, password: PASSWORD });
    const outsiderLogin = await outsiderAgent
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: outsider.email, password: PASSWORD });
    const csrf = (assignedLogin.body as { csrf_token: string }).csrf_token;
    const begin = { request_id: randomUUID(), speaker_stream_id: runtime.speakerStreamId };

    expect(
      (await assignedAgent.get(`/api/v1/sessions/${session.id}/speaker-calibration`)).body,
    ).toMatchObject({ status: 'not_started', speaker_stream: { id: runtime.speakerStreamId } });
    expect(
      (await outsiderAgent.get(`/api/v1/sessions/${session.id}/speaker-calibration`)).status,
    ).toBe(403);
    const missingCsrf = await assignedAgent
      .post(`/api/v1/sessions/${session.id}/speaker-calibrations`)
      .set('Origin', ORIGIN)
      .send(begin);
    expect(missingCsrf).toMatchObject({ status: 403, body: { code: 'INVALID_CSRF_TOKEN' } });

    const began = await assignedAgent
      .post(`/api/v1/sessions/${session.id}/speaker-calibrations`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send(begin);
    expect(began).toMatchObject({ status: 201, body: { status: 'collecting' } });
    const attemptId = (began.body as { attempt: { id: string } }).attempt.id;
    const resolveRequestId = randomUUID();
    const premature = await assignedAgent
      .post(`/api/v1/speaker-calibrations/${attemptId}/resolve`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({
        action: 'confirm',
        mappings: [
          { speaker_provider_id: 'speaker_1', speaker_role: 'interviewer' },
          { speaker_provider_id: 'speaker_2', speaker_role: 'elder' },
        ],
        request_id: resolveRequestId,
      });
    expect(premature).toMatchObject({
      status: 409,
      body: { code: 'SPEAKER_CALIBRATION_LABELS_INVALID' },
    });
    const ingestion = app.get(TranscriptIngestionService);
    await prisma.speakerMapping.create({
      data: {
        authority: 'unconfirmed',
        sessionId: session.id,
        source: 'provider',
        speakerProviderId: 'speaker_1',
        speakerRole: 'elder',
        speakerStreamId: runtime.speakerStreamId,
      },
    });
    for (const [index, label] of ['speaker_1', 'speaker_2'].entries()) {
      await ingestion.ingest({
        endMs: index * 100 + 100,
        ingestKey: `http-label-${String(index)}`,
        kind: 'final',
        sessionId: session.id,
        source: 'fixture',
        speakerProviderId: label,
        speakerStreamId: runtime.speakerStreamId,
        startMs: index * 100,
        text: `虚构 HTTP 标签 ${String(index)}`,
      });
      runtimes.recordFrame(runtime, {
        audio_stream_id: generation.audioStreamId,
        channels: 1,
        encoding: 'pcm_s16le',
        end_ms: index * 100 + 100,
        pcm_base64: '',
        pcm_sha256: '0'.repeat(64),
        sample_count: 1600,
        sample_rate_hz: 16000,
        sequence_no: index,
        start_ms: index * 100,
      });
    }
    const resolveBody = {
      action: 'confirm',
      mappings: [
        { speaker_provider_id: 'speaker_1', speaker_role: 'interviewer' },
        { speaker_provider_id: 'speaker_2', speaker_role: 'elder' },
      ],
      request_id: resolveRequestId,
    };
    const confirmed = await assignedAgent
      .post(`/api/v1/speaker-calibrations/${attemptId}/resolve`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send(resolveBody);
    expect(confirmed).toMatchObject({
      status: 201,
      body: { speaker_role_revision: 1, status: 'confirmed' },
    });
    const replay = await assignedAgent
      .post(`/api/v1/speaker-calibrations/${attemptId}/resolve`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send(resolveBody);
    expect(replay.body).toEqual(confirmed.body);
    const conflict = await assignedAgent
      .post(`/api/v1/speaker-calibrations/${attemptId}/resolve`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ action: 'skip', mappings: [], request_id: resolveRequestId });
    expect(conflict).toMatchObject({
      status: 409,
      body: { code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' },
    });
    expect(
      (await assignedAgent.get(`/api/v1/sessions/${session.id}/speaker-calibration`)).body,
    ).toMatchObject({ speaker_role_revision: 1, status: 'confirmed' });

    for (const [index, label] of ['speaker_1', 'speaker_2'].entries()) {
      await ingestion.ingest({
        endMs: 400,
        ingestKey: `http-after-confirm-${String(index)}`,
        kind: 'final',
        sessionId: session.id,
        source: 'fixture',
        speakerProviderId: label,
        speakerStreamId: runtime.speakerStreamId,
        startMs: 300,
        text: `synthetic post-confirm segment ${String(index)}`,
      });
    }
    expect((await request(server).get(`/api/v1/sessions/${session.id}/transcripts`)).status).toBe(
      401,
    );
    expect((await outsiderAgent.get(`/api/v1/sessions/${session.id}/transcripts`)).status).toBe(
      403,
    );
    const transcriptItems: Array<{
      content_kind: 'conversation' | 'speaker_calibration';
      effective_speaker_role: string;
      id: string;
      original_speaker_role: string;
      original_speaker_role_authority: string;
      start_ms: number;
      trusted_effective_speaker_role: string;
    }> = [];
    let cursor: string | null = null;
    do {
      const page = await assignedAgent
        .get(`/api/v1/sessions/${session.id}/transcripts`)
        .query({ ...(cursor === null ? {} : { cursor }), limit: 1 });
      expect(page.status).toBe(200);
      const body = page.body as {
        items: typeof transcriptItems;
        next_cursor: string | null;
      };
      transcriptItems.push(...body.items);
      cursor = body.next_cursor;
    } while (cursor !== null);
    expect(transcriptItems).toHaveLength(2);
    expect(transcriptItems.every((item) => item.content_kind === 'conversation')).toBe(true);
    expect(
      await prisma.transcriptSegment.count({
        where: { contentKind: 'speaker_calibration', sessionId: session.id },
      }),
    ).toBe(2);
    expect(transcriptItems.map(({ id, start_ms: startMs }) => [startMs, id])).toEqual(
      [...transcriptItems]
        .sort((left, right) => left.start_ms - right.start_ms || left.id.localeCompare(right.id))
        .map(({ id, start_ms: startMs }) => [startMs, id]),
    );
    expect(transcriptItems).toContainEqual(
      expect.objectContaining({
        effective_speaker_role: 'elder',
        original_speaker_role: 'elder',
        original_speaker_role_authority: 'user_confirmed',
        trusted_effective_speaker_role: 'elder',
      }),
    );
    await prisma.elderProject.update({
      data: { status: 'restricted', statusBeforeRestriction: 'active' },
      where: { id: project.id },
    });
    expect((await assignedAgent.get(`/api/v1/sessions/${session.id}/transcripts`)).status).toBe(
      403,
    );
    await prisma.elderProject.update({
      data: { status: 'active', statusBeforeRestriction: null },
      where: { id: project.id },
    });

    await prisma.consentRecord.updateMany({
      data: { revokedAt: new Date(), status: 'revoked' },
      where: { projectId: project.id },
    });
    expect(
      (await assignedAgent.get(`/api/v1/sessions/${session.id}/speaker-calibration`)).status,
    ).toBe(403);
    expect((await assignedAgent.get(`/api/v1/sessions/${session.id}/transcripts`)).status).toBe(
      403,
    );
    expect(outsiderLogin.status).toBe(200);
  });
});

async function clean(prisma: PrismaService): Promise<void> {
  await prisma.speakerCalibrationAttemptSegment.deleteMany();
  await prisma.speakerCalibrationAttempt.deleteMany();
  await prisma.transcriptSegment.deleteMany();
  await prisma.speakerMapping.deleteMany();
  await prisma.speakerStream.deleteMany();
  await prisma.sessionFinalizationChunk.deleteMany();
  await prisma.sessionFinalization.deleteMany();
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
