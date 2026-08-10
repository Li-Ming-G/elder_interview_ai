import { createHash, randomUUID } from 'node:crypto';

import { loadApiConfig } from '@elder-interview/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ResourceAuthorizationService } from '../../apps/api/src/auth/resource-authorization.service.js';
import type { AuthPrincipal } from '../../apps/api/src/auth/auth.types.js';
import { AudioIntegrityService } from '../../apps/api/src/audio/audio-integrity.service.js';
import { canonicalAudioManifestChecksum } from '../../apps/api/src/audio/audio-manifest.js';
import { AudioService } from '../../apps/api/src/audio/audio.service.js';
import { LocalAudioStorageAdapter } from '../../apps/api/src/audio/local-audio-storage.adapter.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { PrismaProjectAccessReader } from '../../apps/api/src/project-foundation/prisma-project-access.reader.js';
import { ProjectAccessService } from '../../apps/api/src/project-foundation/project-access.service.js';
import { ProjectFoundationService } from '../../apps/api/src/project-foundation/project-foundation.service.js';
import { SessionFinalizationService } from '../../apps/api/src/project-foundation/session-finalization.service.js';
import { SessionSnapshotService } from '../../apps/api/src/project-foundation/session-snapshot.service.js';
import { RealtimeRuntimeService } from '../../apps/api/src/realtime-transcription/realtime-runtime.service.js';
import {
  DeterministicStreamingAsrFake,
  StreamingAsrAdapter,
  StreamingAsrUnavailableError,
  type StreamingEndContext,
} from '../../apps/api/src/realtime-transcription/streaming-asr.js';
import { TranscriptIngestionService } from '../../apps/api/src/transcription/transcript-ingestion.service.js';
import type { NormalizedAsrResult } from '../../apps/api/src/transcription/transcription.types.js';

