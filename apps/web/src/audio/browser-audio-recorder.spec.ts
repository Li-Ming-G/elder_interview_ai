// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { AudioChunkQueue } from './audio-chunk-queue.js';
import { BrowserAudioRecorder } from './browser-audio-recorder.js';
import { AudioCaptureError } from './errors.js';
import { InMemoryAudioChunkStore } from './in-memory-audio-chunk-store.js';

class FakeMediaRecorder {
  public readonly mimeType = 'audio/webm';
  public ondataavailable: ((event: BlobEvent) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public onstop: ((event: Event) => void) | null = null;
  public state: RecordingState = 'inactive';
  public startedWith: number | undefined;
  public tail = new Blob(['tail'], { type: 'audio/webm' });

  public emit(blobText: string): void {
    this.ondataavailable?.({
      data: new Blob([blobText], { type: 'audio/webm' }),
    } as BlobEvent);
  }

  public start(timeslice?: number): void {
    this.startedWith = timeslice;
    this.state = 'recording';
  }

  public stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: this.tail } as BlobEvent);
    this.onstop?.(new Event('stop'));
  }
}

interface RecorderHarness {
  fakeRecorder: FakeMediaRecorder;
  getUserMedia: ReturnType<typeof vi.fn>;
  queue: AudioChunkQueue;
  recorder: BrowserAudioRecorder;
  setNow: (value: number) => void;
  stopTrack: ReturnType<typeof vi.fn>;
}

function harness(maximumBufferedBytes = 1024): RecorderHarness {
  const store = new InMemoryAudioChunkStore();
  const queue = new AudioChunkQueue(store, {
    checksum: async (blob): Promise<string> => `checksum:${await blob.text()}`,
    maximumBufferedBytes,
  });
  const fakeRecorder = new FakeMediaRecorder();
  const stopTrack = vi.fn();
  const getUserMedia = vi.fn().mockResolvedValue({
    getTracks: () => [{ stop: stopTrack }],
  });
  let now = 0;
  const recorder = new BrowserAudioRecorder(queue, {
    clock: (): number => now,
    mediaDevices: { getUserMedia },
    mediaRecorderFactory: (): FakeMediaRecorder => fakeRecorder,
    supportedMimeTypes: ['audio/webm'],
    timesliceMs: 1000,
  });
  return {
    fakeRecorder,
    getUserMedia,
    queue,
    recorder,
    setNow: (value: number): void => {
      now = value;
    },
    stopTrack,
  };
}

