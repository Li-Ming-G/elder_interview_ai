import { useCallback, useEffect, useState } from 'react';

import { AudioChunkQueue } from './audio-chunk-queue.js';
import { type AudioCaptureSnapshot, BrowserAudioRecorder } from './browser-audio-recorder.js';
import { IndexedDbAudioChunkStore } from './indexeddb-audio-chunk-store.js';
import type { BufferedAudioChunk } from './types.js';

interface AudioBrowserHarnessProps {
  sessionId: string;
}

interface HarnessRuntime {
  queue: AudioChunkQueue;
  recorder: BrowserAudioRecorder;
  source: SyntheticAudioMediaDevices;
}

interface QueueSnapshot {
  chunks: BufferedAudioChunk[];
  nextSequenceNo: number;
  timelineEndMs: number;
}

const EMPTY_QUEUE: QueueSnapshot = {
  chunks: [],
  nextSequenceNo: 0,
  timelineEndMs: 0,
};

export function AudioBrowserHarness({ sessionId }: AudioBrowserHarnessProps): React.JSX.Element {
  const [runtime] = useState<HarnessRuntime>(() => createRuntime());
  const [capture, setCapture] = useState<AudioCaptureSnapshot>(runtime.recorder.snapshot);
  const [queueSnapshot, setQueueSnapshot] = useState<QueueSnapshot>(EMPTY_QUEUE);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshQueue = useCallback(async (): Promise<void> => {
    const [chunks, nextSequenceNo, timelineEndMs] = await Promise.all([
      runtime.queue.restore(sessionId),
      runtime.queue.getNextSequenceNo(sessionId),
      runtime.queue.getTimelineEndMs(sessionId),
    ]);
    setQueueSnapshot({ chunks, nextSequenceNo, timelineEndMs });
  }, [runtime, sessionId]);

  useEffect(() => {
    const unsubscribe = runtime.recorder.subscribe(setCapture);
    void refreshQueue().catch((error: unknown) => {
      setActionError(error instanceof Error ? error.message : '无法读取原生 IndexedDB');
    });
    return (): void => {
      unsubscribe();
      void runtime.source.closeAll();
    };
  }, [refreshQueue, runtime]);

  async function start(): Promise<void> {
    setActionError(null);
    try {
      await runtime.recorder.start({ canRecord: true, sessionId });
    } catch (error) {
      await runtime.source.closeAll();
      setActionError(error instanceof Error ? error.message : '合成音频录制无法开始');
    }
  }

  async function stop(): Promise<void> {
    setActionError(null);
    try {
      await runtime.recorder.stop();
      await runtime.source.closeAll();
      await refreshQueue();
    } catch (error) {
      await runtime.source.closeAll();
      setActionError(error instanceof Error ? error.message : '合成音频录制无法停止');
    }
  }

  async function acknowledgeFirst(): Promise<void> {
    const first = queueSnapshot.chunks[0];
    if (first === undefined) return;
    setActionError(null);
    try {
      const acknowledged = await runtime.queue.acknowledge(
        sessionId,
        first.chunk.sequenceNo,
        first.chunk.checksumSha256,
      );
      if (!acknowledged) throw new Error('测试 ACK 未匹配现有分片');
      await refreshQueue();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '测试 ACK 失败');
    }
  }

  return (
    <main data-testid="audio-browser-harness">
      <p className="eyebrow">DEV-003A · Chromium only</p>
      <h1>原生浏览器音频持久化验证</h1>
      <p>仅使用 Web Audio 合成测试音，不访问真实麦克风、不连接服务端。</p>
      <dl>
        <dt>session</dt>
        <dd data-testid="session-id">{sessionId}</dd>
        <dt>source</dt>
        <dd data-testid="audio-source">web-audio-oscillator</dd>
        <dt>MediaRecorder</dt>
        <dd data-testid="media-recorder-runtime">
          {typeof globalThis.MediaRecorder === 'function' ? 'native-available' : 'unavailable'}
        </dd>
        <dt>IndexedDB</dt>
        <dd data-testid="indexeddb-runtime">
          {Object.prototype.toString.call(globalThis.indexedDB)}
        </dd>
        <dt>capture status</dt>
        <dd data-testid="capture-status">{capture.status}</dd>
        <dt>persisted during capture</dt>
        <dd data-testid="persisted-count">{capture.persistedChunkCount}</dd>
        <dt>next sequence</dt>
        <dd data-testid="next-sequence">{queueSnapshot.nextSequenceNo}</dd>
        <dt>timeline end (ms)</dt>
        <dd data-testid="timeline-end">{queueSnapshot.timelineEndMs}</dd>
      </dl>
      <button
        disabled={capture.status === 'recording' || capture.status === 'stopping'}
        onClick={() => {
          void start();
        }}
        type="button"
      >
        开始合成录音
      </button>
      <button
        disabled={capture.status !== 'recording'}
        onClick={() => {
          void stop();
        }}
        type="button"
      >
        停止并持久化
      </button>
      <button
        disabled={queueSnapshot.chunks.length === 0}
        onClick={() => {
          void acknowledgeFirst();
        }}
        type="button"
      >
        ACK 第一片
      </button>
      <p data-testid="chunk-count">待上传分片：{queueSnapshot.chunks.length}</p>
      <ol aria-label="待上传音频分片">
        {queueSnapshot.chunks.map(({ chunk }) => (
          <li
            data-byte-length={chunk.byteLength}
            data-checksum={chunk.checksumSha256}
            data-ended-at-ms={chunk.endedAtMs}
            data-mime-type={chunk.mimeType}
            data-sequence-no={chunk.sequenceNo}
            data-started-at-ms={chunk.startedAtMs}
            data-testid="audio-chunk"
            key={chunk.key}
          >
            seq {chunk.sequenceNo} · {chunk.byteLength} bytes · {chunk.mimeType}
          </li>
        ))}
      </ol>
      {actionError === null ? null : <p role="alert">{actionError}</p>}
    </main>
  );
}

function createRuntime(): HarnessRuntime {
  const source = new SyntheticAudioMediaDevices();
  const queue = new AudioChunkQueue(new IndexedDbAudioChunkStore(), {
    maximumBufferedBytes: 5 * 1024 * 1024,
  });
  const recorder = new BrowserAudioRecorder(queue, {
    mediaDevices: source,
    timesliceMs: 200,
  });
  return { queue, recorder, source };
}

class SyntheticAudioMediaDevices implements Pick<MediaDevices, 'getUserMedia'> {
  private readonly active = new Set<{ context: AudioContext; oscillator: OscillatorNode }>();

  public async getUserMedia(): Promise<MediaStream> {
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
    this.active.add({ context, oscillator });
    return destination.stream;
  }

  public async closeAll(): Promise<void> {
    const active = [...this.active];
    this.active.clear();
    await Promise.all(
      active.map(async ({ context, oscillator }) => {
        try {
          oscillator.stop();
        } catch {
          // The oscillator may already be stopped during page teardown.
        }
        if (context.state !== 'closed') await context.close();
      }),
    );
  }
}
