import { AudioChunkQueue } from '../audio/audio-chunk-queue.js';
import { BrowserAudioRecorder } from '../audio/browser-audio-recorder.js';
import { BrowserCaptureCore } from '../audio/browser-capture-core.js';
import { BrowserStorageGuard } from '../audio/browser-storage-guard.js';
import { IndexedDbAudioChunkStore } from '../audio/indexeddb-audio-chunk-store.js';
import { PcmAudioWorkletProducer } from '../audio/pcm-audio-worklet-producer.js';
import { SequentialAudioDeliveryPump } from '../audio/sequential-delivery-pump.js';
import { SessionBrowserLock } from '../audio/session-browser-lock.js';
import type {
  AudioChunkStore,
  AudioUploadJobStore,
  BrowserCaptureCheckpointStore,
} from '../audio/types.js';
import {
  RealtimeTranscriptionTransport,
  type RealtimeState,
} from '../realtime-transcription/realtime-transport.js';
import type { InterviewApi, InterviewCaptureApi } from './interview-api.js';
import {
  InterviewCaptureController,
  interviewCaptureLocalJobId,
  type InterviewCaptureRuntime,
  type InterviewCaptureRuntimeFactoryInput,
} from './interview-capture-controller.js';

const DEFAULT_MAXIMUM_ARCHIVE_BYTES = 512 * 1024 * 1024;
const DEFAULT_ARCHIVE_TIMESLICE_MS = 1_000;
const SUPPORTED_INTERVIEW_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm'] as const;

type BrowserCaptureStore = AudioChunkStore & AudioUploadJobStore & BrowserCaptureCheckpointStore;

export interface BrowserInterviewCaptureControllerOptions {
  api: InterviewApi & InterviewCaptureApi;
  archiveTimesliceMs?: number;
  csrfToken: string;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  maximumArchiveBytes?: number;
  projectId: string;
  requestId?: () => string;
  sessionId: string;
  store?: BrowserCaptureStore;
}

export function createBrowserInterviewCaptureController(
  options: BrowserInterviewCaptureControllerOptions,
): InterviewCaptureController {
  const store = options.store ?? new IndexedDbAudioChunkStore();
  const queue = new AudioChunkQueue(store, {
    maximumBufferedBytes: options.maximumArchiveBytes ?? DEFAULT_MAXIMUM_ARCHIVE_BYTES,
  });
  const lock = new SessionBrowserLock(options.sessionId);
  const storageGuard = new BrowserStorageGuard({
    runCanary: (): Promise<void> => queue.runCanary(),
  });
  const pump = new SequentialAudioDeliveryPump(queue, store, {
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
  });

  return new InterviewCaptureController({
    api: options.api,
    browserLock: lock,
    checkpointStore: store,
    createRuntime: (runtimeInput): InterviewCaptureRuntime =>
      createRuntime(
        runtimeInput,
        queue,
        store,
        lock,
        storageGuard,
        options.csrfToken,
        options.sessionId,
        options.archiveTimesliceMs ?? DEFAULT_ARCHIVE_TIMESLICE_MS,
      ),
    ...(options.getUserMedia === undefined ? {} : { getUserMedia: options.getUserMedia }),
    jobs: store,
    mimeType: selectInterviewArchiveMimeType,
    projectId: options.projectId,
    pump,
    queue,
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    sessionId: options.sessionId,
    storageGuard,
  });
}

export function selectInterviewArchiveMimeType(): string {
  if (typeof globalThis.MediaRecorder === 'undefined') throw new Error('AUDIO_CAPTURE_UNSUPPORTED');
  const mimeType = SUPPORTED_INTERVIEW_MIME_TYPES.find((candidate) =>
    globalThis.MediaRecorder.isTypeSupported(candidate),
  );
  if (mimeType === undefined) throw new Error('AUDIO_CAPTURE_UNSUPPORTED');
  return mimeType;
}

