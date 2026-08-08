import { useCallback, useEffect, useRef, useState } from 'react';

import { AudioChunkQueue } from '../audio/audio-chunk-queue.js';
import { BrowserAudioRecorder } from '../audio/browser-audio-recorder.js';
import { BrowserCaptureCore } from '../audio/browser-capture-core.js';
import { BrowserStorageGuard } from '../audio/browser-storage-guard.js';
import { IndexedDbAudioChunkStore } from '../audio/indexeddb-audio-chunk-store.js';
import { PcmAudioWorkletProducer } from '../audio/pcm-audio-worklet-producer.js';
import { SequentialAudioDeliveryPump } from '../audio/sequential-delivery-pump.js';
import { SessionBrowserLock } from '../audio/session-browser-lock.js';
import type { RealtimeState } from '../realtime-transcription/realtime-transport.js';
import { createInterviewApi } from './interview-api.js';
import {
  InterviewCaptureController,
  interviewCaptureLocalJobId,
  type CaptureStopHandoff,
  type InterviewCaptureControllerSnapshot,
  type InterviewCaptureRuntime,
  type InterviewCaptureRuntimeFactoryInput,
} from './interview-capture-controller.js';

interface InterviewCaptureControllerHarnessProps {
  projectId: string;
  sessionId: string;
}

export function InterviewCaptureControllerHarness({
  projectId,
  sessionId,
}: InterviewCaptureControllerHarnessProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<InterviewCaptureControllerSnapshot | null>(null);
  const [failure, setFailure] = useState('none');
  const [handoff, setHandoff] = useState<CaptureStopHandoff | null>(null);
  const [pcmFrames, setPcmFrames] = useState(0);
  const [pcmBytes, setPcmBytes] = useState(0);
  const sourceCreates = useRef(0);
  const [runtime] = useState(
    (): {
      controller: InterviewCaptureController;
      source: SyntheticInterviewStreamSource;
      store: IndexedDbAudioChunkStore;
    } => {
      const store = new IndexedDbAudioChunkStore();
      const queue = new AudioChunkQueue(store, { maximumBufferedBytes: 32 * 1024 * 1024 });
      const lock = new SessionBrowserLock(sessionId);
      const storageGuard = new BrowserStorageGuard({
        estimate: (): Promise<StorageEstimate> =>
          Promise.resolve({ quota: 512 * 1024 * 1024, usage: 1024 }),
        runCanary: (): Promise<void> => queue.runCanary(),
      });
      const source = new SyntheticInterviewStreamSource(() => {
        sourceCreates.current += 1;
      });
      const controller = new InterviewCaptureController({
        api: createInterviewApi('fictional-controller-csrf'),
        browserLock: lock,
        checkpointStore: store,
        createRuntime: (input): InterviewCaptureRuntime =>
          createRuntime(
            input,
            queue,
            store,
            lock,
            storageGuard,
            setPcmFrames,
            setPcmBytes,
            sessionId,
          ),
        getUserMedia: (): Promise<MediaStream> => source.create(),
        jobs: store,
        mimeType: (): string => 'audio/webm;codecs=opus',
        projectId,
        pump: new SequentialAudioDeliveryPump(queue, store),
        queue,
        sessionId,
        storageGuard,
      });
      return { controller, source, store };
    },
  );

  const refresh = useCallback((): Promise<void> => {
    setSnapshot(runtime.controller.snapshot);
    return Promise.resolve();
  }, [runtime]);

  useEffect(() => {
    const unsubscribe = runtime.controller.subscribe(setSnapshot);
    return (): void => {
      unsubscribe();
      void runtime.source.close();
    };
  }, [runtime]);

  async function run(operation: () => Promise<unknown>): Promise<void> {
    setFailure('none');
    try {
      await operation();
      await refresh();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'capture_failed');
      await refresh();
    }
  }

  async function freeze(): Promise<void> {
    await run(async () => {
      setHandoff(await runtime.controller.stopAndFreeze());
    });
  }

  return (
    <main data-testid="interview-controller-harness">
      <h1>DEV-005R2 formal InterviewCaptureController harness</h1>
      <dl>
        <dt>phase</dt>
        <dd data-testid="controller-phase">{snapshot?.phase ?? 'idle'}</dd>
        <dt>source creations</dt>
        <dd data-testid="controller-source-count">{sourceCreates.current}</dd>
        <dt>job</dt>
        <dd data-testid="controller-job">
          {snapshot?.localJobId ?? interviewCaptureLocalJobId(sessionId)}
        </dd>
        <dt>object</dt>
        <dd data-testid="controller-object">{snapshot?.audioObjectId ?? 'none'}</dd>
        <dt>stream</dt>
        <dd data-testid="controller-stream">{snapshot?.audioStreamId ?? 'none'}</dd>
        <dt>generation</dt>
        <dd data-testid="controller-generation">{snapshot?.generationNo ?? -1}</dd>
        <dt>archive chunks</dt>
        <dd data-testid="controller-archive-count">{snapshot?.archive.archiveChunkCount ?? 0}</dd>
        <dt>pending delivery</dt>
        <dd data-testid="controller-delivery-count">
          {snapshot?.archive.pendingDeliveryCount ?? 0}
        </dd>
        <dt>archive high-water</dt>
        <dd data-testid="controller-archive-high-water">
          {snapshot?.archive.archiveHighWaterSequenceNo ?? -1}
        </dd>
        <dt>delivery high-water</dt>
        <dd data-testid="controller-delivery-high-water">
          {snapshot?.archive.deliveryAcknowledgedHighWaterSequenceNo ?? -1}
        </dd>
        <dt>timeline</dt>
        <dd data-testid="controller-timeline">{snapshot?.archive.timelineEndMs ?? 0}</dd>
        <dt>PCM frames</dt>
        <dd data-testid="controller-pcm-frames">{pcmFrames}</dd>
        <dt>PCM bytes</dt>
        <dd data-testid="controller-pcm-bytes">{pcmBytes}</dd>
        <dt>handoff chunks</dt>
        <dd data-testid="controller-handoff-count">{handoff?.expectedChunkCount ?? -1}</dd>
        <dt>handoff stop request</dt>
        <dd data-testid="controller-stop-request">{handoff?.stopRequestId ?? 'none'}</dd>
        <dt>failure</dt>
        <dd data-testid="controller-failure">{failure}</dd>
      </dl>
      <button
        data-testid="controller-start"
        onClick={() => void run(() => runtime.controller.start())}
        type="button"
      >
        Start formal capture
      </button>
      <button
        data-testid="controller-recover"
        onClick={() => void run(() => runtime.controller.recover())}
        type="button"
      >
        Inspect refresh recovery
      </button>
      <button
        data-testid="controller-resume"
        onClick={() => void run(() => runtime.controller.resume())}
        type="button"
      >
        Resume capture
      </button>
      <button data-testid="controller-freeze" onClick={() => void freeze()} type="button">
        Freeze safe handoff
      </button>
    </main>
  );
}

