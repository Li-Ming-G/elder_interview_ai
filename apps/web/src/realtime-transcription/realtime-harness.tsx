import { useEffect, useRef, useState } from 'react';
import type { CsrfResponse } from '@elder-interview/contracts';

import { RealtimeTranscriptionTransport, type RealtimeState } from './realtime-transport.js';

const INITIAL_STATE: RealtimeState = {
  connection: 'connecting',
  errorCode: null,
  failureKind: null,
  finals: [],
  interim: null,
  pendingBytes: 0,
  pendingFrames: 0,
  resetRequired: false,
  resumed: false,
};

export function RealtimeTranscriptionHarness({
  sessionId,
}: {
  sessionId: string;
}): React.JSX.Element {
  const [state, setState] = useState(INITIAL_STATE);
  const [setupError, setSetupError] = useState<string | null>(null);
  const transportRef = useRef<RealtimeTranscriptionTransport | null>(null);

  useEffect(() => {
    let active = true;
    let transport: RealtimeTranscriptionTransport | null = null;
    void fetch('/api/v1/auth/csrf', { cache: 'no-store', credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error('csrf_unavailable');
        const csrf = (await response.json()) as CsrfResponse;
        if (!active) return;
        transport = new RealtimeTranscriptionTransport({
          csrfToken: csrf.csrf_token,
          sessionId,
        });
        transportRef.current = transport;
        transport.subscribe(setState);
        transport.connect();
      })
      .catch(() => {
        if (active) setSetupError('无法取得实时连接凭据，请重新登录');
      });
    return (): void => {
      active = false;
      transport?.disconnect();
      if (transportRef.current === transport) transportRef.current = null;
    };
  }, [sessionId]);

  const errorText = state.failureKind === null ? null : failureText(state.failureKind);

  return (
    <main className="realtime-harness">
      <p className="eyebrow">DEV-004B2 内部验证</p>
      <h1>合成 PCM 实时转录</h1>
      <p>仅供本地或测试环境验证，不代表真实麦克风、真实 ASR 或正式访谈工作台。</p>
      <dl className="realtime-status" aria-label="实时链路状态">
        <div>
          <dt>连接</dt>
          <dd data-testid="realtime-connection">{state.connection}</dd>
        </div>
        <div>
          <dt>恢复</dt>
          <dd>{state.resumed ? '已在窗口内恢复' : '未恢复'}</dd>
        </div>
        <div>
          <dt>背压</dt>
          <dd data-testid="realtime-backpressure">
            {state.pendingFrames}/20 帧 · {state.pendingBytes}/64000 bytes
          </dd>
        </div>
      </dl>
      <div className="realtime-actions">
        <button
          disabled={transportRef.current === null || state.pendingFrames >= 20}
          onClick={() => void transportRef.current?.sendSyntheticFrame(state.pendingFrames + 1)}
          type="button"
        >
          发送一帧合成 PCM
        </button>
        <button
          disabled={transportRef.current === null || state.pendingFrames >= 20}
          onClick={() => {
            const transport = transportRef.current;
            if (transport === null) return;
            void (async (): Promise<void> => {
              for (let index = 0; index < 20; index += 1) {
                if (!(await transport.sendSyntheticFrame(index + 1))) break;
              }
            })();
          }}
          type="button"
        >
          填满背压窗口
        </button>
        <button
          disabled={transportRef.current === null || state.connection !== 'connected'}
          onClick={() => transportRef.current?.simulateConnectionDropForHarness()}
          type="button"
        >
          模拟短时断线
        </button>
      </div>
      {setupError === null ? null : <p role="alert">{setupError}</p>}
      {errorText === null ? null : (
        <p role="alert">
          {errorText} {state.errorCode === null ? null : `(${state.errorCode})`}
        </p>
      )}
      {state.resetRequired ? <p role="status">恢复窗口已失效，需要重新开始实时流。</p> : null}
      <section aria-labelledby="interim-heading">
        <h2 id="interim-heading">中间态</h2>
        <p className="transcript-interim" data-testid="realtime-interim">
          {state.interim?.text ?? '暂无中间态'}
        </p>
      </section>
      <section aria-labelledby="final-heading">
        <h2 id="final-heading">确定态</h2>
        <ol data-testid="realtime-finals">
          {state.finals.map((segment) => (
            <li key={segment.segmentId} data-segment-id={segment.segmentId}>
              {segment.text}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

function failureText(kind: NonNullable<RealtimeState['failureKind']>): string {
  switch (kind) {
    case 'auth':
      return '登录状态已失效，请重新登录';
    case 'permission':
      return '当前账号已无权继续此访谈实时转录';
    case 'session':
      return '当前访谈状态不允许继续实时转录';
    case 'asr':
      return '实时转录暂不可用，原始录音不受影响';
    case 'internal':
      return '实时转录服务暂时异常，原始录音不受影响';
    case 'reset':
      return '短时恢复窗口已失效';
  }
}
