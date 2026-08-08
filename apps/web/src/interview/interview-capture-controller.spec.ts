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
import { SessionBrowserLock } from '../audio/session-browser-lock.js';
import type {
  BrowserCaptureCheckpoint,
  BrowserCaptureCheckpointStore,
  CaptureInterruptionReportRecord,
  CaptureInterruptionReportStore,
} from '../audio/types.js';
import { InMemoryAudioUploadJobStore } from '../audio/audio-upload-job.js';
import type { InterviewApi, InterviewCaptureApi } from './interview-api.js';
import { InterviewApiError } from './interview-api.js';
import type { RealtimeState } from '../realtime-transcription/realtime-transport.js';
import {
  captureInterruptionReportJobId,
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

  it('stops a temporary stream without letting cleanup replace a server-start failure', async () => {
    const harness = createHarness();
    const stop = vi.fn(() => {
      throw new Error('TRACK_STOP_FAILED');
    });
    harness.getUserMedia.mockResolvedValueOnce({
      getAudioTracks: (): MediaStreamTrack[] => [{ stop } as unknown as MediaStreamTrack],
      getTracks: (): MediaStreamTrack[] => [{ stop } as unknown as MediaStreamTrack],
    } as unknown as MediaStream);
    harness.api.startSession.mockRejectedValueOnce(new Error('START_RESPONSE_LOST'));

    await expect(harness.controller.start()).rejects.toThrow('START_RESPONSE_LOST');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(harness.controller.snapshot.lastError).toBe('START_RESPONSE_LOST');
    expect(harness.events).toContain('lock.release');
  });

  it('preserves a storage preflight failure, releases the lock, and allows a new owner', async () => {
    const locks = new SharedLockManager();
    const harness = createHarness({
      browserLock: new SessionBrowserLock(SESSION_ID, { locks }),
      storageStartFailures: [new Error('AUDIO_BUFFER_CANARY_FAILED')],
    });

    await expect(harness.controller.start()).rejects.toThrow('AUDIO_BUFFER_CANARY_FAILED');
    expect(harness.getUserMedia).not.toHaveBeenCalled();
    expect(harness.api.startSession).not.toHaveBeenCalled();
    const nextOwner = new SessionBrowserLock(SESSION_ID, { locks });
    await expect(nextOwner.acquire()).resolves.toBe(true);
    await nextOwner.release();

    await expect(harness.controller.start()).resolves.toMatchObject({ phase: 'active' });
    await harness.controller.stopAndFreeze();
  });

  it('preserves MIME and local job creation failures without leaking the browser lock', async () => {
    const mimeLocks = new SharedLockManager();
    const mimeHarness = createHarness({
      browserLock: new SessionBrowserLock(SESSION_ID, { locks: mimeLocks }),
      mimeType: (): string => {
        throw new Error('AUDIO_CAPTURE_UNSUPPORTED');
      },
    });
    await expect(mimeHarness.controller.start()).rejects.toThrow('AUDIO_CAPTURE_UNSUPPORTED');
    expect(mimeHarness.getUserMedia).not.toHaveBeenCalled();
    expect(mimeHarness.api.startSession).not.toHaveBeenCalled();
    const afterMimeFailure = new SessionBrowserLock(SESSION_ID, { locks: mimeLocks });
    await expect(afterMimeFailure.acquire()).resolves.toBe(true);
    await afterMimeFailure.release();

    const writeLocks = new SharedLockManager();
    const jobs = new FailOncePutUploadJobStore(new Error('LOCAL_JOB_WRITE_FAILED'));
    const writeHarness = createHarness({
      browserLock: new SessionBrowserLock(SESSION_ID, { locks: writeLocks }),
      jobs,
    });
    await expect(writeHarness.controller.start()).rejects.toThrow('LOCAL_JOB_WRITE_FAILED');
    expect(writeHarness.getUserMedia).not.toHaveBeenCalled();
    expect(writeHarness.api.startSession).not.toHaveBeenCalled();
    const afterWriteFailure = new SessionBrowserLock(SESSION_ID, { locks: writeLocks });
    await expect(afterWriteFailure.acquire()).resolves.toBe(true);
    await afterWriteFailure.release();
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

  it('reports and releases a resumed generation when microphone acquisition fails', async () => {
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
    harness.api.reportCaptureInterrupted.mockRejectedValueOnce(new Error('NETWORK_UNAVAILABLE'));
    harness.getUserMedia.mockRejectedValueOnce(
      new DOMException('resume denied', 'NotAllowedError'),
    );
    const releasesBefore = harness.events.filter((event) => event === 'lock.release').length;

    await expect(harness.controller.resume()).rejects.toThrow('resume denied');
    expect(harness.controller.snapshot.lastError).toBe('resume denied');
    expect(harness.events.filter((event) => event === 'lock.release')).toHaveLength(
      releasesBefore + 1,
    );
    const failedReport = harness.api.reportCaptureInterrupted.mock.calls.at(-1)?.[1];
    expect(failedReport).toMatchObject({ generation_no: 1, reason: 'capture_start_failed' });

    await harness.controller.recover(
      session('reconnecting', capture('preparing', 1, failedReport?.audio_stream_id ?? 'missing')),
    );
    const retriedReport = harness.api.reportCaptureInterrupted.mock.calls.at(-1)?.[1];
    expect(retriedReport).toEqual(failedReport);
  });

  it('persists and retries one orphan page-recovery report without creating a job or microphone', async () => {
    const sharedJobs = new InMemoryAudioUploadJobStore();
    const first = createHarness({ jobs: sharedJobs });
    const active = session('recording', capture('active', 3, 'orphan-stream'));
    first.api.getSession.mockResolvedValue(active);
    first.api.reportCaptureInterrupted.mockImplementationOnce(async (_sessionId, request) => {
      const record = await sharedJobs.getCaptureInterruptionReport(
        captureInterruptionReportJobId(SESSION_ID, 3, 'orphan-stream'),
      );
      expect(record?.requestId).toBe(request.request_id);
      throw new Error('NETWORK_UNAVAILABLE');
    });

    await expect(first.controller.recover(active)).rejects.toThrow('NETWORK_UNAVAILABLE');
    expect(first.getUserMedia).not.toHaveBeenCalled();
    expect(first.api.startSession).not.toHaveBeenCalled();
    expect(await sharedJobs.getUploadJob(`interview-capture:${SESSION_ID}`)).toBeNull();
    const firstPayload = first.api.reportCaptureInterrupted.mock.calls[0]?.[1];

    const refreshed = createHarness({ jobs: sharedJobs });
    refreshed.api.getSession.mockResolvedValue(active);
    await refreshed.controller.recover(active);
    expect(refreshed.api.reportCaptureInterrupted.mock.calls[0]?.[1]).toEqual(firstPayload);
    expect(refreshed.controller.snapshot).toMatchObject({
      lastError: 'LOCAL_CAPTURE_JOB_MISSING',
      phase: 'interrupted',
    });
  });

  it('uses generation-scoped orphan keys and skips reports once server capture is interrupted', async () => {
    const jobs = new InMemoryAudioUploadJobStore();
    const harness = createHarness({ jobs });
    const generationZero = session('recording', capture('active', 0, 'stream-0'));
    harness.api.getSession.mockResolvedValueOnce(generationZero);
    await harness.controller.recover(generationZero);
    const generationOne = session('reconnecting', capture('preparing', 1, 'stream-1'));
    harness.api.getSession.mockResolvedValueOnce(generationOne);
    await harness.controller.recover(generationOne);

    expect(
      await jobs.getCaptureInterruptionReport(
        captureInterruptionReportJobId(SESSION_ID, 0, 'stream-0'),
      ),
    ).not.toBeNull();
    expect(
      await jobs.getCaptureInterruptionReport(
        captureInterruptionReportJobId(SESSION_ID, 1, 'stream-1'),
      ),
    ).not.toBeNull();

    const interrupted = session('interrupted', capture('interrupted', 2, 'stream-2'));
    harness.api.getSession.mockResolvedValueOnce(interrupted);
    await harness.controller.recover(session('recording', capture('active', 2, 'stream-2')));
    expect(
      await jobs.getCaptureInterruptionReport(
        captureInterruptionReportJobId(SESSION_ID, 2, 'stream-2'),
      ),
    ).toBeNull();
    expect(harness.controller.snapshot).toMatchObject({
      lastError: 'LOCAL_CAPTURE_JOB_MISSING',
      phase: 'interrupted',
    });
    const stopped = session('completed', capture('stopped', 3, 'stream-3'));
    harness.api.getSession.mockResolvedValueOnce(stopped);
    await harness.controller.recover(session('recording', capture('active', 3, 'stream-3')));
    expect(
      await jobs.getCaptureInterruptionReport(
        captureInterruptionReportJobId(SESSION_ID, 3, 'stream-3'),
      ),
    ).toBeNull();
    expect(harness.api.reportCaptureInterrupted).toHaveBeenCalledTimes(2);
  });

  it('replays the same orphan report when acknowledged persistence fails', async () => {
    const jobs = new FailOnceReportUpdateStore();
    const harness = createHarness({ interruptionReports: jobs, jobs });
    const active = session('recording', capture('active', 4, 'stream-4'));
    harness.api.getSession.mockResolvedValue(active);

    await expect(harness.controller.recover(active)).rejects.toThrow(
      'CAPTURE_REPORT_UPDATE_FAILED',
    );
    const firstPayload = harness.api.reportCaptureInterrupted.mock.calls[0]?.[1];
    await harness.controller.recover(active);
    expect(harness.api.reportCaptureInterrupted.mock.calls[1]?.[1]).toEqual(firstPayload);
  });

  it('fails closed without sending when the orphan report record is corrupted', async () => {
    const jobs = new CorruptReportStore();
    const harness = createHarness({ interruptionReports: jobs, jobs });
    const active = session('recording', capture('active', 5, 'stream-5'));
    harness.api.getSession.mockResolvedValue(active);

    await expect(harness.controller.recover(active)).rejects.toThrow(
      'CAPTURE_INTERRUPTION_REPORT_RECORD_INVALID',
    );
    expect(harness.api.reportCaptureInterrupted).not.toHaveBeenCalled();
    expect(harness.getUserMedia).not.toHaveBeenCalled();
  });

  it('fails closed without sending when an orphan report key has conflicting identity', async () => {
    const jobs = new InMemoryAudioUploadJobStore();
    const jobId = captureInterruptionReportJobId(SESSION_ID, 6, 'stream-6');
    await jobs.getOrCreateCaptureInterruptionReport({
      audioObjectId: 'conflicting-object',
      audioStreamId: 'stream-6',
      createdAt: '2026-08-08T00:00:00.000Z',
      generationNo: 6,
      jobId,
      lastError: null,
      projectId: PROJECT_ID,
      reason: 'page_recovery_detected',
      recordType: 'capture-interruption-report-v1',
      requestId: 'conflicting-request',
      sessionId: SESSION_ID,
      status: 'pending',
      updatedAt: '2026-08-08T00:00:00.000Z',
    });
    const harness = createHarness({ jobs });
    const active = session('recording', capture('active', 6, 'stream-6'));
    harness.api.getSession.mockResolvedValue(active);

    await expect(harness.controller.recover(active)).rejects.toThrow(
      'CAPTURE_INTERRUPTION_REPORT_IDENTITY_CONFLICT',
    );
    expect(harness.api.reportCaptureInterrupted).not.toHaveBeenCalled();
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
    await expect(harness.controller.resume()).rejects.toThrow('END_HANDOFF_ALREADY_FROZEN');
    expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
    expect(harness.controller.snapshot.endHandoff).toEqual({
      audioObjectId: AUDIO_OBJECT_ID,
      completeRequestId: first.completeRequestId,
      expectedChunkCount: 1,
      stopRequestId: first.stopRequestId,
    });
  });

  it('rechecks only persisted server facts and preserves the last snapshot on a network failure', async () => {
    const harness = createHarness();
    await harness.controller.start();
    const recording = session('recording', capture('active', 0, 'id-1'));
    harness.api.getSession.mockResolvedValueOnce(recording);

    const verified = await harness.controller.verifyServerSession();
    expect(verified.serverSession?.status).toBe('recording');
    expect(verified.serverVerifiedAt).toBeTruthy();
    expect(harness.getUserMedia).toHaveBeenCalledTimes(1);

    harness.api.getSession.mockRejectedValueOnce(new Error('NETWORK_UNAVAILABLE'));
    await expect(harness.controller.verifyServerSession()).rejects.toThrow('NETWORK_UNAVAILABLE');
    expect(harness.controller.snapshot.serverSession?.status).toBe('recording');
    expect(harness.controller.snapshot.serverVerificationError).toBe('NETWORK_UNAVAILABLE');
    expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('stops local capture and fails closed when a read-only verification loses authority', async () => {
    const harness = createHarness();
    await harness.controller.start();
    harness.api.getSession.mockRejectedValueOnce(
      new InterviewApiError('AUTH_REQUIRED', '登录已失效，请重新登录', 401),
    );

    await expect(harness.controller.verifyServerSession()).rejects.toThrow('登录已失效');
    expect(harness.runtimes[0]?.interrupt).toHaveBeenCalledTimes(1);
    expect(harness.controller.snapshot.phase).toBe('interrupted');
    expect(harness.controller.snapshot.lastError).toBe('AUTHORITY_LOST');
    expect(harness.getUserMedia).toHaveBeenCalledTimes(1);
  });
});

interface HarnessOptions {
  browserLock?: SessionBrowserLock;
  checkpoint?: BrowserCaptureCheckpoint | null;
  getUserMediaFailure?: Error;
  interruptionReports?: CaptureInterruptionReportStore;
  jobs?: InMemoryAudioUploadJobStore;
  lockAvailable?: boolean;
  mimeType?: () => string;
  queue?: AudioChunkQueue;
  runtimeStartFailure?: Error;
  storageStartFailures?: Error[];
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
  lock: SessionBrowserLock;
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
  const storageStartFailures = [...(options.storageStartFailures ?? [])];
  const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>(() => {
    events.push('getUserMedia');
    if (options.getUserMediaFailure !== undefined) {
      return Promise.reject(options.getUserMediaFailure);
    }
    return Promise.resolve(stream);
  });
  const api = createApi(events);
  const lock =
    options.browserLock ??
    new (class extends SessionBrowserLock {
      public constructor() {
        super(SESSION_ID, { locks: null });
      }

      public override acquire(): Promise<boolean> {
        events.push('lock.acquire');
        return Promise.resolve(options.lockAvailable ?? true);
      }

      public override release(): Promise<void> {
        events.push('lock.release');
        return Promise.resolve();
      }
    })();
  if (options.browserLock === undefined) {
    vi.spyOn(lock, 'acquire');
    vi.spyOn(lock, 'release');
  }
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
      const failure = storageStartFailures.shift();
      if (failure !== undefined) return Promise.reject(failure);
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
        interrupt: vi.fn(() => lock.release()),
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
        stop: vi.fn(async () => {
          const archive = await queue.restoreArchive(SESSION_ID);
          await lock.release();
          return archive;
        }),
      };
      runtimes.push(runtime);
      return runtime;
    },
    getUserMedia,
    interruptionReports: options.interruptionReports ?? jobs,
    jobs,
    mimeType: options.mimeType ?? ((): string => MIME),
    projectId: PROJECT_ID,
    pump: new SequentialAudioDeliveryPump(queue, jobs, {
      requestId: (): string => `chunk-${String(++id)}`,
    }),
    queue,
    requestId: (): string => `id-${String(++id)}`,
    sessionId: SESSION_ID,
    storageGuard,
  });
  return { api, controller, events, getUserMedia, jobs, lock, queue, runtimes, store };
}