function createRuntime(
  input: InterviewCaptureRuntimeFactoryInput,
  queue: AudioChunkQueue,
  checkpointStore: IndexedDbAudioChunkStore,
  lock: SessionBrowserLock,
  storageGuard: BrowserStorageGuard,
  setPcmFrames: React.Dispatch<React.SetStateAction<number>>,
  setPcmBytes: React.Dispatch<React.SetStateAction<number>>,
  sessionId: string,
): InterviewCaptureRuntime {
  const deferredPcm = new HarnessDeferredPcmProducer(setPcmFrames, setPcmBytes);
  const recorder = new BrowserAudioRecorder(queue, {
    onStateChange: (): void => {
      input.onArchiveProgress();
    },
    supportedMimeTypes: [input.mimeType],
    timesliceMs: 200,
  });
  const core = new BrowserCaptureCore({
    browserLock: lock,
    checkpointStore,
    onCaptureFailure: (reason, error): void => {
      input.onCaptureFailure(reason, error);
    },
    onRealtimeFailure: (): void => {
      input.onRealtimeState(unavailableRealtime());
    },
    pcmProducer: deferredPcm,
    queue,
    recorder,
    storageGuard,
  });
  return {
    activateRealtime: (): Promise<void> => deferredPcm.activate(),
    interrupt: (): Promise<void> => core.interrupt(),
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
    stop: (): Promise<import('../audio/types.js').ImmutableAudioChunk[]> => core.stop(),
  };
}

class HarnessDeferredPcmProducer {
  private producer: PcmAudioWorkletProducer | null = null;
  private stream: MediaStream | null = null;

  public constructor(
    private readonly setFrames: React.Dispatch<React.SetStateAction<number>>,
    private readonly setBytes: React.Dispatch<React.SetStateAction<number>>,
  ) {}

  public start(stream: MediaStream): Promise<void> {
    this.stream = stream;
    return Promise.resolve();
  }

  public async activate(): Promise<void> {
    if (this.producer !== null) return;
    const stream = this.stream;
    if (stream === null) throw new Error('PCM_STREAM_NOT_READY');
    const producer = new PcmAudioWorkletProducer({
      onFrame: (pcm): boolean => {
        this.setFrames((value) => value + 1);
        this.setBytes(pcm.byteLength);
        return true;
      },
    });
    this.producer = producer;
    await producer.start(stream);
  }

  public async stop(): Promise<void> {
    const producer = this.producer;
    this.producer = null;
    this.stream = null;
    await producer?.stop();
  }
}

class SyntheticInterviewStreamSource {
  private context: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;

  public constructor(private readonly onCreate: () => void) {}

  public async create(): Promise<MediaStream> {
    if (this.context !== null) throw new Error('synthetic stream already active');
    this.onCreate();
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const destination = context.createMediaStreamDestination();
    oscillator.frequency.value = 440;
    gain.gain.value = 0.1;
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
    await context.resume();
    this.context = context;
    this.oscillator = oscillator;
    return destination.stream;
  }

  public async close(): Promise<void> {
    try {
      this.oscillator?.stop();
    } catch {
      // Browser teardown may already stop the source.
    }
    this.oscillator = null;
    const context = this.context;
    this.context = null;
    if (context !== null && context.state !== 'closed') await context.close();
  }
}

function unavailableRealtime(): RealtimeState {
  return {
    connection: 'unavailable',
    errorCode: 'REALTIME_UNAVAILABLE',
    failureKind: 'internal',
    finals: [],
    interim: null,
    pendingBytes: 0,
    pendingFrames: 0,
    resetRequired: false,
    resumed: false,
  };
}
