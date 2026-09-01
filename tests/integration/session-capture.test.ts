import { createHash, randomUUID } from 'node:crypto';

import { loadApiConfig } from '@elder-interview/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ResourceAuthorizationService } from '../../apps/api/src/auth/resource-authorization.service.js';
import type { AuthPrincipal } from '../../apps/api/src/auth/auth.types.js';
import { AudioIntegrityService } from '../../apps/api/src/audio/audio-integrity.service.js';
import { AudioService } from '../../apps/api/src/audio/audio.service.js';
import { LocalAudioStorageAdapter } from '../../apps/api/src/audio/local-audio-storage.adapter.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { LocalTestDeletionScopeFixtureReader } from '../../apps/api/src/ai-runtime/deletion-scope.reader.js';
import {
  FICTIONAL_CONTINUING_CONSENT_VERSION,
  SyntheticConsentContinuationPolicyReader,
} from '../../apps/api/src/project-foundation/consent-continuation.policy.js';
import { PrismaProjectAccessReader } from '../../apps/api/src/project-foundation/prisma-project-access.reader.js';
import { ProjectAccessService } from '../../apps/api/src/project-foundation/project-access.service.js';
import { ProjectFoundationService } from '../../apps/api/src/project-foundation/project-foundation.service.js';
import { RepeatInterviewDecisionService } from '../../apps/api/src/project-foundation/repeat-interview-decision.service.js';
import { SessionCaptureService } from '../../apps/api/src/project-foundation/session-capture.service.js';
import { SessionFinalizationService } from '../../apps/api/src/project-foundation/session-finalization.service.js';
import { SessionSnapshotService } from '../../apps/api/src/project-foundation/session-snapshot.service.js';
import { CapturePcmEvidenceService } from '../../apps/api/src/realtime-transcription/capture-pcm-evidence.service.js';
import { RealtimeRuntimeService } from '../../apps/api/src/realtime-transcription/realtime-runtime.service.js';
import { DeterministicStreamingAsrFake } from '../../apps/api/src/realtime-transcription/streaming-asr.js';

const MIME = 'audio/webm;codecs=opus';

