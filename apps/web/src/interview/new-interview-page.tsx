import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import type {
  ConsentResponse,
  CreateConsentRequest,
  CreateProjectRequest,
  DiscardPrestartInterviewRequest,
  InterviewSessionResponse,
  ProjectResponse,
} from '@elder-interview/contracts';

import { HomeFrame, StatusBadge } from '../home/home-shell.js';
import type { AudioCaptureSnapshot } from '../audio/browser-audio-recorder.js';
import { BrowserConsentCapture, type ConsentCapture } from './browser-consent-capture.js';
import type { NewInterviewApi } from './interview-api.js';
import { InterviewApiError } from './interview-api.js';
import type { InterviewCaptureController } from './interview-capture-controller.js';
import type { MicrophoneChecker, MicrophoneCheckResult } from './microphone-check.js';
import {
  canonicalWorkflowPayload,
  IndexedDbNewInterviewWorkflowStore,
  type NewInterviewWorkflow,
  type StableCreateAttempt,
} from './new-interview-workflow-store.js';
import {
  reconcileNewInterviewWorkflow,
  type NewInterviewRecoveryAuthority,
} from './new-interview-recovery.js';
import { workbenchPath } from './routes.js';

const CONSENT_TEXT_VERSION = 'mvp-v1';
const CONSENT_NOTICE = [
  '对话会被录音。',
  '录音会被转成文字。',
  '转录会用于 AI 分析。',
  'AI 会向倾听员提供问题建议。',
  '数据会被保存。',
  '长者可随时要求停止。',
  '长者可要求某段内容不再使用。',
  '内容不会未经确认直接公开。',
] as const;

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; newIntent: boolean; resumed: boolean; workflow: NewInterviewWorkflow };

const EMPTY_CAPTURE: AudioCaptureSnapshot = {
  error: null,
  persistedChunkCount: 0,
  status: 'idle',
};

type DeviceState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'passed' }
  | { kind: 'failed'; message: string };

