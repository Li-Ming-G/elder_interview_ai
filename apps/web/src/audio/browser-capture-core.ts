import type { AudioChunkQueue } from './audio-chunk-queue.js';
import type { AudioCaptureSnapshot, BrowserAudioRecorder } from './browser-audio-recorder.js';
import type { BrowserStorageAssessment, BrowserStorageGuard } from './browser-storage-guard.js';
import type { SessionBrowserLock } from './session-browser-lock.js';
import type {
  BrowserCaptureCheckpoint,
  BrowserCaptureCheckpointStore,
  ImmutableAudioChunk,
} from './types.js';

export type BrowserCaptureFailureReason =
  'local_archive_failed' | 'microphone_ended' | 'recorder_error';

interface RealtimePcmProducer {
  start(stream: MediaStream): Promise<void>;
  stop(): Promise<void>;
}

export interface BrowserCaptureCoreOptions {
  browserLock: SessionBrowserLock;
  checkpointStore: BrowserCaptureCheckpointStore;
  now?: () => Date;
  onCaptureFailure?: (reason: BrowserCaptureFailureReason, error?: unknown) => void;
  onRealtimeFailure?: (error: unknown) => void;
  onStorageAssessment?: (assessment: BrowserStorageAssessment) => void;
  pcmProducer: RealtimePcmProducer;
  queue: AudioChunkQueue;
  recorder: BrowserAudioRecorder;
  storageGuard: BrowserStorageGuard;
}

export interface StartBrowserCaptureInput {
  audioStreamId: string;
  localJobId: string;
  mimeType: string;
  sessionId: string;
  stream: MediaStream;
}

export class BrowserCaptureCore {
  private active: StartBrowserCaptureInput | null = null;
  private checkpointWrite: Promise<void> = Promise.resolve();
  private failing = false;
  private readonly now: () => Date;
  private storageCheck: Promise<void> | null = null;
  private readonly trackEnded = (): void => {
    void this.failCapture('microphone_ended');
  };
  private unsubscribeRecorder: (() => void) | null = null;

  public constructor(private readonly options: BrowserCaptureCoreOptions) {
    this.now = options.now ?? ((): Date => new Date());
  }

  public async start(input: StartBrowserCaptureInput): Promise<BrowserCaptureCheckpoint> {
    validateStart(input);
    if (this.active !== null) throw new Error('browser capture is already active');
    if (!(await this.options.browserLock.acquire())) throw new Error('BROWSER_CAPTURE_LOCKED');

    try {
      const assessment = await this.options.storageGuard.assertCanStart();
      this.options.onStorageAssessment?.(assessment);
      this.active = input;
      this.attachTracks(input.stream);
      this.unsubscribeRecorder = this.options.recorder.subscribe((snapshot) => {
        this.observeRecorder(snapshot);
      });
      await this.writeCheckpoint('starting', true);
      await this.options.recorder.startWithStream(
        { canRecord: true, sessionId: input.sessionId },
        input.stream,
      );
      await this.writeCheckpoint('recording', true);
      try {
        await this.options.pcmProducer.start(input.stream);
      } catch (error) {
        this.options.onRealtimeFailure?.(error);
      }
      const checkpoint = await this.options.checkpointStore.getCaptureCheckpoint(input.localJobId);
      if (checkpoint === null) throw new Error('capture checkpoint missing');
      return checkpoint;
    } catch (error) {
      if (this.active !== null) await this.failCapture('recorder_error', error);
      else await this.options.browserLock.release();
      throw error;
    }
  }

  public async stop(): Promise<ImmutableAudioChunk[]> {
    const active = this.active;
    if (active === null) return [];
    await this.options.pcmProducer.stop().catch((error: unknown) => {
      this.options.onRealtimeFailure?.(error);
    });
    await this.options.recorder.stop();
    await this.writeCheckpoint('stopped', false);
    await this.checkpointWrite;
    const archive = await this.options.queue.restoreArchive(active.sessionId);
    await this.releaseActive();
    return archive;
  }

  private attachTracks(stream: MediaStream): void {
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', this.trackEnded);
  }

  private detachTracks(stream: MediaStream): void {
    for (const track of stream.getAudioTracks())
      track.removeEventListener('ended', this.trackEnded);
  }

  private async failCapture(reason: BrowserCaptureFailureReason, error?: unknown): Promise<void> {
    if (this.failing || this.active === null) return;
    this.failing = true;
    try {
      this.options.onCaptureFailure?.(reason, error);
      await this.options.pcmProducer.stop().catch(() => undefined);
      await this.options.recorder.stop().catch(() => undefined);
      await this.writeCheckpoint('failed', true);
      await this.checkpointWrite;
      await this.releaseActive();
    } finally {
      this.failing = false;
    }
  }

  private observeRecorder(snapshot: AudioCaptureSnapshot): void {
    if (this.active === null) return;
    if (snapshot.status === 'failed') {
      const reason: BrowserCaptureFailureReason =
        snapshot.error?.code === 'AUDIO_BUFFER_CAPACITY_EXCEEDED' ||
        snapshot.error?.code === 'AUDIO_BUFFER_WRITE_FAILED'
          ? 'local_archive_failed'
          : 'recorder_error';
      void this.failCapture(reason, snapshot.error);
      return;
    }
    if (snapshot.status === 'recording' || snapshot.status === 'stopping') {
      void this.writeCheckpoint('recording', true);
      this.storageCheck ??= this.options.storageGuard
        .assertCanContinue()
        .then((assessment) => {
          this.options.onStorageAssessment?.(assessment);
        })
        .catch((error: unknown) => this.failCapture('local_archive_failed', error))
        .finally(() => {
          this.storageCheck = null;
        });
    }
  }

  private writeCheckpoint(
    status: BrowserCaptureCheckpoint['status'],
    dirty: boolean,
  ): Promise<void> {
    const active = this.active;
    if (active === null) return Promise.resolve();
    this.checkpointWrite = this.checkpointWrite.then(async () => {
      const snapshot = await this.options.queue.getArchiveSnapshot(active.sessionId);
      await this.options.checkpointStore.putCaptureCheckpoint({
        archiveHighWaterSequenceNo: snapshot.archiveHighWaterSequenceNo,
        audioStreamId: active.audioStreamId,
        deliveryAcknowledgedHighWaterSequenceNo: snapshot.deliveryAcknowledgedHighWaterSequenceNo,
        dirty,
        localJobId: active.localJobId,
        mimeType: active.mimeType,
        sessionId: active.sessionId,
        status,
        timelineEndMs: snapshot.timelineEndMs,
        updatedAt: this.now().toISOString(),
      });
    });
    return this.checkpointWrite;
  }

  private async releaseActive(): Promise<void> {
    const active = this.active;
    if (active === null) return;
    this.unsubscribeRecorder?.();
    this.unsubscribeRecorder = null;
    this.detachTracks(active.stream);
    for (const track of active.stream.getTracks()) track.stop();
    this.active = null;
    await this.options.browserLock.release();
  }
}

function validateStart(input: StartBrowserCaptureInput): void {
  for (const value of [input.audioStreamId, input.localJobId, input.mimeType, input.sessionId]) {
    if (value.trim().length === 0) throw new TypeError('capture identity is required');
  }
  if (input.stream.getAudioTracks().length === 0) throw new Error('AUDIO_TRACK_REQUIRED');
}