describe('session capture lifecycle PostgreSQL barriers', () => {
  let prisma: PrismaService;
  let projects: ProjectFoundationService;
  let captures: SessionCaptureService;
  let evidence: CapturePcmEvidenceService;
  let finalization: SessionFinalizationService;
  let audio: AudioService;
  let runtime: RealtimeRuntimeService;
  const actorId = randomUUID();
  const actor: AuthPrincipal = {
    displayName: '虚构采集倾听员',
    id: actorId,
    role: 'interviewer',
    sessionId: randomUUID(),
    sessionTokenHash: 'test-only-capture-session',
    status: 'active',
  };

  function startSession(
    sessionId: string,
    input: { audio_stream_id: string; mime_type: string; request_id: string },
  ): ReturnType<ProjectFoundationService['startSession']> {
    return projects.startSession(actor, sessionId, {
      ...input,
      recording_reminder_version: 'recording-reminder-v1',
    });
  }

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    const config = loadApiConfig({
      APP_ENV: 'test',
      AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
      AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-capture-throttle-pepper',
      AI_RETENTION_CLEANUP_PEPPER: 'test-only-capture-retention-pepper',
      DATABASE_URL: databaseUrl,
    });
    prisma = new PrismaService(config);
    await prisma.$connect();
    const authorization = new ResourceAuthorizationService(prisma);
    const snapshots = new SessionSnapshotService(prisma);
    runtime = new RealtimeRuntimeService();
    const storage = new LocalAudioStorageAdapter(config);
    const integrity = new AudioIntegrityService(storage);
    projects = new ProjectFoundationService(
      prisma,
      new ProjectAccessService(new PrismaProjectAccessReader(prisma), authorization),
      authorization,
      integrity,
      snapshots,
      runtime,
      new RepeatInterviewDecisionService(
        prisma,
        new SyntheticConsentContinuationPolicyReader(),
        new LocalTestDeletionScopeFixtureReader(),
      ),
    );
    const repeatInterviews = new RepeatInterviewDecisionService(
      prisma,
      new SyntheticConsentContinuationPolicyReader(),
      new LocalTestDeletionScopeFixtureReader(),
    );
    captures = new SessionCaptureService(
      prisma,
      authorization,
      runtime,
      snapshots,
      repeatInterviews,
    );
    evidence = new CapturePcmEvidenceService(prisma);
    finalization = new SessionFinalizationService(
      prisma,
      authorization,
      runtime,
      new DeterministicStreamingAsrFake(),
      snapshots,
    );
    audio = new AudioService(prisma, authorization, integrity, storage);
    await prisma.user.create({
      data: {
        displayName: actor.displayName,
        email: `capture-${actorId}@example.test`,
        id: actorId,
        passwordHash: 'test-only-hash',
        role: 'interviewer',
      },
    });
  });

  afterAll(async () => {
    await prisma.sessionFinalizationChunk.deleteMany({
      where: { finalization: { createdBy: actorId } },
    });
    await prisma.sessionFinalization.deleteMany({ where: { createdBy: actorId } });
    await prisma.idempotencyRecord.deleteMany({ where: { actorId } });
    await prisma.auditLog.deleteMany({ where: { actorId } });
    await prisma.speakerCalibrationAttemptSegment.deleteMany({
      where: { attempt: { session: { createdBy: actorId } } },
    });
    await prisma.speakerCalibrationAttempt.deleteMany({
      where: { session: { createdBy: actorId } },
    });
    await prisma.transcriptSegment.deleteMany({ where: { session: { createdBy: actorId } } });
    await prisma.speakerMapping.deleteMany({ where: { session: { createdBy: actorId } } });
    await prisma.speakerStream.deleteMany({ where: { session: { createdBy: actorId } } });
    await prisma.audioChunk.deleteMany({ where: { audioObject: { createdBy: actorId } } });
    await prisma.sessionCaptureGeneration.deleteMany({
      where: { session: { createdBy: actorId } },
    });
    await prisma.audioObject.deleteMany({ where: { createdBy: actorId } });
    await prisma.interviewSession.deleteMany({ where: { createdBy: actorId } });
    await prisma.consentRecord.deleteMany({ where: { createdBy: actorId } });
    await prisma.serviceTerm.deleteMany({ where: { explainedBy: actorId } });
    await prisma.projectAssignment.deleteMany({ where: { userId: actorId } });
    await prisma.elderProject.deleteMany({ where: { createdBy: actorId } });
    await prisma.user.delete({ where: { id: actorId } });
    await prisma.$disconnect();
  });

  it('atomically starts one object and generation and rejects same-key payload drift', async () => {
    const fixture = await createFixture(2);
    const input = { audio_stream_id: randomUUID(), mime_type: MIME, request_id: randomUUID() };
    const [first, replay] = await Promise.all([
      startSession(fixture.sessionIds[0], input),
      startSession(fixture.sessionIds[0], input),
    ]);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      capture: {
        audio_stream_id: input.audio_stream_id,
        generation_no: 0,
        status: 'preparing',
        timeline_offset_ms: 0,
      },
      capture_failure_code: null,
      finalization: null,
      status: 'recording',
    });
    expect(await prisma.audioObject.count({ where: { sessionId: fixture.sessionIds[0] } })).toBe(1);
    expect(
      await prisma.sessionCaptureGeneration.count({ where: { sessionId: fixture.sessionIds[0] } }),
    ).toBe(1);
    const audioObjectId = first.capture?.audio_object_id;
    if (audioObjectId === undefined) throw new Error('Expected capture audio object');
    await expect(
      prisma.sessionCaptureGeneration.create({
        data: {
          audioObjectId,
          audioStreamId: randomUUID(),
          generationNo: 1,
          sessionId: fixture.sessionIds[0],
          timelineOffsetMs: 0,
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.sessionCaptureGeneration.create({
        data: {
          audioObjectId,
          audioStreamId: randomUUID(),
          generationNo: 0,
          sessionId: fixture.sessionIds[1],
          timelineOffsetMs: 0,
        },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.interviewSession.update({
        data: { captureFailureCode: 'NO_AUDIO_CAPTURED' },
        where: { id: fixture.sessionIds[1] },
      }),
    ).rejects.toBeDefined();
    expect(
      await prisma.auditLog.count({
        where: { action: 'interview_session.start', requestId: input.request_id },
      }),
    ).toBe(1);
    await expect(
      startSession(fixture.sessionIds[0], {
        ...input,
        mime_type: 'audio/ogg;codecs=opus',
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' } });
  });

  it('confirms, records durable PCM evidence, interrupts, and resumes a first session without continuation policy', async () => {
    const fixture = await createFixture(1, 'mvp-v1');
    const sessionId = fixture.sessionIds[0];
    const stream0 = randomUUID();
    const started = await startSession(sessionId, {
      audio_stream_id: stream0,
      mime_type: MIME,
      request_id: randomUUID(),
    });
    const audioObjectId = started.capture?.audio_object_id;
    if (audioObjectId === undefined) throw new Error('Expected capture audio object');
    const confirmRequest = {
      audio_stream_id: stream0,
      generation_no: 0,
      request_id: randomUUID(),
    };
    const confirmed = await captures.confirmActive(actor, sessionId, confirmRequest);
    expect(await captures.confirmActive(actor, sessionId, confirmRequest)).toEqual(confirmed);
    let adapterCalls = 0;
    await evidence.acceptAndPersist(sessionId, stream0, () => {
      adapterCalls += 1;
      return Promise.resolve([]);
    });
    await evidence.acceptAndPersist(sessionId, stream0, () => {
      adapterCalls += 1;
      return Promise.resolve([]);
    });
    expect(adapterCalls).toBe(2);
    expect(
      (
        await prisma.sessionCaptureGeneration.findUniqueOrThrow({
          where: { audioStreamId: stream0 },
        })
      ).firstPcmAcceptedAt,
    ).not.toBeNull();

    await prisma.projectAssignment.updateMany({
      data: { revokedAt: new Date() },
      where: { projectId: fixture.projectId, userId: actorId },
    });
    const interrupted = await captures.reportInterrupted(actor, sessionId, {
      audio_stream_id: stream0,
      generation_no: 0,
      reason: 'page_recovery_detected',
      request_id: randomUUID(),
    });
    expect(interrupted).toMatchObject({
      capture: { status: 'interrupted' },
      status: 'interrupted',
    });
    await prisma.projectAssignment.updateMany({
      data: { revokedAt: null },
      where: { projectId: fixture.projectId, userId: actorId },
    });
    await prisma.audioChunk.create({
      data: {
        audioObjectId,
        checksum: 'a'.repeat(64),
        endMs: 5_000,
        mimeType: MIME,
        objectKey: `${audioObjectId}/0.bin`,
        sequenceNo: 0,
        sizeBytes: 10,
        startMs: 0,
        uploadStatus: 'uploaded',
        uploadedAt: new Date(),
      },
    });
    const stream1 = randomUUID();
    const resumeRequest = {
      action: 'resume_capture' as const,
      audio_stream_id: stream1,
      local_archive_chunk_count: 1,
      local_archive_timeline_high_water_ms: 6_000,
      request_id: randomUUID(),
    };
    const resumed = await captures.resume(actor, sessionId, resumeRequest);
    expect(resumed).toMatchObject({
      capture: {
        audio_object_id: audioObjectId,
        audio_stream_id: stream1,
        generation_no: 1,
        status: 'preparing',
        timeline_offset_ms: 6_000,
      },
      status: 'reconnecting',
    });
    expect(await captures.resume(actor, sessionId, resumeRequest)).toEqual(resumed);
    await expect(
      captures.resume(actor, sessionId, { ...resumeRequest, local_archive_chunk_count: 2 }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' } });
    expect(
      new Set(
        (await prisma.sessionCaptureGeneration.findMany({ where: { sessionId } })).map(
          (g) => g.audioObjectId,
        ),
      ),
    ).toEqual(new Set([audioObjectId]));
  });

  it.each([
    {
      label: 'missing',
      mutate: async (_projectId: string, consentId: string): Promise<void> => {
        await prisma.consentRecord.delete({ where: { id: consentId } });
      },
    },
    {
      label: 'revoked',
      mutate: async (_projectId: string, consentId: string): Promise<void> => {
        await prisma.consentRecord.update({
          data: { revokedAt: new Date(), status: 'revoked' },
          where: { id: consentId },
        });
      },
    },
    {
      label: 'invalid',
      mutate: async (_projectId: string, consentId: string): Promise<void> => {
        await prisma.consentRecord.update({
          data: { status: 'pending' },
          where: { id: consentId },
        });
      },
    },
    {
      label: 'wrong-project',
      mutate: async (_projectId: string, consentId: string): Promise<void> => {
        const otherProject = await prisma.elderProject.create({
          data: { createdBy: actorId, displayName: '虚构错误授权项目', status: 'ready' },
        });
        await prisma.consentRecord.update({
          data: { projectId: otherProject.id },
          where: { id: consentId },
        });
      },
    },
  ])(
    'fails closed for a $label first-session formal consent at capture confirmation',
    async ({ mutate }) => {
      const fixture = await createFixture(1, 'mvp-v1');
      const sessionId = fixture.sessionIds[0];
      const stream = randomUUID();
      await startSession(sessionId, {
        audio_stream_id: stream,
        mime_type: MIME,
        request_id: randomUUID(),
      });
      await mutate(fixture.projectId, fixture.consentId);

      await expect(
        captures.confirmActive(actor, sessionId, {
          audio_stream_id: stream,
          generation_no: 0,
          request_id: randomUUID(),
        }),
      ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    },
  );

  it('keeps later-session capture bound to covered continuation consent', async () => {
    const fixture = await createFixture(2);
    const sessionId = fixture.sessionIds[1];
    const stream = randomUUID();
    await startSession(sessionId, {
      audio_stream_id: stream,
      mime_type: MIME,
      request_id: randomUUID(),
    });
    await prisma.consentRecord.update({
      data: { consentTextVersion: 'mvp-v1' },
      where: { id: fixture.consentId },
    });

    await expect(
      captures.confirmActive(actor, sessionId, {
        audio_stream_id: stream,
        generation_no: 0,
        request_id: randomUUID(),
      }),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
  });

  it('allows NO_AUDIO_CAPTURED only when server chunks and accepted PCM are both absent', async () => {
    const empty = await createFixture();
    const emptySessionId = empty.sessionIds[0];
    const emptyStream = randomUUID();
    await startSession(emptySessionId, {
      audio_stream_id: emptyStream,
      mime_type: MIME,
      request_id: randomUUID(),
    });
    await captures.reportInterrupted(actor, emptySessionId, {
      audio_stream_id: emptyStream,
      generation_no: 0,
      reason: 'capture_start_failed',
      request_id: randomUUID(),
    });
    const abandoned = await captures.abandonEmpty(actor, emptySessionId, {
      audio_stream_id: emptyStream,
      generation_no: 0,
      local_archive_chunk_count: 0,
      request_id: randomUUID(),
    });
    expect(abandoned).toMatchObject({
      capture: { status: 'abandoned_empty' },
      capture_failure_code: 'NO_AUDIO_CAPTURED',
      finalization: null,
      status: 'failed',
    });
    expect(Object.keys(abandoned.capture ?? {}).sort()).toEqual(
      [
        'audio_object_id',
        'audio_stream_id',
        'generation_no',
        'interrupted_at',
        'interruption_reason',
        'status',
        'timeline_offset_ms',
        'uploaded_chunk_count',
      ].sort(),
    );
    expect(JSON.stringify(abandoned)).not.toContain('first_pcm_accepted_at');
    expect(JSON.stringify(abandoned)).not.toContain('object_key');

    const evidenced = await createFixture();
    const evidencedSessionId = evidenced.sessionIds[0];
    const evidencedStream = randomUUID();
    await startSession(evidencedSessionId, {
      audio_stream_id: evidencedStream,
      mime_type: MIME,
      request_id: randomUUID(),
    });
    await evidence.acceptAndPersist(evidencedSessionId, evidencedStream, () => Promise.resolve([]));
    await captures.reportInterrupted(actor, evidencedSessionId, {
      audio_stream_id: evidencedStream,
      generation_no: 0,
      reason: 'microphone_ended',
      request_id: randomUUID(),
    });
    await expect(
      captures.abandonEmpty(actor, evidencedSessionId, {
        audio_stream_id: evidencedStream,
        generation_no: 0,
        local_archive_chunk_count: 0,
        request_id: randomUUID(),
      }),
    ).rejects.toMatchObject({ response: { code: 'CAPTURE_EVIDENCE_EXISTS' } });
  });

  it('rejects abandoning a later generation when an earlier generation accepted PCM', async () => {
    const fixture = await createFixture();
    const sessionId = fixture.sessionIds[0];
    const stream0 = randomUUID();
    const started = await startSession(sessionId, {
      audio_stream_id: stream0,
      mime_type: MIME,
      request_id: randomUUID(),
    });
    const audioObjectId = started.capture?.audio_object_id;
    if (audioObjectId === undefined) throw new Error('Expected capture audio object');
    await evidence.acceptAndPersist(sessionId, stream0, () => Promise.resolve([]));
    await captures.reportInterrupted(actor, sessionId, {
      audio_stream_id: stream0,
      generation_no: 0,
      reason: 'microphone_ended',
      request_id: randomUUID(),
    });
    const stream1 = randomUUID();
    await captures.resume(actor, sessionId, {
      action: 'resume_capture',
      audio_stream_id: stream1,
      local_archive_chunk_count: 0,
      local_archive_timeline_high_water_ms: 0,
      request_id: randomUUID(),
    });
    await captures.reportInterrupted(actor, sessionId, {
      audio_stream_id: stream1,
      generation_no: 1,
      reason: 'page_recovery_detected',
      request_id: randomUUID(),
    });
    const audioBefore = await prisma.audioObject.findUniqueOrThrow({
      where: { id: audioObjectId },
    });

    await expect(
      captures.abandonEmpty(actor, sessionId, {
        audio_stream_id: stream1,
        generation_no: 1,
        local_archive_chunk_count: 0,
        request_id: randomUUID(),
      }),
    ).rejects.toMatchObject({ response: { code: 'CAPTURE_EVIDENCE_EXISTS' } });

    expect(
      await prisma.interviewSession.findUniqueOrThrow({ where: { id: sessionId } }),
    ).toMatchObject({ captureFailureCode: null, status: 'interrupted' });
    expect(
      await prisma.audioObject.findUniqueOrThrow({ where: { id: audioObjectId } }),
    ).toMatchObject({ id: audioBefore.id, status: audioBefore.status });
    expect(await prisma.sessionFinalization.findUnique({ where: { sessionId } })).toBeNull();
    const generations = await prisma.sessionCaptureGeneration.findMany({
      orderBy: { generationNo: 'asc' },
      where: { sessionId },
    });
    expect(generations).toHaveLength(2);
    expect(generations[0]).toMatchObject({
      audioObjectId,
      audioStreamId: stream0,
      generationNo: 0,
      status: 'interrupted',
    });
    expect(generations[0]?.firstPcmAcceptedAt).not.toBeNull();
    expect(generations[1]).toMatchObject({
      audioObjectId,
      audioStreamId: stream1,
      firstPcmAcceptedAt: null,
      generationNo: 1,
      status: 'interrupted',
    });
  });

  it('fails disabled reporting closed and keeps stop and terminal snapshots monotonic', async () => {
    const fixture = await createFixture();
    const sessionId = fixture.sessionIds[0];
    const stream = randomUUID();
    const started = await startSession(sessionId, {
      audio_stream_id: stream,
      mime_type: MIME,
      request_id: randomUUID(),
    });
    const audioObjectId = started.capture?.audio_object_id;
    if (audioObjectId === undefined) throw new Error('Expected capture audio object');
    await captures.confirmActive(actor, sessionId, {
      audio_stream_id: stream,
      generation_no: 0,
      request_id: randomUUID(),
    });
    await expect(
      captures.reportInterrupted({ ...actor, status: 'disabled' }, sessionId, {
        audio_stream_id: stream,
        generation_no: 0,
        reason: 'auth_lost',
        request_id: randomUUID(),
      }),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    expect(
      (
        await prisma.sessionCaptureGeneration.findUniqueOrThrow({
          where: { audioStreamId: stream },
        })
      ).status,
    ).toBe('active');

    const live = runtime.create(sessionId, stream);
    live.producer = {};
    const stopped = await finalization.stop(actor, sessionId, {
      audio_object_id: audioObjectId,
      chunks: [
        {
          checksum: 'b'.repeat(64),
          end_ms: 1_000,
          mime_type: MIME,
          sequence_no: 0,
          size_bytes: 10,
          start_ms: 0,
        },
      ],
      expected_chunk_count: 1,
      request_id: randomUUID(),
    });
    expect(stopped).toMatchObject({ capture: { status: 'stopped' }, status: 'stopping' });
    expect(runtime.find(sessionId)?.producer).toBeNull();
    const reportRequest = {
      audio_stream_id: stream,
      generation_no: 0,
      reason: 'page_recovery_detected' as const,
      request_id: randomUUID(),
    };
    const terminal = await captures.reportInterrupted(actor, sessionId, reportRequest);
    expect(terminal).toMatchObject({ capture: { status: 'stopped' }, status: 'stopping' });
    expect(await captures.reportInterrupted(actor, sessionId, reportRequest)).toEqual(terminal);
    await expect(
      captures.reportInterrupted(actor, sessionId, { ...reportRequest, reason: 'unknown' }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' } });
  });

  it('bounds a blocked first adapter and leaves stop as the only committed race winner', async () => {
    const fixture = await createFixture();
    const sessionId = fixture.sessionIds[0];
    const stream = randomUUID();
    const started = await startSession(sessionId, {
      audio_stream_id: stream,
      mime_type: MIME,
      request_id: randomUUID(),
    });
    const audioObjectId = started.capture?.audio_object_id;
    if (audioObjectId === undefined) throw new Error('Expected capture audio object');
    await captures.confirmActive(actor, sessionId, {
      audio_stream_id: stream,
      generation_no: 0,
      request_id: randomUUID(),
    });
    let acceptStarted: (() => void) | undefined;
    const adapterStarted = new Promise<void>((resolve) => {
      acceptStarted = resolve;
    });
    const hanging = evidence
      .acceptAndPersist(sessionId, stream, () => {
        acceptStarted?.();
        return new Promise<never>(() => undefined);
      })
      .then(
        () => ({ status: 'fulfilled' as const }),
        (error: unknown) => ({ error, status: 'rejected' as const }),
      );
    await adapterStarted;
    const stop = finalization.stop(actor, sessionId, {
      audio_object_id: audioObjectId,
      chunks: [commitment('c')],
      expected_chunk_count: 1,
      request_id: randomUUID(),
    });

    const stopped = await within(stop, 1_500);
    expect(stopped).toMatchObject({ capture: { status: 'stopped' }, status: 'stopping' });
    expect((await hanging).status).toBe('rejected');
    expect(
      (
        await prisma.sessionCaptureGeneration.findUniqueOrThrow({
          where: { audioStreamId: stream },
        })
      ).firstPcmAcceptedAt,
    ).toBeNull();

    const acceptedFixture = await createFixture();
    const acceptedSessionId = acceptedFixture.sessionIds[0];
    const acceptedStream = randomUUID();
    const acceptedStart = await startSession(acceptedSessionId, {
      audio_stream_id: acceptedStream,
      mime_type: MIME,
      request_id: randomUUID(),
    });
    const acceptedAudioObjectId = acceptedStart.capture?.audio_object_id;
    if (acceptedAudioObjectId === undefined) throw new Error('Expected capture audio object');
    let releaseFirst: (() => void) | undefined;
    let firstStarted: (() => void) | undefined;
    const firstAdapterStarted = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const firstAdapter = new Promise<readonly []>((resolve) => {
      releaseFirst = (): void => {
        resolve([]);
      };
    });
    const acceptedEvidence = evidence.acceptAndPersist(acceptedSessionId, acceptedStream, () => {
      firstStarted?.();
      return firstAdapter;
    });
    await firstAdapterStarted;
    const stopAfterAccepted = finalization.stop(actor, acceptedSessionId, {
      audio_object_id: acceptedAudioObjectId,
      chunks: [commitment('e')],
      expected_chunk_count: 1,
      request_id: randomUUID(),
    });
    await within(stopAfterAccepted, 1_000);
    releaseFirst?.();
    await expect(acceptedEvidence).rejects.toThrow('Capture evidence target is unavailable');
    expect(
      (
        await prisma.sessionCaptureGeneration.findUniqueOrThrow({
          where: { audioStreamId: acceptedStream },
        })
      ).firstPcmAcceptedAt,
    ).toBeNull();
  });

  it('keeps later frames off database locks and lets stop finish while the adapter is blocked', async () => {
    const fixture = await createFixture();
    const sessionId = fixture.sessionIds[0];
    const stream = randomUUID();
    const started = await startSession(sessionId, {
      audio_stream_id: stream,
      mime_type: MIME,
      request_id: randomUUID(),
    });
    const audioObjectId = started.capture?.audio_object_id;
    if (audioObjectId === undefined) throw new Error('Expected capture audio object');
    await evidence.acceptAndPersist(sessionId, stream, () => Promise.resolve([]));
    let acceptStarted: (() => void) | undefined;
    let releaseAccept: (() => void) | undefined;
    const adapterStarted = new Promise<void>((resolve) => {
      acceptStarted = resolve;
    });
    const blocked = new Promise<readonly []>((resolve) => {
      releaseAccept = (): void => {
        resolve([]);
      };
    });
    const laterFrame = evidence.acceptAndPersist(sessionId, stream, () => {
      acceptStarted?.();
      return blocked;
    });
    await adapterStarted;

    const stopped = await within(
      finalization.stop(actor, sessionId, {
        audio_object_id: audioObjectId,
        chunks: [commitment('d')],
        expected_chunk_count: 1,
        request_id: randomUUID(),
      }),
      1_000,
    );
    releaseAccept?.();
    await laterFrame;

    expect(stopped).toMatchObject({ capture: { status: 'stopped' }, status: 'stopping' });
    expect(
      (
        await prisma.sessionCaptureGeneration.findUniqueOrThrow({
          where: { audioStreamId: stream },
        })
      ).firstPcmAcceptedAt,
    ).not.toBeNull();
  });

  it('keeps report-interrupted replay cleanup bound to its original capture stream', async () => {
    const fixture = await createFixture();
    const sessionId = fixture.sessionIds[0];
    const stream0 = randomUUID();
    await startSession(sessionId, {
      audio_stream_id: stream0,
      mime_type: MIME,
      request_id: randomUUID(),
    });
    const reportRequest = {
      audio_stream_id: stream0,
      generation_no: 0,
      reason: 'page_recovery_detected' as const,
      request_id: randomUUID(),
    };
    const interrupted = await captures.reportInterrupted(actor, sessionId, reportRequest);
    const oldRuntime = runtime.create(sessionId, stream0);
    runtime.claim(oldRuntime, {});
    expect(await captures.reportInterrupted(actor, sessionId, reportRequest)).toEqual(interrupted);
    expect(oldRuntime.producer).toBeNull();

    const stream1 = randomUUID();
    await captures.resume(actor, sessionId, {
      action: 'resume_capture',
      audio_stream_id: stream1,
      local_archive_chunk_count: 0,
      local_archive_timeline_high_water_ms: 0,
      request_id: randomUUID(),
    });
    const currentRuntime = runtime.create(sessionId, stream1);
    const currentProducer = {};
    runtime.claim(currentRuntime, currentProducer);

    expect(await captures.reportInterrupted(actor, sessionId, reportRequest)).toEqual(interrupted);
    expect(currentRuntime.producer).toBe(currentProducer);
    expect(
      await prisma.sessionCaptureGeneration.findUniqueOrThrow({
        where: { audioStreamId: stream1 },
      }),
    ).toMatchObject({ generationNo: 1, status: 'preparing' });
  });

  it('replays revoke cleanup for the old stream without terminating a later authorized resume', async () => {
    const fixture = await createFixture();
    const sessionId = fixture.sessionIds[0];
    const stream0 = randomUUID();
    await startSession(sessionId, {
      audio_stream_id: stream0,
      mime_type: MIME,
      request_id: randomUUID(),
    });
    await evidence.acceptAndPersist(sessionId, stream0, () => Promise.resolve([]));
    let releaseAdapter: (() => void) | undefined;
    let adapterStarted: (() => void) | undefined;
    const laterAdapterStarted = new Promise<void>((resolve) => {
      adapterStarted = resolve;
    });
    const blockedAdapter = new Promise<readonly []>((resolve) => {
      releaseAdapter = (): void => {
        resolve([]);
      };
    });
    const laterFrame = evidence.acceptAndPersist(sessionId, stream0, () => {
      adapterStarted?.();
      return blockedAdapter;
    });
    await laterAdapterStarted;
    const oldRuntime = runtime.create(sessionId, stream0);
    runtime.claim(oldRuntime, {});
    const requestId = randomUUID();
    const revoked = await within(
      projects.revokeConsent(actor, fixture.consentId, requestId),
      1_000,
    );
    releaseAdapter?.();
    await laterFrame;
    expect(oldRuntime.producer).toBeNull();

    runtime.claim(oldRuntime, {});
    expect(await projects.revokeConsent(actor, fixture.consentId, requestId)).toEqual(revoked);
    expect(oldRuntime.producer).toBeNull();
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'consent.revoke', requestId },
    });
    expect(audit.metadata).toMatchObject({
      interrupted_captures: [{ audio_stream_id: stream0, generation_no: 0, session_id: sessionId }],
    });

    await prisma.consentRecord.create({
      data: {
        consentMethod: 'electronic',
        consentTextVersion: FICTIONAL_CONTINUING_CONSENT_VERSION,
        consentType: 'recording_transcription_ai',
        consentedAt: new Date(),
        createdBy: actorId,
        projectId: fixture.projectId,
        status: 'valid',
      },
    });
    await prisma.elderProject.update({
      data: { status: 'active', statusBeforeRestriction: null },
      where: { id: fixture.projectId },
    });
    const stream1 = randomUUID();
    await captures.resume(actor, sessionId, {
      action: 'resume_capture',
      audio_stream_id: stream1,
      local_archive_chunk_count: 0,
      local_archive_timeline_high_water_ms: 0,
      request_id: randomUUID(),
    });
    const currentRuntime = runtime.create(sessionId, stream1);
    const currentProducer = {};
    runtime.claim(currentRuntime, currentProducer);

    expect(await projects.revokeConsent(actor, fixture.consentId, requestId)).toEqual(revoked);
    expect(currentRuntime.producer).toBe(currentProducer);
    expect(
      await prisma.sessionCaptureGeneration.findUniqueOrThrow({
        where: { audioStreamId: stream1 },
      }),
    ).toMatchObject({ generationNo: 1, status: 'preparing' });
  });

  it('serializes revoke with start, stop, upload, and PCM acceptance behind a real project barrier', async () => {
    const fixture = await createFixture(2);
    const captureSessionId = fixture.sessionIds[0];
    const startSessionId = fixture.sessionIds[1];
    const stream = randomUUID();
    const started = await startSession(captureSessionId, {
      audio_stream_id: stream,
      mime_type: MIME,
      request_id: randomUUID(),
    });
    await captures.confirmActive(actor, captureSessionId, {
      audio_stream_id: stream,
      generation_no: 0,
      request_id: randomUUID(),
    });
    const audioObjectId = started.capture?.audio_object_id;
    if (audioObjectId === undefined) throw new Error('Expected capture audio object');
    const bytes = Buffer.from('fictional0');
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const revokeRequestId = randomUUID();
    const barrier = holdProjectLock(fixture.projectId);
    await barrier.acquired;
    const operations = [
      startSession(startSessionId, {
        audio_stream_id: randomUUID(),
        mime_type: MIME,
        request_id: randomUUID(),
      }),
      finalization.stop(actor, captureSessionId, {
        audio_object_id: audioObjectId,
        chunks: [
          {
            checksum,
            end_ms: 1_000,
            mime_type: MIME,
            sequence_no: 0,
            size_bytes: bytes.byteLength,
            start_ms: 0,
          },
        ],
        expected_chunk_count: 1,
        request_id: randomUUID(),
      }),
      audio.uploadChunk(
        actor,
        audioObjectId,
        {
          checksum,
          endMs: 1_000,
          mimeType: MIME,
          requestId: randomUUID(),
          sequenceNo: 0,
          startMs: 0,
        },
        bytes,
      ),
      evidence.acceptAndPersist(captureSessionId, stream, () => Promise.resolve([])),
      projects.revokeConsent(actor, fixture.consentId, revokeRequestId),
    ];
    await new Promise((resolve) => setTimeout(resolve, 30));
    barrier.release();
    await barrier.completed;
    const outcomes = await Promise.allSettled(operations);
    expect(outcomes[4]).toMatchObject({ status: 'fulfilled' });
    const replayRuntime = runtime.create(captureSessionId, stream);
    const replayProducer = {};
    runtime.claim(replayRuntime, replayProducer);
    await projects.revokeConsent(actor, fixture.consentId, revokeRequestId);
    const revokeAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'consent.revoke', requestId: revokeRequestId },
    });
    const interruptedCaptures =
      typeof revokeAudit.metadata === 'object' &&
      revokeAudit.metadata !== null &&
      !Array.isArray(revokeAudit.metadata) &&
      Array.isArray(revokeAudit.metadata.interrupted_captures)
        ? revokeAudit.metadata.interrupted_captures
        : [];
    const originallyInterrupted = interruptedCaptures.some(
      (target) =>
        typeof target === 'object' &&
        target !== null &&
        !Array.isArray(target) &&
        target.audio_stream_id === stream,
    );
    expect(runtime.find(captureSessionId)?.producer).toBe(
      originallyInterrupted ? null : replayProducer,
    );

    const sessions = await prisma.interviewSession.findMany({
      where: { id: { in: fixture.sessionIds } },
    });
    expect(
      sessions.every((session) => !['recording', 'reconnecting'].includes(session.status)),
    ).toBe(true);
    for (const sessionId of fixture.sessionIds) {
      expect(
        await prisma.audioObject.count({ where: { purpose: 'interview', sessionId } }),
      ).toBeLessThanOrEqual(1);
      expect(
        await prisma.sessionCaptureGeneration.count({
          where: { sessionId, status: { in: ['preparing', 'active'] } },
        }),
      ).toBe(0);
      expect(await prisma.sessionFinalization.count({ where: { sessionId } })).toBeLessThanOrEqual(
        1,
      );
    }
  });

  async function createFixture(
    sessionCount = 1,
    consentTextVersion = FICTIONAL_CONTINUING_CONSENT_VERSION,
  ): Promise<{
    consentId: string;
    projectId: string;
    sessionIds: string[];
  }> {
    const project = await prisma.elderProject.create({
      data: {
        createdBy: actorId,
        displayName: '虚构采集项目',
        status: 'ready',
      },
    });
    await prisma.projectAssignment.create({ data: { projectId: project.id, userId: actorId } });
    await prisma.serviceTerm.create({
      data: {
        currency: 'CNY',
        effectiveFrom: new Date(),
        estimatedSessionCount: sessionCount,
        expectedCurrentMinutes: 30,
        explainedAt: new Date(),
        explainedBy: actorId,
        includedMinutes: 30,
        overtimePriceMinor: 0,
        overtimeUnitMinutes: 30,
        projectId: project.id,
      },
    });
    const consent = await prisma.consentRecord.create({
      data: {
        consentMethod: 'electronic',
        consentTextVersion,
        consentType: 'recording_transcription_ai',
        consentedAt: new Date(),
        createdBy: actorId,
        projectId: project.id,
        status: 'valid',
      },
    });
    const sessionIds: string[] = [];
    for (let sequenceNo = 1; sequenceNo <= sessionCount; sequenceNo += 1) {
      const session = await prisma.interviewSession.create({
        data: { createdBy: actorId, projectId: project.id, sequenceNo, status: 'device_check' },
      });
      sessionIds.push(session.id);
    }
    return { consentId: consent.id, projectId: project.id, sessionIds };
  }

  function holdProjectLock(projectId: string): {
    acquired: Promise<void>;
    completed: Promise<void>;
    release: () => void;
  } {
    let markAcquired: (() => void) | undefined;
    let releaseLock: (() => void) | undefined;
    const acquired = new Promise<void>((resolve) => {
      markAcquired = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const completed = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project:${projectId}`}, 0))`;
      markAcquired?.();
      await released;
    });
    return { acquired, completed, release: () => releaseLock?.() };
  }

  function commitment(seed: string): {
    checksum: string;
    end_ms: number;
    mime_type: string;
    sequence_no: number;
    size_bytes: number;
    start_ms: number;
  } {
    return {
      checksum: seed.repeat(64),
      end_ms: 1_000,
      mime_type: MIME,
      sequence_no: 0,
      size_bytes: 10,
      start_ms: 0,
    };
  }

  async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error('operation exceeded test deadline'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
});
