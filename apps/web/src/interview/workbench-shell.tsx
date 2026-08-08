import { useCallback, useEffect, useRef, useState } from 'react';
import type { InterviewSessionResponse } from '@elder-interview/contracts';

import type { InterviewApi, PreparationData } from './interview-api.js';
import { hasCurrentValidConsent } from './consent-status.js';
import {
  type RealtimeState,
  type RealtimeTranscriptFinal,
} from '../realtime-transcription/realtime-transport.js';
import type { InterviewCaptureController } from './interview-capture-controller.js';

const INITIAL_REALTIME_STATE: RealtimeState = {
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

interface WorkbenchShellProps {
  api: InterviewApi;
  captureController: Pick<InterviewCaptureController, 'recover' | 'subscribe'>;
  projectId: string;
  sessionId: string;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { data: PreparationData; kind: 'ready' };

export function WorkbenchShell({
  api,
  captureController,
  projectId,
  sessionId,
}: WorkbenchShellProps): React.JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [realtime, setRealtime] = useState(INITIAL_REALTIME_STATE);

  const load = useCallback(async (): Promise<void> => {
    setLoadState({ kind: 'loading' });
    try {
      const data = await api.loadPreparation(projectId, sessionId);
      if (data.session === null || !isStreamable(data.session))
        throw new Error('SESSION_NOT_STREAMABLE');
      if (!hasCurrentValidConsent(data.consents)) throw new Error('CONSENT_NOT_CURRENT');
      setLoadState({ data, kind: 'ready' });
    } catch (error) {
      setLoadState({ kind: 'error', message: workbenchLoadError(error) });
    }
  }, [api, projectId, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    return captureController.subscribe((snapshot): void => {
      setRealtime(snapshot.realtime);
    });
  }, [captureController]);
  useEffect(() => {
    if (loadState.kind !== 'ready' || loadState.data.session === null) return;
    void captureController.recover(loadState.data.session);
  }, [captureController, loadState]);

  if (loadState.kind === 'loading') return <WorkbenchLoading />;
  if (loadState.kind === 'error')
    return <WorkbenchFailure message={loadState.message} retry={load} />;
  const session = loadState.data.session;
  if (session === null) return <WorkbenchFailure message="无法确认当前访谈会话。" retry={load} />;

  return (
    <WorkbenchView
      projectName={loadState.data.project.display_name}
      realtime={realtime}
      session={session}
    />
  );
}

function WorkbenchView({
  projectName,
  realtime,
  session,
}: {
  projectName: string;
  realtime: RealtimeState;
  session: InterviewSessionResponse;
}): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [unread, setUnread] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const previousFinalCount = useRef(0);

  useEffect(() => {
    const timer = globalThis.setInterval((): void => {
      setNow(Date.now());
    }, 1000);
    return (): void => {
      globalThis.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const added = Math.max(0, realtime.finals.length - previousFinalCount.current);
    previousFinalCount.current = realtime.finals.length;
    if (!following && added > 0) setUnread((count) => count + added);
    if (following && typeof viewportRef.current?.scrollTo === 'function')
      viewportRef.current.scrollTo({
        top: viewportRef.current.scrollHeight,
        behavior: 'smooth',
      });
  }, [following, realtime.finals.length, realtime.interim?.revision]);

  function onScroll(): void {
    const node = viewportRef.current;
    if (node === null) return;
    const atLatest = node.scrollHeight - node.scrollTop - node.clientHeight < 56;
    if (atLatest !== following) {
      setFollowing(atLatest);
      if (atLatest) setUnread(0);
    }
  }

  function returnToLatest(): void {
    setFollowing(true);
    setUnread(0);
    if (typeof viewportRef.current?.scrollTo !== 'function') return;
    viewportRef.current.scrollTo({
      top: viewportRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }

  const failure = realtime.failureKind === null ? null : failureText(realtime.failureKind);
  return (
    <main className="workbench" data-session-id={session.id}>
      <header className="workbench-bar">
        <div className="workbench-identity">
          <strong>{projectName}</strong>
          <span>{elapsedText(session.started_at, now)}</span>
        </div>
        <div className="workbench-chain" aria-label="访谈链路状态">
          <StatusChip
            label="会话"
            value={session.status === 'recording' ? '服务端进行中' : '服务端重连中'}
          />
          <StatusChip
            label="转录"
            value={connectionText(realtime)}
            tone={realtime.failureKind === null ? 'normal' : 'warning'}
          />
          <StatusChip label="录音" value="独立链路" />
        </div>
        <button
          className="button button--secondary workbench-end-mount"
          disabled
          title="将在安全结束能力接入后启用"
          type="button"
        >
          结束访谈
        </button>
      </header>

      <section className="transcript-stage" aria-labelledby="transcript-title">
        <div className="transcript-heading">
          <div>
            <p className="context-label">实时记录</p>
            <h1 id="transcript-title">当前对话</h1>
          </div>
          <span className="transcript-state" role="status">
            {connectionText(realtime)}
          </span>
        </div>
        {failure === null ? null : (
          <div className="transcript-notice" role="alert">
            <strong>{failure.title}</strong>
            <p>{failure.detail}</p>
          </div>
        )}
        <div
          className="transcript-viewport"
          data-testid="transcript-viewport"
          onScroll={onScroll}
          ref={viewportRef}
          tabIndex={0}
        >
          {realtime.finals.length === 0 && realtime.interim === null ? (
            <div className="transcript-empty">
              <strong>等待对话内容</strong>
              <p>实时连接确认后，确定态转录会依次出现在这里。</p>
            </div>
          ) : null}
          <ol className="transcript-list" data-testid="workbench-finals">
            {realtime.finals.map((segment) => (
              <TranscriptLine key={segment.segmentId} segment={segment} />
            ))}
          </ol>
          {realtime.interim === null ? null : (
            <div
              className="transcript-line transcript-line--interim"
              data-testid="workbench-interim"
            >
              <span className="speaker-label">正在识别</span>
              <p>{realtime.interim.text}</p>
              <span className="finality-label">中间态</span>
            </div>
          )}
        </div>
        {!following ? (
          <button className="button return-latest" onClick={returnToLatest} type="button">
            回到最新{unread > 0 ? ` · ${String(unread)} 条新内容` : ''}
          </button>
        ) : null}
        <span className="sr-only" aria-live="polite">
          {unread > 0 ? `有 ${String(unread)} 条新的确定态转录` : ''}
        </span>
      </section>

      <aside className="suggestion-seam" aria-labelledby="suggestion-title">
        <div>
          <p className="context-label">下一步</p>
          <h2 id="suggestion-title">继续倾听</h2>
        </div>
        <p>暂时没有需要打断当前讲述的问题。问题建议将在后续能力接入后显示。</p>
      </aside>
    </main>
  );
}

function TranscriptLine({ segment }: { segment: RealtimeTranscriptFinal }): React.JSX.Element {
  const labels = { elder: '长者', interviewer: '倾听员', unknown: '说话人待确认' } as const;
  return (
    <li
      className={`transcript-line transcript-line--${segment.speakerRole}`}
      data-segment-id={segment.segmentId}
    >
      <span className="speaker-label">{labels[segment.speakerRole]}</span>
      <p>{segment.text}</p>
      <time>{formatOffset(segment.startMs)}</time>
      <span className="finality-label">确定态</span>
    </li>
  );
}

function StatusChip({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: string;
  tone?: 'normal' | 'warning';
}): React.JSX.Element {
  return (
    <span className={`status-chip status-chip--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function WorkbenchLoading(): React.JSX.Element {
  return (
    <main className="workbench-loading" aria-busy="true">
      <div className="skeleton skeleton--label" />
      <div className="skeleton skeleton--title" />
      <div className="skeleton skeleton--panel" />
      <span className="sr-only">正在核对访谈会话与授权</span>
    </main>
  );
}
function WorkbenchFailure({
  message,
  retry,
}: {
  message: string;
  retry: () => Promise<void>;
}): React.JSX.Element {
  return (
    <main className="interview-page interview-page--centered">
      <section className="load-failure">
        <p className="context-label">访谈工作台</p>
        <h1>无法进入实时工作台</h1>
        <p role="alert">{message}</p>
        <button className="button button--secondary" onClick={() => void retry()} type="button">
          重新核对
        </button>
      </section>
    </main>
  );
}
function isStreamable(session: InterviewSessionResponse): boolean {
  return session.status === 'recording' || session.status === 'reconnecting';
}
function workbenchLoadError(error: unknown): string {
  if (error instanceof Error && error.message === 'SESSION_NOT_STREAMABLE')
    return '服务端未确认此会话可继续实时转录，请返回准备流程核对。';
  if (error instanceof Error && error.message === 'CONSENT_NOT_CURRENT')
    return '最新授权记录当前无效，不能继续实时转录。';
  return error instanceof Error ? error.message : '无法核对当前会话，请稍后重试。';
}
function connectionText(state: RealtimeState): string {
  if (state.connection === 'connected') return state.resumed ? '已恢复' : '实时连接';
  if (state.connection === 'reconnecting') return '正在重连';
  if (state.connection === 'connecting') return '正在连接';
  return state.connection === 'unavailable' ? '不可用' : '已关闭';
}
function elapsedText(startedAt: string | null, now: number): string {
  if (startedAt === null) return '时长由服务端开始时间计算';
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `已进行 ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function formatOffset(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function failureText(kind: NonNullable<RealtimeState['failureKind']>): {
  title: string;
  detail: string;
} {
  const details = {
    auth: ['登录状态已失效', '请重新登录后再核对会话。'],
    permission: ['当前账号已无权继续', '实时转录已停止，请联系项目负责人。'],
    session: ['会话当前不可流式', '服务端已拒绝继续实时转录。'],
    asr: ['实时转录暂不可用', '原始录音链路不受此状态影响。'],
    internal: ['实时转录服务暂时异常', '原始录音链路不受此状态影响。'],
    reset: ['短时恢复窗口已失效', '无法在本页恢复完整转录，请按安全流程处置。'],
  } as const;
  return { title: details[kind][0], detail: details[kind][1] };
}
