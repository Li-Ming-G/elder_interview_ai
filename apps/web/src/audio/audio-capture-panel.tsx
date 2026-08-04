import { useEffect, useState } from 'react';

import type { AudioCaptureSnapshot, BrowserAudioRecorder } from './browser-audio-recorder.js';
import type { RecordingSessionContext } from './types.js';

export interface AudioCapturePanelProps {
  context: RecordingSessionContext;
  recorder: BrowserAudioRecorder;
}

const STATUS_TEXT: Record<AudioCaptureSnapshot['status'], string> = {
  failed: '录音暂存失败，请安全结束并保留当前页面',
  idle: '尚未开始录音',
  recording: '正在录音，分片持续写入本地可靠暂存',
  requesting_permission: '正在请求麦克风权限',
  stopped: '录音已停止，待上传分片仍保留在本地',
  stopping: '正在收束最后一个录音分片',
};

export function AudioCapturePanel({
  context,
  recorder,
}: AudioCapturePanelProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState(recorder.snapshot);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    return recorder.subscribe(setSnapshot);
  }, [recorder]);

  async function start(): Promise<void> {
    setActionError(null);
    try {
      await recorder.start(context);
      setSnapshot(recorder.snapshot);
    } catch (error) {
      setSnapshot(recorder.snapshot);
      setActionError(error instanceof Error ? error.message : '录音无法开始');
    }
  }

  async function stop(): Promise<void> {
    setActionError(null);
    try {
      await recorder.stop();
      setSnapshot(recorder.snapshot);
    } catch (error) {
      setSnapshot(recorder.snapshot);
      setActionError(error instanceof Error ? error.message : '录音无法安全结束');
    }
  }

  return (
    <section aria-labelledby="audio-capture-heading">
      <h2 id="audio-capture-heading">内部录音暂存验证</h2>
      <p aria-live="polite">{STATUS_TEXT[snapshot.status]}</p>
      <p>已可靠暂存分片：{snapshot.persistedChunkCount}</p>
      <button
        disabled={
          !context.canRecord ||
          snapshot.status === 'requesting_permission' ||
          snapshot.status === 'recording' ||
          snapshot.status === 'stopping'
        }
        onClick={() => {
          void start();
        }}
        type="button"
      >
        开始测试录音
      </button>
      <button
        disabled={snapshot.status !== 'recording'}
        onClick={() => {
          void stop();
        }}
        type="button"
      >
        停止并收束尾片
      </button>
      {context.canRecord ? null : <p role="alert">外部授权门禁尚未允许录音</p>}
      {actionError === null ? null : <p role="alert">{actionError}</p>}
    </section>
  );
}