export function NewInterviewPage({
  actorId,
  api,
  captureController,
  captureFactory = (): ConsentCapture => new BrowserConsentCapture(),
  checkMicrophone,
  csrfToken,
  intent = 'resume',
  navigate,
  workflowStore,
}: {
  actorId: string;
  api: NewInterviewApi;
  captureController: (
    projectId: string,
    sessionId: string,
  ) => Pick<InterviewCaptureController, 'start'>;
  captureFactory?: () => ConsentCapture;
  checkMicrophone: MicrophoneChecker;
  csrfToken: string;
  intent?: 'new' | 'resume' | undefined;
  navigate: (path: string, replace?: boolean) => void;
  workflowStore?: IndexedDbNewInterviewWorkflowStore;
}): React.JSX.Element {
  const store = useMemo(
    () => workflowStore ?? new IndexedDbNewInterviewWorkflowStore(),
    [workflowStore],
  );
  const [page, setPage] = useState<PageState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [captureSnapshot, setCaptureSnapshot] = useState(EMPTY_CAPTURE);
  const [deviceState, setDeviceState] = useState<DeviceState>({ kind: 'idle' });
  const [unknownReplayGeneration, setUnknownReplayGeneration] = useState(0);
  const actionLock = useRef(false);
  const initializationPromise = useRef<Promise<{
    newIntent: boolean;
    resumed: boolean;
    workflow: NewInterviewWorkflow;
  }> | null>(null);
  const unknownReplayKey = useRef<string | null>(null);
  const capture = useRef<ConsentCapture | null>(null);
  const captureUnsubscribe = useRef<(() => void) | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    let cancelled = false;
    initializationPromise.current ??= (async (): Promise<{
      newIntent: boolean;
      resumed: boolean;
      workflow: NewInterviewWorkflow;
    }> => {
      const existing = await store.getActive(actorId);
      let workflow: NewInterviewWorkflow;
      let resumed = false;
      let newIntent = false;
      if (existing === null) {
        workflow = await store.create(actorId);
      } else {
        const reconciliation = await reconcileNewInterviewWorkflow(
          existing,
          api as NewInterviewRecoveryAuthority,
        );
        if (reconciliation.kind === 'unavailable') {
          throw new Error('NEW_INTERVIEW_RECOVERY_UNAVAILABLE');
        }
        if (reconciliation.kind === 'retired') {
          if (intent === 'new') throw new Error('NEW_INTERVIEW_DISCARD_BLOCKED_ADVANCED');
          await store.retire(reconciliation.workflow);
          workflow = await store.create(actorId);
        } else if (intent === 'new') {
          workflow = reconciliation.workflow;
          newIntent = true;
        } else {
          workflow = reconciliation.workflow;
          await store.put(workflow);
          resumed = true;
        }
      }
      return { newIntent, resumed, workflow };
    })();
    void initializationPromise.current
      .then(({ newIntent, resumed, workflow }) => {
        if (!cancelled && mounted.current) setPage({ kind: 'ready', newIntent, resumed, workflow });
      })
      .catch((error: unknown) => {
        if (!cancelled && mounted.current) {
          setPage({
            kind: 'error',
            message: workflowInitializationError(error),
          });
        }
      });
    return (): void => {
      cancelled = true;
    };
  }, [actorId, api, intent, store]);

  useEffect(() => {
    mounted.current = true;
    return (): void => {
      mounted.current = false;
      const controller = capture.current;
      capture.current = null;
      if (controller !== null) void controller.dispose().catch(() => undefined);
      captureUnsubscribe.current?.();
      captureUnsubscribe.current = null;
    };
  }, []);

  useEffect(() => {
    const retryUnknown = (): void => {
      unknownReplayKey.current = null;
      setUnknownReplayGeneration((value) => value + 1);
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') retryUnknown();
    };
    globalThis.addEventListener('online', retryUnknown);
    document.addEventListener('visibilitychange', onVisible);
    return (): void => {
      globalThis.removeEventListener('online', retryUnknown);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (page.kind !== 'ready') return;
    const attempt = unknownAttempt(page.workflow);
    if (attempt === null) return;
    const key = `${page.workflow.workflowId}:${attempt.requestId}`;
    if (unknownReplayKey.current === key) return;
    unknownReplayKey.current = key;
    showMessage('正在恢复上次创建操作，不会重复创建项目。');
    const timer = globalThis.setTimeout(() => {
      void replayUnknown(page.workflow);
    }, 0);
    return (): void => {
      globalThis.clearTimeout(timer);
    };
  }, [page, unknownReplayGeneration]);

  async function save(workflow: NewInterviewWorkflow): Promise<void> {
    await store.put(workflow);
    if (mounted.current) {
      setPage((current) => ({
        kind: 'ready',
        newIntent: current.kind === 'ready' && current.newIntent,
        resumed: current.kind === 'ready' && current.resumed,
        workflow,
      }));
    }
  }

  async function runCreate<Response>(
    attempt: StableCreateAttempt<unknown, Response>,
    workflow: NewInterviewWorkflow,
    request: () => Promise<Response>,
    acknowledge: (response: Response) => NewInterviewWorkflow,
  ): Promise<Response | null> {
    if (!beginAction()) return null;
    try {
      const response = await request();
      await save(acknowledge(response));
      return response;
    } catch (error) {
      if (isUnknownResponse(error)) {
        await save(markUnknown(workflow, attempt.requestId));
        showMessage('暂时无法确认创建结果。网络恢复后会自动继续，也可以重新恢复创建操作。');
      } else {
        showMessage(readableError(error));
      }
      return null;
    } finally {
      endAction();
    }
  }

  async function replayUnknown(workflow: NewInterviewWorkflow): Promise<void> {
    const projectAttempt = workflow.projectAttempt;
    if (workflow.step === 'project' && projectAttempt?.state === 'unknown_response') {
      await runCreate(
        projectAttempt,
        workflow,
        () => api.createProject(projectAttempt.payload),
        (response) => {
          assertProjectAck(projectAttempt.payload, response);
          return {
            ...workflow,
            projectAttempt: acknowledged(projectAttempt, response),
            step: 'session',
          };
        },
      );
      return;
    }

    const projectId = workflow.projectAttempt?.response?.id;
    const sessionAttempt = workflow.sessionAttempt;
    if (
      workflow.step === 'session' &&
      projectId !== undefined &&
      sessionAttempt?.state === 'unknown_response'
    ) {
      const response = await runCreate(
        sessionAttempt,
        workflow,
        () => api.createSession(projectId, sessionAttempt.payload),
        (ack) => {
          assertSessionAck(projectId, ack);
          return {
            ...workflow,
            sessionAttempt: acknowledged(sessionAttempt, ack),
            step: workflow.consentAudioObjectId === null ? 'consent_audio' : 'consent',
          };
        },
      );
      if (response !== null) setDeviceState({ kind: 'idle' });
      return;
    }

    const consentAttempt = workflow.consentAttempt;
    if (
      workflow.step === 'consent' &&
      projectId !== undefined &&
      consentAttempt?.state === 'unknown_response'
    ) {
      const response = await runCreate(
        consentAttempt,
        workflow,
        () => api.createConsent(projectId, consentAttempt.payload),
        (ack) => {
          assertConsentAck(projectId, consentAttempt.payload, ack);
          return {
            ...workflow,
            consentAttempt: acknowledged(consentAttempt, ack),
            step: 'start',
          };
        },
      );
      if (response !== null) {
        await startFormalCapture({
          ...workflow,
          consentAttempt: acknowledged(consentAttempt, response),
          step: 'start',
        });
      }
    }
  }

  function beginAction(): boolean {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusy(true);
    showMessage(null);
    return true;
  }

  function endAction(): void {
    actionLock.current = false;
    if (mounted.current) setBusy(false);
  }

  async function submitProject(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (page.kind !== 'ready') return;
    let workflow = page.workflow;
    let attempt = workflow.projectAttempt;
    if (attempt === null) {
      if (!beginAction()) return;
      try {
        const form = new FormData(event.currentTarget);
        const requestId = globalThis.crypto.randomUUID();
        const request: CreateProjectRequest = {
          approximate_age: optionalInteger(form.get('approximate_age')),
          birth_year: optionalInteger(form.get('birth_year')),
          current_city: optionalText(form.get('current_city')),
          display_name: requiredText(form.get('display_name')),
          native_place: optionalText(form.get('native_place')),
          request_id: requestId,
        };
        attempt = prepared(requestId, request);
        workflow = { ...workflow, projectAttempt: attempt };
        await save(workflow);
      } catch (error) {
        showMessage(readablePreparationError(error));
        return;
      } finally {
        endAction();
      }
    }
    const frozen = attempt;
    await runCreate(
      frozen,
      workflow,
      () => api.createProject(frozen.payload),
      (response) => {
        assertProjectAck(frozen.payload, response);
        return {
          ...workflow,
          projectAttempt: acknowledged(frozen, response),
          step: 'session',
        };
      },
    );
  }

  async function runDeviceCheck(): Promise<void> {
    if (page.kind !== 'ready' || page.workflow.sessionAttempt?.response == null) return;
    if (!beginAction()) return;
    setDeviceState({ kind: 'checking' });
    try {
      const result = await checkMicrophone();
      if (!result.inputDetected) {
        setDeviceState({ kind: 'failed', message: microphoneFailure(result) });
        return;
      }
      const session = await api.deviceCheck(page.workflow.sessionAttempt.response.id, {
        input_detected: true,
        microphone_permission: 'granted',
      });
      assertDeviceCheckAck(page.workflow.sessionAttempt.response.id, session);
      setDeviceState({ kind: 'passed' });
      showMessage('已确认本页麦克风有输入，可以开始录制口头授权。');
    } catch (error) {
      setDeviceState({ kind: 'failed', message: readableDeviceError(error) });
    } finally {
      endAction();
    }
  }

  async function startConsentRecording(): Promise<void> {
    if (
      page.kind !== 'ready' ||
      page.workflow.projectAttempt?.response === null ||
      deviceState.kind !== 'passed' ||
      actionLock.current
    ) {
      return;
    }
    if (!beginAction()) return;
    try {
      const workflow = page.workflow;
      const projectId = workflow.projectAttempt?.response?.id;
      if (projectId === undefined) throw new Error('PROJECT_ACK_MISSING');
      const jobId = workflow.consentAudioJobId ?? `consent:${workflow.workflowId}`;
      if (workflow.consentAudioJobId === null)
        await save({ ...workflow, consentAudioJobId: jobId });
      const controller = consentCapture();
      await controller.start(jobId, projectId);
      if (mounted.current && capture.current === controller)
        showMessage('正在录制授权。请完整朗读固定文本，并请长者明确表达同意。');
    } catch (error) {
      showMessage(readableAudioError(error));
    } finally {
      endAction();
    }
  }

  async function finishConsentRecording(): Promise<void> {
    if (page.kind !== 'ready' || page.workflow.consentAudioJobId === null || actionLock.current) {
      return;
    }
    if (!beginAction()) return;
    try {
      const audioObjectId = await consentCapture().finishAndUpload(
        page.workflow.consentAudioJobId,
        csrfToken,
      );
      await save({
        ...page.workflow,
        consentAudioObjectId: audioObjectId,
        step: 'consent',
      });
      showMessage('授权录音已完整保存，可以登记正式口头授权。');
    } catch (error) {
      showMessage(`授权录音尚未完整保存：${readableAudioError(error)}。请使用同一上传记录重试。`);
    } finally {
      endAction();
    }
  }

  async function submitConsent(): Promise<void> {
    if (
      page.kind !== 'ready' ||
      page.workflow.projectAttempt?.response == null ||
      page.workflow.consentAudioObjectId === null
    ) {
      return;
    }
    const projectId = page.workflow.projectAttempt.response.id;
    let workflow = page.workflow;
    let attempt = workflow.consentAttempt;
    if (attempt === null) {
      if (!beginAction()) return;
      try {
        const requestId = globalThis.crypto.randomUUID();
        const request: CreateConsentRequest = {
          consent_audio_object_id: workflow.consentAudioObjectId,
          consent_method: 'recorded_verbal',
          consent_text_version: CONSENT_TEXT_VERSION,
          consent_type: 'recording_transcription_ai',
          consented_at: new Date().toISOString(),
          request_id: requestId,
        };
        attempt = prepared(requestId, request);
        workflow = { ...workflow, consentAttempt: attempt };
        await save(workflow);
      } catch (error) {
        showMessage(readablePreparationError(error));
        return;
      } finally {
        endAction();
      }
    }
    const frozen = attempt;
    await runCreate(
      frozen,
      workflow,
      () => api.createConsent(projectId, frozen.payload),
      (response) => {
        assertConsentAck(projectId, frozen.payload, response);
        return {
          ...workflow,
          consentAttempt: acknowledged(frozen, response),
          step: 'start',
        };
      },
    );
  }

  async function createSession(): Promise<void> {
    if (page.kind !== 'ready' || page.workflow.projectAttempt?.response == null) return;
    const projectId = page.workflow.projectAttempt.response.id;
    let workflow = page.workflow;
    let attempt = workflow.sessionAttempt;
    if (attempt === null) {
      if (!beginAction()) return;
      try {
        const requestId = globalThis.crypto.randomUUID();
        attempt = prepared(requestId, { request_id: requestId });
        workflow = { ...workflow, sessionAttempt: attempt };
        await save(workflow);
      } catch (error) {
        showMessage(readablePreparationError(error));
        return;
      } finally {
        endAction();
      }
    }
    const frozen = attempt;
    const response = await runCreate(
      frozen,
      workflow,
      () => api.createSession(projectId, frozen.payload),
      (response) => {
        assertSessionAck(projectId, response);
        const complete: NewInterviewWorkflow = {
          ...workflow,
          sessionAttempt: acknowledged(frozen, response),
          step: workflow.consentAudioObjectId === null ? 'consent_audio' : 'consent',
        };
        return complete;
      },
    );
    if (response !== null) setDeviceState({ kind: 'idle' });
  }

  async function startFormalCapture(workflowOverride?: NewInterviewWorkflow): Promise<void> {
    const current = workflowOverride ?? (page.kind === 'ready' ? page.workflow : null);
    if (
      current?.projectAttempt?.response == null ||
      current.sessionAttempt?.response == null ||
      current.consentAttempt?.response == null
    ) {
      return;
    }
    const workflow = current;
    const projectAck = workflow.projectAttempt?.response;
    const sessionAck = workflow.sessionAttempt?.response;
    if (projectAck == null || sessionAck == null) return;
    const projectId = projectAck.id;
    const sessionId = sessionAck.id;
    const reminder = sessionAck.recording_start_reminder;
    if (reminder === undefined) {
      showMessage('暂时无法核对本次录音提醒，请刷新权威会话信息后再开始。');
      return;
    }
    if (!beginAction()) return;
    try {
      const snapshot = await captureController(projectId, sessionId).start(reminder.version);
      if (snapshot.phase !== 'active') throw new Error('FORMAL_CAPTURE_NOT_ACTIVE');
      await save({ ...workflow, status: 'complete', step: 'complete' });
      navigate(workbenchPath(projectId, sessionId), true);
    } catch (error) {
      showMessage(readableStartError(error));
    } finally {
      endAction();
    }
  }

  async function discardAndStartFresh(): Promise<void> {
    if (page.kind !== 'ready' || !page.newIntent || !beginAction()) return;
    const workflow = page.workflow;
    try {
      const projectId = workflow.projectAttempt?.response?.id;
      if (projectId !== undefined) {
        const request: DiscardPrestartInterviewRequest = {
          request_id: globalThis.crypto.randomUUID(),
          session_id: workflow.sessionAttempt?.response?.id ?? null,
          workflow_version: 'prestart-discard-v1',
        };
        const response = await api.discardPrestartInterview(projectId, request);
        if (response.project_id !== projectId) {
          throw new Error('PRESTART_DISCARD_ACK_MISMATCH');
        }
      }
      const fresh = await store.discard(workflow);
      setDeviceState({ kind: 'idle' });
      setPage({ kind: 'ready', newIntent: false, resumed: false, workflow: fresh });
      showMessage('旧的未完成访谈已安全放弃。请填写信息，开始一次全新的访谈。');
    } catch (error) {
      showMessage(
        error instanceof InterviewApiError && error.code === 'PRESTART_DISCARD_UNAVAILABLE'
          ? '这次访谈已经有正式录音或其他证据，不能放弃；请返回工作区处理现有访谈。'
          : '尚未安全放弃旧的未完成访谈；原恢复记录已保留，请稍后重试。',
      );
    } finally {
      endAction();
    }
  }

  function consentCapture(): ConsentCapture {
    if (capture.current === null) {
      capture.current = captureFactory();
      captureUnsubscribe.current = capture.current.subscribe((snapshot): void => {
        if (mounted.current) setCaptureSnapshot(snapshot);
      });
    }
    return capture.current;
  }

  function showMessage(value: string | null): void {
    if (mounted.current) setMessage(value);
  }

  async function returnToWorkspace(): Promise<void> {
    if (!beginAction()) return;
    try {
      const controller = capture.current;
      capture.current = null;
      if (controller !== null) await controller.dispose();
      captureUnsubscribe.current?.();
      captureUnsubscribe.current = null;
      endAction();
      navigate('/');
    } catch {
      showMessage('麦克风已停止，但本地分片状态需要核对；请留在本页重试或刷新恢复同一录音记录。');
      endAction();
    }
  }

  if (page.kind === 'loading') {
    return (
      <HomeFrame>
        <section className="new-interview-panel" aria-busy="true">
          <div className="skeleton skeleton--label" />
          <div className="skeleton skeleton--title" />
          <div className="skeleton skeleton--panel" />
          <span className="sr-only">正在恢复新建访谈进度</span>
        </section>
      </HomeFrame>
    );
  }
  if (page.kind === 'error') {
    return (
      <HomeFrame>
        <section className="new-interview-panel">
          <h1>无法安全开始新建访谈</h1>
          <p role="alert">{page.message}</p>
          <button
            className="button button--secondary"
            onClick={() => {
              navigate('/');
            }}
            type="button"
          >
            返回工作区
          </button>
        </section>
      </HomeFrame>
    );
  }

  const workflow = page.workflow;
  return (
    <HomeFrame>
      <header className="new-interview-header">
        <div>
          <p className="context-label">倾听员工作区 · 新建访谈</p>
          <h1>建立一次有授权、可安全保存的访谈</h1>
          <p>先确认当前页面的麦克风，再录制口头授权；正式录音建立后进入说话人校准。</p>
        </div>
        <button
          className="button button--secondary"
          disabled={busy}
          onClick={() => void returnToWorkspace()}
          type="button"
        >
          {busy ? '正在安全停止…' : '返回工作区'}
        </button>
      </header>

      <ol className="workflow-steps" aria-label="新建访谈进度">
        {(
          [
            ['project', '项目信息'],
            ['session', '建立会话'],
            ['consent_audio', '麦克风与授权'],
            ['start', '正式录音'],
          ] as const
        ).map(([step, label]) => (
          <li aria-current={stepIsCurrent(workflow.step, step) ? 'step' : undefined} key={step}>
            <StatusBadge tone={stepIsPast(workflow.step, step) ? 'active' : 'neutral'}>
              {label}
            </StatusBadge>
          </li>
        ))}
      </ol>

      {page.resumed ? (
        <p className="workflow-resume" role="status">
          已恢复这台浏览器上未完成的新建记录。正在恢复上次创建操作，不会重复创建项目。
        </p>
      ) : null}

      <section className="new-interview-panel" aria-live="polite">
        {page.newIntent ? (
          <PrestartDiscardStep
            busy={busy}
            onCancel={() => {
              navigate('/interviews/new?mode=resume', true);
            }}
            onDiscard={() => void discardAndStartFresh()}
          />
        ) : null}
        {!page.newIntent && workflow.step === 'project' ? (
          <ProjectForm attempt={workflow.projectAttempt} busy={busy} onSubmit={submitProject} />
        ) : null}
        {!page.newIntent && workflow.step === 'session' ? (
          <SessionStep
            attempt={workflow.sessionAttempt}
            busy={busy}
            onCreate={() => void createSession()}
          />
        ) : null}
        {!page.newIntent && workflow.step === 'consent_audio' ? (
          <ConsentRecordingStep
            busy={busy}
            capture={captureSnapshot}
            deviceState={deviceState}
            hasJob={workflow.consentAudioJobId !== null}
            onCheck={() => void runDeviceCheck()}
            onFinish={() => void finishConsentRecording()}
            onStart={() => void startConsentRecording()}
          />
        ) : null}
        {!page.newIntent && workflow.step === 'consent' ? (
          <ConsentConfirmationStep
            attempt={workflow.consentAttempt}
            busy={busy}
            onConfirm={() => void submitConsent()}
          />
        ) : null}
        {!page.newIntent && workflow.step === 'start' ? (
          <StartStep
            busy={busy}
            onStart={() => void startFormalCapture()}
            reminder={workflow.sessionAttempt?.response?.recording_start_reminder}
          />
        ) : null}
        {!page.newIntent && workflow.step === 'complete' ? (
          <p aria-busy="true">正在打开说话人校准…</p>
        ) : null}
        {message === null ? null : (
          <p className="workflow-message" role="status">
            {message}
          </p>
        )}
      </section>
    </HomeFrame>
  );
}