function createApi(events: string[]): MockApi {
  return {
    abandonEmptyCapture: vi.fn<CompleteApi['abandonEmptyCapture']>(),
    completeInterviewAudio: vi.fn<CompleteApi['completeInterviewAudio']>(),
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
    stopSession: vi.fn<CompleteApi['stopSession']>(),
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

class SharedLockManager {
  private held = false;

  public request(
    _name: string,
    _options: { ifAvailable: true; mode: 'exclusive' },
    callback: (lock: Lock | null) => Promise<void>,
  ): Promise<void> {
    if (this.held) return callback(null);
    this.held = true;
    return callback({} as Lock).finally(() => {
      this.held = false;
    });
  }
}

class FailOncePutUploadJobStore extends InMemoryAudioUploadJobStore {
  private failed = false;

  public constructor(private readonly failure: Error) {
    super();
  }

  public override putUploadJob(job: import('../audio/types.js').AudioUploadJob): Promise<void> {
    if (!this.failed) {
      this.failed = true;
      return Promise.reject(this.failure);
    }
    return super.putUploadJob(job);
  }
}

class FailOnceReportUpdateStore extends InMemoryAudioUploadJobStore {
  private failed = false;

  public override updateCaptureInterruptionReport(
    jobId: string,
    update: (current: CaptureInterruptionReportRecord) => CaptureInterruptionReportRecord,
  ): Promise<CaptureInterruptionReportRecord> {
    if (!this.failed) {
      this.failed = true;
      return Promise.reject(new Error('CAPTURE_REPORT_UPDATE_FAILED'));
    }
    return super.updateCaptureInterruptionReport(jobId, update);
  }
}

class CorruptReportStore extends InMemoryAudioUploadJobStore {
  public override getOrCreateCaptureInterruptionReport(
    candidate: CaptureInterruptionReportRecord,
  ): Promise<CaptureInterruptionReportRecord> {
    void candidate;
    return Promise.reject(new Error('CAPTURE_INTERRUPTION_REPORT_RECORD_INVALID'));
  }
}