function createRuntime(
  input: InterviewCaptureRuntimeFactoryInput,
  queue: AudioChunkQueue,
  checkpointStore: BrowserCaptureCheckpointStore,
  lock: SessionBrowserLock,
  storageGuard: BrowserStorageGuard,
  csrfToken: string,
  sessionId: string,
  archiveTimesliceMs: number,
): InterviewCaptureRuntime {
  const transport = new RealtimeTranscriptionTransport({
    audioStreamId: input.audioStreamId,
    csrfToken,
    sessionId,
  });
  let lastPersistedChunkCount = -1;
  const recorder = new BrowserAudioRecorder(queue, {
    onStateChange: (snapshot): void => {
      if (snapshot.persistedChunkCount !== lastPersistedChunkCount) {
        lastPersistedChunkCount = snapshot.persistedChunkCount;
        input.onArchiveProgress();
      }
    },
    supportedMimeTypes: [input.mimeType],
    timesliceMs: archiveTimesliceMs,
  });
  const deferredPcm = new DeferredRealtimePcmProducer(transport);
  const core = new BrowserCaptureCore({
    browserLock: lock,
    checkpointStore,
    onCaptureFailure: (reason, error): void => {
      input.onCaptureFailure(reason, error);
    },
    onRealtimeFailure: (error): void => {
      input.onRealtimeState({
        ...EMPTY_REALTIME_STATE,
        connection: 'unavailable',
        errorCode: error instanceof Error ? error.message : 'REALTIME_UNAVAILABLE',
        failureKind: 'internal',
      });
    },
    pcmProducer: deferredPcm,
    queue,
    recorder,
    storageGuard,
  });
  const unsubscribe = transport.subscribe((state): void => {
    input.onRealtimeState(state);
  });
  let disposed = false;

  async function disposeRealtime(): Promise<void> {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    await deferredPcm.stop();
  }

  return {
    activateRealtime: (): Promise<void> => deferredPcm.activate(),
    interrupt: async (): Promise<void> => {
      await core.interrupt();
      await disposeRealtime();
    },
    start: (stream): Promise<void> =>
      core
        .start({
          audioStreamId: input.audioStreamId,
          localJobId: interviewCaptureLocalJobId(sessionId),
          mimeType: input.mimeType,
          sessionId,
          stream,
        })
        .then(() => undefined),
    stop: async (): Promise<import('../audio/types.js').ImmutableAudioChunk[]> => {
      const archive = await core.stop();
      await disposeRealtime();
      return archive;
    },
  };
}

class DeferredRealtimePcmProducer {
  private active = false;
  private producer: PcmAudioWorkletProducer | null = null;
  private stream: MediaStream | null = null;

  public constructor(private readonly transport: RealtimeTranscriptionTransport) {}

  public start(stream: MediaStream): Promise<void> {
    if (this.stream !== null) return Promise.reject(new Error('PCM producer is already active'));
    this.stream = stream;
    return Promise.resolve();
  }

  public async activate(): Promise<void> {
    if (this.active) return;
    const stream = this.stream;
    if (stream === null) throw new Error('PCM_STREAM_NOT_READY');
    this.transport.connect();
    const producer = new PcmAudioWorkletProducer({
      onFrame: (pcm): Promise<boolean> => this.transport.sendPcmFrame(pcm),
    });
    this.producer = producer;
    try {
      await producer.start(stream);
      this.active = true;
    } catch (error) {
      this.producer = null;
      this.transport.disconnect();
      throw error;
    }
  }

  public async stop(): Promise<void> {
    const producer = this.producer;
    this.producer = null;
    this.stream = null;
    this.active = false;
    await producer?.stop().catch(() => undefined);
    this.transport.disconnect();
  }
}

const EMPTY_REALTIME_STATE: RealtimeState = {
  connection: 'closed',
  errorCode: null,
  failureKind: null,
  finals: [],
  interim: null,
  pendingBytes: 0,
  pendingFrames: 0,
  resetRequired: false,
  resumed: false,
};
