import { useCallback, useEffect, useState } from 'react';
import type { InterviewSessionResponse } from '@elder-interview/contracts';

import type { InterviewApi, PreparationData } from './interview-api.js';
import {
  InterviewApiError,
  isAuthenticationError,
  safeInterviewErrorMessage,
} from './interview-api.js';
import { hasCurrentValidConsent, latestConsent } from './consent-status.js';
import type { InterviewCaptureController } from './interview-capture-controller.js';
import type { MicrophoneChecker, MicrophoneCheckResult } from './microphone-check.js';
import { workbenchPath } from './routes.js';

interface PreparationPageProps {
  /** Deprecated compatibility props accepted by pre-A4 callers/tests. */
  actorId?: string;
  api: InterviewApi;
  captureController: (sessionId: string) => Pick<InterviewCaptureController, 'start'>;
  checkMicrophone: MicrophoneChecker;
  initialSessionId: string | null;
  navigate: (path: string, replace?: boolean) => void;
  onAuthLost?: () => void;
  projectId: string;
}

type LoadState =
  | { kind: 'loading' }
  | { authenticationRequired: boolean; kind: 'error'; message: string }
  | { data: PreparationData; kind: 'ready' };

type DeviceState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'passed' }
  | { kind: 'failed'; message: string };

/** Repeat-session and legacy recovery route; every page visit requires a fresh local device check. */
export function PreparationPage({
  api,
  captureController,
  checkMicrophone,
  initialSessionId,
  navigate,
  onAuthLost,
  projectId,
}: PreparationPageProps): React.JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [submitting, setSubmitting] = useState(false);
  const [deviceState, setDeviceState] = useState<DeviceState>({ kind: 'idle' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [authenticationRequired, setAuthenticationRequired] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoadState({ kind: 'loading' });
    setDeviceState({ kind: 'idle' });
    setAuthenticationRequired(false);
    try {
      const data = await api.loadPreparation(projectId, initialSessionId);
      setLoadState({ data, kind: 'ready' });
    } catch (error) {
      setLoadState({
        authenticationRequired: isAuthenticationError(error),
        kind: 'error',
        message: readableError(error, '无法加载访谈恢复信息'),
      });
    }
  }, [api, initialSessionId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runDeviceCheck(): Promise<void> {
    if (
      loadState.kind !== 'ready' ||
      loadState.data.session === null ||
      !['created', 'device_check'].includes(loadState.data.session.status) ||
      deviceState.kind === 'checking' ||
      submitting
    ) {
      return;
    }
    setDeviceState({ kind: 'checking' });
    setActionError(null);
    try {
      const result = await checkMicrophone();
      if (!result.inputDetected) {
        setDeviceState({ kind: 'failed', message: microphoneFailure(result) });
        return;
      }
      const currentSession = loadState.data.session;
      const checked = await api.deviceCheck(currentSession.id, {
        input_detected: true,
        microphone_permission: 'granted',
      });
      if (
        checked.id !== currentSession.id ||
        checked.project_id !== projectId ||
        checked.status !== 'device_check'
      ) {
        throw new Error('DEVICE_CHECK_ACK_MISMATCH');
      }
      setLoadState({
        data: { ...loadState.data, session: checked },
        kind: 'ready',
      });
      setDeviceState({ kind: 'passed' });
    } catch (error) {
      setAuthenticationRequired(isAuthenticationError(error));
      setDeviceState({ kind: 'failed', message: readableDeviceError(error) });
    }
  }

  async function startInterview(): Promise<void> {
    if (
      loadState.kind !== 'ready' ||
      loadState.data.session?.status !== 'device_check' ||
      deviceState.kind !== 'passed'
    )
      return;
    setSubmitting(true);
    setActionError(null);
    try {
      const sessionId = loadState.data.session.id;
      const reminder = loadState.data.session.recording_start_reminder;
      if (reminder === undefined) {
        throw new InterviewApiError(
          'RECORDING_REMINDER_UNAVAILABLE',
          '暂时无法核对本次录音提醒，请重新加载后再试',
          409,
        );
      }
      const capture = await captureController(sessionId).start(reminder.version);
      if (capture.phase !== 'active') {
        throw new InterviewApiError('UNEXPECTED_SESSION_STATE', '服务端未确认正式录音已开始', 409);
      }
      navigate(workbenchPath(projectId, sessionId));
    } catch (error) {
      setAuthenticationRequired(isAuthenticationError(error));
      setActionError(readableError(error, '正式录音未能开始，请核对当前状态后重试'));
      setSubmitting(false);
    }
  }

  if (loadState.kind === 'loading') return <PreparationSkeleton />;
  if (loadState.kind === 'error') {
    return (
      <main className="interview-page interview-page--centered">
        <section className="load-failure" aria-labelledby="load-failure-title">
          <p className="context-label">访谈恢复</p>
          <h1 id="load-failure-title">暂时无法打开这次访谈</h1>
          <p role="alert">{loadState.message}</p>
          <button className="button button--secondary" onClick={() => void load()} type="button">
            重新加载
          </button>
          {loadState.authenticationRequired && onAuthLost !== undefined ? (
            <button className="button button--secondary" onClick={onAuthLost} type="button">
              返回登录
            </button>
          ) : null}
          <button
            className="button button--secondary"
            onClick={() => {
              navigate('/', true);
            }}
            type="button"
          >
            返回工作区
          </button>
        </section>
      </main>
    );
  }

  const { project, consents, session } = loadState.data;
  const currentConsent = latestConsent(consents);
  const consentReady = hasCurrentValidConsent(consents);
  const legacyFirstSessionDraft =
    project.status === 'draft' &&
    session?.sequence_no === 1 &&
    consentReady &&
    session.status === 'device_check';
  const canResume =
    (project.status === 'ready' || project.status === 'active' || legacyFirstSessionDraft) &&
    session?.status === 'device_check' &&
    deviceState.kind === 'passed' &&
    session.recording_start_reminder !== undefined &&
    !submitting;

  return (
    <main className="interview-page interview-page--centered">
      <section className="readiness-panel" aria-labelledby="recovery-title">
        <p className="context-label">访谈恢复</p>
        <h1 id="recovery-title">继续建立正式录音</h1>
        <p>请先检查当前页面的麦克风输入，再核对服务端提醒并显式开始本次访谈。</p>
        <StatusItem
          detail={
            currentConsent === null
              ? '没有有效的正式授权记录。'
              : consentReady
                ? `正式授权有效 · 文本版本 ${currentConsent.consent_text_version}`
                : '最新正式授权当前无效。'
          }
          label="录音、转录与 AI 分析授权"
          state={consentReady ? 'ready' : 'blocked'}
        />
        <StatusItem
          detail={
            session === null
              ? '没有可恢复的会话，请从工作区重新发起。'
              : !['created', 'device_check'].includes(session.status)
                ? `当前会话状态为“${sessionStatusText(session)}”，不能从本页开始。`
                : deviceState.kind === 'passed'
                  ? '已确认当前页面的麦克风有输入。'
                  : deviceState.kind === 'checking'
                    ? '正在检测当前页面的麦克风输入…'
                    : '待设备检查；不会复用上一次访谈或其他页面的设备状态。'
          }
          label="当前页设备检查"
          state={deviceState.kind === 'passed' ? 'ready' : 'blocked'}
        />
        {session !== null && ['created', 'device_check'].includes(session.status) ? (
          <button
            className="button button--secondary"
            disabled={deviceState.kind === 'checking' || submitting || !consentReady}
            onClick={() => void runDeviceCheck()}
            type="button"
          >
            {deviceState.kind === 'checking' ? '正在检测麦克风…' : '检测麦克风'}
          </button>
        ) : null}
        {deviceState.kind === 'failed' ? (
          <p className="inline-error" role="alert">
            {deviceState.message}
          </p>
        ) : null}
        {authenticationRequired && onAuthLost !== undefined ? (
          <button className="button button--secondary" onClick={onAuthLost} type="button">
            返回登录
          </button>
        ) : null}
        {deviceState.kind !== 'passed' ? null : session?.recording_start_reminder === undefined ? (
          <p className="inline-error" role="alert">
            暂时无法核对服务端录音提醒，当前不能开始访谈。
          </p>
        ) : (
          <p className="recording-reminder">{session.recording_start_reminder.text}</p>
        )}
        <button
          className="button button--primary"
          disabled={!canResume}
          onClick={() => void startInterview()}
          type="button"
        >
          {submitting
            ? '正在建立正式录音…'
            : (session?.recording_start_reminder?.action_label ?? '开始访谈')}
        </button>
        {actionError === null ? null : (
          <p className="inline-error" role="alert">
            {actionError}
          </p>
        )}
      </section>
    </main>
  );
}

function PreparationSkeleton(): React.JSX.Element {
  return (
    <main className="interview-page" aria-busy="true" aria-label="正在加载访谈恢复信息">
      <div className="skeleton skeleton--label" />
      <div className="skeleton skeleton--title" />
      <div className="skeleton skeleton--panel" />
      <span className="sr-only">正在加载访谈恢复信息</span>
    </main>
  );
}

function StatusItem({
  detail,
  label,
  state,
}: {
  detail: string;
  label: string;
  state: 'ready' | 'blocked';
}): React.JSX.Element {
  return (
    <div className="status-item">
      <span aria-hidden="true" className={`status-mark status-mark--${state}`}>
        {state === 'ready' ? '✓' : '!'}
      </span>
      <div>
        <h2>{label}</h2>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function sessionStatusText(session: InterviewSessionResponse): string {
  const labels: Record<InterviewSessionResponse['status'], string> = {
    completed: '已完成',
    created: '待设备检查',
    device_check: '设备检查完成',
    failed: '失败',
    interrupted: '已中断',
    processing: '处理中',
    reconnecting: '正在重连',
    recording: '正在访谈',
    stopping: '正在停止',
  };
  return labels[session.status];
}

function readableError(error: unknown, fallback: string): string {
  return safeInterviewErrorMessage(error, fallback);
}

function microphoneFailure(result: MicrophoneCheckResult): string {
  if (result.permission === 'denied') return '麦克风权限未开启，请允许本页使用麦克风后重试。';
  if (!result.inputDetected && result.reason === 'too_low')
    return '检测到的声音太小，请靠近麦克风并重新检查。';
  return '没有检测到声音，请检查麦克风选择和静音开关后重试。';
}

function readableDeviceError(error: unknown): string {
  if (error instanceof InterviewApiError)
    return safeInterviewErrorMessage(error, '当前页麦克风检查未完成，请检查设备后重试。');
  return '当前页麦克风检查未完成，请检查设备后重试。';
}
