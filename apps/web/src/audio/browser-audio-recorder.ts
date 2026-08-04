import { AudioCaptureError } from './errors.js';
import type { AudioChunkQueue } from './audio-chunk-queue.js';
import type { BufferedAudioChunk, RecordingSessionContext } from './types.js';

export type AudioCaptureStatus =
  'idle' | 'requesting_permission' | 'recording' | 'stopping' | 'stopped' | 'failed';

export interface AudioCaptureSnapshot {
  error: AudioCaptureError | null;
  persistedChunkCount: number;
  status: AudioCaptureStatus;
}

interface MediaRecorderLike {
  mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onstop: ((event: Event) => void) | null;
  readonly state: RecordingState;
  start(timeslice?: number): void;
  stop(): void;
}

type MediaRecorderFactory = (
  stream: MediaStream,
  options?: MediaRecorderOptions,
) => MediaRecorderLike;

export interface BrowserAudioRecorderOptions {
  clock?: () => number;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>;
  mediaRecorderFactory?: MediaRecorderFactory;
  onStateChange?: (snapshot: AudioCaptureSnapshot) => void;
  supportedMimeTypes?: readonly string[];
  timesliceMs: number;
}

const DEFAULT_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm'] as const;

export class BrowserAudioRecorder {
  private readonly clock: () => number;
  private readonly mediaDevices: Pick<MediaDevices, 'getUserMedia'> | undefined;
  private readonly mediaRecorderFactory: MediaRecorderFactory | undefined;
  private readonly supportedMimeTypes: readonly string[];
  private context: RecordingSessionContext | null = null;
  private readonly listeners = new Set<(snapshot: AudioCaptureSnapshot) => void>();
  private lastChunkClock = 0;
  private nextSequenceNo = 0;
  private recorder: MediaRecorderLike | null = null;
  private recorderStopped: Promise<void> = Promise.resolve();
  private resolveRecorderStopped: (() => void) | null = null;
  private snapshotValue: AudioCaptureSnapshot = {
    error: null,
    persistedChunkCount: 0,
    status: 'idle',
  };
  private stream: MediaStream | null = null;
  private timelineEndMs = 0;
  private writeChain: Promise<void> = Promise.resolve();
  private writeFailure: AudioCaptureError | null = null;

  public constructor(
    private readonly queue: AudioChunkQueue,
    private readonly options: BrowserAudioRecorderOptions,
  ) {
    if (!Number.isSafeInteger(options.timesliceMs) || options.timesliceMs <= 0) {
      throw new RangeError('timesliceMs must be a positive safe integer');
    }
    this.clock = options.clock ?? ((): number => performance.now());
    this.mediaDevices = options.mediaDevices ?? globalThis.navigator.mediaDevices;
    this.mediaRecorderFactory = options.mediaRecorderFactory ?? nativeMediaRecorderFactory();
    this.supportedMimeTypes = options.supportedMimeTypes ?? detectSupportedMimeTypes();
  }

  public get snapshot(): AudioCaptureSnapshot {
    return this.snapshotValue;
  }