describe('BrowserAudioRecorder', () => {
  it('denies recording by default before requesting microphone access', async () => {
    const { getUserMedia, recorder } = harness();
    await expect(recorder.start()).rejects.toMatchObject({ code: 'RECORDING_NOT_ALLOWED' });
    await expect(
      recorder.start({ canRecord: false, sessionId: 'fictional-session' }),
    ).rejects.toMatchObject({ code: 'RECORDING_NOT_ALLOWED' });
    expect(getUserMedia.mock.calls).toHaveLength(0);
  });

  it('persists ordinary and final tail chunks before reporting stopped', async () => {
    const { fakeRecorder, queue, recorder, setNow, stopTrack } = harness();
    await recorder.start({ canRecord: true, sessionId: 'fictional-session' });
    setNow(1000.4);
    fakeRecorder.emit('first');
    setNow(1500.6);

    const records = await recorder.stop();

    expect(records.map((record) => record.chunk.sequenceNo)).toEqual([0, 1]);
    expect(records.map(({ chunk }) => [chunk.startedAtMs, chunk.endedAtMs])).toEqual([
      [0, 1000],
      [1000, 1500],
    ]);
    expect(await records[1]?.chunk.blob.text()).toBe('tail');
    expect((await queue.restore('fictional-session')).map((item) => item.chunk.sequenceNo)).toEqual(
      [0, 1],
    );
    expect(recorder.snapshot.status).toBe('stopped');
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it('rejects a concurrent start before a second microphone request can begin', async () => {
    const { getUserMedia, recorder } = harness();
    const context = { canRecord: true, sessionId: 'fictional-session' };

    const firstStart = recorder.start(context);
    await expect(recorder.start(context)).rejects.toThrow('audio capture is already active');
    await firstStart;

    expect(getUserMedia).toHaveBeenCalledOnce();
    await recorder.stop();
  });

  it('records an injected stream without requesting or stopping a second stream', async () => {
    const { fakeRecorder, getUserMedia, queue, recorder, stopTrack } = harness();
    const injectedStop = vi.fn();
    const stream = { getTracks: () => [{ stop: injectedStop }] } as unknown as MediaStream;

    await recorder.startWithStream({ canRecord: true, sessionId: 'fictional-session' }, stream);
    fakeRecorder.emit('single-source');
    await recorder.stop();

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(stopTrack).not.toHaveBeenCalled();
    expect(injectedStop).not.toHaveBeenCalled();
    expect(await queue.restoreArchive('fictional-session')).toHaveLength(2);
  });

  it('continues sequence numbers after restoring pending chunks', async () => {
    const sharedStore = new InMemoryAudioChunkStore();
    const firstQueue = new AudioChunkQueue(sharedStore, {
      checksum: async (blob): Promise<string> => `checksum:${await blob.text()}`,
      maximumBufferedBytes: 1024,
    });
    await firstQueue.enqueue({
      blob: new Blob(['existing'], { type: 'audio/webm' }),
      endedAtMs: 1000,
      mimeType: 'audio/webm',
      sequenceNo: 0,
      sessionId: 'fictional-session',
      startedAtMs: 0,
    });
    const fakeRecorder = new FakeMediaRecorder();
    const recorder = new BrowserAudioRecorder(firstQueue, {
      clock: (): number => 2000,
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }),
      },
      mediaRecorderFactory: (): FakeMediaRecorder => fakeRecorder,
      supportedMimeTypes: ['audio/webm'],
      timesliceMs: 1000,
    });

    await recorder.start({ canRecord: true, sessionId: 'fictional-session' });
    await recorder.stop();
    expect(
      (await firstQueue.restore('fictional-session')).map((item) => item.chunk.sequenceNo),
    ).toEqual([0, 1]);
  });

  it('continues sequence numbers after every earlier chunk has been acknowledged', async () => {
    const sharedStore = new InMemoryAudioChunkStore();
    const queue = new AudioChunkQueue(sharedStore, {
      checksum: async (blob): Promise<string> => `checksum:${await blob.text()}`,
      maximumBufferedBytes: 1024,
    });
    const first = await queue.enqueue({
      blob: new Blob(['acknowledged'], { type: 'audio/webm' }),
      endedAtMs: 1000,
      mimeType: 'audio/webm',
      sequenceNo: 0,
      sessionId: 'fictional-session',
      startedAtMs: 0,
    });
    await queue.acknowledge('fictional-session', 0, first.chunk.checksumSha256);

    const fakeRecorder = new FakeMediaRecorder();
    const recorder = new BrowserAudioRecorder(queue, {
      clock: (): number => 2000,
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
      mediaRecorderFactory: (): FakeMediaRecorder => fakeRecorder,
      supportedMimeTypes: ['audio/webm'],
      timesliceMs: 1000,
    });
    await recorder.start({ canRecord: true, sessionId: 'fictional-session' });
    await recorder.stop();

    const [resumed] = await queue.restore('fictional-session');
    expect(resumed?.chunk).toMatchObject({ sequenceNo: 1, startedAtMs: 1000 });
  });

  it('does not leave stop waiting when MediaRecorder.start throws', async () => {
    const queue = new AudioChunkQueue(new InMemoryAudioChunkStore(), {
      checksum: (): Promise<string> => Promise.resolve('checksum'),
      maximumBufferedBytes: 1024,
    });
    const recorder = new BrowserAudioRecorder(queue, {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
      mediaRecorderFactory: (): FakeMediaRecorder => {
        const failing = new FakeMediaRecorder();
        failing.start = (): never => {
          throw new Error('synthetic start failure');
        };
        return failing;
      },
      supportedMimeTypes: ['audio/webm'],
      timesliceMs: 1000,
    });

    await expect(
      recorder.start({ canRecord: true, sessionId: 'fictional-session' }),
    ).rejects.toMatchObject({ code: 'AUDIO_DEVICE_UNAVAILABLE' });
    await expect(recorder.stop()).resolves.toEqual([]);
  });

  it('stops and exposes risk when reliable persistence reaches its capacity', async () => {
    const { fakeRecorder, recorder } = harness(3);
    await recorder.start({ canRecord: true, sessionId: 'fictional-session' });
    fakeRecorder.emit('four');
    await vi.waitFor(() => {
      expect(recorder.snapshot.status).toBe('failed');
    });

    await expect(recorder.stop()).rejects.toMatchObject({
      code: 'AUDIO_BUFFER_CAPACITY_EXCEEDED',
    });
    expect(recorder.snapshot.error).toBeInstanceOf(AudioCaptureError);
  });

  it('reports microphone permission rejection without starting MediaRecorder', async () => {
    const queue = new AudioChunkQueue(new InMemoryAudioChunkStore(), {
      checksum: (): Promise<string> => Promise.resolve('checksum'),
      maximumBufferedBytes: 1024,
    });
    const factory = vi.fn();
    const recorder = new BrowserAudioRecorder(queue, {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')),
      },
      mediaRecorderFactory: factory,
      supportedMimeTypes: ['audio/webm'],
      timesliceMs: 1000,
    });

    await expect(
      recorder.start({ canRecord: true, sessionId: 'fictional-session' }),
    ).rejects.toMatchObject({ code: 'AUDIO_PERMISSION_DENIED' });
    expect(factory).not.toHaveBeenCalled();
    expect(recorder.snapshot.status).toBe('failed');
  });
});
