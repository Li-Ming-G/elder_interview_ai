// @vitest-environment jsdom

import type {
  AudioChunkResponse,
  CaptureInterruptionReason,
  InterviewSessionResponse,
  SessionCaptureSnapshot,
} from '@elder-interview/contracts';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { AudioChunkQueue } from '../audio/audio-chunk-queue.js';
import { BrowserStorageGuard } from '../audio/browser-storage-guard.js';
import { InMemoryAudioChunkStore } from '../audio/in-memory-audio-chunk-store.js';
import { SequentialAudioDeliveryPump } from '../audio/sequential-delivery-pump.js';
import type { SessionBrowserLock } from '../audio/session-browser-lock.js';
import type { BrowserCaptureCheckpoint, BrowserCaptureCheckpointStore } from '../audio/types.js';
import { InMemoryAudioUploadJobStore } from '../audio/audio-upload-job.js';
import type { InterviewApi, InterviewCaptureApi } from './interview-api.js';
import { InterviewApiError } from './interview-api.js';
import type { RealtimeState } from '../realtime-transcription/realtime-transport.js';
import {
  InterviewCaptureController,
  type InterviewCaptureRuntime,
  type InterviewCaptureRuntimeFactoryInput,
} from './interview-capture-controller.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const AUDIO_OBJECT_ID = '33333333-3333-4333-8333-333333333333';
const MIME = 'audio/webm;codecs=opus';

