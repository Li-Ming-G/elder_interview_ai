import { loadApiConfig } from '@elder-interview/config';
import type { INestApplication } from '@nestjs/common';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthPrincipal } from '../../apps/api/src/auth/auth.types.js';
import { createApplication } from '../../apps/api/src/create-application.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { SpeakerMappingService } from '../../apps/api/src/transcription/speaker-mapping.service.js';
import { DeterministicAsrFake } from '../../apps/api/src/transcription/testing/deterministic-asr.fake.js';
import { TranscriptIngestionService } from '../../apps/api/src/transcription/transcript-ingestion.service.js';
import { TranscriptQueryService } from '../../apps/api/src/transcription/transcript-query.service.js';
import type { NormalizedAsrResult } from '../../apps/api/src/transcription/transcription.types.js';

let defaultSessionId = '';

describe('final-only transcript evidence core', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ingestion: TranscriptIngestionService;
  let mappings: SpeakerMappingService;
  let query: TranscriptQueryService;
  let actorA: AuthPrincipal;
  let actorB: AuthPrincipal;
  let projectId: string;
  let sessionId: string;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    app = await createApplication(
      loadApiConfig({
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-transcript-throttle-pepper',
        DATABASE_URL: databaseUrl,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    ingestion = app.get(TranscriptIngestionService);
    mappings = app.get(SpeakerMappingService);
    query = app.get(TranscriptQueryService);
    await cleanDatabase(prisma);

    const [userA, userB] = await Promise.all([
      prisma.user.create({
        data: {
          displayName: '虚构转录倾听员 A',
          email: 'transcript-listener-a@example.test',
          passwordHash: 'test-only-not-a-real-password-hash',
          role: 'interviewer',
        },
      }),
      prisma.user.create({
        data: {
          displayName: '虚构转录倾听员 B',
          email: 'transcript-listener-b@example.test',
          passwordHash: 'test-only-not-a-real-password-hash',
          role: 'interviewer',
        },
      }),
    ]);
    actorA = principal(userA.id, userA.displayName);
    actorB = principal(userB.id, userB.displayName);
    const project = await prisma.elderProject.create({
      data: {
        assignments: {
          create: { assignmentRole: 'interviewer', userId: userA.id },
        },
        consents: {
          create: {
            consentMethod: 'electronic',
            consentTextVersion: 'test-v1',
            consentedAt: new Date('2026-08-04T08:00:00.000Z'),
            createdBy: userA.id,
            status: 'valid',
          },
        },
        createdBy: userA.id,
        displayName: '虚构转录证据项目',
        status: 'active',
      },
    });
    projectId = project.id;
    const session = await prisma.interviewSession.create({
      data: {
        createdBy: userA.id,
        projectId,
        sequenceNo: 1,
        startedAt: new Date('2026-08-04T08:05:00.000Z'),
        status: 'recording',
      },
    });
    sessionId = session.id;
    defaultSessionId = session.id;
  });

  beforeEach(async () => {
    await prisma.transcriptSegment.deleteMany({ where: { sessionId } });
    await prisma.speakerMapping.deleteMany({ where: { sessionId } });
    await prisma.audioChunk.deleteMany({ where: { audioObject: { projectId } } });
    await prisma.sessionCaptureGeneration.deleteMany({ where: { session: { projectId } } });
    await prisma.audioObject.deleteMany({ where: { projectId } });
    await prisma.auditLog.deleteMany();
    await prisma.projectAssignment.deleteMany({ where: { projectId } });
    await prisma.projectAssignment.create({
      data: { assignmentRole: 'interviewer', projectId, userId: actorA.id },
    });
    await prisma.consentRecord.updateMany({
      data: { revokedAt: null, status: 'valid' },
      where: { projectId },
    });
    await prisma.elderProject.update({
      data: { deletedAt: null, status: 'active' },
      where: { id: projectId },
    });
    await prisma.interviewSession.update({
      data: { status: 'recording' },
      where: { id: sessionId },
    });
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await app.close();
  });

  it('persists only final, replays canonical evidence, and fails closed on conflicts', async () => {
    await mappings.append({
      createdBy: null,
      role: 'elder',
      sessionId,
      source: 'provider',
      speakerProviderId: 'speaker-1',
    });
    const final = result({
      providerPayload: { confidence: 0.91, nested: { b: 2, a: 1 } },
      speakerProviderId: 'speaker-1',
    });
    const first = await ingestion.ingest(final);
    expect(first.kind).toBe('final');
    if (first.kind !== 'final') throw new Error('Expected final result');
    expect(first.segment.originalSpeakerRole).toBe('elder');
    expect(first.segment).not.toHaveProperty('providerPayload');

    const replay = await ingestion.ingest({
      ...final,
      providerPayload: { nested: { a: 1, b: 2 }, confidence: 0.91 },
    });
    expect(replay.kind).toBe('final');
    if (replay.kind !== 'final') throw new Error('Expected final replay');
    expect(replay.segment.id).toBe(first.segment.id);
    expect(await prisma.transcriptSegment.count({ where: { sessionId } })).toBe(1);

    await expect(ingestion.ingest({ ...final, text: '不同的虚构原文' })).rejects.toMatchObject({
      response: { code: 'TRANSCRIPT_INGEST_CONFLICT' },
    });
    await expect(
      ingestion.ingest({ ...final, providerPayload: { confidence: 0.92 } }),
    ).rejects.toMatchObject({ response: { code: 'TRANSCRIPT_INGEST_CONFLICT' } });
    expect(await prisma.transcriptSegment.count({ where: { sessionId } })).toBe(1);

    const interim = await ingestion.ingest({
      ...result({ ingestKey: 'fixture-stream:interim-1' }),
      kind: 'interim',
    });
    expect(interim).toEqual({ kind: 'interim', persisted: false });
    expect(await prisma.transcriptSegment.count({ where: { sessionId } })).toBe(1);
  });

  it('keeps mappings append-only and snapshots original roles without historical rewrites', async () => {
    await mappings.append({
      createdBy: null,
      role: 'elder',
      sessionId,
      source: 'provider',
      speakerProviderId: 'speaker-1',
    });
    const first = await ingestion.ingest(result({ speakerProviderId: 'speaker-1' }));
    if (first.kind !== 'final') throw new Error('Expected final result');
    const original = await prisma.transcriptSegment.findUniqueOrThrow({
      where: { id: first.segment.id },
    });
    await mappings.append({
      createdBy: null,
      role: 'interviewer',
      sessionId,
      source: 'provider',
      speakerProviderId: 'speaker-1',
    });
    const history = await prisma.speakerMapping.findMany({
      orderBy: { createdAt: 'asc' },
      where: { sessionId, speakerProviderId: 'speaker-1' },
    });
    expect(history).toHaveLength(2);
    expect(history.filter((mapping) => mapping.supersededAt === null)).toHaveLength(1);
    expect(
      (await prisma.transcriptSegment.findUniqueOrThrow({ where: { id: original.id } }))
        .originalSpeakerRole,
    ).toBe('elder');

    const mapped = await ingestion.ingest(
      result({
        ingestKey: 'fixture-stream:segment-2',
        speakerProviderId: 'speaker-1',
        startMs: 101,
      }),
    );
    expect(mapped.kind === 'final' && mapped.segment.originalSpeakerRole).toBe('interviewer');
    const unknown = await ingestion.ingest(
      result({
        ingestKey: 'fixture-stream:segment-3',
        speakerProviderId: 'speaker-missing',
        startMs: 202,
      }),
    );
    expect(unknown.kind === 'final' && unknown.segment.originalSpeakerRole).toBe('unknown');
  });

  it('isolates internal queries by current assignment and never returns provider payload', async () => {
    await ingestion.ingest(result());
    const segments = await query.listFinalSegments(actorA, sessionId);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0]).not.toHaveProperty('providerPayload');
    await expect(query.listFinalSegments(actorB, sessionId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await prisma.projectAssignment.updateMany({
      data: { revokedAt: new Date() },
      where: { projectId, revokedAt: null, userId: actorA.id },
    });
    await expect(query.listFinalSegments(actorA, sessionId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await prisma.projectAssignment.create({
      data: { assignmentRole: 'interviewer', projectId, userId: actorA.id },
    });

    await prisma.elderProject.update({
      data: { status: 'restricted', statusBeforeRestriction: 'active' },
      where: { id: projectId },
    });
    await expect(query.listFinalSegments(actorA, sessionId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await prisma.elderProject.update({
      data: { status: 'active', statusBeforeRestriction: null },
      where: { id: projectId },
    });
  });

  it('rejects oversized payloads and disallowed session or consent states without mutation', async () => {
    await expect(
      ingestion.ingest(
        result({
          ingestKey: 'fixture-stream:oversized',
          providerPayload: { raw: 'x'.repeat(65_536) },
          startMs: 303,
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'ASR_PROVIDER_PAYLOAD_TOO_LARGE' } });

    await prisma.interviewSession.update({
      data: { status: 'completed' },
      where: { id: sessionId },
    });
    await expect(
      ingestion.ingest(result({ ingestKey: 'fixture-stream:closed', startMs: 404 })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (await prisma.interviewSession.findUniqueOrThrow({ where: { id: sessionId } })).status,
    ).toBe('completed');
    await prisma.interviewSession.update({
      data: { status: 'processing' },
      where: { id: sessionId },
    });
    await prisma.consentRecord.updateMany({
      data: { revokedAt: new Date(), status: 'revoked' },
      where: { projectId, status: 'valid' },
    });
    await expect(
      ingestion.ingest(result({ ingestKey: 'fixture-stream:revoked', startMs: 505 })),
    ).rejects.toMatchObject({ response: { code: 'ASR_INGESTION_NOT_ALLOWED' } });
    expect(
      await prisma.transcriptSegment.count({ where: { ingestKey: 'fixture-stream:revoked' } }),
    ).toBe(0);
  });

  it('keeps audio and session state unchanged when the deterministic fake fails', async () => {
    const audio = await prisma.audioObject.create({
      data: {
        createdBy: actorA.id,
        mimeType: 'audio/webm;codecs=opus',
        projectId,
        purpose: 'interview',
        sessionId,
        status: 'initiated',
      },
    });
    const beforeAudio = await prisma.audioObject.findUniqueOrThrow({ where: { id: audio.id } });
    const beforeSession = await prisma.interviewSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    const fake = new DeterministicAsrFake([result({ ingestKey: 'fixture-stream:fake' })], 0);
    await expect(fake.next()).rejects.toThrow('TEST_ONLY_ASR_FAILURE');
    expect(await prisma.audioObject.findUniqueOrThrow({ where: { id: audio.id } })).toEqual(
      beforeAudio,
    );
    expect(await prisma.interviewSession.findUniqueOrThrow({ where: { id: sessionId } })).toEqual(
      beforeSession,
    );
  });
});

function result(overrides: Partial<NormalizedAsrResult> = {}): NormalizedAsrResult {
  const startMs = overrides.startMs ?? 0;
  return {
    endMs: startMs + 100,
    ingestKey: 'fixture-stream:segment-1',
    kind: 'final',
    providerPayload: { request_id: 'synthetic-request' },
    providerSegmentId: 'provider-segment-1',
    sessionId: defaultSessionId,
    source: 'fixture',
    speakerProviderId: null,
    startMs,
    text: '这是一段完全虚构的测试转录。',
    ...overrides,
  };
}

function principal(id: string, displayName: string): AuthPrincipal {
  return {
    displayName,
    id,
    role: 'interviewer',
    sessionId: crypto.randomUUID(),
    sessionTokenHash: 'test-only-session-token-hash',
    status: 'active',
  };
}

async function cleanDatabase(database: PrismaService): Promise<void> {
  await database.transcriptSegment.deleteMany();
  await database.speakerMapping.deleteMany();
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
