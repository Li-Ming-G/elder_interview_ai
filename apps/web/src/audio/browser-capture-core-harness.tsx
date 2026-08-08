import { useCallback, useEffect, useRef, useState } from 'react';

import { AudioChunkQueue } from './audio-chunk-queue.js';
import { AudioUploadJobRunner } from './audio-upload-job.js';
import { BrowserAudioRecorder } from './browser-audio-recorder.js';
import { BrowserCaptureCore } from './browser-capture-core.js';
import { BrowserStorageGuard } from './browser-storage-guard.js';
import { IndexedDbAudioChunkStore } from './indexeddb-audio-chunk-store.js';
import { PcmAudioWorkletProducer } from './pcm-audio-worklet-producer.js';
import { SequentialAudioDeliveryPump } from './sequential-delivery-pump.js';
import { SessionBrowserLock } from './session-browser-lock.js';
import type { AudioArchiveSnapshot, BrowserCaptureCheckpoint } from './types.js';

interface BrowserCaptureCoreHarnessProps {
  sessionId: string;
}

const EMPTY_ARCHIVE: AudioArchiveSnapshot = {
  archiveByteLength: 0,
  archiveChunkCount: 0,
  archiveHighWaterSequenceNo: -1,
  deliveryAcknowledgedHighWaterSequenceNo: -1,
  pendingDeliveryCount: 0,
  timelineEndMs: 0,
};

