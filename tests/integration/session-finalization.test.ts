import { randomUUID } from 'node:crypto';

import { loadApiConfig } from '@elder-interview/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ResourceAuthorizationService } from '../../apps/api/src/auth/resource-authorization.service.js';
import type { AuthPrincipal } from '../../apps/api/src/auth/auth.types.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { SessionFinalizationService } from '../../apps/api/src/project-foundation/session-finalization.service.js';
import { RealtimeRuntimeService } from '../../apps/api/src/realtime-transcription/realtime-runtime.service.js';

describe('session finalization PostgreSQL orchestration', () => {
  let prisma: PrismaService;
  const actorId = randomUUID();
  const projectId = randomUUID();
  const actor: AuthPrincipal = {
    displayName: '虚构倾听员',
    id: actorId,
    role: 'interviewer',
    sessionId: randomUUID(),
    sessionTokenHash: 'test',
    status: 'active',
  };
  let service: SessionFinalizationService;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    prisma = new PrismaService(
      loadApiConfig({
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-finalization-pepper',
        DATABASE_URL: databaseUrl,
      }),
    );
    await prisma.$connect();
    service = new SessionFinalizationService(
      prisma,
      new ResourceAuthorizationService(prisma),
      new RealtimeRuntimeService(),
    );
    await prisma.user.create({
      data: {
        displayName: actor.displayName,
        email: `finalize-${actorId}@example.test`,
        id: actorId,
        passwordHash: 'test',
        role: 'interviewer',
      },
    });
    await prisma.elderProject.create({
      data: { createdBy: actorId, displayName: '虚构长者', id: projectId, status: 'active' },
    });
    await prisma.projectAssignment.create({ data: { projectId, userId: actorId } });
    await prisma.consentRecord.create({
      data: {
        consentMethod: 'electronic',
        consentTextVersion: 'mvp-v1',
        consentType: 'recording_transcription_ai',
        consentedAt: new Date(),
        createdBy: actorId,
        projectId,
        status: 'valid',
      },
    });
  });

  afterAll(async () => {
    await prisma.sessionFinalizationChunk.deleteMany({
      where: { finalization: { session: { projectId } } },
    });
    await prisma.sessionFinalization.deleteMany({ where: { session: { projectId } } });
    await prisma.idempotencyRecord.deleteMany({ where: { actorId } });
    await prisma.auditLog.deleteMany({ where: { actorId } });
    await prisma.audioChunk.deleteMany({ where: { audioObject: { projectId } } });
    await prisma.audioObject.deleteMany({ where: { projectId } });
    await prisma.interviewSession.deleteMany({ where: { projectId } });
    await prisma.consentRecord.deleteMany({ where: { projectId } });
    await prisma.projectAssignment.deleteMany({ where: { projectId } });
    await prisma.elderProject.deleteMany({ where: { id: projectId } });
    await prisma.user.deleteMany({ where: { id: actorId } });
    await prisma.$disconnect();
  });

  it('freezes one snapshot and completes only after the audio manifest is complete', async () => {
    const session = await prisma.interviewSession.create({
      data: {
        createdBy: actorId,
        projectId,
        sequenceNo: 1,
        startedAt: new Date('2026-08-07T08:00:00Z'),
        status: 'recording',
      },
    });
    const audio = await prisma.audioObject.create({
      data: {
        createdBy: actorId,
        mimeType: 'audio/webm;codecs=opus',
        projectId,
        purpose: 'interview',
        sessionId: session.id,
      },
    });
    const request = {
      audio_object_id: audio.id,
      chunks: [
        {
          checksum: 'a'.repeat(64),
          end_ms: 9200,
          mime_type: audio.mimeType,
          sequence_no: 0,
          size_bytes: 10,
          start_ms: 0,
        },
      ],
      expected_chunk_count: 1,
      request_id: randomUUID(),
    };
    const stopped = await service.stop(actor, session.id, request);
    expect(stopped).toMatchObject({
      duration_seconds: 10,
      status: 'stopping',
      finalization: {
        expected_chunk_count: 1,
        transcript_status: 'pending',
        upload_status: 'awaiting_upload',
      },
    });
    expect((await service.stop(actor, session.id, request)).ended_at).toBe(stopped.ended_at);
    const concurrent = await Promise.all([
      service.stop(actor, session.id, { ...request, request_id: randomUUID() }),
      service.stop(actor, session.id, { ...request, request_id: randomUUID() }),
    ]);
    expect(concurrent.every((value) => value.id === session.id)).toBe(true);
    expect(await prisma.sessionFinalization.count({ where: { sessionId: session.id } })).toBe(1);
    await prisma.audioObject.update({
      data: {
        chunkCount: 1,
        completedAt: new Date(),
        manifestChecksum: 'b'.repeat(64),
        status: 'complete',
        totalSizeBytes: 10,
      },
      where: { id: audio.id },
    });
    const completed = await service.recover(actor, session.id, {
      action: 'reconcile',
      request_id: randomUUID(),
    });
    expect(completed).toMatchObject({
      status: 'completed',
      finalization: { transcript_status: 'not_started', upload_status: 'complete' },
    });
  });

  it('rejects a first snapshot after consent withdrawal and leaves no commitments', async () => {
    const session = await prisma.interviewSession.create({
      data: {
        createdBy: actorId,
        projectId,
        sequenceNo: 2,
        startedAt: new Date(),
        status: 'recording',
      },
    });
    const audio = await prisma.audioObject.create({
      data: {
        createdBy: actorId,
        mimeType: 'audio/webm;codecs=opus',
        projectId,
        purpose: 'interview',
        sessionId: session.id,
      },
    });
    await prisma.consentRecord.updateMany({
      data: { revokedAt: new Date(), status: 'revoked' },
      where: { projectId, status: 'valid' },
    });
    await prisma.elderProject.update({
      data: { status: 'restricted', statusBeforeRestriction: 'active' },
      where: { id: projectId },
    });
    await expect(
      service.stop(actor, session.id, {
        audio_object_id: audio.id,
        chunks: [
          {
            checksum: 'c'.repeat(64),
            end_ms: 1000,
            mime_type: audio.mimeType,
            sequence_no: 0,
            size_bytes: 10,
            start_ms: 0,
          },
        ],
        expected_chunk_count: 1,
        request_id: randomUUID(),
      }),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    expect(await prisma.sessionFinalization.count({ where: { sessionId: session.id } })).toBe(0);
    expect(
      (await prisma.interviewSession.findUniqueOrThrow({ where: { id: session.id } })).status,
    ).toBe('interrupted');
    const interrupted = await prisma.interviewSession.create({
      data: {
        createdBy: actorId,
        projectId,
        sequenceNo: 3,
        startedAt: new Date(),
        status: 'interrupted',
      },
    });
    const interruptedAudio = await prisma.audioObject.create({
      data: {
        createdBy: actorId,
        mimeType: audio.mimeType,
        projectId,
        purpose: 'interview',
        sessionId: interrupted.id,
      },
    });
    await expect(
      service.recover(actor, interrupted.id, {
        action: 'finalize_interrupted',
        audio_object_id: interruptedAudio.id,
        chunks: [
          {
            checksum: 'd'.repeat(64),
            end_ms: 1000,
            mime_type: audio.mimeType,
            sequence_no: 0,
            size_bytes: 10,
            start_ms: 0,
          },
        ],
        expected_chunk_count: 1,
        request_id: randomUUID(),
      }),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    expect(await prisma.sessionFinalization.count({ where: { sessionId: interrupted.id } })).toBe(
      0,
    );
  });
});