  public subscribe(listener: (snapshot: AudioCaptureSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshotValue);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async start(context?: RecordingSessionContext): Promise<void> {
    if (context === undefined || !context.canRecord) {
      throw new AudioCaptureError('RECORDING_NOT_ALLOWED', '外部授权门禁未允许开始录音');
    }
    if (context.sessionId.trim().length === 0) {
      throw new AudioCaptureError('RECORDING_SESSION_REQUIRED', '开始录音需要有效的会话上下文');
    }
    if (
      this.snapshotValue.status === 'requesting_permission' ||
      this.snapshotValue.status === 'recording' ||
      this.snapshotValue.status === 'stopping'
    ) {
      throw new Error('audio capture is already active');
    }
    if (this.mediaDevices === undefined || this.mediaRecorderFactory === undefined) {
      throw new AudioCaptureError('AUDIO_CAPTURE_UNSUPPORTED', '当前浏览器不支持可靠录音采集');
    }

    this.context = context;
    this.writeFailure = null;
    this.transition('requesting_permission', null, 0);
    let recovered: BufferedAudioChunk[];
    try {
      recovered = await this.queue.restore(context.sessionId);
      this.nextSequenceNo = await this.queue.getNextSequenceNo(context.sessionId);
      this.timelineEndMs = await this.queue.getTimelineEndMs(context.sessionId);
    } catch (error) {
      const captureError = new AudioCaptureError(
        'AUDIO_BUFFER_WRITE_FAILED',
        '无法恢复本地原始音频暂存',
        { cause: error },
      );
      this.transition('failed', captureError, 0);
      throw captureError;
    }
    this.transition('requesting_permission', null, recovered.length);

    try {
      this.stream = await this.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (error) {
      const captureError = classifyDeviceError(error);
      this.transition('failed', captureError, recovered.length);
      throw captureError;
    }

    const mimeType = this.supportedMimeTypes[0];
    let recorder: MediaRecorderLike;
    try {
      recorder = this.mediaRecorderFactory(
        this.stream,
        mimeType === undefined ? undefined : { mimeType },
      );
    } catch (error) {
      this.stopTracks();
      this.resolveRecorderStopped?.();
      this.resolveRecorderStopped = null;
      this.recorder = null;
      const captureError = new AudioCaptureError(
        'AUDIO_CAPTURE_UNSUPPORTED',
        '浏览器无法初始化兼容的录音格式',
        { cause: error },
      );
      this.transition('failed', captureError, recovered.length);
      throw captureError;
    }
    this.recorder = recorder;
    this.recorderStopped = new Promise((resolve) => {
      this.resolveRecorderStopped = resolve;
    });
    recorder.ondataavailable = (event): void => {
      this.acceptBlob(event.data);
    };
    recorder.onerror = (): void => {
      const error = new AudioCaptureError('AUDIO_DEVICE_UNAVAILABLE', '浏览器录音器发生设备错误');
      this.fail(error);
    };
    recorder.onstop = (): void => {
      this.stopTracks();
      this.resolveRecorderStopped?.();
      this.resolveRecorderStopped = null;
    };

    this.lastChunkClock = this.clock();
    try {
      recorder.start(this.options.timesliceMs);
    } catch (error) {
      this.stopTracks();
      this.resolveRecorderStopped?.();
      this.resolveRecorderStopped = null;
      this.recorder = null;
      const captureError = new AudioCaptureError(
        'AUDIO_DEVICE_UNAVAILABLE',
        '浏览器录音器无法启动',
        { cause: error },
      );
      this.transition('failed', captureError, recovered.length);
      throw captureError;
    }
    this.transition('recording', null, recovered.length);
  }

  public async stop(): Promise<BufferedAudioChunk[]> {
    const recorder = this.recorder;
    const context = this.context;
    if (recorder === null || context === null) return [];

    if (recorder.state !== 'inactive') {
      if (this.snapshotValue.status !== 'failed') {
        this.transition('stopping', null, this.snapshotValue.persistedChunkCount);
      }
      recorder.stop();
    }
    await this.recorderStopped;
    await this.writeChain;

    if (this.writeFailure !== null) throw this.writeFailure;
    const records = await this.queue.restore(context.sessionId);
    this.transition('stopped', null, records.length);
    return records;
  }

  private acceptBlob(blob: Blob): void {
    if (blob.size === 0 || this.context === null) return;
    const context = this.context;
    const sequenceNo = this.nextSequenceNo;
    this.nextSequenceNo += 1;
    const eventClock = this.clock();
    const elapsed = Math.max(1, Math.round(eventClock - this.lastChunkClock));
    const startedAtMs = Math.ceil(this.timelineEndMs);
    const endedAtMs = startedAtMs + elapsed;
    this.timelineEndMs = endedAtMs;
    this.lastChunkClock = eventClock;

    this.writeChain = this.writeChain
      .then(async () => {
        await this.queue.enqueue({
          blob,
          endedAtMs,
          mimeType: blob.type || this.recorder?.mimeType || 'application/octet-stream',
          sequenceNo,
          sessionId: context.sessionId,
          startedAtMs,
        });
        this.transition(
          this.snapshotValue.status,
          this.snapshotValue.error,
          this.snapshotValue.persistedChunkCount + 1,
        );
      })
      .catch((error: unknown) => {
        this.fail(
          error instanceof AudioCaptureError
            ? error
            : new AudioCaptureError(
                'AUDIO_BUFFER_WRITE_FAILED',
                '原始音频分片未能写入本地可靠暂存',
                { cause: error },
              ),
        );
      });
  }

  private fail(error: AudioCaptureError): void {
    if (this.writeFailure === null) this.writeFailure = error;
    this.transition('failed', this.writeFailure, this.snapshotValue.persistedChunkCount);
    if (this.recorder?.state !== 'inactive') this.recorder?.stop();
  }

  private stopTracks(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }

  private transition(
    status: AudioCaptureStatus,
    error: AudioCaptureError | null,
    persistedChunkCount: number,
  ): void {
    this.snapshotValue = { error, persistedChunkCount, status };
    this.options.onStateChange?.(this.snapshotValue);
    for (const listener of this.listeners) listener(this.snapshotValue);
  }
}

function nativeMediaRecorderFactory(): MediaRecorderFactory | undefined {
  if (typeof globalThis.MediaRecorder === 'undefined') return undefined;
  return (stream, options): MediaRecorderLike => new globalThis.MediaRecorder(stream, options);
}

function detectSupportedMimeTypes(): string[] {
  if (typeof globalThis.MediaRecorder === 'undefined') return [];
  return DEFAULT_MIME_TYPES.filter((mimeType) =>
    globalThis.MediaRecorder.isTypeSupported(mimeType),
  );
}

function classifyDeviceError(error: unknown): AudioCaptureError {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new AudioCaptureError('AUDIO_PERMISSION_DENIED', '麦克风权限被拒绝', { cause: error });
  }
  return new AudioCaptureError('AUDIO_DEVICE_UNAVAILABLE', '无法访问可用的麦克风设备', {
    cause: error,
  });
}