function ProjectForm({
  attempt,
  busy,
  onSubmit,
}: {
  attempt: NewInterviewWorkflow['projectAttempt'];
  busy: boolean;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>;
}): React.JSX.Element {
  const frozen = attempt !== null;
  return (
    <form onSubmit={(event) => void onSubmit(event)}>
      <p className="context-label">第 1 步</p>
      <h2>最低项目信息</h2>
      <p>称呼是唯一必填项。其余信息不清楚时可以留空。</p>
      <div className="workflow-form-grid">
        <label>
          姓名、昵称或项目代号
          <input
            defaultValue={attempt?.payload.display_name}
            disabled={frozen}
            name="display_name"
            required
          />
        </label>
        <label>
          出生年份
          <input
            defaultValue={attempt?.payload.birth_year ?? ''}
            disabled={frozen}
            inputMode="numeric"
            min="0"
            name="birth_year"
            type="number"
          />
        </label>
        <label>
          大致年龄
          <input
            defaultValue={attempt?.payload.approximate_age ?? ''}
            disabled={frozen}
            inputMode="numeric"
            min="0"
            name="approximate_age"
            type="number"
          />
        </label>
        <label>
          籍贯
          <input
            defaultValue={attempt?.payload.native_place ?? ''}
            disabled={frozen}
            name="native_place"
          />
        </label>
        <label>
          当前城市
          <input
            defaultValue={attempt?.payload.current_city ?? ''}
            disabled={frozen}
            name="current_city"
          />
        </label>
      </div>
      <AttemptNotice attempt={attempt} />
      <button className="button button--primary" disabled={busy} type="submit">
        {busy ? '正在确认…' : frozen ? '重新恢复创建操作' : '创建项目并继续'}
      </button>
    </form>
  );
}

