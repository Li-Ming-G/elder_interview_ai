import { useCallback, useEffect, useState } from 'react';

import { AudioChunkQueue } from './audio-chunk-queue.js';
import { AudioUploadJobRunner } from './audio-upload-job.js';
import { type AudioCaptureSnapshot, BrowserAudioRecorder } from './browser-audio-recorder.js';
import { IndexedDbAudioChunkStore } from './indexeddb-audio-chunk-store.js';
import type { BufferedAudioChunk } from './types.js';

interface AudioBrowserHarnessProps {
  projectId: string | null;
  sessionId: string;
}

interface HarnessRuntime {
  queue: AudioChunkQueue;
  recorder: BrowserAudioRecorder;
  source: SyntheticAudioMediaDevices;
  store: IndexedDbAudioChunkStore;
  uploader: AudioUploadJobRunner;
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

export function AudioBrowserHarness({
  projectId,
  sessionId,
}: AudioBrowserHarnessProps): React.JSX.Element {
  const [runtime] = useState<HarnessRuntime>(() => createRuntime());
  const [capture, setCapture] = useState<AudioCaptureSnapshot>(runtime.recorder.snapshot);
  const [queueSnapshot, setQueueSnapshot] = useState<QueueSnapshot>(EMPTY_QUEUE);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState('not-configured');
  const [audioObjectId, setAudioObjectId] = useState<string | null>(null);
  const jobId = projectId === null ? null : `${projectId}:${sessionId}:consent`;

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
    if (jobId !== null) {
      void runtime.store.getUploadJob(jobId).then((job) => {
        if (job === null) return;
        setUploadStatus(job.status);
        setAudioObjectId(job.audioObjectId);
      });
    }
    return (): void => {
      unsubscribe();
      void runtime.source.closeAll();
    };
  }, [jobId, refreshQueue, runtime]);

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
      if (projectId !== null && jobId !== null) await ensureFrozenUploadJob(projectId, jobId);
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

  async function uploadAndComplete(): Promise<void> {
    if (projectId === null || jobId === null) return;
    setActionError(null);
    try {
      await ensureFrozenUploadJob(projectId, jobId);
      const csrfResponse = await fetch('/api/v1/auth/csrf', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!csrfResponse.ok) throw new Error(`CSRF_${String(csrfResponse.status)}`);
      const csrf = (await csrfResponse.json()) as { csrf_token: string };
      const result = await runtime.uploader.resume(jobId, csrf.csrf_token);
      setUploadStatus(result.status);
      setAudioObjectId(result.audioObjectId);
      if (result.status === 'failed') throw new Error(result.lastError ?? '上传失败');
      await refreshQueue();
    } catch (error) {
      const persisted = await runtime.store.getUploadJob(jobId);
      if (persisted !== null) {
        setUploadStatus(persisted.status);
        setAudioObjectId(persisted.audioObjectId);
      }
      await refreshQueue();
      setActionError(error instanceof Error ? error.message : '上传失败');
    }
  }

  async function ensureFrozenUploadJob(project: string, uploadJobId: string): Promise<void> {
    let existing = await runtime.store.getUploadJob(uploadJobId);
    if (existing === null) {
      const first = (await runtime.queue.restore(sessionId))[0];
      if (first === undefined) throw new Error('没有可创建上传作业的分片');
      existing = await runtime.uploader.create({
        bufferSessionId: sessionId,
        jobId: uploadJobId,
        mimeType: first.chunk.mimeType,
        projectId: project,
        purpose: 'consent',
        serverSessionId: null,
      });
    }
    if (existing.expectedChunkCount === null) existing = await runtime.uploader.freeze(uploadJobId);
    setUploadStatus(existing.status);
    setAudioObjectId(existing.audioObjectId);
  }

  return (
    <main data-testid="audio-browser-harness">
      <p className="eyebrow">DEV-003A · Chromium only</p>
      <h1>原生浏览器音频持久化验证</h1>
      <p>仅使用 Web Audio 合成测试音，不访问真实麦克风；提供 project_id 时连接本地正式 API。</p>
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
        <dt>upload status</dt>
        <dd data-testid="upload-status">{uploadStatus}</dd>
        <dt>audio object</dt>
        <dd data-testid="audio-object-id">{audioObjectId ?? 'none'}</dd>
      </dl>
      <button
        data-testid="start-recording"
        disabled={
          capture.status === 'recording' ||
          capture.status === 'stopping' ||
          (projectId !== null && uploadStatus !== 'not-configured')
        }
        onClick={() => {
          void start();
        }}
        type="button"
      >
        开始合成录音
      </button>
      <button
        data-testid="upload-action"
        disabled={projectId === null || queueSnapshot.nextSequenceNo === 0}
        onClick={() => {
          void uploadAndComplete();
        }}
        type="button"
      >
        上传并完成
      </button>
      <button
        data-testid="stop-recording"
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
  const store = new IndexedDbAudioChunkStore();
  const queue = new AudioChunkQueue(store, {
    maximumBufferedBytes: 5 * 1024 * 1024,
  });
  const recorder = new BrowserAudioRecorder(queue, {
    mediaDevices: source,
    timesliceMs: 200,
  });
  const uploader = new AudioUploadJobRunner(queue, store);
  return { queue, recorder, source, store, uploader };
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
