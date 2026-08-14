import { createHash, randomUUID } from 'node:crypto';
import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket, { type ClientOptions, type RawData } from 'ws';

import { SessionService } from '../../apps/api/src/auth/session.service.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import {
  CausalQueue,
  RealtimeRuntimeService,
} from '../../apps/api/src/realtime-transcription/realtime-runtime.service.js';
import { RealtimeAccessService } from '../../apps/api/src/realtime-transcription/realtime-access.service.js';
import { SpeakerCalibrationSnapshotService } from '../../apps/api/src/transcription/speaker-calibration-snapshot.service.js';

const ORIGIN = 'http://127.0.0.1:4173';

describe('authenticated realtime transcription WebSocket', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let url: string;
  let cookie: string;
  let csrf: string;
  let sessionToken: string;
  let userId: string;
  let projectId: string;
  let sessionId: string;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    app = await createApplication(
      loadApiConfig({
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: ORIGIN,
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-realtime-throttle-pepper',
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-realtime-retention-pepper',
        DATABASE_URL: databaseUrl,
      }),
    );
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    await cleanDatabase(prisma);
    const user = await prisma.user.create({
      data: {
        displayName: '虚构实时倾听员',
        email: 'realtime@example.test',
        passwordHash: 'test-only-not-a-real-password-hash',
        role: 'interviewer',
      },
    });
    userId = user.id;
    const project = await prisma.elderProject.create({
      data: {
        assignments: { create: { assignmentRole: 'interviewer', userId } },
        consents: {
          create: {
            consentMethod: 'electronic',
            consentTextVersion: 'test-v1',
            consentedAt: new Date('2026-08-05T08:00:00.000Z'),
            createdBy: userId,
            status: 'valid',
          },
        },
        createdBy: userId,
        displayName: '虚构实时项目',
        status: 'active',
      },
    });
    projectId = project.id;
    const session = await prisma.interviewSession.create({
      data: {
        createdBy: userId,
        projectId,
        sequenceNo: 1,
        startedAt: new Date('2026-08-05T08:05:00.000Z'),
        status: 'recording',
      },
    });
    sessionId = session.id;
    activeSessionId = session.id;
    const credentials = await app.get(SessionService).create(userId);
    sessionToken = credentials.sessionToken;
    cookie = `elder_interview_session=${credentials.sessionToken}`;
    csrf = credentials.csrfToken;
    url = `${(await app.getUrl()).replace(/^http/u, 'ws')}/ws/interviews`;
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  it('rejects Origin and Cookie before HTTP 101', async () => {
    await expectUpgradeStatus(url, { headers: { Cookie: cookie } }, 403);
    await expectUpgradeStatus(url, { origin: ORIGIN }, 401);
    await expectUpgradeStatus(
      url,
      {
        headers: {
          'Cf-Access-Authenticated-User-Email': 'listener-a@example.test',
          'Cf-Access-Jwt-Assertion': 'forged-edge-assertion',
        },
        origin: ORIGIN,
      },
      401,
    );
  });

  it('fails a bad join CSRF without starting a producer', async () => {
    const client = await connect(url, cookie);
    const inbox = new Inbox(client);
    client.send(JSON.stringify(join('wrong-csrf', randomUUID())));
    expect((await inbox.next()).payload).toMatchObject({ code: 'INVALID_CSRF_TOKEN' });
    expect(await inbox.closed()).toBe(4401);
  });

  it('fails closed for restricted, revoked, and resume-only sessions', async () => {
    await prisma.projectAssignment.updateMany({
      data: { revokedAt: new Date() },
      where: { projectId, userId, revokedAt: null },
    });
    await expectJoinFailure('FORBIDDEN', 4403);
    await prisma.projectAssignment.updateMany({
      data: { revokedAt: null },
      where: { projectId, userId },
    });

    await prisma.elderProject.update({
      data: { status: 'restricted', statusBeforeRestriction: 'active' },
      where: { id: projectId },
    });
    await expectJoinFailure('FORBIDDEN', 4403);
    await prisma.elderProject.update({
      data: { status: 'active', statusBeforeRestriction: null },
      where: { id: projectId },
    });

    await prisma.consentRecord.updateMany({
      data: { revokedAt: new Date(), status: 'revoked' },
      where: { projectId },
    });
    await expectJoinFailure('FORBIDDEN', 4403);
    await prisma.consentRecord.updateMany({
      data: { revokedAt: null, status: 'valid' },
      where: { projectId },
    });

    await prisma.interviewSession.update({
      data: { status: 'stopping' },
      where: { id: sessionId },
    });
    await expectJoinFailure('SESSION_NOT_STREAMABLE', 4408);
    expect(await prisma.transcriptSegment.count({ where: { sessionId } })).toBe(0);
    await prisma.interviewSession.update({
      data: { status: 'recording' },
      where: { id: sessionId },
    });
  });

  it.each(['heartbeat', 'event.ack'] as const)(
    'rechecks assignment for %s and releases the active producer',
    async (messageType) => {
      await withIsolatedRecordingSession(async () => {
        const audioStreamId = randomUUID();
        await setCaptureStream(audioStreamId);
        const client = await connect(url, cookie);
        const inbox = new Inbox(client);
        client.send(JSON.stringify(join(csrf, audioStreamId)));
        const ready = await inbox.next();
        expect((await inbox.next()).type).toBe('speaker.calibration.updated');
        expect(await inbox.next()).toMatchObject({
          payload: { status: 'connected' },
          type: 'asr.status',
        });
        await prisma.projectAssignment.updateMany({
          data: { revokedAt: new Date() },
          where: { projectId, userId, revokedAt: null },
        });
        try {
          client.send(
            JSON.stringify(
              messageType === 'heartbeat'
                ? heartbeat()
                : eventAck((ready as { server_sequence: number }).server_sequence),
            ),
          );
          expect(await inbox.next()).toMatchObject({
            type: 'error',
            payload: { code: 'FORBIDDEN' },
          });
          expect(await inbox.closed()).toBe(4403);
        } finally {
          await prisma.projectAssignment.updateMany({
            data: { revokedAt: null },
            where: { projectId, userId },
          });
        }
      });
    },
  );

  it('rejects a producer stream that is not the current persisted capture generation', async () => {
    await withIsolatedRecordingSession(async () => {
      await setCaptureStream(randomUUID());
      const client = await connect(url, cookie);
      const inbox = new Inbox(client);
      client.send(JSON.stringify(join(csrf, randomUUID())));
      expect(await inbox.next()).toMatchObject({
        payload: { code: 'SESSION_NOT_STREAMABLE' },
        type: 'error',
      });
      expect(await inbox.closed()).toBe(4408);
    });
  });

  it('maps an unexpected persistence failure to REALTIME_UNAVAILABLE without details', async () => {
    await withIsolatedRecordingSession(async () => {
      const audioStreamId = randomUUID();
      await setCaptureStream(audioStreamId);
      const client = await connect(url, cookie);
      const inbox = new Inbox(client);
      client.send(JSON.stringify(join(csrf, audioStreamId)));
      await inbox.next();
      expect((await inbox.next()).type).toBe('speaker.calibration.updated');
      expect(await inbox.next()).toMatchObject({
        payload: { status: 'connected' },
        type: 'asr.status',
      });
      const failure = vi
        .spyOn(prisma.interviewSession, 'findUnique')
        .mockRejectedValueOnce(new Error('database-name SQL private detail'));
      try {
        client.send(JSON.stringify(heartbeat()));
        const error = await inbox.next();
        expect(error).toMatchObject({
          type: 'error',
          payload: { code: 'REALTIME_UNAVAILABLE' },
        });
        expect(JSON.stringify(error)).not.toContain('database-name');
        expect(JSON.stringify(error)).not.toContain('SQL');
        expect(await inbox.closed()).toBe(4500);
      } finally {
        failure.mockRestore();
      }
    });
  });

  it('orders interim/final, persists before publish, replays, and rechecks assignment per frame', async () => {
    const audioStreamId = randomUUID();
    await setCaptureStream(audioStreamId);
    let client = await connect(url, cookie);
    let inbox = new Inbox(client);
    client.send(JSON.stringify(join(csrf, audioStreamId)));
    const ready = await inbox.next();
    expect(ready).toMatchObject({
      type: 'session.ready',
      server_sequence: 0,
      payload: {
        highest_audio_sequence_acked: -1,
        resumed: false,
      },
    });
    const eventStreamId = ready.event_stream_id;
    expect(await inbox.next()).toMatchObject({
      type: 'speaker.calibration.updated',
      server_sequence: 1,
    });
    expect(await inbox.next()).toMatchObject({
      payload: { status: 'connected' },
      type: 'asr.status',
    });
    const speakerStream = await prisma.speakerStream.findFirstOrThrow({
      where: { sessionId, status: 'active' },
    });
    await prisma.speakerMapping.create({
      data: {
        authority: 'unconfirmed',
        sessionId,
        source: 'provider',
        speakerProviderId: 'speaker_1',
        speakerRole: 'elder',
        speakerStreamId: speakerStream.id,
      },
    });

    client.send(JSON.stringify(frame(0, audioStreamId)));
    expect((await inbox.next()).type).toBe('asr.interim');
    expect(await inbox.next()).toMatchObject({
      payload: {
        effective_speaker_role: 'elder',
        speaker_role: 'elder',
        speaker_role_authority: 'unconfirmed',
        trusted_effective_speaker_role: 'unknown',
        trusted_speaker_role: 'unknown',
      },
      type: 'asr.final',
    });
    expect(await inbox.next()).toMatchObject({
      type: 'audio.ack',
      payload: {
        highest_audio_sequence_acked: 0,
      },
    });
    expect(await prisma.transcriptSegment.count({ where: { sessionId } })).toBe(1);

    await prisma.speakerMapping.create({
      data: {
        authority: 'user_confirmed',
        createdBy: userId,
        sessionId,
        source: 'calibration',
        speakerProviderId: 'speaker_2',
        speakerRole: 'elder',
        speakerStreamId: speakerStream.id,
      },
    });
    client.send(JSON.stringify(frame(1, audioStreamId)));
    const final = await inbox.next();
    expect(final).toMatchObject({
      type: 'asr.final',
      payload: {
        effective_speaker_role: 'elder',
        finality: 'final',
        speaker_role_authority: 'user_confirmed',
        trusted_effective_speaker_role: 'elder',
        trusted_speaker_role: 'elder',
      },
    });
    const segmentId = (final.payload as { segment_id: string }).segment_id;
    expect(await prisma.transcriptSegment.findUnique({ where: { id: segmentId } })).not.toBeNull();
    expect((await inbox.next()).type).toBe('audio.ack');
    client.close(1000);
    await inbox.closed();

    await new Promise((resolve) => setTimeout(resolve, 20));
    client = await connect(url, cookie);
    inbox = new Inbox(client);
    client.send(JSON.stringify(join(csrf, audioStreamId, eventStreamId, 5)));
    expect(await inbox.next()).toMatchObject({ type: 'asr.final', server_sequence: 6 });
    expect(await inbox.next()).toMatchObject({ type: 'audio.ack', server_sequence: 7 });
    expect(await inbox.next()).toMatchObject({ type: 'session.ready', payload: { resumed: true } });

    client.send(JSON.stringify(frame(1, audioStreamId)));
    expect(await inbox.next()).toMatchObject({
      type: 'audio.ack',
      payload: {
        highest_audio_sequence_acked: 1,
      },
    });
    expect(await prisma.transcriptSegment.count({ where: { sessionId } })).toBe(2);

    await prisma.projectAssignment.updateMany({
      data: { revokedAt: new Date() },
      where: { projectId, userId, revokedAt: null },
    });
    client.send(JSON.stringify(frame(2, audioStreamId)));
    expect(await inbox.next()).toMatchObject({ type: 'error', payload: { code: 'FORBIDDEN' } });
    expect(await inbox.closed()).toBe(4403);
    expect(await prisma.transcriptSegment.count({ where: { sessionId } })).toBe(2);
  });

  it('keeps resumed PCM generation-relative while persisting and publishing on the session timeline', async () => {
    await withIsolatedRecordingSession(async () => {
      await prisma.projectAssignment.updateMany({
        data: { revokedAt: null },
        where: { projectId, userId },
      });
      const audio = await prisma.audioObject.create({
        data: {
          createdBy: userId,
          mimeType: 'audio/webm;codecs=opus',
          projectId,
          purpose: 'interview',
          sessionId: activeSessionId,
        },
      });
      await prisma.sessionCaptureGeneration.create({
        data: {
          audioObjectId: audio.id,
          audioStreamId: randomUUID(),
          generationNo: 0,
          interruptedAt: new Date(),
          interruptionReason: 'page_recovery_detected',
          sessionId: activeSessionId,
          status: 'interrupted',
          timelineOffsetMs: 0,
        },
      });
      const audioStreamId = randomUUID();
      await prisma.sessionCaptureGeneration.create({
        data: {
          audioObjectId: audio.id,
          audioStreamId,
          confirmedActiveAt: new Date(),
          generationNo: 1,
          sessionId: activeSessionId,
          status: 'active',
          timelineOffsetMs: 6_000,
        },
      });

      const client = await connect(url, cookie);
      const inbox = new Inbox(client);
      client.send(JSON.stringify(join(csrf, audioStreamId)));
      await inbox.next();
      expect((await inbox.next()).type).toBe('speaker.calibration.updated');
      expect(await inbox.next()).toMatchObject({
        payload: { status: 'connected' },
        type: 'asr.status',
      });

      client.send(JSON.stringify(frame(0, audioStreamId)));
      expect(await inbox.next()).toMatchObject({
        payload: { end_ms: 6_100, start_ms: 6_000 },
        type: 'asr.interim',
      });
      expect(await inbox.next()).toMatchObject({
        payload: { end_ms: 6_100, start_ms: 6_000 },
        type: 'asr.final',
      });
      expect((await inbox.next()).type).toBe('audio.ack');

      client.send(JSON.stringify(frame(1, audioStreamId)));
      expect(await inbox.next()).toMatchObject({
        payload: { end_ms: 6_200, start_ms: 6_100 },
        type: 'asr.final',
      });
      expect((await inbox.next()).type).toBe('audio.ack');
      expect(
        await prisma.transcriptSegment.findFirstOrThrow({
          orderBy: { endMs: 'desc' },
          where: { sessionId: activeSessionId },
        }),
      ).toMatchObject({ endMs: 6_200, startMs: 6_100 });

      client.close(1000);
      await inbox.closed();
    });
  });

  it('exposes persisted PCM acceptance so a rebuilt runtime can fail closed on lost coverage evidence', async () => {
    await withIsolatedRecordingSession(async () => {
      const audioStreamId = randomUUID();
      await setCaptureStream(audioStreamId);
      const client = await connect(url, cookie);
      const inbox = new Inbox(client);
      client.send(JSON.stringify(join(csrf, audioStreamId)));
      await inbox.next();
      expect((await inbox.next()).type).toBe('speaker.calibration.updated');
      expect(await inbox.next()).toMatchObject({
        payload: { status: 'connected' },
        type: 'asr.status',
      });

      client.send(JSON.stringify(frame(0, audioStreamId)));
      expect((await inbox.next()).type).toBe('asr.interim');
      expect((await inbox.next()).type).toBe('asr.final');
      expect((await inbox.next()).type).toBe('audio.ack');

      const actor = await app.get(SessionService).authenticate(sessionToken);
      await expect(
        app.get(RealtimeAccessService).assertJoin(actor, activeSessionId, csrf, audioStreamId),
      ).resolves.toMatchObject({ acceptedPcmEvidenceExists: true });
      const persistedCapture = await prisma.sessionCaptureGeneration.findFirstOrThrow({
        orderBy: { generationNo: 'desc' },
        where: { sessionId: activeSessionId },
      });
      expect(persistedCapture.firstPcmAcceptedAt).toBeInstanceOf(Date);

      client.close(1000);
      await inbox.closed();
    });
  });

  it('rotates a provider voice onto a new active speaker stream with no trusted mapping', async () => {
    await withIsolatedRecordingSession(async () => {
      const audioStreamId = randomUUID();
      await setCaptureStream(audioStreamId);
      const capture = await prisma.sessionCaptureGeneration.findUniqueOrThrow({
        where: { audioStreamId },
      });
      const runtimes = new RealtimeRuntimeService(prisma);
      const runtime = await runtimes.create(
        activeSessionId,
        audioStreamId,
        capture.id,
        new CausalQueue(),
        capture.timelineOffsetMs,
      );
      const previousStreamId = runtime.speakerStreamId;
      await prisma.speakerMapping.create({
        data: {
          authority: 'user_confirmed',
          createdBy: userId,
          sessionId: activeSessionId,
          source: 'calibration',
          speakerProviderId: '0',
          speakerRole: 'elder',
          speakerStreamId: previousStreamId,
        },
      });
      const nextStreamId = await runtimes.rotateSpeakerStream(runtime);
      expect(nextStreamId).not.toBe(previousStreamId);
      expect(
        await prisma.speakerStream.findUniqueOrThrow({ where: { id: previousStreamId } }),
      ).toMatchObject({ status: 'closed' });
      expect(
        await prisma.speakerStream.findUniqueOrThrow({ where: { id: nextStreamId } }),
      ).toMatchObject({
        status: 'active',
      });
      expect(await prisma.speakerMapping.count({ where: { speakerStreamId: nextStreamId } })).toBe(
        0,
      );
      expect(
        await new SpeakerCalibrationSnapshotService(prisma).get(activeSessionId),
      ).toMatchObject({
        speaker_stream: { id: nextStreamId },
        status: 'not_started',
      });
    });
  });

  async function expectJoinFailure(code: string, closeCode: number): Promise<void> {
    const client = await connect(url, cookie);
    const inbox = new Inbox(client);
    client.send(JSON.stringify(join(csrf, randomUUID())));
    expect(await inbox.next()).toMatchObject({ type: 'error', payload: { code } });
    expect(await inbox.closed()).toBe(closeCode);
  }

  async function setCaptureStream(audioStreamId: string): Promise<void> {
    const existing = await prisma.sessionCaptureGeneration.findFirst({
      orderBy: { generationNo: 'desc' },
      where: { sessionId: activeSessionId },
    });
    if (existing !== null) {
      await prisma.sessionCaptureGeneration.update({
        data: { audioStreamId },
        where: { id: existing.id },
      });
      return;
    }
    const audio = await prisma.audioObject.create({
      data: {
        createdBy: userId,
        mimeType: 'audio/webm;codecs=opus',
        projectId,
        purpose: 'interview',
        sessionId: activeSessionId,
      },
    });
    await prisma.sessionCaptureGeneration.create({
      data: {
        audioObjectId: audio.id,
        audioStreamId,
        generationNo: 0,
        sessionId: activeSessionId,
        timelineOffsetMs: 0,
      },
    });
  }

  let isolatedSequence = 1000;
  async function withIsolatedRecordingSession<T>(run: () => Promise<T>): Promise<T> {
    const previousSessionId = activeSessionId;
    const isolated = await prisma.interviewSession.create({
      data: {
        createdBy: userId,
        projectId,
        sequenceNo: isolatedSequence,
        status: 'recording',
      },
    });
    isolatedSequence += 1;
    activeSessionId = isolated.id;
    try {
      return await run();
    } finally {
      activeSessionId = previousSessionId;
    }
  }
});

