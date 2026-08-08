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
        this.reportRealtimeFailure(error);
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
    let archive: ImmutableAudioChunk[] = [];
    let firstError: unknown;
    try {
      await this.options.recorder.stop();
      archive = await this.options.queue.restoreArchive(active.sessionId);
      await this.writeCheckpoint('stopped', false);
    } catch (error) {
      firstError = error;
    } finally {
      this.stopRealtimeWithoutBlockingArchive();
      try {
        await this.releaseActive();
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== undefined) throw toError(firstError);
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
      try {
        this.options.onCaptureFailure?.(reason, error);
      } catch {
        // Observer failures cannot prevent raw archive finalization and cleanup.
      }
      await this.options.recorder.stop().catch(() => undefined);
      await this.writeCheckpoint('failed', true).catch(() => undefined);
    } finally {
      this.stopRealtimeWithoutBlockingArchive();
      await this.releaseActive().catch(() => undefined);
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
      void this.writeCheckpoint('recording', true).catch((error: unknown) =>
        this.failCapture('local_archive_failed', error),
      );
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
    const write = this.checkpointWrite.then(async () => {
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
    this.checkpointWrite = write.catch(() => undefined);
    return write;
  }

  private async releaseActive(): Promise<void> {
    const active = this.active;
    if (active === null) return;
    let firstError: unknown;
    try {
      this.unsubscribeRecorder?.();
    } catch (error) {
      firstError = error;
    }
    this.unsubscribeRecorder = null;
    try {
      this.detachTracks(active.stream);
    } catch (error) {
      firstError ??= error;
    }
    let tracks: MediaStreamTrack[] = [];
    try {
      tracks = active.stream.getTracks();
    } catch (error) {
      firstError ??= error;
    }
    for (const track of tracks) {
      try {
        track.stop();
      } catch (error) {
        firstError ??= error;
      }
    }
    this.active = null;
    try {
      await this.options.browserLock.release();
    } catch (error) {
      firstError ??= error;
    }
    if (firstError !== undefined) throw toError(firstError);
  }

  private stopRealtimeWithoutBlockingArchive(): void {
    try {
      void this.options.pcmProducer.stop().catch((error: unknown) => {
        this.reportRealtimeFailure(error);
      });
    } catch (error) {
      this.reportRealtimeFailure(error);
    }
  }

  private reportRealtimeFailure(error: unknown): void {
    try {
      this.options.onRealtimeFailure?.(error);
    } catch {
      // Realtime observers are advisory and cannot affect raw archive ownership.
    }
  }
}

function toError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error('browser capture cleanup failed', { cause: value });
}

function validateStart(input: StartBrowserCaptureInput): void {
  for (const value of [input.audioStreamId, input.localJobId, input.mimeType, input.sessionId]) {
    if (value.trim().length === 0) throw new TypeError('capture identity is required');
  }
  if (input.stream.getAudioTracks().length === 0) throw new Error('AUDIO_TRACK_REQUIRED');
}