export function BrowserCaptureCoreHarness({
  sessionId,
}: BrowserCaptureCoreHarnessProps): React.JSX.Element {
  const localJobId = `${sessionId}:capture-job`;
  const audioStreamId = `${sessionId}:stream-0`;
  const [archive, setArchive] = useState(EMPTY_ARCHIVE);
  const [checkpoint, setCheckpoint] = useState<BrowserCaptureCheckpoint | null>(null);
  const [captureStatus, setCaptureStatus] = useState('idle');
  const [failure, setFailure] = useState('none');
  const [pcmFrames, setPcmFrames] = useState(0);
  const [pcmFrameBytes, setPcmFrameBytes] = useState(0);
  const [requestId, setRequestId] = useState('none');
  const frameCount = useRef(0);
  const [runtime] = useState(() => {
    const source = new SyntheticSingleStreamSource();
    const store = new IndexedDbAudioChunkStore();
    const queue = new AudioChunkQueue(store, { maximumBufferedBytes: 5 * 1024 * 1024 });
    const recorder = new BrowserAudioRecorder(queue, {
      mediaDevices: {
        getUserMedia: (): Promise<MediaStream> =>
          Promise.reject(new Error('capture core must not call getUserMedia')),
      },
      timesliceMs: 200,
    });
    const producer = new PcmAudioWorkletProducer({
      onBackpressure: (): void => {
        setFailure('realtime_backpressure');
      },
      onFailure: (): void => {
        setFailure('realtime_failed');
      },
      onFrame: (pcm): boolean => {
        frameCount.current += 1;
        setPcmFrames(frameCount.current);
        setPcmFrameBytes(pcm.byteLength);
        return frameCount.current <= 20;
      },
    });
    const core = new BrowserCaptureCore({
      browserLock: new SessionBrowserLock(sessionId),
      checkpointStore: store,
      onCaptureFailure: (reason): void => {
        setFailure(reason);
        setCaptureStatus('failed');
      },
      onRealtimeFailure: (): void => {
        setFailure('realtime_failed');
      },
      pcmProducer: producer,
      queue,
      recorder,
      storageGuard: new BrowserStorageGuard({
        estimate: (): Promise<StorageEstimate> =>
          Promise.resolve({ quota: 512 * 1024 * 1024, usage: 1024 }),
        runCanary: (): Promise<void> => queue.runCanary(),
      }),
    });
    const uploader = new AudioUploadJobRunner(queue, store);
    const pump = new SequentialAudioDeliveryPump(queue, store);
    return { core, pump, queue, source, store, uploader };
  });

  const refresh = useCallback(async (): Promise<void> => {
    const [nextArchive, nextCheckpoint, job] = await Promise.all([
      runtime.queue.getArchiveSnapshot(sessionId),
      runtime.store.getCaptureCheckpoint(localJobId),
      runtime.store.getUploadJob(localJobId),
    ]);
    setArchive(nextArchive);
    setCheckpoint(nextCheckpoint);
    setRequestId(job?.chunkRequestIds['0'] ?? job?.createRequestId ?? 'none');
  }, [localJobId, runtime, sessionId]);

  useEffect(() => {
    void refresh();
    return (): void => {
      void runtime.source.close();
    };
  }, [refresh, runtime]);

  useEffect(() => {
    if (captureStatus !== 'recording') return undefined;
    const interval = globalThis.setInterval((): void => {
      void refresh();
    }, 100);
    return (): void => {
      globalThis.clearInterval(interval);
    };
  }, [captureStatus, refresh]);

  async function start(): Promise<void> {
    setFailure('none');
    try {
      let job = await runtime.store.getUploadJob(localJobId);
      if (job === null) {
        job = await runtime.uploader.create({
          bufferSessionId: sessionId,
          jobId: localJobId,
          mimeType: 'audio/webm;codecs=opus',
          projectId: 'r2c-local-project',
          purpose: 'interview',
          serverSessionId: sessionId,
        });
      }
      const stream = await runtime.source.create();
      await runtime.core.start({
        audioStreamId,
        localJobId,
        mimeType: job.mimeType,
        sessionId,
        stream,
      });
      setCaptureStatus('recording');
      await refresh();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'capture_start_failed');
      setCaptureStatus('failed');
    }
  }

  async function stop(): Promise<void> {
    try {
      await runtime.core.stop();
      setCaptureStatus('stopped');
      await refresh();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'capture_stop_failed');
    }
  }

  async function acknowledgeDelivery(): Promise<void> {
    try {
      await runtime.pump.deliverPending(localJobId, (): Promise<boolean> => Promise.resolve(true));
      await refresh();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'delivery_failed');
    }
  }

  return (
    <main data-testid="capture-core-harness">
      <h1>DEV-005R2C browser capture core harness</h1>
      <dl>
        <dt>capture</dt>
        <dd data-testid="core-capture-status">{captureStatus}</dd>
        <dt>source creations</dt>
        <dd data-testid="source-create-count">{runtime.source.createCount}</dd>
        <dt>archive chunks</dt>
        <dd data-testid="archive-count">{archive.archiveChunkCount}</dd>
        <dt>pending delivery</dt>
        <dd data-testid="delivery-count">{archive.pendingDeliveryCount}</dd>
        <dt>archive high-water</dt>
        <dd data-testid="archive-high-water">{archive.archiveHighWaterSequenceNo}</dd>
        <dt>delivery ACK high-water</dt>
        <dd data-testid="delivery-high-water">{archive.deliveryAcknowledgedHighWaterSequenceNo}</dd>
        <dt>timeline end</dt>
        <dd data-testid="archive-timeline">{archive.timelineEndMs}</dd>
        <dt>checkpoint dirty</dt>
        <dd data-testid="checkpoint-dirty">{String(checkpoint?.dirty ?? false)}</dd>
        <dt>checkpoint stream</dt>
        <dd data-testid="checkpoint-stream">{checkpoint?.audioStreamId ?? 'none'}</dd>
        <dt>PCM frames</dt>
        <dd data-testid="pcm-frame-count">{pcmFrames}</dd>
        <dt>PCM bytes</dt>
        <dd data-testid="pcm-frame-bytes">{pcmFrameBytes}</dd>
        <dt>stable request</dt>
        <dd data-testid="delivery-request-id">{requestId}</dd>
        <dt>failure</dt>
        <dd data-testid="core-failure">{failure}</dd>
      </dl>
      <button
        data-testid="core-start"
        disabled={captureStatus === 'recording'}
        onClick={() => void start()}
        type="button"
      >
        Start injected stream
      </button>
      <button
        data-testid="core-stop"
        disabled={captureStatus !== 'recording'}
        onClick={() => void stop()}
        type="button"
      >
        Stop capture
      </button>
      <button
        data-testid="delivery-ack"
        disabled={archive.pendingDeliveryCount === 0}
        onClick={() => void acknowledgeDelivery()}
        type="button"
      >
        ACK delivery references
      </button>
    </main>
  );
}

class SyntheticSingleStreamSource {
  private context: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  public createCount = 0;

  public async create(): Promise<MediaStream> {
    if (this.context !== null) throw new Error('synthetic stream already active');
    this.createCount += 1;
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
      // Page teardown may stop the synthetic source first.
    }
    this.oscillator = null;
    const context = this.context;
    this.context = null;
    if (context !== null && context.state !== 'closed') await context.close();
  }
}