function PrestartDiscardStep({
  busy,
  onCancel,
  onDiscard,
}: {
  busy: boolean;
  onCancel: () => void;
  onDiscard: () => void;
}): React.JSX.Element {
  return (
    <div>
      <p className="context-label">新建访谈</p>
      <h2>已有一条未完成访谈</h2>
      <p>
        继续会保留原来的项目和创建记录；放弃并新建需要确认，且只会在服务端确认尚未正式录音后执行。
      </p>
      <div className="workflow-actions">
        <button
          className="button button--secondary"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          继续未完成访谈
        </button>
        <button
          className="button button--primary"
          disabled={busy}
          onClick={onDiscard}
          type="button"
        >
          {busy ? '正在安全放弃…' : '放弃未完成访谈并新建'}
        </button>
      </div>
    </div>
  );
}

function ConsentRecordingStep({
  busy,
  capture,
  deviceState,
  hasJob,
  onCheck,
  onFinish,
  onStart,
}: {
  busy: boolean;
  capture: AudioCaptureSnapshot;
  deviceState: DeviceState;
  hasJob: boolean;
  onCheck: () => void;
  onFinish: () => void;
  onStart: () => void;
}): React.JSX.Element {
  return (
    <div>
      <p className="context-label">第 3 步 · 当前页设备与正式口头授权</p>
      <h2>完整朗读，再请长者明确同意</h2>
      <p>先在本页确认麦克风有输入。刷新或重新打开后必须再次确认，旧检查不会被沿用。</p>
      <div className="workflow-actions">
        <button
          className="button button--secondary"
          disabled={busy || deviceState.kind === 'checking' || capture.status === 'recording'}
          onClick={onCheck}
          type="button"
        >
          {deviceState.kind === 'checking'
            ? '请对着麦克风说话…'
            : deviceState.kind === 'passed'
              ? '重新检查当前页麦克风'
              : '检查当前页麦克风'}
        </button>
      </div>
      <p aria-live="polite" className={deviceState.kind === 'failed' ? 'inline-error' : undefined}>
        {deviceState.kind === 'passed'
          ? '当前页麦克风检查通过。现在可以录制口头授权。'
          : deviceState.kind === 'failed'
            ? deviceState.message
            : '尚未确认当前页麦克风输入。'}
      </p>
      <p>点击录制后，倾听员逐项完整朗读；最后请长者清楚表达是否同意。</p>
      <ul className="consent-notice">
        {CONSENT_NOTICE.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="privacy-note">授权文本版本：{CONSENT_TEXT_VERSION}</p>
      <div className="workflow-actions">
        <button
          className="button button--secondary"
          disabled={busy || deviceState.kind !== 'passed' || capture.status === 'recording'}
          onClick={onStart}
          type="button"
        >
          {capture.status === 'requesting_permission'
            ? '正在请求麦克风…'
            : hasJob
              ? '继续录制授权'
              : '录制授权'}
        </button>
        <button
          className="button button--primary"
          disabled={busy || (!hasJob && capture.persistedChunkCount < 1)}
          onClick={onFinish}
          type="button"
        >
          {busy ? '正在可靠保存…' : '停止并保存授权录音'}
        </button>
      </div>
      <p aria-live="polite">
        {capture.status === 'recording'
          ? `正在录制 · 已可靠暂存 ${String(capture.persistedChunkCount)} 个分片`
          : hasJob
            ? '存在可恢复的授权录音记录；保存失败或刷新后请继续使用本记录。'
            : '尚未请求麦克风。'}
      </p>
    </div>
  );
}

function ConsentConfirmationStep({
  attempt,
  busy,
  onConfirm,
}: {
  attempt: NewInterviewWorkflow['consentAttempt'];
  busy: boolean;
  onConfirm: () => void;
}): React.JSX.Element {
  return (
    <div>
      <p className="context-label">第 3 步 · 授权录音已保存</p>
      <h2>登记正式口头授权</h2>
      <p>确认录音中已完整朗读固定文本，并且长者明确表达了同意。</p>
      <AttemptNotice attempt={attempt} />
      <button className="button button--primary" disabled={busy} onClick={onConfirm} type="button">
        {busy ? '正在登记…' : attempt === null ? '确认并登记正式授权' : '重新恢复登记操作'}
      </button>
    </div>
  );
}

function SessionStep({
  attempt,
  busy,
  onCreate,
}: {
  attempt: NewInterviewWorkflow['sessionAttempt'];
  busy: boolean;
  onCreate: () => void;
}): React.JSX.Element {
  return (
    <div>
      <p className="context-label">第 2 步</p>
      <h2>建立本次访谈会话</h2>
      <p>先建立会话，才能把接下来的当前页麦克风检查和授权绑定到同一次访谈。</p>
      <AttemptNotice attempt={attempt} />
      <button className="button button--primary" disabled={busy} onClick={onCreate} type="button">
        {busy ? '正在建立…' : attempt === null ? '建立会话并检查麦克风' : '重新恢复建立会话'}
      </button>
    </div>
  );
}

function StartStep({
  busy,
  onStart,
  reminder,
}: {
  busy: boolean;
  onStart: () => void;
  reminder: InterviewSessionResponse['recording_start_reminder'];
}): React.JSX.Element {
  return (
    <div>
      <p className="context-label">第 4 步 · 授权已登记</p>
      <h2>开始本次访谈前，请再次向长者说明</h2>
      {reminder === undefined ? (
        <p className="inline-error" role="alert">
          暂时无法核对服务端录音提醒，当前不能开始访谈。
        </p>
      ) : (
        <p className="recording-reminder">{reminder.text}</p>
      )}
      <button
        className="button button--primary"
        disabled={busy || reminder === undefined || !reminder.requires_explicit_action}
        onClick={onStart}
        type="button"
      >
        {busy ? '正在建立正式录音…' : (reminder?.action_label ?? '开始访谈')}
      </button>
    </div>
  );
}

function AttemptNotice({
  attempt,
}: {
  attempt: { state: string } | null;
}): React.JSX.Element | null {
  if (attempt === null) return null;
  return (
    <p className={attempt.state === 'unknown_response' ? 'inline-error' : 'workflow-frozen'}>
      {attempt.state === 'unknown_response'
        ? '正在恢复上次创建操作，不会重复创建项目。若网络仍不可用，可稍后重新恢复。'
        : '创建操作已可靠保存，正在确认服务端结果。'}
    </p>
  );
}

function prepared<Payload, Response>(
  requestId: string,
  payload: Payload,
): StableCreateAttempt<Payload, Response> {
  return { payload, requestId, response: null, state: 'prepared' };
}

function acknowledged<Payload, Response>(
  attempt: StableCreateAttempt<Payload, Response>,
  response: Response,
): StableCreateAttempt<Payload, Response> {
  return { ...attempt, response, state: 'acknowledged' };
}

function markUnknown(workflow: NewInterviewWorkflow, requestId: string): NewInterviewWorkflow {
  for (const key of [
    'projectAttempt',
    'serviceTermAttempt',
    'consentAttempt',
    'sessionAttempt',
  ] as const) {
    const attempt = workflow[key];
    if (attempt?.requestId === requestId)
      return { ...workflow, [key]: { ...attempt, state: 'unknown_response' } };
  }
  return workflow;
}

function unknownAttempt(
  workflow: NewInterviewWorkflow,
): StableCreateAttempt<unknown, unknown> | null {
  return (
    [workflow.projectAttempt, workflow.sessionAttempt, workflow.consentAttempt].find(
      (attempt) => attempt?.state === 'unknown_response',
    ) ?? null
  );
}

function assertProjectAck(request: CreateProjectRequest, response: ProjectResponse): void {
  const payload = withoutRequestId(request);
  const comparable = {
    approximate_age: response.approximate_age,
    birth_year: response.birth_year,
    current_city: response.current_city,
    display_name: response.display_name,
    native_place: response.native_place,
  };
  if (canonicalWorkflowPayload(payload) !== canonicalWorkflowPayload(comparable))
    throw new Error('PROJECT_ACK_MISMATCH');
}

function assertConsentAck(
  projectId: string,
  request: CreateConsentRequest,
  response: ConsentResponse,
): void {
  const payload = withoutRequestId(request);
  const comparable = {
    consent_audio_object_id: response.consent_audio_object_id,
    consent_method: response.consent_method,
    consent_text_version: response.consent_text_version,
    consent_type: response.consent_type,
    consented_at: response.consented_at,
  };
  if (
    response.project_id !== projectId ||
    response.status !== 'valid' ||
    response.revoked_at !== null ||
    canonicalWorkflowPayload(payload) !== canonicalWorkflowPayload(comparable)
  )
    throw new Error('CONSENT_ACK_MISMATCH');
}

function withoutRequestId<Request extends { request_id: string }>(
  request: Request,
): Omit<Request, 'request_id'> {
  return Object.fromEntries(
    Object.entries(request).filter(([key]) => key !== 'request_id'),
  ) as Omit<Request, 'request_id'>;
}

function assertSessionAck(projectId: string, response: InterviewSessionResponse): void {
  if (response.project_id !== projectId || response.status !== 'created')
    throw new Error('SESSION_ACK_MISMATCH');
}

function assertDeviceCheckAck(sessionId: string, response: InterviewSessionResponse): void {
  if (response.id !== sessionId || response.status !== 'device_check')
    throw new Error('DEVICE_CHECK_ACK_MISMATCH');
}

function isUnknownResponse(error: unknown): boolean {
  return error instanceof InterviewApiError && error.status === 0;
}

function readableError(error: unknown): string {
  if (error instanceof InterviewApiError) {
    if (error.code === 'IDEMPOTENCY_KEY_REUSED')
      return '请求编号与当前操作者、动作、项目或内容不匹配，流程已停止，请联系项目负责人核对。';
    return error.message;
  }
  if (error instanceof Error && error.message.endsWith('_ACK_MISMATCH'))
    return '服务响应与已保存的请求身份不一致，流程已停止，请联系项目负责人核对。';
  return '操作未完成；已保存的请求身份不会被替换，请重试。';
}

function readableAudioError(error: unknown): string {
  if (!(error instanceof Error)) return '录音或上传未能完成';
  if (error.message === 'AUDIO_PERMISSION_DENIED')
    return '麦克风权限被拒绝，请在浏览器权限设置中允许后重试';
  if (error.message === 'AUDIO_CAPTURE_UNSUPPORTED') return '当前浏览器不支持可靠的授权录音格式';
  if (error.message === 'UPLOAD_JOB_EMPTY') return '尚未录到可保存的授权内容，请先完整录制';
  if (error.message === 'CONSENT_AUDIO_ALREADY_FROZEN')
    return '授权录音已进入可靠保存阶段，请直接使用同一记录继续保存，不要重新录制';
  return '录音或上传未能完成';
}

function microphoneFailure(result: MicrophoneCheckResult): string {
  if (result.permission === 'denied') return '麦克风权限未开启，请允许本页使用麦克风后重试。';
  if (!result.inputDetected && result.reason === 'too_low')
    return '检测到的声音太小，请靠近麦克风并重新检查。';
  return '没有检测到声音，请检查麦克风选择和静音开关后重试。';
}

function readableDeviceError(error: unknown): string {
  if (error instanceof InterviewApiError) return error.message;
  return '当前页麦克风检查未完成，请检查设备后重试。';
}

function readableStartError(error: unknown): string {
  if (error instanceof InterviewApiError) return error.message;
  if (error instanceof Error && error.message === 'BROWSER_CAPTURE_LOCKED')
    return '同一访谈已在另一个页面录音，请回到原页面继续。';
  return '正式录音尚未建立。授权记录不会丢失，请确认麦克风权限后重试。';
}

function readablePreparationError(error: unknown): string {
  return error instanceof Error ? error.message : '无法在首次联网前可靠保存本次请求';
}

function optionalText(value: FormDataEntryValue | null): string | null {
  const text = requiredText(value, false);
  return text.length === 0 ? null : text;
}

function requiredText(value: FormDataEntryValue | null, required = true): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && text.length === 0) throw new TypeError('请输入必填内容');
  return text;
}

