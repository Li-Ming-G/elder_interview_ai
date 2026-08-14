import { randomUUID } from 'node:crypto';
import { loadApiConfig } from '@elder-interview/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthPrincipal } from '../../apps/api/src/auth/auth.types.js';
import { PrismaService } from '../../apps/api/src/database/prisma.service.js';
import { SpeakerCalibrationService } from '../../apps/api/src/project-foundation/speaker-calibration.service.js';
import {
  CausalQueue,
  CausalQueueTimeoutError,
  RealtimeRuntimeService,
  type SessionRuntime,
} from '../../apps/api/src/realtime-transcription/realtime-runtime.service.js';
import { SpeakerCalibrationSnapshotService } from '../../apps/api/src/transcription/speaker-calibration-snapshot.service.js';
import { TranscriptIngestionService } from '../../apps/api/src/transcription/transcript-ingestion.service.js';
import { projectTrustedSpeakerRole } from '../../apps/api/src/transcription/trusted-speaker-role.js';

describe('speaker calibration causal boundary and trusted role core', () => {
  let prisma: PrismaService;
  let runtimes: RealtimeRuntimeService;
  let calibration: SpeakerCalibrationService;
  let ingestion: TranscriptIngestionService;
  let snapshots: SpeakerCalibrationSnapshotService;
  let actor: AuthPrincipal;

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
    const config = loadApiConfig({
      APP_ENV: 'test',
      AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
      AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-speaker-calibration-pepper',
      AI_RETENTION_CLEANUP_PEPPER: 'test-only-speaker-calibration-retention-pepper',
      DATABASE_URL: databaseUrl,
    });
    prisma = new PrismaService(config);
    await prisma.$connect();
    runtimes = new RealtimeRuntimeService(prisma);
    snapshots = new SpeakerCalibrationSnapshotService(prisma);
    calibration = new SpeakerCalibrationService(prisma, runtimes, snapshots);
    ingestion = new TranscriptIngestionService(prisma, config);
  });

  beforeEach(async () => {
    await clean(prisma);
    const user = await prisma.user.create({
      data: {
        displayName: '虚构校准访谈员',
        email: `speaker-${randomUUID()}@example.test`,
        passwordHash: 'test-only',
        role: 'interviewer',
      },
    });
    actor = {
      displayName: user.displayName,
      id: user.id,
      role: user.role,
      sessionId: randomUUID(),
      sessionTokenHash: 'test-only',
      status: 'active',
    };
  });

  afterAll(async () => {
    await clean(prisma);
    await prisma.$disconnect();
  });

  it('linearizes begin/resolve with PCM facts and confirms exactly two trusted mappings once', async () => {
    const fixture = await createFixture(prisma, runtimes, actor);
    const priorFrame = runtimes.enqueue(fixture.runtime, async () => {
      await ingest('prior', fixture, 0, 100, 'speaker_1');
      runtimes.recordFrame(fixture.runtime, frame(fixture.audioStreamId, 0));
    });
    const beginRequestId = randomUUID();
    const began = calibration.begin(actor, fixture.sessionId, {
      request_id: beginRequestId,
      speaker_stream_id: fixture.runtime.speakerStreamId,
    });
    await priorFrame;
    const collecting = await began;
    expect(collecting).toMatchObject({
      status: 'collecting',
      attempt: { boundary: { start_sequence_no: 1, start_timeline_ms: 100 } },
    });
    const attemptId = collecting.attempt?.id;
    if (attemptId === undefined) throw new Error('collecting attempt missing');

    await runtimes.enqueue(fixture.runtime, async () => {
      await ingest('calibration-1', fixture, 100, 200, 'speaker_1');
      runtimes.recordFrame(fixture.runtime, frame(fixture.audioStreamId, 1));
      await ingest('calibration-2', fixture, 200, 300, 'speaker_2');
      runtimes.recordFrame(fixture.runtime, frame(fixture.audioStreamId, 2));
    });
    const resolveRequestId = randomUUID();
    const confirmed = await calibration.resolve(actor, attemptId, {
      action: 'confirm',
      mappings: [
        { speaker_provider_id: 'speaker_1', speaker_role: 'interviewer' },
        { speaker_provider_id: 'speaker_2', speaker_role: 'elder' },
      ],
      request_id: resolveRequestId,
    });
    expect(confirmed).toMatchObject({
      speaker_role_revision: 1,
      status: 'confirmed',
      attempt: { boundary: { end_sequence_no_exclusive: 3, end_timeline_ms: 300 } },
    });
    expect(confirmed.attempt?.confirmed_mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ authority: 'user_confirmed', speaker_role: 'elder' }),
        expect.objectContaining({ authority: 'user_confirmed', speaker_role: 'interviewer' }),
      ]),
    );
    expect(
      await prisma.speakerMapping.count({
        where: { authority: 'user_confirmed', speakerStreamId: fixture.runtime.speakerStreamId },
      }),
    ).toBe(2);
    expect(
      (await prisma.interviewSession.findUniqueOrThrow({ where: { id: fixture.sessionId } }))
        .speakerRoleRevision,
    ).toBe(1);

    const replay = await calibration.resolve(actor, attemptId, {
      action: 'confirm',
      mappings: [
        { speaker_provider_id: 'speaker_1', speaker_role: 'interviewer' },
        { speaker_provider_id: 'speaker_2', speaker_role: 'elder' },
      ],
      request_id: resolveRequestId,
    });
    expect(replay).toEqual(confirmed);
    expect(
      (await prisma.interviewSession.findUniqueOrThrow({ where: { id: fixture.sessionId } }))
        .speakerRoleRevision,
    ).toBe(1);
    await expect(
      calibration.resolve(actor, attemptId, {
        action: 'skip',
        mappings: [],
        request_id: resolveRequestId,
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' } });

    expect(
      await calibration.begin(actor, fixture.sessionId, {
        request_id: beginRequestId,
        speaker_stream_id: fixture.runtime.speakerStreamId,
      }),
    ).toEqual(collecting);
    expect((await calibration.get(actor, fixture.sessionId)).status).toBe('confirmed');
    expect(
      await calibration.begin(actor, fixture.sessionId, {
        request_id: randomUUID(),
        speaker_stream_id: fixture.runtime.speakerStreamId,
      }),
    ).toMatchObject({ status: 'confirmed', speaker_role_revision: 1 });
    expect(
      await prisma.speakerCalibrationAttempt.count({
        where: { speakerStreamId: fixture.runtime.speakerStreamId },
      }),
    ).toBe(1);
    expect(
      JSON.stringify(
        await prisma.auditLog.findMany({ where: { entityType: 'speaker_calibration' } }),
      ),
    ).not.toContain('speaker_1');
  });

  it('allows a provider label to be confirmed again on a replacement speaker stream', async () => {
    const fixture = await createFixture(prisma, runtimes, actor);
    await prisma.speakerMapping.create({
      data: {
        authority: 'user_confirmed',
        createdBy: actor.id,
        sessionId: fixture.sessionId,
        source: 'calibration',
        speakerProviderId: 'speaker_1',
        speakerRole: 'interviewer',
        speakerStreamId: fixture.runtime.speakerStreamId,
      },
    });
    await prisma.speakerStream.update({
      data: { closedAt: new Date(), status: 'closed' },
      where: { id: fixture.runtime.speakerStreamId },
    });
    const replacement = await prisma.speakerStream.create({
      data: {
        captureGenerationId: fixture.runtime.captureGenerationId,
        sessionId: fixture.sessionId,
      },
    });

    await expect(
      prisma.speakerMapping.create({
        data: {
          authority: 'user_confirmed',
          createdBy: actor.id,
          sessionId: fixture.sessionId,
          source: 'calibration',
          speakerProviderId: 'speaker_1',
          speakerRole: 'interviewer',
          speakerStreamId: replacement.id,
        },
      }),
    ).resolves.toMatchObject({ speakerStreamId: replacement.id });
    expect(
      await prisma.speakerMapping.count({
        where: { sessionId: fixture.sessionId, speakerProviderId: 'speaker_1' },
      }),
    ).toBe(2);
  });

  it('classifies delayed and cross-boundary finals by the immutable half-open interval', async () => {
    const fixture = await createFixture(prisma, runtimes, actor);
    runtimes.recordFrame(fixture.runtime, frame(fixture.audioStreamId, 0));
    const collecting = await calibration.begin(actor, fixture.sessionId, {
      request_id: randomUUID(),
      speaker_stream_id: fixture.runtime.speakerStreamId,
    });
    const attemptId = collecting.attempt?.id;
    if (attemptId === undefined) throw new Error('collecting attempt missing');
    await ingest('inside-1', fixture, 100, 200, 'speaker_1');
    await ingest('inside-2', fixture, 200, 300, 'speaker_2');
    runtimes.recordFrame(fixture.runtime, frame(fixture.audioStreamId, 2));
    await calibration.resolve(actor, attemptId, {
      action: 'confirm',
      mappings: [
        { speaker_provider_id: 'speaker_1', speaker_role: 'interviewer' },
        { speaker_provider_id: 'speaker_2', speaker_role: 'elder' },
      ],
      request_id: randomUUID(),
    });

    await ingest('delayed-before', fixture, 0, 100, 'speaker_1');
    await ingest('delayed-inside', fixture, 150, 180, 'speaker_1');
    await ingest('cross-start', fixture, 50, 150, 'speaker_2');
    await ingest('after-end', fixture, 300, 400, 'speaker_2');
    const segments = await prisma.transcriptSegment.findMany({
      orderBy: { ingestKey: 'asc' },
      select: { contentKind: true, ingestKey: true },
      where: { sessionId: fixture.sessionId },
    });
    expect(
      Object.fromEntries(segments.map((segment) => [segment.ingestKey, segment.contentKind])),
    ).toMatchObject({
      'after-end': 'conversation',
      'cross-start': 'speaker_calibration',
      'delayed-before': 'conversation',
      'delayed-inside': 'speaker_calibration',
    });
    expect(await prisma.speakerCalibrationAttemptSegment.count({ where: { attemptId } })).toBe(4);

    runtimes.release(fixture.runtime, fixture.producer);
    await prisma.sessionCaptureGeneration.update({
      data: {
        interruptedAt: new Date(),
        interruptionReason: 'page_recovery_detected',
        status: 'interrupted',
      },
      where: { audioStreamId: fixture.audioStreamId },
    });
    const nextGeneration = await prisma.sessionCaptureGeneration.create({
      data: {
        audioObjectId: fixture.audioObjectId,
        audioStreamId: randomUUID(),
        confirmedActiveAt: new Date(),
        generationNo: 1,
        sessionId: fixture.sessionId,
        status: 'active',
        timelineOffsetMs: 400,
      },
    });
    const next = await runtimes.create(
      fixture.sessionId,
      nextGeneration.audioStreamId,
      nextGeneration.id,
      new CausalQueue(),
      400,
    );
    runtimes.claim(next, {});
    const nextSnapshot = await calibration.get(actor, fixture.sessionId);
    expect(next.speakerStreamId).not.toBe(fixture.runtime.speakerStreamId);
    expect(nextSnapshot).toMatchObject({ status: 'not_started', speaker_role_revision: 1 });
    expect(nextSnapshot.attempt).toBeNull();
  });

  it('publishes marker and observed-label snapshots in causal order with immutable replay facts', async () => {
    const fixture = await createFixture(prisma, runtimes, actor);
    const published: Array<{
      payload: unknown;
      server_sequence: number;
      type: string;
    }> = [];
    runtimes.subscribe(fixture.runtime, (event) => published.push(event));

    const beginPromise = calibration.begin(actor, fixture.sessionId, {
      request_id: randomUUID(),
      speaker_stream_id: fixture.runtime.speakerStreamId,
    });
    await waitFor(
      async () =>
        (await prisma.speakerCalibrationAttempt.count({
          where: { sessionId: fixture.sessionId },
        })) > 0,
    );
    const followingPcm = runtimes.enqueue(fixture.runtime, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const persisted = await ingestion.ingest({
        endMs: 100,
        ingestKey: 'causal-label-after-begin',
        kind: 'final',
        sessionId: fixture.sessionId,
        source: 'fixture',
        speakerProviderId: 'speaker_1',
        speakerStreamId: fixture.runtime.speakerStreamId,
        startMs: 0,
        text: 'synthetic causal label',
      });
      if (persisted.kind !== 'final') throw new Error('expected persisted final');
      const role = projectTrustedSpeakerRole(persisted.segment);
      const finalEvent = runtimes.append(fixture.runtime, 'asr.final', {
        content_kind: persisted.segment.contentKind,
        effective_speaker_role: role.effectiveSpeakerRole,
        end_ms: persisted.segment.endMs,
        finality: 'final' as const,
        segment_id: persisted.segment.id,
        speaker_provider_id: persisted.segment.speakerProviderId,
        speaker_role: persisted.segment.originalSpeakerRole,
        speaker_role_authority: persisted.segment.originalRoleAuthority,
        speaker_role_revision: persisted.segment.speakerRoleRevision,
        speaker_stream_id: persisted.segment.speakerStreamId,
        start_ms: persisted.segment.startMs,
        text: persisted.segment.originalText,
        trusted_effective_speaker_role: role.trustedEffectiveSpeakerRole,
        trusted_speaker_role: role.trustedEffectiveSpeakerRole,
      });
      published.push(finalEvent);
      runtimes.publishCalibration(fixture.runtime, await snapshots.get(fixture.runtime.sessionId));
    });

    const began = await beginPromise;
    await followingPcm;
    expect(published.map(({ server_sequence: sequence }) => sequence)).toEqual([0, 1, 2]);
    expect(published.map(({ type }) => type)).toEqual([
      'speaker.calibration.updated',
      'asr.final',
      'speaker.calibration.updated',
    ]);
    const markerSnapshot = published[0]?.payload as {
      observed_provider_labels?: string[];
      attempt?: { observed_provider_labels: string[] };
      updated_at: string;
    };
    const observedSnapshot = published[2]?.payload as {
      attempt: { observed_provider_labels: string[] };
      updated_at: string;
    };
    expect(markerSnapshot.attempt?.observed_provider_labels).toEqual([]);
    expect(observedSnapshot.attempt.observed_provider_labels).toEqual(['speaker_1']);
    expect(Date.parse(observedSnapshot.updated_at)).toBeGreaterThan(Date.parse(began.updated_at));
    const replay = runtimes.replayAfter(fixture.runtime, -1);
    expect(
      (replay?.[0]?.envelope.payload as { attempt: { observed_provider_labels: string[] } }).attempt
        .observed_provider_labels,
    ).toEqual([]);
    expect(
      (await calibration.get(actor, fixture.sessionId)).attempt?.observed_provider_labels,
    ).toEqual(['speaker_1']);
  });

  it('cancels a marker that misses its queue deadline before execution', async () => {
    const queue = new CausalQueue();
    let release!: () => void;
    const blocker = queue.enqueue(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    let mutated = false;
    const marker = queue.enqueueBefore(Date.now() + 20, () => {
      mutated = true;
      return Promise.resolve();
    });
    await expect(marker).rejects.toBeInstanceOf(CausalQueueTimeoutError);
    release();
    await blocker;
    await queue.enqueue(() => undefined);
    expect(mutated).toBe(false);
  });

  it('keeps recording and trusted facts unchanged across skip, fail, and retry', async () => {
    const fixture = await createFixture(prisma, runtimes, actor);
    const skippedAttempt = await calibration.begin(actor, fixture.sessionId, {
      request_id: randomUUID(),
      speaker_stream_id: fixture.runtime.speakerStreamId,
    });
    const skippedAttemptId = skippedAttempt.attempt?.id;
    if (skippedAttemptId === undefined) throw new Error('collecting attempt missing');
    const skipped = await calibration.resolve(actor, skippedAttemptId, {
      action: 'skip',
      mappings: [],
      request_id: randomUUID(),
    });
    expect(skipped).toMatchObject({ speaker_role_revision: 0, status: 'skipped' });

    const failedAttempt = await calibration.begin(actor, fixture.sessionId, {
      request_id: randomUUID(),
      speaker_stream_id: fixture.runtime.speakerStreamId,
    });
    expect(failedAttempt.attempt?.attempt_no).toBe(2);
    const failedAttemptId = failedAttempt.attempt?.id;
    if (failedAttemptId === undefined) throw new Error('retry attempt missing');
    const failed = await calibration.resolve(actor, failedAttemptId, {
      action: 'fail',
      mappings: [],
      request_id: randomUUID(),
    });
    expect(failed).toMatchObject({ speaker_role_revision: 0, status: 'failed' });

    const retried = await calibration.begin(actor, fixture.sessionId, {
      request_id: randomUUID(),
      speaker_stream_id: fixture.runtime.speakerStreamId,
    });
    expect(retried).toMatchObject({
      speaker_role_revision: 0,
      status: 'collecting',
      attempt: { attempt_no: 3 },
    });
    expect(
      await prisma.interviewSession.findUniqueOrThrow({ where: { id: fixture.sessionId } }),
    ).toMatchObject({ speakerRoleRevision: 0, status: 'recording' });
    expect(await prisma.speakerMapping.count({ where: { sessionId: fixture.sessionId } })).toBe(0);
  });

  it('rolls back the whole marker transaction when its persisted boundary facts fail', async () => {
    const fixture = await createFixture(prisma, runtimes, actor);
    runtimes.release(fixture.runtime, fixture.producer);
    await prisma.sessionCaptureGeneration.update({
      data: {
        interruptedAt: new Date(),
        interruptionReason: 'page_recovery_detected',
        status: 'interrupted',
      },
      where: { id: fixture.runtime.captureGenerationId },
    });
    const audioStreamId = randomUUID();
    const generation = await prisma.sessionCaptureGeneration.create({
      data: {
        audioObjectId: fixture.audioObjectId,
        audioStreamId,
        confirmedActiveAt: new Date(),
        generationNo: 1,
        sessionId: fixture.sessionId,
        status: 'active',
        timelineOffsetMs: 100,
      },
    });
    const runtimeWithWrongOffset = await runtimes.create(
      fixture.sessionId,
      audioStreamId,
      generation.id,
      new CausalQueue(),
      0,
    );
    runtimes.claim(runtimeWithWrongOffset, {});
    const requestId = randomUUID();
    await expect(
      calibration.begin(actor, fixture.sessionId, {
        request_id: requestId,
        speaker_stream_id: runtimeWithWrongOffset.speakerStreamId,
      }),
    ).rejects.toBeTruthy();
    expect(
      await prisma.speakerCalibrationAttempt.count({ where: { sessionId: fixture.sessionId } }),
    ).toBe(0);
    expect(await prisma.idempotencyRecord.count({ where: { requestId } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { action: 'speaker_calibration.begin', entityId: fixture.sessionId },
      }),
    ).toBe(0);
  });

  async function ingest(
    key: string,
    fixture: Fixture,
    startMs: number,
    endMs: number,
    label: string,
  ): Promise<void> {
    const result = await ingestion.ingest({
      endMs,
      ingestKey: key,
      kind: 'final',
      providerSegmentId: key,
      sessionId: fixture.sessionId,
      source: 'fixture',
      speakerProviderId: label,
      speakerStreamId: fixture.runtime.speakerStreamId,
      startMs,
      text: `虚构片段 ${key}`,
    });
    if (result.kind !== 'final') throw new Error('final fixture was not persisted');
  }
});