describe('InterviewCaptureController', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('orders lock, one microphone stream, atomic start, archive, confirm, then realtime', async () => {
    const harness = createHarness();
    const result = await harness.controller.start();

    expect(result.phase).toBe('active');
    expect(harness.events).toEqual([
      'lock.acquire',
      'storage.start',
      'getUserMedia',
      'api.start',
      'runtime.start:0',
      'api.confirm:0',
      'runtime.realtime:0',
    ]);
    expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
    expect(harness.api.startSession).toHaveBeenCalledTimes(1);
    expect(harness.api.startSession.mock.calls[0]?.[1]).toMatchObject({
      audio_stream_id: 'id-1',
      mime_type: MIME,
      request_id: 'id-2',
    });
  });

  it('makes duplicate start and a lost start response reuse the formal job identity', async () => {
    const harness = createHarness();
    harness.api.startSession.mockRejectedValueOnce(new Error('NETWORK_UNAVAILABLE'));
    await expect(harness.controller.start()).rejects.toThrow('NETWORK_UNAVAILABLE');
    await harness.controller.start();
    await harness.controller.start();

    expect(harness.api.startSession).toHaveBeenCalledTimes(2);
    expect(harness.api.startSession.mock.calls[0]?.[1]).toEqual(
      harness.api.startSession.mock.calls[1]?.[1],
    );
    expect(harness.getUserMedia).toHaveBeenCalledTimes(2);
    expect(harness.runtimes).toHaveLength(1);
  });

  it('does not request a microphone or start the server when another tab owns the lock', async () => {
    const harness = createHarness({ lockAvailable: false });
    await expect(harness.controller.start()).rejects.toThrow('BROWSER_CAPTURE_LOCKED');
    expect(harness.getUserMedia).not.toHaveBeenCalled();
    expect(harness.api.startSession).not.toHaveBeenCalled();
  });

  it('keeps a permission failure local when no server capture exists', async () => {
    const harness = createHarness({
      getUserMediaFailure: new DOMException('denied', 'NotAllowedError'),
    });
    await expect(harness.controller.start()).rejects.toThrow('denied');
    expect(harness.api.startSession).not.toHaveBeenCalled();
    expect(harness.api.reportCaptureInterrupted).not.toHaveBeenCalled();
    expect(harness.controller.snapshot.phase).toBe('failed');
  });

  it('reports capture_start_failed when local runtime cannot start after atomic start', async () => {
    const harness = createHarness({ runtimeStartFailure: new Error('RECORDER_START_FAILED') });
    await expect(harness.controller.start()).rejects.toThrow('RECORDER_START_FAILED');
    expect(harness.api.reportCaptureInterrupted).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ generation_no: 0, reason: 'capture_start_failed' }),
    );
  });

  it('retries the same confirm request without acquiring a second stream', async () => {
    const harness = createHarness();
    harness.api.confirmCaptureActive.mockRejectedValueOnce(new Error('NETWORK_UNAVAILABLE'));
    await expect(harness.controller.start()).rejects.toThrow('NETWORK_UNAVAILABLE');
    await harness.controller.start();

    expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
    expect(harness.api.startSession).toHaveBeenCalledTimes(1);
    expect(harness.api.confirmCaptureActive).toHaveBeenCalledTimes(2);
    expect(harness.api.confirmCaptureActive.mock.calls[0]?.[1]).toEqual(
      harness.api.confirmCaptureActive.mock.calls[1]?.[1],
    );
  });

  it('interrupts the local archive with auth_lost when confirm detects revoked authority', async () => {
    const harness = createHarness();
    harness.api.confirmCaptureActive.mockRejectedValueOnce(
      new InterviewApiError('CONSENT_REQUIRED', 'consent revoked', 409),
    );
    await expect(harness.controller.start()).rejects.toThrow('consent revoked');
    expect(harness.runtimes[0]?.interrupt).toHaveBeenCalledTimes(1);
    expect(harness.api.reportCaptureInterrupted).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ reason: 'auth_lost' }),
    );
  });

  it('persists one page-recovery report and never auto-requests the microphone', async () => {
    const shared = createHarness();
    const active = await shared.controller.start();
    const refreshed = createHarness({
      checkpoint: checkpoint(active.audioStreamId as string),
      jobs: shared.jobs,
      queue: shared.queue,
      store: shared.store,
    });
    refreshed.api.reportCaptureInterrupted.mockRejectedValueOnce(new Error('NETWORK_UNAVAILABLE'));

    await refreshed.controller.recover(
      session('recording', capture('active', 0, active.audioStreamId as string)),
    );
    await refreshed.controller.recover(
      session('recording', capture('active', 0, active.audioStreamId as string)),
    );

    expect(refreshed.getUserMedia).not.toHaveBeenCalled();
    expect(refreshed.api.reportCaptureInterrupted).toHaveBeenCalledTimes(2);
    expect(refreshed.api.reportCaptureInterrupted.mock.calls[0]?.[1]).toEqual(
      refreshed.api.reportCaptureInterrupted.mock.calls[1]?.[1],
    );
    expect(refreshed.api.reportCaptureInterrupted.mock.calls[0]?.[1]).toMatchObject({
      reason: 'page_recovery_detected',
    });
  });

  it('resumes the same job/object with cumulative archive high-water and a new generation', async () => {
    const harness = createHarness();
    const started = await harness.controller.start();
    harness.runtimes[0]?.input.onCaptureFailure('microphone_ended');
    await eventually(() => {
      expect(harness.controller.snapshot.phase).toBe('interrupted');
    });
    harness.api.getSession.mockResolvedValue(
      session('interrupted', capture('interrupted', 0, started.audioStreamId as string)),
    );
    harness.api.recoverSession.mockImplementation((_sessionId, request) =>
      Promise.resolve(
        session(
          'reconnecting',
          capture('preparing', 1, 'audio_stream_id' in request ? request.audio_stream_id : 'bad'),
        ),
      ),
    );

    const resumed = await harness.controller.resume();

    expect(resumed.phase).toBe('active');
    expect(resumed.audioObjectId).toBe(AUDIO_OBJECT_ID);
    expect(resumed.generationNo).toBe(1);
    expect(resumed.audioStreamId).not.toBe(started.audioStreamId);
    expect(harness.api.recoverSession.mock.calls[0]?.[1]).toMatchObject({
      action: 'resume_capture',
      local_archive_chunk_count: 1,
      local_archive_timeline_high_water_ms: 100,
    });
  });

  it('generation-fences a delayed failure from the previous runtime', async () => {
    const harness = createHarness();
    const started = await harness.controller.start();
    const oldRuntime = harness.runtimes[0];
    oldRuntime?.input.onCaptureFailure('microphone_ended');
    await eventually(() => {
      expect(harness.controller.snapshot.phase).toBe('interrupted');
    });
    harness.api.getSession.mockResolvedValue(
      session('interrupted', capture('interrupted', 0, started.audioStreamId as string)),
    );
    harness.api.recoverSession.mockImplementation((_sessionId, request) =>
      Promise.resolve(
        session(
          'reconnecting',
          capture('preparing', 1, 'audio_stream_id' in request ? request.audio_stream_id : 'bad'),
        ),
      ),
    );
    await harness.controller.resume();
    const reportsBefore = harness.api.reportCaptureInterrupted.mock.calls.length;

    oldRuntime?.input.onCaptureFailure('local_archive_failed');
    await Promise.resolve();

    expect(harness.controller.snapshot.phase).toBe('active');
    expect(harness.controller.snapshot.generationNo).toBe(1);
    expect(harness.api.reportCaptureInterrupted).toHaveBeenCalledTimes(reportsBefore);
  });

  it.each<
    [
      CaptureInterruptionReason,
      Parameters<InterviewCaptureRuntimeFactoryInput['onCaptureFailure']>[0],
    ]
  >([
    ['microphone_ended', 'microphone_ended'],
    ['recorder_error', 'recorder_error'],
    ['local_archive_failed', 'local_archive_failed'],
  ])('reports %s without rewriting the archive fact', async (expected, runtimeReason) => {
    const harness = createHarness();
    await harness.controller.start();
    harness.runtimes[0]?.input.onCaptureFailure(runtimeReason);
    await eventually(() => {
      expect(harness.api.reportCaptureInterrupted).toHaveBeenCalledWith(
        SESSION_ID,
        expect.objectContaining({ reason: expected }),
      );
    });
    expect(await harness.queue.restoreArchive(SESSION_ID)).toHaveLength(1);
  });

  it('maps realtime authority loss to auth_lost but keeps ordinary ASR failure independent', async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.runtimes[0]?.input.onRealtimeState(realtime('asr'));
    await Promise.resolve();
    expect(harness.api.reportCaptureInterrupted).not.toHaveBeenCalled();

    harness.runtimes[0]?.input.onRealtimeState(realtime('permission'));
    await eventually(() => {
      expect(harness.api.reportCaptureInterrupted).toHaveBeenCalledWith(
        SESSION_ID,
        expect.objectContaining({ reason: 'auth_lost' }),
      );
    });
    expect(harness.runtimes[0]?.interrupt).toHaveBeenCalledTimes(1);
  });

  it('strictly ACKs delivery while retaining archive and stable request IDs', async () => {
    const harness = createHarness();
    await harness.controller.start();
    await harness.controller.flushDelivery();

    expect(harness.api.uploadInterviewChunk).toHaveBeenCalledTimes(1);
    expect(await harness.queue.restore(SESSION_ID)).toHaveLength(0);
    expect(await harness.queue.restoreArchive(SESSION_ID)).toHaveLength(1);
    const job = await harness.jobs.getUploadJob(`interview-capture:${SESSION_ID}`);
    expect(job?.chunkRequestIds['0']).toBeTruthy();
  });

  it('freezes stable stop/complete IDs and commitments from immutable archive', async () => {
    const harness = createHarness();
    await harness.controller.start();
    await harness.controller.flushDelivery();
    const first = await harness.controller.stopAndFreeze();
    const second = await harness.controller.stopAndFreeze();

    expect(first).toEqual(second);
    expect(first.expectedChunkCount).toBe(1);
    expect(first.chunks).toEqual([
      expect.objectContaining({
        checksum: 'checksum-0',
        end_ms: 100,
        sequence_no: 0,
        size_bytes: 3,
        start_ms: 0,
      }),
    ]);
  });
});