function join(
  csrfToken: string,
  audioStreamId: string,
  eventStreamId?: string,
  resumeAfter?: number,
): Record<string, unknown> {
  return {
    event_id: randomUUID(),
    payload: {
      audio_stream_id: audioStreamId,
      csrf_token: csrfToken,
      ...(eventStreamId === undefined
        ? {}
        : {
            event_stream_id: eventStreamId,
            resume_after_server_sequence: resumeAfter,
          }),
    },
    schema_version: '1.1',
    session_id: sessionIdValue(),
    type: 'session.join',
  };
}

let activeSessionId = '';
function sessionIdValue(): string {
  return activeSessionId;
}

function frame(sequence: number, audioStreamId: string): Record<string, unknown> {
  const pcm = Buffer.alloc(3200, sequence + 1);
  return {
    event_id: randomUUID(),
    payload: {
      audio_stream_id: audioStreamId,
      channels: 1,
      encoding: 'pcm_s16le',
      end_ms: sequence * 100 + 100,
      pcm_base64: pcm.toString('base64'),
      pcm_sha256: createHash('sha256').update(pcm).digest('hex'),
      sample_count: 1600,
      sample_rate_hz: 16000,
      sequence_no: sequence,
      start_ms: sequence * 100,
    },
    schema_version: '1.1',
    session_id: sessionIdValue(),
    type: 'audio.frame',
  };
}