interface Fixture {
  audioObjectId: string;
  audioStreamId: string;
  producer: object;
  runtime: SessionRuntime;
  sessionId: string;
}

async function createFixture(
  prisma: PrismaService,
  runtimes: RealtimeRuntimeService,
  actor: AuthPrincipal,
): Promise<Fixture> {
  const project = await prisma.elderProject.create({
    data: {
      assignments: { create: { userId: actor.id } },
      consents: {
        create: {
          consentMethod: 'electronic',
          consentTextVersion: 'test-v1',
          consentedAt: new Date(),
          createdBy: actor.id,
          status: 'valid',
        },
      },
      createdBy: actor.id,
      displayName: '虚构校准项目',
      status: 'active',
    },
  });
  const session = await prisma.interviewSession.create({
    data: { createdBy: actor.id, projectId: project.id, sequenceNo: 1, status: 'recording' },
  });
  const audio = await prisma.audioObject.create({
    data: {
      createdBy: actor.id,
      mimeType: 'audio/webm;codecs=opus',
      projectId: project.id,
      purpose: 'interview',
      sessionId: session.id,
    },
  });
  const audioStreamId = randomUUID();
  const generation = await prisma.sessionCaptureGeneration.create({
    data: {
      audioObjectId: audio.id,
      audioStreamId,
      confirmedActiveAt: new Date(),
      generationNo: 0,
      sessionId: session.id,
      status: 'active',
      timelineOffsetMs: 0,
    },
  });
  const runtime = await runtimes.create(
    session.id,
    audioStreamId,
    generation.id,
    new CausalQueue(),
  );
  const producer = {};
  runtimes.claim(runtime, producer);
  return { audioObjectId: audio.id, audioStreamId, producer, runtime, sessionId: session.id };
}

function frame(
  audioStreamId: string,
  sequenceNo: number,
): {
  audio_stream_id: string;
  channels: 1;
  encoding: 'pcm_s16le';
  end_ms: number;
  pcm_base64: string;
  pcm_sha256: string;
  sample_count: 1600;
  sample_rate_hz: 16000;
  sequence_no: number;
  start_ms: number;
} {
  return {
    audio_stream_id: audioStreamId,
    channels: 1 as const,
    encoding: 'pcm_s16le' as const,
    end_ms: sequenceNo * 100 + 100,
    pcm_base64: '',
    pcm_sha256: '0'.repeat(64),
    sample_count: 1600 as const,
    sample_rate_hz: 16000 as const,
    sequence_no: sequenceNo,
    start_ms: sequenceNo * 100,
  };
}

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

async function waitFor(predicate: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for persisted marker');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