interface HarnessOptions {
  checkpoint?: BrowserCaptureCheckpoint | null;
  getUserMediaFailure?: Error;
  jobs?: InMemoryAudioUploadJobStore;
  lockAvailable?: boolean;
  queue?: AudioChunkQueue;
  runtimeStartFailure?: Error;
  store?: InMemoryAudioChunkStore;
}

type CompleteApi = InterviewApi & InterviewCaptureApi;
type MockApi = { [Key in keyof CompleteApi]: Mock<CompleteApi[Key]> };

interface TestRuntime extends InterviewCaptureRuntime {
  activateRealtime: Mock<InterviewCaptureRuntime['activateRealtime']>;
  input: InterviewCaptureRuntimeFactoryInput;
  interrupt: Mock<InterviewCaptureRuntime['interrupt']>;
  start: Mock<InterviewCaptureRuntime['start']>;
  stop: Mock<InterviewCaptureRuntime['stop']>;
}

interface ControllerHarness {
  api: MockApi;
  controller: InterviewCaptureController;
  events: string[];
  getUserMedia: Mock<(constraints: MediaStreamConstraints) => Promise<MediaStream>>;
  jobs: InMemoryAudioUploadJobStore;
  queue: AudioChunkQueue;
  runtimes: TestRuntime[];
  store: InMemoryAudioChunkStore;
}

