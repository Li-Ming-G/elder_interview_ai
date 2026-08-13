import { expect, test, type Page } from '@playwright/test';

import { createTestPrismaClient } from '../../apps/api/test-support/prisma-client.js';

const requestedDurationMs = Number(process.env.DEV005R4_DESKTOP_DURATION_MS ?? 300_000);
const interviewDurationMs = Number.isFinite(requestedDurationMs)
  ? Math.max(10_000, requestedDurationMs)
  : 300_000;
const acceptanceProjectIds = new Set<string>();

test.afterEach(async () => {
  for (const projectId of acceptanceProjectIds) await cleanupAcceptanceProject(projectId);
  acceptanceProjectIds.clear();
});

interface BrowserEvidence {
  audioSources: Array<{ streamKey: number; trackId: string }>;
  fetches: Array<{ at: number; method: string; path: string }>;
  getUserMedia: Array<{ streamKey: number; trackId: string }>;
  mediaRecorders: Array<{ streamKey: number; trackId: string }>;
  recorderData: Array<{ at: number; size: number; streamKey: number }>;
  wsAudioFrames: Array<{
    audioStreamId: string;
    endMs: number;
    sequenceNo: number;
    startMs: number;
  }>;
}

interface LocalEvidence {
  archiveCount: number;
  archiveHighWater: number;
  checkpoint: null | {
    audioStreamId: string;
    dirty: boolean;
    localJobId: string;
    status: string;
    timelineEndMs: number;
  };
  deliveryAcknowledgedHighWater: number;
  deliveryCount: number;
  job: null | {
    audioObjectId: string | null;
    audioStreamId: string | null;
    generationNo: number | null;
    jobId: string;
    status: string;
    timelineOffsetMs: number | null;
  };
  timelineEndMs: number;
}

