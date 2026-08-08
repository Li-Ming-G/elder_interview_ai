// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { AudioChunkQueue } from './audio-chunk-queue.js';
import { BrowserAudioRecorder } from './browser-audio-recorder.js';
import { BrowserCaptureCore, type BrowserCaptureFailureReason } from './browser-capture-core.js';
import { BrowserStorageGuard } from './browser-storage-guard.js';
import { InMemoryAudioChunkStore } from './in-memory-audio-chunk-store.js';
import { SessionBrowserLock } from './session-browser-lock.js';
import type { BrowserCaptureCheckpoint, BrowserCaptureCheckpointStore } from './types.js';

class FakeRecorder {
  public readonly mimeType = 'audio/webm';
  public ondataavailable: ((event: BlobEvent) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public onstop: ((event: Event) => void) | null = null;
  public state: RecordingState = 'inactive';
  public readonly stopCalls = vi.fn();
  public tail = new Blob(['final-tail'], { type: 'audio/webm' });

  public emit(value: string): void {
    this.ondataavailable?.({ data: new Blob([value], { type: 'audio/webm' }) } as BlobEvent);
  }

  public start(): void {
    this.state = 'recording';
  }

  public stop(): void {
    this.stopCalls();
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: this.tail } as BlobEvent);
    this.onstop?.(new Event('stop'));
  }
}

class FaultInjectingCheckpointStore implements BrowserCaptureCheckpointStore {
  private failCount = 0;

  public constructor(
    private readonly backing: InMemoryAudioChunkStore,
    public readonly failure: Error,
  ) {}

  public failNext(count = 1): void {
    this.failCount = count;
  }

  public failForever(): void {
    this.failCount = Number.POSITIVE_INFINITY;
  }

  public getCaptureCheckpoint(localJobId: string): Promise<BrowserCaptureCheckpoint | null> {
    return this.backing.getCaptureCheckpoint(localJobId);
  }

  public putCaptureCheckpoint(checkpoint: BrowserCaptureCheckpoint): Promise<void> {
    if (this.failCount > 0) {
      this.failCount -= 1;
      return Promise.reject(this.failure);
    }
    return this.backing.putCaptureCheckpoint(checkpoint);
  }
}

interface TestLockManager {
  request(
    name: string,
    options: { ifAvailable: true; mode: 'exclusive' },
    callback: (lock: Lock | null) => Promise<void>,
  ): Promise<void>;
}

function sharedLocks(): {
  isHeld: () => boolean;
  locks: TestLockManager;
} {
  let held = false;
  return {
    isHeld: (): boolean => held,
    locks: {
      async request(
        _name: string,
        _options: { ifAvailable: true; mode: 'exclusive' },
        callback: (lock: Lock | null) => Promise<void>,
      ): Promise<void> {
        if (held) return callback(null);
        held = true;
        try {
          await callback({ mode: 'exclusive', name: 'fictional-lock' });
        } finally {
          held = false;
        }
      },
    },
  };
}

interface StartedCaptureHarness {
  checkpointStore: FaultInjectingCheckpointStore;
  core: BrowserCaptureCore;
  fakeRecorder: FakeRecorder;
  lockState: ReturnType<typeof sharedLocks>;
  queue: AudioChunkQueue;
  trackStop: ReturnType<typeof vi.fn>;
}

async function startedCapture(
  options: {
    onCaptureFailure?: (reason: BrowserCaptureFailureReason, error?: unknown) => void;
    pcmStop?: () => Promise<void>;
  } = {},
): Promise<StartedCaptureHarness> {
  const store = new InMemoryAudioChunkStore();
  const checkpointStore = new FaultInjectingCheckpointStore(
    store,
    new Error('synthetic checkpoint failure'),
  );
  const queue = new AudioChunkQueue(store, {
    checksum: async (blob): Promise<string> => `checksum:${await blob.text()}`,
    maximumBufferedBytes: 1024,
  });
  const fakeRecorder = new FakeRecorder();
  const recorder = new BrowserAudioRecorder(queue, {
    mediaDevices: { getUserMedia: vi.fn() },
    mediaRecorderFactory: (): FakeRecorder => fakeRecorder,
    supportedMimeTypes: ['audio/webm'],
    timesliceMs: 100,
  });
  const track = new EventTarget() as MediaStreamTrack;
  const trackStop = vi.fn();
  track.stop = trackStop;
  const stream = {
    getAudioTracks: (): MediaStreamTrack[] => [track],
    getTracks: (): MediaStreamTrack[] => [track],
  } as MediaStream;
  const lockState = sharedLocks();
  const core = new BrowserCaptureCore({
    browserLock: new SessionBrowserLock('core-session', { locks: lockState.locks }),
    checkpointStore,
    ...(options.onCaptureFailure === undefined
      ? {}
      : { onCaptureFailure: options.onCaptureFailure }),
    pcmProducer: {
      start: (): Promise<void> => Promise.resolve(),
      stop: options.pcmStop ?? ((): Promise<void> => Promise.resolve()),
    },
    queue,
    recorder,
    storageGuard: new BrowserStorageGuard({
      estimate: (): Promise<StorageEstimate> => Promise.resolve({ quota: 1000, usage: 0 }),
      criticalAvailableBytes: 0,
      recommendedAvailableBytes: 0,
      runCanary: (): Promise<void> => Promise.resolve(),
    }),
  });
  await core.start({
    audioStreamId: 'stream-0',
    localJobId: 'job-0',
    mimeType: 'audio/webm',
    sessionId: 'core-session',
    stream,
  });
  return { checkpointStore, core, fakeRecorder, lockState, queue, trackStop };
}