function createHarness(options: HarnessOptions = {}): ControllerHarness {
  const events: string[] = [];
  const store = options.store ?? new InMemoryAudioChunkStore();
  const queue =
    options.queue ??
    new AudioChunkQueue(store, {
      checksum: (blob): Promise<string> => {
        void blob;
        return Promise.resolve('checksum-0');
      },
      maximumBufferedBytes: 1024,
    });
  const jobs = options.jobs ?? new InMemoryAudioUploadJobStore();
  const runtimes: TestRuntime[] = [];
  let id = 0;
  const stream = fakeStream();
  const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>(() => {
    events.push('getUserMedia');
    if (options.getUserMediaFailure !== undefined) {
      return Promise.reject(options.getUserMediaFailure);
    }
    return Promise.resolve(stream);
  });
  const api = createApi(events);
  const lock = {
    acquire: vi.fn((): Promise<boolean> => {
      events.push('lock.acquire');
      return Promise.resolve(options.lockAvailable ?? true);
    }),
    release: vi.fn((): Promise<void> => {
      events.push('lock.release');
      return Promise.resolve();
    }),
  } as unknown as SessionBrowserLock;
  const checkpointStore: BrowserCaptureCheckpointStore = {
    getCaptureCheckpoint: vi.fn(() => Promise.resolve(options.checkpoint ?? null)),
    putCaptureCheckpoint: vi.fn(),
  };
  const storageGuard = {
    assertCanContinue: vi.fn(() =>
      Promise.resolve({ availableBytes: 1024, recommendedCapacityAvailable: true }),
    ),
    assertCanStart: vi.fn(() => {
      events.push('storage.start');
      return Promise.resolve({ availableBytes: 1024, recommendedCapacityAvailable: true });
    }),
  } as unknown as BrowserStorageGuard;
  const controller = new InterviewCaptureController({
    api,
    browserLock: lock,
    checkpointStore,
    createRuntime: (input): InterviewCaptureRuntime => {
      const runtime: TestRuntime = {
        activateRealtime: vi.fn((): Promise<void> => {
          events.push(`runtime.realtime:${String(input.generationNo)}`);
          return Promise.resolve();
        }),
        input,
        interrupt: vi.fn(() => Promise.resolve()),
        start: vi.fn(async (mediaStream: MediaStream): Promise<void> => {
          void mediaStream;
          events.push(`runtime.start:${String(input.generationNo)}`);
          if (options.runtimeStartFailure !== undefined) throw options.runtimeStartFailure;
          if ((await queue.getNextSequenceNo(SESSION_ID)) === 0) {
            await queue.enqueue({
              blob: new Blob([new Uint8Array([1, 2, 3])], { type: MIME }),
              endedAtMs: 100,
              mimeType: MIME,
              sequenceNo: 0,
              sessionId: SESSION_ID,
              startedAtMs: 0,
            });
          }
          input.onArchiveProgress();
        }),
        stop: vi.fn(() => queue.restoreArchive(SESSION_ID)),
      };
      runtimes.push(runtime);
      return runtime;
    },
    getUserMedia,
    jobs,
    mimeType: (): string => MIME,
    projectId: PROJECT_ID,
    pump: new SequentialAudioDeliveryPump(queue, jobs, {
      requestId: (): string => `chunk-${String(++id)}`,
    }),
    queue,
    requestId: (): string => `id-${String(++id)}`,
    sessionId: SESSION_ID,
    storageGuard,
  });
  return { api, controller, events, getUserMedia, jobs, queue, runtimes, store };
}