describe('session finalization PostgreSQL orchestration', () => {
  let prisma: PrismaService;
  let config: ReturnType<typeof loadApiConfig>;
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
    config = loadApiConfig({
      APP_ENV: 'test',
      AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
      AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-finalization-pepper',
      AI_RETENTION_CLEANUP_PEPPER: 'test-only-finalization-retention-pepper',
      DATABASE_URL: databaseUrl,
    });
    prisma = new PrismaService(config);
    await prisma.$connect();
    service = new SessionFinalizationService(
      prisma,
      new ResourceAuthorizationService(prisma),
      new RealtimeRuntimeService(),
      new DeterministicStreamingAsrFake(),
      new TranscriptIngestionService(prisma, config),
      new SessionSnapshotService(prisma),
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
    await prisma.speakerCalibrationAttemptSegment.deleteMany({
      where: { attempt: { session: { projectId } } },
    });
    await prisma.speakerCalibrationAttempt.deleteMany({ where: { session: { projectId } } });
    await prisma.transcriptSegment.deleteMany({ where: { session: { projectId } } });
    await prisma.speakerMapping.deleteMany({ where: { session: { projectId } } });
    await prisma.speakerStream.deleteMany({ where: { session: { projectId } } });
    await prisma.audioChunk.deleteMany({ where: { audioObject: { projectId } } });
    await prisma.sessionCaptureGeneration.deleteMany({ where: { session: { projectId } } });
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
    const requestB = { ...request, request_id: randomUUID() };
    const firstB = await service.stop(actor, session.id, requestB);
    expect(firstB.status).toBe('stopping');
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
    await prisma.audioChunk.create({
      data: {
        audioObjectId: audio.id,
        checksum: request.chunks[0].checksum,
        endMs: request.chunks[0].end_ms,
        mimeType: request.chunks[0].mime_type,
        objectKey: `${audio.id}/0.bin`,
        sequenceNo: 0,
        sizeBytes: request.chunks[0].size_bytes,
        startMs: request.chunks[0].start_ms,
        uploadStatus: 'uploaded',
        uploadedAt: new Date(),
      },
    });
    const storedChunks = await prisma.audioChunk.findMany({ where: { audioObjectId: audio.id } });
    await prisma.audioObject.update({
      data: { manifestChecksum: canonicalAudioManifestChecksum(storedChunks) },
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
    expect(await service.stop(actor, session.id, requestB)).toEqual(firstB);
  });

  it('drains ASR only after final ingestion and degrades unavailable, timeout, and lost runtimes', async () => {
    const order: string[] = [];
    const successfulRuntime = new RealtimeRuntimeService();
    const successful = successfulRuntime.create(randomUUID(), randomUUID(), 6_000);
    successful.highestAudioSequenceAcked = 0;
    const successfulCase = await createReadyFinalization(successful.sessionId, 10);
    await prisma.speakerStream.create({
      data: {
        closedAt: new Date(),
        id: successful.speakerStreamId,
        sessionId: successful.sessionId,
        status: 'closed',
      },
    });
    const successfulService = createService(
      successfulRuntime,
      new EndingAdapter(async (context) => {
        order.push('final');
        await context.ingestFinal(finalResult(context.sessionId));
        order.push('closed');
      }),
    );
    await successfulService.recover(actor, successfulCase.sessionId, {
      action: 'reconcile',
      request_id: randomUUID(),
    });
    expect(order).toEqual(['final', 'closed']);
    expect(
      await prisma.transcriptSegment.count({ where: { sessionId: successfulCase.sessionId } }),
    ).toBe(1);
    expect(
      await prisma.transcriptSegment.findFirstOrThrow({
        where: { sessionId: successfulCase.sessionId },
      }),
    ).toMatchObject({ endMs: 7_000, startMs: 6_000 });
    expect(
      await prisma.sessionFinalization.findUniqueOrThrow({
        where: { sessionId: successfulCase.sessionId },
      }),
    ).toMatchObject({ transcriptStatus: 'drained' });

    const unavailableRuntime = new RealtimeRuntimeService();
    const unavailable = unavailableRuntime.create(randomUUID(), randomUUID());
    unavailable.highestAudioSequenceAcked = 0;
    const unavailableCase = await createReadyFinalization(unavailable.sessionId, 11);
    await createService(unavailableRuntime, new UnavailableEndingAdapter()).recover(
      actor,
      unavailableCase.sessionId,
      { action: 'reconcile', request_id: randomUUID() },
    );
    expect(
      await prisma.sessionFinalization.findUniqueOrThrow({
        where: { sessionId: unavailableCase.sessionId },
      }),
    ).toMatchObject({ transcriptStatus: 'degraded' });

    const timeoutRuntime = new RealtimeRuntimeService();
    const timeout = timeoutRuntime.create(randomUUID(), randomUUID());
    timeout.highestAudioSequenceAcked = 0;
    const timeoutCase = await createReadyFinalization(timeout.sessionId, 12);
    await createService(timeoutRuntime, new TimeoutEndingAdapter()).recover(
      actor,
      timeoutCase.sessionId,
      { action: 'reconcile', request_id: randomUUID() },
    );
    expect(
      await prisma.sessionFinalization.findUniqueOrThrow({
        where: { sessionId: timeoutCase.sessionId },
      }),
    ).toMatchObject({ transcriptStatus: 'degraded' });

    const lostCase = await createReadyFinalization(randomUUID(), 13, 0);
    await createService(new RealtimeRuntimeService(), new DeterministicStreamingAsrFake()).recover(
      actor,
      lostCase.sessionId,
      { action: 'reconcile', request_id: randomUUID() },
    );
    expect(
      await prisma.sessionFinalization.findUniqueOrThrow({
        where: { sessionId: lostCase.sessionId },
      }),
    ).toMatchObject({ transcriptStatus: 'degraded' });
  });

  it('serializes stop against consent revocation and ordinary upload with real barriers', async () => {
    const authorization = new ResourceAuthorizationService(prisma);
    const projectService = new ProjectFoundationService(
      prisma,
      new ProjectAccessService(new PrismaProjectAccessReader(prisma), authorization),
      authorization,
      new AudioIntegrityService(new LocalAudioStorageAdapter(config)),
      new SessionSnapshotService(prisma),
      new RealtimeRuntimeService(),
    );
    const session = await prisma.interviewSession.create({
      data: {
        createdBy: actorId,
        projectId,
        sequenceNo: 20,
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
    const stopRequest = {
      audio_object_id: audio.id,
      chunks: [
        {
          checksum: '1'.repeat(64),
          end_ms: 1000,
          mime_type: audio.mimeType,
          sequence_no: 0,
          size_bytes: 10,
          start_ms: 0,
        },
      ],
      expected_chunk_count: 1,
      request_id: randomUUID(),
    };
    const currentConsent = await prisma.consentRecord.findFirstOrThrow({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: { projectId, status: 'valid' },
    });
    const barrier = holdProjectLock();
    await barrier.acquired;
    const stopping = service.stop(actor, session.id, stopRequest);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const revoking = projectService.revokeConsent(actor, currentConsent.id, randomUUID());
    barrier.release();
    await expect(stopping).resolves.toMatchObject({ status: 'stopping' });
    await expect(revoking).resolves.toMatchObject({ status: 'revoked' });
    expect(await prisma.sessionFinalization.count({ where: { sessionId: session.id } })).toBe(1);

    await restoreConsent();
    const revokeFirstSession = await prisma.interviewSession.create({
      data: {
        createdBy: actorId,
        projectId,
        sequenceNo: 22,
        startedAt: new Date(),
        status: 'recording',
      },
    });
    const revokeFirstAudio = await prisma.audioObject.create({
      data: {
        createdBy: actorId,
        mimeType: audio.mimeType,
        projectId,
        purpose: 'interview',
        sessionId: revokeFirstSession.id,
      },
    });
    const revokeFirstConsent = await prisma.consentRecord.findFirstOrThrow({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: { projectId, status: 'valid' },
    });
    const revokeFirstBarrier = holdProjectLock();
    await revokeFirstBarrier.acquired;
    const revokeFirst = projectService.revokeConsent(actor, revokeFirstConsent.id, randomUUID());
    await new Promise((resolve) => setTimeout(resolve, 25));
    const deniedStop = expect(
      service.stop(actor, revokeFirstSession.id, {
        ...stopRequest,
        audio_object_id: revokeFirstAudio.id,
        request_id: randomUUID(),
      }),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    revokeFirstBarrier.release();
    await revokeFirst;
    await deniedStop;
    expect(
      await prisma.sessionFinalization.count({ where: { sessionId: revokeFirstSession.id } }),
    ).toBe(0);
    await restoreConsent();

    const uploadSession = await prisma.interviewSession.create({
      data: {
        createdBy: actorId,
        projectId,
        sequenceNo: 21,
        startedAt: new Date(),
        status: 'recording',
      },
    });
    const uploadAudio = await prisma.audioObject.create({
      data: {
        createdBy: actorId,
        mimeType: audio.mimeType,
        projectId,
        purpose: 'interview',
        sessionId: uploadSession.id,
      },
    });
    const storage = new LocalAudioStorageAdapter(config);
    const audioService = new AudioService(
      prisma,
      authorization,
      new AudioIntegrityService(storage),
      storage,
    );
    const uploadBarrier = holdProjectLock();
    await uploadBarrier.acquired;
    const frozen = service.stop(actor, uploadSession.id, {
      ...stopRequest,
      audio_object_id: uploadAudio.id,
      request_id: randomUUID(),
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const bytes = Buffer.from('0123456789');
    const expandingUpload = expect(
      audioService.uploadChunk(
        actor,
        uploadAudio.id,
        {
          checksum: '84d89877f0d4041efb6bf91a16f0248f2fd573e6af05c19f96bedb9f882f7882',
          endMs: 2000,
          mimeType: uploadAudio.mimeType,
          requestId: randomUUID(),
          sequenceNo: 1,
          startMs: 1000,
        },
        bytes,
      ),
    ).rejects.toMatchObject({ response: { code: 'AUDIO_COMMITMENT_CONFLICT' } });
    uploadBarrier.release();
    await expect(frozen).resolves.toMatchObject({ status: 'stopping' });
    await expandingUpload;
    expect(await prisma.audioChunk.count({ where: { audioObjectId: uploadAudio.id } })).toBe(0);
  });

  it('keeps completed and failed finalization terminals stable', async () => {
    const completed = await createReadyFinalization(randomUUID(), 14, null, 'completed');
    const completedAt = new Date('2026-08-07T10:00:00Z');
    await prisma.sessionFinalization.update({
      data: { completedAt, transcriptStatus: 'not_started' },
      where: { sessionId: completed.sessionId },
    });
    await service.recover(actor, completed.sessionId, {
      action: 'reconcile',
      request_id: randomUUID(),
    });
    expect(
      (
        await prisma.sessionFinalization.findUniqueOrThrow({
          where: { sessionId: completed.sessionId },
        })
      ).completedAt,
    ).toEqual(completedAt);

    const failed = await createReadyFinalization(randomUUID(), 15, 0, 'failed');
    await service.recover(actor, failed.sessionId, {
      action: 'reconcile',
      request_id: randomUUID(),
    });
    expect(
      (await prisma.interviewSession.findUniqueOrThrow({ where: { id: failed.sessionId } })).status,
    ).toBe('failed');
  });

  it('single-flights concurrent recover and matching stop runners and clears failed entries', async () => {
    const runtime = new RealtimeRuntimeService();
    const runtimeSession = runtime.create(randomUUID(), randomUUID());
    runtimeSession.highestAudioSequenceAcked = 0;
    const ready = await createReadyFinalization(runtimeSession.sessionId, 30);
    const adapter = new BlockingEndingAdapter();
    const singleFlightService = createService(runtime, adapter);
    const sameRequestId = randomUUID();
    const firstRecover = singleFlightService.recover(actor, ready.sessionId, {
      action: 'reconcile',
      request_id: sameRequestId,
    });
    await adapter.entered;

    const sameRecover = singleFlightService.recover(actor, ready.sessionId, {
      action: 'reconcile',
      request_id: sameRequestId,
    });
    const differentRequest = {
      action: 'reconcile' as const,
      request_id: randomUUID(),
    };
    const differentRecover = singleFlightService.recover(actor, ready.sessionId, differentRequest);
    const stopRequest = {
      audio_object_id: ready.audioObjectId,
      chunks: [
        {
          checksum: 'e'.repeat(64),
          end_ms: 1000,
          mime_type: 'audio/webm;codecs=opus',
          sequence_no: 0,
          size_bytes: 10,
          start_ms: 0,
        },
      ],
      expected_chunk_count: 1,
      request_id: randomUUID(),
    };
    const matchingStop = singleFlightService.stop(actor, ready.sessionId, stopRequest);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(adapter.calls).toBe(1);

    adapter.release();
    const [first, same, different, stopped] = await Promise.all([
      firstRecover,
      sameRecover,
      differentRecover,
      matchingStop,
    ]);
    expect(same).toEqual(first);
    expect(await singleFlightService.recover(actor, ready.sessionId, differentRequest)).toEqual(
      different,
    );
    expect(await singleFlightService.stop(actor, ready.sessionId, stopRequest)).toEqual(stopped);
    expect(adapter.calls).toBe(1);
    expect(await singleFlightService.get(actor, ready.sessionId)).toMatchObject({
      finalization: { transcript_status: 'drained' },
      status: 'completed',
    });

    const retryableId = randomUUID();
    await expect(singleFlightService.advance(retryableId)).rejects.toBeDefined();
    const retryRuntime = runtime.create(randomUUID(), randomUUID());
    retryRuntime.highestAudioSequenceAcked = 0;
    const retryable = await createReadyFinalization(
      retryRuntime.sessionId,
      31,
      0,
      'stopping',
      retryableId,
    );
    await singleFlightService.advance(retryable.finalizationId);
    expect(adapter.calls).toBe(2);
    expect(await singleFlightService.get(actor, retryable.sessionId)).toMatchObject({
      finalization: { transcript_status: 'drained' },
      status: 'completed',
    });
  });

  function createService(
    runtime: RealtimeRuntimeService,
    adapter: StreamingAsrAdapter,
  ): SessionFinalizationService {
    return new SessionFinalizationService(
      prisma,
      new ResourceAuthorizationService(prisma),
      runtime,
      adapter,
      new TranscriptIngestionService(prisma, config),
      new SessionSnapshotService(prisma),
    );
  }

  async function createReadyFinalization(
    sessionId: string,
    sequenceNo: number,
    accepted: number | null = 0,
    status: 'completed' | 'failed' | 'stopping' = 'stopping',
    finalizationId: string = randomUUID(),
  ): Promise<{ audioObjectId: string; finalizationId: string; sessionId: string }> {
    const session = await prisma.interviewSession.create({
      data: {
        createdBy: actorId,
        id: sessionId,
        projectId,
        sequenceNo,
        startedAt: new Date(),
        status,
      },
    });
    const audio = await prisma.audioObject.create({
      data: {
        chunkCount: 1,
        completedAt: new Date(),
        createdBy: actorId,
        manifestChecksum: 'f'.repeat(64),
        mimeType: 'audio/webm;codecs=opus',
        projectId,
        purpose: 'interview',
        sessionId,
        status: 'complete',
        totalSizeBytes: 10,
      },
    });
    await prisma.audioChunk.create({
      data: {
        audioObjectId: audio.id,
        checksum: 'e'.repeat(64),
        endMs: 1000,
        mimeType: audio.mimeType,
        objectKey: `${audio.id}/0.bin`,
        sequenceNo: 0,
        sizeBytes: 10,
        startMs: 0,
        uploadedAt: new Date(),
      },
    });
    await prisma.sessionFinalization.create({
      data: {
        asrLastAudioSequenceAccepted: accepted,
        audioObjectId: audio.id,
        captureEndedAt: new Date(),
        commitmentsChecksum: fixtureCommitmentChecksum(),
        createdBy: actorId,
        expectedChunkCount: 1,
        id: finalizationId,
        sessionId,
        stopRequestId: randomUUID(),
        chunks: {
          create: {
            checksum: 'e'.repeat(64),
            endMs: 1000,
            mimeType: audio.mimeType,
            sequenceNo: 0,
            sizeBytes: 10,
            startMs: 0,
          },
        },
      },
    });
    const chunks = await prisma.audioChunk.findMany({ where: { audioObjectId: audio.id } });
    await prisma.audioObject.update({
      data: { manifestChecksum: canonicalAudioManifestChecksum(chunks) },
      where: { id: audio.id },
    });
    return { audioObjectId: audio.id, finalizationId, sessionId: session.id };
  }

  function holdProjectLock(): {
    acquired: Promise<void>;
    release: () => void;
  } {
    let signalAcquired: (() => void) | undefined;
    let signalRelease: (() => void) | undefined;
    const acquired = new Promise<void>((resolve) => {
      signalAcquired = resolve;
    });
    const released = new Promise<void>((resolve) => {
      signalRelease = resolve;
    });
    void prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project:${projectId}`}, 0))`;
      signalAcquired?.();
      await released;
    });
    return { acquired, release: () => signalRelease?.() };
  }

  async function restoreConsent(): Promise<void> {
    await prisma.elderProject.update({
      data: { status: 'active', statusBeforeRestriction: null },
      where: { id: projectId },
    });
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
  }

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

class EndingAdapter extends StreamingAsrAdapter {
  public constructor(private readonly ending: (context: StreamingEndContext) => Promise<void>) {
    super();
  }

  public accept(): Promise<readonly NormalizedAsrResult[]> {
    return Promise.resolve([]);
  }

  public drainAndClose(context: StreamingEndContext): Promise<void> {
    return this.ending(context);
  }
}

class UnavailableEndingAdapter extends EndingAdapter {
  public constructor() {
    super(() => Promise.reject(new StreamingAsrUnavailableError()));
  }
}

class TimeoutEndingAdapter extends EndingAdapter {
  public constructor() {
    super(() => new Promise(() => undefined));
  }
}

class BlockingEndingAdapter extends StreamingAsrAdapter {
  public calls = 0;
  public readonly entered: Promise<void>;
  private signalEntered: (() => void) | undefined;
  private signalRelease: (() => void) | undefined;
  private readonly released: Promise<void>;

  public constructor() {
    super();
    this.entered = new Promise<void>((resolve) => {
      this.signalEntered = resolve;
    });
    this.released = new Promise<void>((resolve) => {
      this.signalRelease = resolve;
    });
  }

  public accept(): Promise<readonly NormalizedAsrResult[]> {
    return Promise.resolve([]);
  }

  public async drainAndClose(): Promise<void> {
    this.calls += 1;
    this.signalEntered?.();
    await this.released;
  }

  public release(): void {
    this.signalRelease?.();
  }
}

function finalResult(sessionId: string): NormalizedAsrResult {
  return {
    endMs: 1000,
    ingestKey: `ending:${sessionId}`,
    kind: 'final',
    providerSegmentId: `ending:${sessionId}`,
    sessionId,
    source: 'fixture',
    startMs: 0,
    text: '虚构的结束确定态转录',
  };
}

function fixtureCommitmentChecksum(): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        {
          checksum: 'e'.repeat(64),
          end_ms: 1000,
          mime_type: 'audio/webm;codecs=opus',
          sequence_no: 0,
          size_bytes: 10,
          start_ms: 0,
        },
      ]),
    )
    .digest('hex');
}