describe('BrowserCaptureCore', () => {
  it('keeps MediaRecorder archive active when realtime PCM startup fails', async () => {
    const store = new InMemoryAudioChunkStore();
    const queue = new AudioChunkQueue(store, {
      checksum: async (blob): Promise<string> => `checksum:${await blob.text()}`,
      maximumBufferedBytes: 1024,
    });
    const fakeRecorder = new FakeRecorder();
    const getUserMedia = vi.fn();
    const recorder = new BrowserAudioRecorder(queue, {
      mediaDevices: { getUserMedia },
      mediaRecorderFactory: (): FakeRecorder => fakeRecorder,
      supportedMimeTypes: ['audio/webm'],
      timesliceMs: 100,
    });
    const track = new EventTarget() as MediaStreamTrack;
    track.stop = vi.fn();
    const stream = {
      getAudioTracks: (): MediaStreamTrack[] => [track],
      getTracks: (): MediaStreamTrack[] => [track],
    } as MediaStream;
    const realtimeFailure = vi.fn();
    const core = new BrowserCaptureCore({
      browserLock: new SessionBrowserLock('core-session', {
        locks: {
          request: async (_name, _options, callback): Promise<void> => callback({} as Lock),
        },
      }),
      checkpointStore: store,
      onRealtimeFailure: realtimeFailure,
      pcmProducer: {
        start: (): Promise<void> => Promise.reject(new Error('synthetic realtime failure')),
        stop: (): Promise<void> => Promise.resolve(),
      },
      queue,
      recorder,
      storageGuard: new BrowserStorageGuard({
        estimate: (): Promise<StorageEstimate> => Promise.resolve({ quota: 1000, usage: 0 }),
        criticalAvailableBytes: 0,
        recommendedAvailableBytes: 0,
        runCanary: (): Promise<void> => Promise.resolve(),
      }),
    });

    await core.start({
      audioStreamId: 'stream-0',
      localJobId: 'job-0',
      mimeType: 'audio/webm',
      sessionId: 'core-session',
      stream,
    });
    expect(recorder.snapshot.status).toBe('recording');
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(realtimeFailure).toHaveBeenCalledOnce();

    fakeRecorder.emit('archive-survives');
    await core.stop();
    const [archived] = await queue.restoreArchive('core-session');
    expect(await archived?.blob.text()).toBe('archive-survives');
  });

  it('finalizes raw archive and releases ownership when realtime stop never settles', async () => {
    const pendingRealtimeStop = new Promise<void>(() => undefined);
    const harness = await startedCapture({ pcmStop: () => pendingRealtimeStop });

    await expect(harness.core.stop()).resolves.toHaveLength(1);

    const [archived] = await harness.queue.restoreArchive('core-session');
    expect(await archived?.blob.text()).toBe('final-tail');
    expect(harness.fakeRecorder.stopCalls).toHaveBeenCalledOnce();
    expect(harness.trackStop).toHaveBeenCalledOnce();
    expect(harness.lockState.isHeld()).toBe(false);
    const nextOwner = new SessionBrowserLock('core-session', { locks: harness.lockState.locks });
    await expect(nextOwner.acquire()).resolves.toBe(true);
    await nextOwner.release();
  });

  it('finalizes archive with a dirty failed checkpoint for controller-side interruption', async () => {
    const failures = vi.fn();
    const harness = await startedCapture({ onCaptureFailure: failures });

    await harness.core.interrupt();

    expect(failures).not.toHaveBeenCalled();
    expect(harness.fakeRecorder.stopCalls).toHaveBeenCalledOnce();
    expect(harness.trackStop).toHaveBeenCalledOnce();
    expect(harness.lockState.isHeld()).toBe(false);
    await expect(harness.checkpointStore.getCaptureCheckpoint('job-0')).resolves.toMatchObject({
      dirty: true,
      status: 'failed',
    });
    await expect(harness.queue.restoreArchive('core-session')).resolves.toHaveLength(1);
  });

  it('turns a runtime checkpoint failure into one archive failure and recovers the write chain', async () => {
    const failures = vi.fn();
    const harness = await startedCapture({ onCaptureFailure: failures });
    harness.checkpointStore.failNext();

    harness.fakeRecorder.emit('runtime-audio');
    await vi.waitFor(() => {
      expect(failures).toHaveBeenCalledOnce();
    });

    expect(failures).toHaveBeenCalledWith('local_archive_failed', harness.checkpointStore.failure);
    expect(harness.fakeRecorder.stopCalls).toHaveBeenCalledOnce();
    await expect(harness.checkpointStore.getCaptureCheckpoint('job-0')).resolves.toMatchObject({
      dirty: true,
      status: 'failed',
    });
    expect(harness.trackStop).toHaveBeenCalledOnce();
    expect(harness.lockState.isHeld()).toBe(false);
  });

  it('releases ownership even when every failure checkpoint write also fails', async () => {
    const failures = vi.fn();
    const harness = await startedCapture({ onCaptureFailure: failures });
    harness.checkpointStore.failForever();

    harness.fakeRecorder.emit('runtime-audio');
    await vi.waitFor(() => {
      expect(harness.lockState.isHeld()).toBe(false);
    });

    expect(failures).toHaveBeenCalledOnce();
    expect(failures).toHaveBeenCalledWith('local_archive_failed', harness.checkpointStore.failure);
    expect(harness.fakeRecorder.stopCalls).toHaveBeenCalledOnce();
    expect(harness.trackStop).toHaveBeenCalledOnce();
    const nextOwner = new SessionBrowserLock('core-session', { locks: harness.lockState.locks });
    await expect(nextOwner.acquire()).resolves.toBe(true);
    await nextOwner.release();
  });
});