function createApi(events: string[]): MockApi {
  return {
    confirmCaptureActive: vi.fn<CompleteApi['confirmCaptureActive']>((_sessionId, request) => {
      events.push(`api.confirm:${String(request.generation_no)}`);
      return Promise.resolve(
        session('recording', capture('active', request.generation_no, request.audio_stream_id)),
      );
    }),
    createSession: vi.fn<CompleteApi['createSession']>(),
    deviceCheck: vi.fn<CompleteApi['deviceCheck']>(),
    getSession: vi.fn<CompleteApi['getSession']>(() =>
      Promise.resolve(session('interrupted', capture('interrupted', 0, 'id-1'))),
    ),
    loadPreparation: vi.fn<CompleteApi['loadPreparation']>(),
    recoverSession: vi.fn<CompleteApi['recoverSession']>(),
    reportCaptureInterrupted: vi.fn<CompleteApi['reportCaptureInterrupted']>(
      (_sessionId, request) =>
        Promise.resolve(
          session(
            'interrupted',
            capture('interrupted', request.generation_no, request.audio_stream_id, request.reason),
          ),
        ),
    ),
    startSession: vi.fn<CompleteApi['startSession']>((_sessionId, request) => {
      events.push('api.start');
      return Promise.resolve(
        session('recording', capture('preparing', 0, request.audio_stream_id)),
      );
    }),
    uploadInterviewChunk: vi.fn<CompleteApi['uploadInterviewChunk']>((_audioObjectId, chunk) =>
      Promise.resolve({
        audio_object_id: AUDIO_OBJECT_ID,
        checksum: chunk.checksumSha256,
        end_ms: chunk.endedAtMs,
        id: 'chunk-id',
        mime_type: chunk.mimeType,
        sequence_no: chunk.sequenceNo,
        size_bytes: chunk.byteLength,
        start_ms: chunk.startedAtMs,
        upload_status: 'uploaded',
        uploaded_at: '2026-08-08T00:00:00.000Z',
      } satisfies AudioChunkResponse),
    ),
  };
}

function session(
  status: InterviewSessionResponse['status'],
  captureValue: SessionCaptureSnapshot,
): InterviewSessionResponse {
  return {
    capture: captureValue,
    created_at: '2026-08-08T00:00:00.000Z',
    created_by: '44444444-4444-4444-8444-444444444444',
    id: SESSION_ID,
    project_id: PROJECT_ID,
    sequence_no: 1,
    started_at: '2026-08-08T00:00:00.000Z',
    status,
    updated_at: '2026-08-08T00:00:00.000Z',
  };
}

function capture(
  status: SessionCaptureSnapshot['status'],
  generationNo: number,
  audioStreamId: string,
  reason: CaptureInterruptionReason | null = null,
): SessionCaptureSnapshot {
  return {
    audio_object_id: AUDIO_OBJECT_ID,
    audio_stream_id: audioStreamId,
    generation_no: generationNo,
    interrupted_at: reason === null ? null : '2026-08-08T00:00:00.000Z',
    interruption_reason: reason,
    status,
    timeline_offset_ms: generationNo * 100,
    uploaded_chunk_count: 0,
  };
}

function checkpoint(audioStreamId: string): BrowserCaptureCheckpoint {
  return {
    archiveHighWaterSequenceNo: 0,
    audioStreamId,
    deliveryAcknowledgedHighWaterSequenceNo: -1,
    dirty: true,
    localJobId: `interview-capture:${SESSION_ID}`,
    mimeType: MIME,
    sessionId: SESSION_ID,
    status: 'recording',
    timelineEndMs: 100,
    updatedAt: '2026-08-08T00:00:00.000Z',
  };
}

function fakeStream(): MediaStream {
  const track = { stop: vi.fn() };
  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

function realtime(failureKind: 'asr' | 'permission'): RealtimeState {
  return {
    connection: 'unavailable' as const,
    errorCode: failureKind === 'asr' ? 'ASR_UNAVAILABLE' : 'FORBIDDEN',
    failureKind,
    finals: [],
    interim: null,
    pendingBytes: 0,
    pendingFrames: 0,
    resetRequired: false,
    resumed: false,
  };
}

async function eventually(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      if (attempt === 19) throw error;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    }
  }
}