function optionalInteger(value: FormDataEntryValue | null): number | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length === 0 ? null : requiredInteger(value);
}

function requiredInteger(value: FormDataEntryValue | null): number {
  const number = requiredNumber(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError('请输入有效的非负整数');
  return number;
}

function requiredNumber(value: FormDataEntryValue | null): number {
  const number = typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(number) || number < 0) throw new TypeError('请输入有效的非负数字');
  return number;
}

const STEP_ORDER = ['project', 'session', 'consent_audio', 'consent', 'start', 'complete'];

function stepIsCurrent(current: string, displayed: string): boolean {
  return current === displayed || (displayed === 'consent_audio' && current === 'consent');
}

function stepIsPast(current: string, displayed: string): boolean {
  return STEP_ORDER.indexOf(current) > STEP_ORDER.indexOf(displayed);
}

function workflowInitializationError(error: unknown): string {
  if (error instanceof Error && error.message === 'NEW_INTERVIEW_DISCARD_BLOCKED_ADVANCED') {
    return '这条未完成访谈已经有正式录音或其他证据，不能放弃；请返回工作区处理现有访谈。';
  }
  if (error instanceof Error && error.message === 'NEW_INTERVIEW_RECOVERY_UNAVAILABLE') {
    return '暂时无法核对未完成的新建访谈，尚未开始新的访谈；请返回工作区，待权威状态可用后重试。';
  }
  return '浏览器无法建立可靠的新建访谈记录，请检查存储权限后重试。';
}
