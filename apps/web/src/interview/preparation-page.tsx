import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConsentResponse,
  InterviewSessionResponse,
  ServiceTermResponse,
} from '@elder-interview/contracts';

import type { InterviewApi, PreparationData } from './interview-api.js';
import { InterviewApiError } from './interview-api.js';
import type { MicrophoneChecker } from './microphone-check.js';
import { preparationPath, workbenchPath } from './routes.js';

interface PreparationPageProps {
  api: InterviewApi;
  checkMicrophone: MicrophoneChecker;
  initialSessionId: string | null;
  navigate: (path: string, replace?: boolean) => void;
  projectId: string;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { data: PreparationData; kind: 'ready' };

type DeviceState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'passed' }
  | { kind: 'failed'; message: string; permission: 'denied' | 'granted' | 'unknown' };

export function PreparationPage({
  api,
  checkMicrophone,
  initialSessionId,
  navigate,
  projectId,
}: PreparationPageProps): React.JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [deviceState, setDeviceState] = useState<DeviceState>({ kind: 'idle' });
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionLock = useRef(false);
  const startRequestId = useRef<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoadState({ kind: 'loading' });
    try {
      const data = await api.loadPreparation(projectId, initialSessionId);
      setLoadState({ data, kind: 'ready' });
      if (data.session?.status === 'device_check') setDeviceState({ kind: 'passed' });
    } catch (error) {
      setLoadState({ kind: 'error', message: readableError(error, '无法加载访谈准备信息') });
    }
  }, [api, initialSessionId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const readiness = useMemo(
    () => (loadState.kind === 'ready' ? deriveReadiness(loadState.data) : null),
    [loadState],
  );

  async function runDeviceCheck(): Promise<void> {
    if (actionLock.current || loadState.kind !== 'ready') return;
    actionLock.current = true;
    setActionError(null);
    setDeviceState({ kind: 'checking' });
    try {
      const result = await checkMicrophone();
      if (result.permission === 'denied') {
        setDeviceState({
          kind: 'failed',
          message: '麦克风权限被拒绝。请在浏览器地址栏的权限设置中允许后重试。',
          permission: 'denied',
        });
        return;
      }
      if (!result.inputDetected) {
        setDeviceState({
          kind: 'failed',
          message: '没有检测到声音。请确认输入设备、系统音量，并对着麦克风说一句话后重试。',
          permission: 'granted',
        });
        return;
      }

      let session = loadState.data.session;
      if (session === null) {
        session = await api.createSession(projectId);
        navigate(preparationPath(projectId, session.id), true);
      }
      if (session.status !== 'created' && session.status !== 'device_check') {
        throw new InterviewApiError(
          'INVALID_SESSION_STATE',
          '当前访谈状态不允许执行设备检测，请刷新后核对',
          409,
        );
      }
      const checked =
        session.status === 'device_check'
          ? session
          : await api.deviceCheck(session.id, {
              input_detected: true,
              microphone_permission: 'granted',
            });
      setLoadState({ data: { ...loadState.data, session: checked }, kind: 'ready' });
      setDeviceState({ kind: 'passed' });
    } catch (error) {
      setDeviceState({
        kind: 'failed',
        message: readableError(error, '设备检测未能完成，请检查设备后重试'),
        permission: 'unknown',
      });
    } finally {
      actionLock.current = false;
    }
  }

  async function startInterview(): Promise<void> {
    if (
      actionLock.current ||
      loadState.kind !== 'ready' ||
      loadState.data.session === null ||
      deviceState.kind !== 'passed'
    ) {
      return;
    }
    actionLock.current = true;
    setSubmitting(true);
    setActionError(null);
    startRequestId.current ??= crypto.randomUUID();
    try {
      const session = await api.startSession(loadState.data.session.id, startRequestId.current);
      if (session.status !== 'recording') {
        throw new InterviewApiError('UNEXPECTED_SESSION_STATE', '服务端未确认访谈已开始', 409);
      }
      navigate(workbenchPath(projectId, session.id));
    } catch (error) {
      setActionError(readableError(error, '访谈未能开始，请核对当前状态后重试'));
      setSubmitting(false);
    } finally {
      actionLock.current = false;
    }
  }

  if (loadState.kind === 'loading') return <PreparationSkeleton />;
  if (loadState.kind === 'error') {
    return (
      <main className="interview-page interview-page--centered">
        <section className="load-failure" aria-labelledby="load-failure-title">
          <p className="context-label">访谈准备</p>
          <h1 id="load-failure-title">暂时无法打开这个项目</h1>
          <p role="alert">{loadState.message}</p>
          <button className="button button--secondary" onClick={() => void load()} type="button">
            重新加载
          </button>
        </section>
      </main>
    );
  }

  const { project, serviceTerms, consents, session } = loadState.data;
  const currentTerm = currentServiceTerm(serviceTerms);
  const currentConsent = currentValidConsent(consents);
  const canStart =
    readiness?.projectReady === true &&
    readiness.serviceReady &&
    readiness.consentReady &&
    session?.status === 'device_check' &&
    deviceState.kind === 'passed' &&
    !submitting;

  return (
    <main className="interview-page">
      <header className="prep-header">
        <div>
          <p className="context-label">首次访谈 · 准备</p>
          <h1>和{project.display_name}开始一段从容的对话</h1>
          <p className="intro-copy">
            开始前请确认服务说明与正式授权，并完成一次短暂的麦克风检测。检测不会录音或保存声音。
          </p>
        </div>
        <span className="privacy-note">仅显示当前已分配项目</span>
      </header>

      <div className="prep-layout">
        <section className="prep-summary" aria-labelledby="summary-title">
          <h2 id="summary-title">本次访谈</h2>
          <dl className="summary-list">
            <SummaryRow label="长者称呼" value={project.display_name} />
            <SummaryRow
              label="预计时长"
              value={
                currentTerm === null
                  ? '尚未记录'
                  : `${String(currentTerm.expected_current_minutes)} 分钟`
              }
            />
            <SummaryRow label="访谈方式" value="由倾听员主导，系统协助录音与转录" />
          </dl>
          <div className="interview-guidance">
            <h3>给谈话留一点空间</h3>
            <p>从熟悉的人、地方或一段日常记忆开始。长者可以随时暂停、拒绝或换一个话题。</p>
          </div>
        </section>

        <section className="readiness-panel" aria-labelledby="readiness-title">
          <div className="section-heading">
            <div>
              <p className="context-label">开始条件</p>
              <h2 id="readiness-title">准备状态</h2>
            </div>
            <span className="status-count">
              {
                [
                  readiness?.serviceReady,
                  readiness?.consentReady,
                  deviceState.kind === 'passed',
                ].filter(Boolean).length
              }
              /3
            </span>
          </div>

          <StatusItem
            detail={
              currentTerm === null
                ? '未找到当前服务说明，请联系项目负责人补充。'
                : `已说明本次预计 ${String(currentTerm.expected_current_minutes)} 分钟`
            }
            label="服务说明"
            state={readiness?.serviceReady === true ? 'ready' : 'blocked'}
          />
          <StatusItem
            detail={
              currentConsent === null
                ? '没有有效的正式授权记录，页面确认不能替代授权。'
                : `正式授权有效 · 文本版本 ${currentConsent.consent_text_version}`
            }
            label="录音、转录与 AI 分析授权"
            state={readiness?.consentReady === true ? 'ready' : 'blocked'}
          />
          <DeviceStatus state={deviceState} />

          <div className="prep-actions">
            <button
              className="button button--secondary"
              disabled={
                deviceState.kind === 'checking' ||
                submitting ||
                (session !== null && !['created', 'device_check'].includes(session.status))
              }
              onClick={() => void runDeviceCheck()}
              type="button"
            >
              {deviceState.kind === 'checking' ? '正在听取输入…' : '检测麦克风'}
            </button>
            <button
              className="button button--primary"
              disabled={!canStart}
              onClick={() => void startInterview()}
              type="button"
            >
              {submitting ? '正在开始…' : '开始访谈'}
            </button>
          </div>
          {readiness?.projectReady === false ? (
            <p className="inline-error" role="alert">
              项目状态当前不允许开始访谈，请联系项目负责人核对。
            </p>
          ) : null}
          {session !== null && !['created', 'device_check'].includes(session.status) ? (
            <p className="inline-error" role="alert">
              当前会话状态为“{sessionStatusText(session)}”，不能从准备页开始。
            </p>
          ) : null}
          {actionError === null ? null : (
            <p className="inline-error" role="alert">
              {actionError}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function PreparationSkeleton(): React.JSX.Element {
  return (
    <main className="interview-page" aria-busy="true" aria-label="正在加载访谈准备信息">
      <div className="skeleton skeleton--label" />
      <div className="skeleton skeleton--title" />
      <div className="skeleton skeleton--copy" />
      <div className="prep-layout prep-layout--skeleton">
        <div className="skeleton skeleton--panel" />
        <div className="skeleton skeleton--panel" />
      </div>
      <span className="sr-only">正在加载访谈准备信息</span>
    </main>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
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
        <h3>{label}</h3>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function DeviceStatus({ state }: { state: DeviceState }): React.JSX.Element {
  const content = {
    checking: ['正在检测麦克风', '请对着麦克风说一句话。检测完成后会立即释放设备。'],
    failed: ['设备检查未通过', state.kind === 'failed' ? state.message : ''],
    idle: ['麦克风与输入', '尚未检测。检测不会创建录音或上传声音。'],
    passed: ['麦克风与输入', '权限已允许，并检测到声音输入。'],
  }[state.kind];
  const visualState =
    state.kind === 'passed' ? 'ready' : state.kind === 'failed' ? 'blocked' : 'idle';
  return (
    <div className="status-item" aria-live="polite">
      <span aria-hidden="true" className={`status-mark status-mark--${visualState}`}>
        {visualState === 'ready' ? '✓' : visualState === 'blocked' ? '!' : '·'}
      </span>
      <div>
        <h3>{content[0]}</h3>
        <p>{content[1]}</p>
      </div>
    </div>
  );
}

function deriveReadiness(data: PreparationData): {
  consentReady: boolean;
  projectReady: boolean;
  serviceReady: boolean;
} {
  return {
    consentReady: currentValidConsent(data.consents) !== null,
    projectReady: data.project.status === 'ready' || data.project.status === 'active',
    serviceReady: currentServiceTerm(data.serviceTerms) !== null,
  };
}

function currentServiceTerm(terms: ServiceTermResponse[]): ServiceTermResponse | null {
  return terms.find((term) => term.superseded_at === null) ?? null;
}

function currentValidConsent(consents: ConsentResponse[]): ConsentResponse | null {
  return consents.find((consent) => consent.status === 'valid') ?? null;
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
  if (error instanceof InterviewApiError) return error.message;
  if (error instanceof Error) {
    if (error.message === 'AUDIO_DEVICE_UNAVAILABLE') return '无法访问可用的麦克风设备';
    if (error.message === 'AUDIO_INPUT_CHECK_UNSUPPORTED') return '当前浏览器不支持输入检测';
  }
  return fallback;
}