function heartbeat(): Record<string, unknown> {
  return {
    event_id: randomUUID(),
    payload: {},
    schema_version: '1.1',
    session_id: sessionIdValue(),
    type: 'heartbeat',
  };
}

function eventAck(serverSequence: number): Record<string, unknown> {
  return {
    event_id: randomUUID(),
    payload: { server_sequence: serverSequence },
    schema_version: '1.1',
    session_id: sessionIdValue(),
    type: 'event.ack',
  };
}

interface ServerMessage {
  event_stream_id: string;
  payload: Record<string, unknown>;
  server_sequence: number;
  type: string;
}

class Inbox {
  private readonly messages: ServerMessage[] = [];
  private readonly waiters: Array<(message: ServerMessage) => void> = [];
  private closePromise: Promise<number>;

  public constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const message = JSON.parse(rawDataBuffer(data).toString('utf8')) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter === undefined) this.messages.push(message);
      else waiter(message);
    });
    this.closePromise = new Promise((resolve) => {
      socket.once('close', (code) => {
        resolve(code);
      });
    });
  }

  public next(): Promise<ServerMessage> {
    const message = this.messages.shift();
    return message === undefined
      ? new Promise((resolve) => this.waiters.push(resolve))
      : Promise.resolve(message);
  }

  public closed(): Promise<number> {
    return this.closePromise;
  }
}

