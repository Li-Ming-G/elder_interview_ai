import { createHash, randomUUID } from 'node:crypto';
import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket, { type ClientOptions, type RawData } from 'ws';

import { SessionService } from '../../apps/api/src/auth/session.service.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';

const ORIGIN = 'http://127.0.0.1:4173';

describe('authenticated realtime transcription WebSocket', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let url: string;
  let cookie: string;
  let csrf: string;
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

  it('orders interim/final, persists before publish, replays, and rechecks assignment per frame', async () => {
    const audioStreamId = randomUUID();
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

    client.send(JSON.stringify(frame(0, audioStreamId)));
    expect((await inbox.next()).type).toBe('asr.interim');
    expect(await inbox.next()).toMatchObject({
      type: 'audio.ack',
      payload: {
        highest_audio_sequence_acked: 0,
      },
    });
    expect(await prisma.transcriptSegment.count({ where: { sessionId } })).toBe(0);

    client.send(JSON.stringify(frame(1, audioStreamId)));
    const final = await inbox.next();
    expect(final).toMatchObject({ type: 'asr.final', payload: { finality: 'final' } });
    const segmentId = (final.payload as { segment_id: string }).segment_id;
    expect(await prisma.transcriptSegment.findUnique({ where: { id: segmentId } })).not.toBeNull();
    expect((await inbox.next()).type).toBe('audio.ack');
    client.close(1000);
    await inbox.closed();

    await new Promise((resolve) => setTimeout(resolve, 20));
    client = await connect(url, cookie);
    inbox = new Inbox(client);
    client.send(JSON.stringify(join(csrf, audioStreamId, eventStreamId, 2)));
    expect(await inbox.next()).toMatchObject({ type: 'asr.final', server_sequence: 3 });
    expect(await inbox.next()).toMatchObject({ type: 'audio.ack', server_sequence: 4 });
    expect(await inbox.next()).toMatchObject({ type: 'session.ready', payload: { resumed: true } });

    client.send(JSON.stringify(frame(1, audioStreamId)));
    expect(await inbox.next()).toMatchObject({
      type: 'audio.ack',
      payload: {
        highest_audio_sequence_acked: 1,
      },
    });
    expect(await prisma.transcriptSegment.count({ where: { sessionId } })).toBe(1);

    await prisma.projectAssignment.updateMany({
      data: { revokedAt: new Date() },
      where: { projectId, userId, revokedAt: null },
    });
    client.send(JSON.stringify(frame(2, audioStreamId)));
    expect(await inbox.next()).toMatchObject({ type: 'error', payload: { code: 'FORBIDDEN' } });
    expect(await inbox.closed()).toBe(4403);
    expect(await prisma.transcriptSegment.count({ where: { sessionId } })).toBe(1);
  });

  async function expectJoinFailure(code: string, closeCode: number): Promise<void> {
    const client = await connect(url, cookie);
    const inbox = new Inbox(client);
    client.send(JSON.stringify(join(csrf, randomUUID())));
    expect(await inbox.next()).toMatchObject({ type: 'error', payload: { code } });
    expect(await inbox.closed()).toBe(closeCode);
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
    schema_version: '1.0',
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
    schema_version: '1.0',
    session_id: sessionIdValue(),
    type: 'audio.frame',
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
  await database.transcriptSegment.deleteMany();
  await database.speakerMapping.deleteMany();
  await database.consentRecord.deleteMany();
  await database.audioChunk.deleteMany();
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
