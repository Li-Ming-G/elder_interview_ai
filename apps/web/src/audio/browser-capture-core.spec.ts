// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { AudioChunkQueue } from './audio-chunk-queue.js';
import { BrowserAudioRecorder } from './browser-audio-recorder.js';
import { BrowserCaptureCore } from './browser-capture-core.js';
import { BrowserStorageGuard } from './browser-storage-guard.js';
import { InMemoryAudioChunkStore } from './in-memory-audio-chunk-store.js';
import { SessionBrowserLock } from './session-browser-lock.js';

class FakeRecorder {
  public readonly mimeType = 'audio/webm';
  public ondataavailable: ((event: BlobEvent) => void) | null = null;
  public onerror: ((event: ErrorEvent) => void) | null = null;
  public onstop: ((event: Event) => void) | null = null;
  public state: RecordingState = 'inactive';

  public emit(value: string): void {
    this.ondataavailable?.({ data: new Blob([value], { type: 'audio/webm' }) } as BlobEvent);
  }

  public start(): void {
    this.state = 'recording';
  }

  public stop(): void {
    this.state = 'inactive';
    this.onstop?.(new Event('stop'));
  }
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
});