async function connect(url: string, cookie: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Cookie: cookie }, origin: ORIGIN });
    socket.once('open', () => {
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

async function expectUpgradeStatus(
  url: string,
  options: ClientOptions,
  expected: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url, options);
    socket.once('unexpected-response', (_request, response) => {
      try {
        expect(response.statusCode).toBe(expected);
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Upgrade assertion failed'));
      }
      response.resume();
    });
    socket.once('open', () => {
      reject(new Error('Upgrade unexpectedly succeeded'));
    });
    socket.once('error', () => {
      // Rejection is asserted through the HTTP unexpected-response event.
    });
  });
}

function rawDataBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

async function cleanDatabase(database: PrismaService): Promise<void> {
  await database.speakerCalibrationAttemptSegment.deleteMany();
  await database.speakerCalibrationAttempt.deleteMany();
  await database.transcriptSegment.deleteMany();
  await database.speakerMapping.deleteMany();
  await database.speakerStream.deleteMany();
  await database.consentRecord.deleteMany();
  await database.audioChunk.deleteMany();
  await database.sessionCaptureGeneration.deleteMany();
  await database.audioObject.deleteMany();
  await database.interviewSession.deleteMany();
  await database.serviceTerm.deleteMany();
  await database.projectAssignment.deleteMany();
  await database.elderProject.deleteMany();
  await database.idempotencyRecord.deleteMany();
  await database.auditLog.deleteMany();
  await database.authSession.deleteMany();
  await database.authLoginThrottle.deleteMany();
  await database.user.deleteMany();
}