test('formal preparation route preserves one archive across explicit recovery and safe finalization', async ({
  page,
}) => {
  test.setTimeout(interviewDurationMs + 180_000);
  await installNativeMediaEvidence(page);
  const stopRequests: Array<{ expectedChunkCount: number; sequenceCount: number }> = [];
  page.on('request', (request) => {
    if (!/\/api\/v1\/sessions\/[0-9a-f-]+\/stop$/iu.test(request.url())) return;
    const body = request.postDataJSON() as {
      chunks?: unknown[];
      expected_chunk_count?: number;
    };
    stopRequests.push({
      expectedChunkCount: body.expected_chunk_count ?? -1,
      sequenceCount: body.chunks?.length ?? -1,
    });
  });

  const { csrfToken, projectId } = await loginAndCreateFormalProject(page);
  await page.goto(`/projects/${projectId}/interview/prepare`);
  await expect(page.getByRole('button', { name: '检测麦克风' })).toBeVisible();
  expect((await browserEvidence(page)).getUserMedia).toHaveLength(0);

  await page.getByRole('button', { name: '检测麦克风' }).click();
  await expect(page.getByRole('button', { name: '开始访谈' })).toBeEnabled({ timeout: 12_000 });
  const preparationMedia = await browserEvidence(page);
  expect(preparationMedia.getUserMedia).toHaveLength(1);
  expect(preparationMedia.mediaRecorders).toHaveLength(0);

  const preparationPath = new URL(page.url()).pathname;
  const sessionId = preparationPath.split('/')[4];
  if (sessionId === undefined) throw new Error('Formal preparation did not bind a session');
  const localJobId = `interview-capture:${sessionId}`;

  await page.getByRole('button', { name: '开始访谈' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${projectId}/interview/${sessionId}/workbench$`),
  );
  await expect(page.getByRole('button', { name: '结束访谈' })).toBeVisible();
  await expect.poll(async () => (await browserEvidence(page)).mediaRecorders.length).toBe(1);
  await expect
    .poll(async () => (await browserEvidence(page)).wsAudioFrames.length)
    .toBeGreaterThan(0);

  const generation0Media = await browserEvidence(page);
  assertOneStreamFeedsArchiveAndPcm(generation0Media);
  const generation0 = await serverSnapshot(sessionId);
  expect(generation0.audioObjectCount).toBe(1);
  expect(generation0.currentCapture).toMatchObject({ generationNo: 0, status: 'active' });
  const audioObjectId = generation0.currentCapture?.audioObjectId;
  const generation0AudioStreamId = generation0.currentCapture?.audioStreamId;
  if (audioObjectId === undefined || generation0AudioStreamId === undefined) {
    throw new Error('Generation 0 identity is unavailable');
  }

  const beforeRefreshDurationMs = Math.floor(interviewDurationMs / 2);
  await page.waitForTimeout(beforeRefreshDurationMs);
  await expect
    .poll(async () => (await localEvidence(page, sessionId, localJobId)).deliveryCount)
    .toBe(0);
  const beforeRefreshLocal = await localEvidence(page, sessionId, localJobId);
  expect(beforeRefreshLocal.archiveCount).toBeGreaterThan(0);
  expect(beforeRefreshLocal.archiveHighWater).toBe(beforeRefreshLocal.archiveCount - 1);
  expect(beforeRefreshLocal.deliveryAcknowledgedHighWater).toBeGreaterThanOrEqual(0);
  expect(beforeRefreshLocal.job).toMatchObject({
    audioObjectId,
    audioStreamId: generation0AudioStreamId,
    generationNo: 0,
    jobId: localJobId,
  });

  await page.reload();
  await expect(page.getByRole('button', { name: '继续同一次访谈' })).toBeVisible({
    timeout: 20_000,
  });
  const recoveryMedia = await browserEvidence(page);
  expect(recoveryMedia.getUserMedia).toHaveLength(0);
  expect(recoveryMedia.mediaRecorders).toHaveLength(0);
  const interrupted = await serverSnapshot(sessionId);
  expect(interrupted.currentCapture).toMatchObject({
    audioObjectId,
    audioStreamId: generation0AudioStreamId,
    generationNo: 0,
    interruptionReason: 'page_recovery_detected',
    status: 'interrupted',
  });
  const recoveryLocal = await localEvidence(page, sessionId, localJobId);
  expect(recoveryLocal).toMatchObject({
    archiveCount: beforeRefreshLocal.archiveCount,
    archiveHighWater: beforeRefreshLocal.archiveHighWater,
    timelineEndMs: beforeRefreshLocal.timelineEndMs,
  });

  await page.getByRole('button', { name: '继续同一次访谈' }).click();
  await expect(page.getByRole('button', { name: '结束访谈' })).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await browserEvidence(page)).mediaRecorders.length).toBe(1);
  await expect
    .poll(async () => (await browserEvidence(page)).wsAudioFrames.length)
    .toBeGreaterThan(0);
  const generation1Media = await browserEvidence(page);
  assertOneStreamFeedsArchiveAndPcm(generation1Media);
  expect(generation1Media.getUserMedia).toHaveLength(1);
  expect(generation1Media.getUserMedia[0]?.trackId).not.toBe(
    generation0Media.mediaRecorders[0]?.trackId,
  );
  expect(generation1Media.wsAudioFrames[0]).toMatchObject({
    endMs: 100,
    sequenceNo: 0,
    startMs: 0,
  });

  const generation1 = await serverSnapshot(sessionId);
  expect(generation1.audioObjectCount).toBe(1);
  expect(generation1.currentCapture).toMatchObject({ generationNo: 1, status: 'active' });
  expect(generation1.currentCapture?.audioObjectId).toBe(audioObjectId);
  expect(generation1.currentCapture?.audioStreamId).not.toBe(generation0AudioStreamId);
  expect(generation1.currentCapture?.timelineOffsetMs).toBe(beforeRefreshLocal.timelineEndMs);
  const generation1AudioStreamId = generation1.currentCapture?.audioStreamId;
  if (generation1AudioStreamId === undefined) throw new Error('Generation 1 stream is unavailable');
  expect(generation1Media.wsAudioFrames[0]?.audioStreamId).toBe(generation1AudioStreamId);
  await expect
    .poll(async () => {
      const snapshot = await serverSnapshot(sessionId);
      return snapshot.generation1SegmentStartMs;
    })
    .toBe(beforeRefreshLocal.timelineEndMs);

  await expect
    .poll(async () => (await localEvidence(page, sessionId, localJobId)).archiveHighWater)
    .toBeGreaterThan(beforeRefreshLocal.archiveHighWater);
  const afterResumeLocal = await localEvidence(page, sessionId, localJobId);
  expect(afterResumeLocal.job).toMatchObject({
    audioObjectId,
    audioStreamId: generation1AudioStreamId,
    generationNo: 1,
    jobId: localJobId,
    timelineOffsetMs: beforeRefreshLocal.timelineEndMs,
  });

  await page.waitForTimeout(interviewDurationMs - beforeRefreshDurationMs);
  const beforeEndMedia = await browserEvidence(page);
  await page.getByRole('button', { name: '结束访谈' }).click();
  await page.getByRole('button', { name: '确认结束' }).click();
  await expect.poll(() => stopRequests.length).toBe(1);
  await expect
    .poll(async () => (await serverSnapshot(sessionId)).audioStatus, { timeout: 30_000 })
    .toBe('complete');

  const endingMedia = await browserEvidence(page);
  const stopFetch = endingMedia.fetches.find(({ path }) =>
    path.endsWith(`/sessions/${sessionId}/stop`),
  );
  const lastDataAvailable = endingMedia.recorderData.at(-1);
  expect(stopFetch).toBeDefined();
  expect(lastDataAvailable).toBeDefined();
  expect(lastDataAvailable?.at).toBeLessThanOrEqual(stopFetch?.at ?? -1);
  expect(endingMedia.recorderData.length).toBeGreaterThan(beforeEndMedia.recorderData.length);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await serverSnapshot(sessionId)).sessionStatus === 'completed') break;
    const reconcile = page.getByRole('button', { name: '继续处理收尾' });
    await expect(reconcile).toBeVisible();
    await reconcile.click();
    await page.waitForTimeout(500);
  }
  await expect
    .poll(async () => (await serverSnapshot(sessionId)).sessionStatus, { timeout: 20_000 })
    .toBe('completed');

  const manifest = await page.evaluate(async (id) => {
    const response = await fetch(`/api/v1/audio-objects/${id}/manifest`, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`manifest failed: ${String(response.status)}`);
    const body = (await response.json()) as {
      chunk_count: number;
      chunks: Array<{ end_ms: number; sequence_no: number; start_ms: number }>;
      id: string;
      manifest_checksum: string | null;
      status: string;
    };
    return {
      chunkCount: body.chunk_count,
      firstSequence: body.chunks[0]?.sequence_no ?? null,
      id: body.id,
      lastEndMs: body.chunks.at(-1)?.end_ms ?? null,
      lastSequence: body.chunks.at(-1)?.sequence_no ?? null,
      manifestChecksumPresent: body.manifest_checksum !== null,
      status: body.status,
    };
  }, audioObjectId);
  const finalLocal = await localEvidence(page, sessionId, localJobId);
  const terminal = await serverSnapshot(sessionId);
  expect(manifest).toMatchObject({
    chunkCount: finalLocal.archiveCount,
    firstSequence: 0,
    id: audioObjectId,
    lastSequence: finalLocal.archiveHighWater,
    manifestChecksumPresent: true,
    status: 'complete',
  });
  expect(stopRequests[0]).toEqual({
    expectedChunkCount: manifest.chunkCount,
    sequenceCount: manifest.chunkCount,
  });
  expect(terminal).toMatchObject({
    audioObjectCount: 1,
    audioStatus: 'complete',
    // The deterministic realtime fixture deliberately fails sequence 2. V2 keeps
    // recording alive and therefore must preserve that known gap as sticky degraded.
    finalizationTranscriptStatus: 'degraded',
    sessionStatus: 'completed',
  });
  expect(terminal.generationCount).toBe(2);
  expect(finalLocal.checkpoint).toMatchObject({ dirty: false, status: 'stopped' });

  console.log(
    JSON.stringify({
      event: 'DEV005R4_DESKTOP_EVIDENCE',
      browser: await page.evaluate(() => navigator.userAgent),
      duration_ms: interviewDurationMs,
      generation_0: {
        archive_high_water_before_refresh: beforeRefreshLocal.archiveHighWater,
        audio_object_id: audioObjectId,
        audio_stream_id: generation0AudioStreamId,
        generation_no: 0,
        timeline_end_ms: beforeRefreshLocal.timelineEndMs,
      },
      generation_1: {
        audio_stream_id: generation1AudioStreamId,
        first_pcm: generation1Media.wsAudioFrames[0],
        generation_no: 1,
        timeline_offset_ms: generation1.currentCapture?.timelineOffsetMs,
      },
      local: {
        archive_count: finalLocal.archiveCount,
        archive_high_water: finalLocal.archiveHighWater,
        delivery_ack_high_water: finalLocal.deliveryAcknowledgedHighWater,
        local_job_id: localJobId,
        pending_delivery: finalLocal.deliveryCount,
        timeline_end_ms: finalLocal.timelineEndMs,
      },
      manifest,
      media: {
        generation_0_track_id: generation0Media.mediaRecorders[0]?.trackId,
        generation_1_track_id: generation1Media.mediaRecorders[0]?.trackId,
        generation_1_final_data_before_stop: true,
      },
      server: terminal,
    }),
  );

  expect(csrfToken).not.toHaveLength(0);
});

function assertOneStreamFeedsArchiveAndPcm(evidence: BrowserEvidence): void {
  expect(evidence.mediaRecorders).toHaveLength(1);
  const recorder = evidence.mediaRecorders[0];
  expect(
    evidence.audioSources.some(
      (source) => source.streamKey === recorder?.streamKey && source.trackId === recorder.trackId,
    ),
  ).toBe(true);
}

async function loginAndCreateFormalProject(
  page: Page,
): Promise<{ csrfToken: string; projectId: string }> {
  await page.goto('/');
  await page.locator('input[name="email"]').fill('listener-a@example.test');
  await page.locator('input[name="password"]').fill('Fictional-only-Password-42!');
  const loginResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/auth/login') && response.status() === 200,
  );
  await page.locator('form button[type="submit"]').click();
  const login = (await (await loginResponse).json()) as { csrf_token: string };
  await expect(page.getByRole('heading', { name: '已登录' })).toBeVisible();
  const projectId = await page.evaluate(async (csrfToken) => {
    async function write(path: string, body?: unknown): Promise<Record<string, unknown>> {
      const createRequest =
        path === '/projects' || /^\/projects\/[^/]+\/(service-terms|consents|sessions)$/.test(path);
      const requestBody = createRequest
        ? { ...((body ?? {}) as Record<string, unknown>), request_id: crypto.randomUUID() }
        : body;
      const response = await fetch(`/api/v1${path}`, {
        ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        method: 'POST',
      });
      if (!response.ok) throw new Error(`${path} failed: ${String(response.status)}`);
      return (await response.json()) as Record<string, unknown>;
    }
    const project = await write('/projects', {
      display_name: `虚构 R4 桌面验收 ${new Date().toISOString()}`,
    });
    const id = String(project.id);
    await write(`/projects/${id}/service-terms`, {
      currency: 'CNY',
      estimated_session_count: 1,
      expected_current_minutes: 10,
      included_minutes: 60,
      overtime_price_minor: 0,
      overtime_unit_minutes: 30,
    });
    await write(`/projects/${id}/consents`, {
      consent_audio_object_id: null,
      consent_method: 'electronic',
      consent_text_version: 'mvp-v1',
      consent_type: 'recording_transcription_ai',
      consented_at: new Date().toISOString(),
    });
    return id;
  }, login.csrf_token);
  acceptanceProjectIds.add(projectId);
  return { csrfToken: login.csrf_token, projectId };
}

async function browserEvidence(page: Page): Promise<BrowserEvidence> {
  return page.evaluate(() =>
    structuredClone(Reflect.get(globalThis, '__dev005r4Evidence') as BrowserEvidence),
  );
}

async function installNativeMediaEvidence(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const evidence: BrowserEvidence = {
      audioSources: [],
      fetches: [],
      getUserMedia: [],
      mediaRecorders: [],
      recorderData: [],
      wsAudioFrames: [],
    };
    Reflect.set(globalThis, '__dev005r4Evidence', evidence);
    const streamKeys = new WeakMap<MediaStream, number>();
    let nextStreamKey = 1;
    function describe(stream: MediaStream): { streamKey: number; trackId: string } {
      let streamKey = streamKeys.get(stream);
      if (streamKey === undefined) {
        streamKey = nextStreamKey;
        nextStreamKey += 1;
        streamKeys.set(stream, streamKey);
      }
      return { streamKey, trackId: stream.getAudioTracks()[0]?.id ?? 'no-audio-track' };
    }

    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints): Promise<MediaStream> => {
      const stream = await nativeGetUserMedia(constraints);
      evidence.getUserMedia.push(describe(stream));
      return stream;
    };

    const NativeMediaRecorder = globalThis.MediaRecorder;
    globalThis.MediaRecorder = new Proxy(NativeMediaRecorder, {
      construct(target, argumentsList, newTarget): object {
        const recorder = Reflect.construct(target, argumentsList, newTarget) as MediaRecorder;
        const stream = argumentsList[0] as MediaStream;
        const description = describe(stream);
        evidence.mediaRecorders.push(description);
        recorder.addEventListener('dataavailable', (event) => {
          evidence.recorderData.push({
            at: performance.now(),
            size: event.data.size,
            streamKey: description.streamKey,
          });
        });
        return recorder;
      },
    });

    for (const Context of [globalThis.AudioContext]) {
      const prototype = Context.prototype;
      const nativeCreateSource = Object.getOwnPropertyDescriptor(
        prototype,
        'createMediaStreamSource',
      )?.value as (this: BaseAudioContext, stream: MediaStream) => MediaStreamAudioSourceNode;
      prototype.createMediaStreamSource = function createMediaStreamSource(
        stream: MediaStream,
      ): MediaStreamAudioSourceNode {
        evidence.audioSources.push(describe(stream));
        return nativeCreateSource.call(this, stream);
      };
    }

    const nativeSend = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'send')?.value as (
      this: WebSocket,
      data: string | ArrayBufferLike | Blob | ArrayBufferView,
    ) => void;
    WebSocket.prototype.send = function send(
      data: string | ArrayBufferLike | Blob | ArrayBufferView,
    ): void {
      if (typeof data === 'string') {
        try {
          const message = JSON.parse(data) as {
            payload?: {
              audio_stream_id?: unknown;
              end_ms?: unknown;
              sequence_no?: unknown;
              start_ms?: unknown;
            };
            type?: unknown;
          };
          if (message.type === 'audio.frame' && message.payload !== undefined) {
            evidence.wsAudioFrames.push({
              audioStreamId: String(message.payload.audio_stream_id),
              endMs: Number(message.payload.end_ms),
              sequenceNo: Number(message.payload.sequence_no),
              startMs: Number(message.payload.start_ms),
            });
          }
        } catch {
          // Native transport still receives malformed data unchanged.
        }
      }
      nativeSend.call(this, data);
    };

    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      evidence.fetches.push({
        at: performance.now(),
        method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
        path: url.pathname,
      });
      return nativeFetch(input, init);
    };
  });
}

async function localEvidence(
  page: Page,
  sessionId: string,
  localJobId: string,
): Promise<LocalEvidence> {
  return page.evaluate(
    async ({ jobId, targetSessionId }): Promise<LocalEvidence> => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('elder-interview-audio-buffer', 4);
        open.onerror = (): void => {
          reject(open.error ?? new Error('IndexedDB open failed'));
        };
        open.onsuccess = (): void => {
          resolve(open.result);
        };
      });
      function readAll(storeName: string): Promise<unknown[]> {
        return new Promise((resolve, reject) => {
          const transaction = database.transaction(storeName, 'readonly');
          const request = transaction.objectStore(storeName).getAll();
          request.onerror = (): void => {
            reject(request.error ?? new Error(`${storeName} read failed`));
          };
          request.onsuccess = (): void => {
            resolve(request.result as unknown[]);
          };
        });
      }
      function readOne(storeName: string, key: string): Promise<Record<string, unknown> | null> {
        return new Promise((resolve, reject) => {
          const transaction = database.transaction(storeName, 'readonly');
          const request = transaction.objectStore(storeName).get(key);
          request.onerror = (): void => {
            reject(request.error ?? new Error(`${storeName} read failed`));
          };
          request.onsuccess = (): void => {
            resolve((request.result as Record<string, unknown> | undefined) ?? null);
          };
        });
      }
      const [archives, deliveries, state, job, checkpoint] = await Promise.all([
        readAll('archive-chunks'),
        readAll('delivery-queue'),
        readOne('session-state', targetSessionId),
        readOne('upload-jobs', jobId),
        readOne('capture-checkpoints', jobId),
      ]);
      database.close();
      const sessionArchives = archives.filter(
        (record) => (record as { sessionId?: unknown }).sessionId === targetSessionId,
      );
      const sessionDeliveries = deliveries.filter(
        (record) => (record as { sessionId?: unknown }).sessionId === targetSessionId,
      );
      const capture = job?.interviewCapture as Record<string, unknown> | undefined;
      return {
        archiveCount: sessionArchives.length,
        archiveHighWater: Number(state?.nextSequenceNo ?? 0) - 1,
        checkpoint:
          checkpoint === null
            ? null
            : {
                audioStreamId: String(checkpoint.audioStreamId),
                dirty: Boolean(checkpoint.dirty),
                localJobId: String(checkpoint.localJobId),
                status: String(checkpoint.status),
                timelineEndMs: Number(checkpoint.timelineEndMs),
              },
        deliveryAcknowledgedHighWater: Number(state?.deliveryAcknowledgedHighWaterSequenceNo ?? -1),
        deliveryCount: sessionDeliveries.length,
        job:
          job === null
            ? null
            : {
                audioObjectId: typeof job.audioObjectId === 'string' ? job.audioObjectId : null,
                audioStreamId:
                  typeof capture?.audioStreamId === 'string' ? capture.audioStreamId : null,
                generationNo:
                  typeof capture?.generationNo === 'number' ? capture.generationNo : null,
                jobId: String(job.jobId),
                status: String(job.status),
                timelineOffsetMs:
                  typeof capture?.timelineOffsetMs === 'number' ? capture.timelineOffsetMs : null,
              },
        timelineEndMs: Number(state?.timelineEndMs ?? 0),
      } satisfies LocalEvidence;
    },
    { jobId: localJobId, targetSessionId: sessionId },
  );
}

async function serverSnapshot(sessionId: string): Promise<{
  audioObjectCount: number;
  audioStatus: string | null;
  currentCapture: null | {
    audioObjectId: string;
    audioStreamId: string;
    generationNo: number;
    interruptionReason: string | null;
    status: string;
    timelineOffsetMs: number;
  };
  finalizationTranscriptStatus: string | null;
  generation1SegmentStartMs: number | null;
  generationCount: number;
  sessionStatus: string;
}> {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
  const prisma = createTestPrismaClient(databaseUrl);
  try {
    const session = await prisma.interviewSession.findUniqueOrThrow({
      include: {
        audioObjects: { orderBy: { createdAt: 'asc' } },
        captureGenerations: { orderBy: { generationNo: 'asc' } },
        finalization: true,
        transcriptSegments: { orderBy: { createdAt: 'asc' } },
      },
      where: { id: sessionId },
    });
    const current = session.captureGenerations.at(-1) ?? null;
    const generation1 =
      current?.generationNo === 1
        ? session.transcriptSegments.find((segment) =>
            segment.ingestKey.includes(current.audioStreamId),
          )
        : null;
    return {
      audioObjectCount: session.audioObjects.length,
      audioStatus: session.audioObjects[0]?.status ?? null,
      currentCapture:
        current === null
          ? null
          : {
              audioObjectId: current.audioObjectId,
              audioStreamId: current.audioStreamId,
              generationNo: current.generationNo,
              interruptionReason: current.interruptionReason,
              status: current.status,
              timelineOffsetMs: current.timelineOffsetMs,
            },
      finalizationTranscriptStatus: session.finalization?.transcriptStatus ?? null,
      generation1SegmentStartMs: generation1?.startMs ?? null,
      generationCount: session.captureGenerations.length,
      sessionStatus: session.status,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function cleanupAcceptanceProject(projectId: string): Promise<void> {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
  const prisma = createTestPrismaClient(databaseUrl);
  try {
    await prisma.$transaction(async (tx) => {
      const sessionWhere = { session: { projectId } };
      await tx.sessionFinalizationChunk.deleteMany({
        where: { finalization: sessionWhere },
      });
      await tx.sessionFinalization.deleteMany({ where: sessionWhere });
      await tx.aiJob.deleteMany({ where: { projectId } });
      await tx.speakerCalibrationAttemptSegment.deleteMany({
        where: { attempt: { session: { projectId } } },
      });
      await tx.speakerCalibrationAttempt.deleteMany({ where: sessionWhere });
      await tx.transcriptSegment.deleteMany({ where: { session: { projectId } } });
      await tx.speakerMapping.deleteMany({ where: { session: { projectId } } });
      await tx.speakerStream.deleteMany({ where: { session: { projectId } } });
      await tx.consentRecord.deleteMany({ where: { projectId } });
      await tx.audioChunk.deleteMany({ where: { audioObject: { projectId } } });
      await tx.sessionCaptureGeneration.deleteMany({ where: { session: { projectId } } });
      await tx.audioObject.deleteMany({ where: { projectId } });
      await tx.interviewSession.deleteMany({ where: { projectId } });
      await tx.serviceTerm.deleteMany({ where: { projectId } });
      await tx.projectAssignment.deleteMany({ where: { projectId } });
      await tx.elderProject.deleteMany({ where: { id: projectId } });
    });
  } finally {
    await prisma.$disconnect();
  }
}
