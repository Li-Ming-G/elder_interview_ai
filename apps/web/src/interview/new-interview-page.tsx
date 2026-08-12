import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import type {
  ConsentResponse,
  CreateConsentRequest,
  CreateProjectRequest,
  CreateServiceTermRequest,
  InterviewSessionResponse,
  ProjectResponse,
  ServiceTermResponse,
} from '@elder-interview/contracts';

import { HomeFrame, StatusBadge } from '../home/home-shell.js';
import type { AudioCaptureSnapshot } from '../audio/browser-audio-recorder.js';
import { BrowserConsentCapture } from './browser-consent-capture.js';
import type { NewInterviewApi } from './interview-api.js';
import { InterviewApiError } from './interview-api.js';
import {
  canonicalWorkflowPayload,
  IndexedDbNewInterviewWorkflowStore,
  type NewInterviewWorkflow,
  type StableCreateAttempt,
} from './new-interview-workflow-store.js';
import { preparationPath } from './routes.js';

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
  | { kind: 'ready'; workflow: NewInterviewWorkflow };

const EMPTY_CAPTURE: AudioCaptureSnapshot = {
  error: null,
  persistedChunkCount: 0,
  status: 'idle',
};

export function NewInterviewPage({
  actorId,
  api,
  captureFactory = (): BrowserConsentCapture => new BrowserConsentCapture(),
  csrfToken,
  navigate,
  workflowStore,
}: {
  actorId: string;
  api: NewInterviewApi;
  captureFactory?: () => BrowserConsentCapture;
  csrfToken: string;
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
  const actionLock = useRef(false);
  const capture = useRef<BrowserConsentCapture | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async (): Promise<void> => {
      try {
        const workflow = (await store.getActive(actorId)) ?? (await store.create(actorId));
        if (!controller.signal.aborted) setPage({ kind: 'ready', workflow });
      } catch {
        if (!controller.signal.aborted) {
          setPage({
            kind: 'error',
            message: '浏览器无法建立可靠的新建访谈记录，请检查存储权限后重试。',
          });
        }
      }
    })();
    return (): void => {
      controller.abort();
    };
  }, [actorId, store]);

  useEffect(() => {
    return (): void => {
      capture.current = null;
    };
  }, []);

  async function save(workflow: NewInterviewWorkflow): Promise<void> {
    await store.put(workflow);
    setPage({ kind: 'ready', workflow });
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
        setMessage('服务响应未知。为避免重复记录，只能使用原请求编号重试。');
      } else {
        setMessage(readableError(error));
      }
      return null;
    } finally {
      endAction();
    }
  }

  function beginAction(): boolean {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusy(true);
    setMessage(null);
    return true;
  }

  function endAction(): void {
    actionLock.current = false;
    setBusy(false);
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
        setMessage(readablePreparationError(error));
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
          step: 'service_term',
        };
      },
    );
  }

  async function submitServiceTerm(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (page.kind !== 'ready' || page.workflow.projectAttempt?.response == null) return;
    const projectId = page.workflow.projectAttempt.response.id;
    let workflow = page.workflow;
    let attempt = workflow.serviceTermAttempt;
    if (attempt === null) {
      if (!beginAction()) return;
      try {
        const form = new FormData(event.currentTarget);
        const requestId = globalThis.crypto.randomUUID();
        const request: CreateServiceTermRequest = {
          currency: 'CNY',
          estimated_session_count: requiredInteger(form.get('estimated_session_count')),
          expected_current_minutes: requiredInteger(form.get('expected_current_minutes')),
          included_minutes: requiredInteger(form.get('included_minutes')),
          overtime_price_minor: Math.round(requiredNumber(form.get('overtime_price')) * 100),
          overtime_unit_minutes: requiredInteger(form.get('overtime_unit_minutes')),
          request_id: requestId,
        };
        attempt = prepared(requestId, request);
        workflow = { ...workflow, serviceTermAttempt: attempt };
        await save(workflow);
      } catch (error) {
        setMessage(readablePreparationError(error));
        return;
      } finally {
        endAction();
      }
    }
    const frozen = attempt;
    await runCreate(
      frozen,
      workflow,
      () => api.createServiceTerm(projectId, frozen.payload),
      (response) => {
        assertServiceTermAck(projectId, frozen.payload, response);
        return {
          ...workflow,
          serviceTermAttempt: acknowledged(frozen, response),
          step: 'consent_audio',
        };
      },
    );
  }

  async function startConsentRecording(): Promise<void> {
    if (
      page.kind !== 'ready' ||
      page.workflow.projectAttempt?.response === null ||
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
      setMessage('正在录制授权。请完整朗读固定文本，并请长者明确表达同意。');
    } catch (error) {
      setMessage(readableAudioError(error));
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
      setMessage('授权录音已完整保存，可以登记正式口头授权。');
    } catch (error) {
      setMessage(`授权录音尚未完整保存：${readableAudioError(error)}。请使用同一上传记录重试。`);
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
        setMessage(readablePreparationError(error));
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
          step: 'session',
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
        setMessage(readablePreparationError(error));
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
          status: 'complete',
          step: 'complete',
        };
        return complete;
      },
    );
    if (response !== null) navigate(preparationPath(projectId, response.id), true);
  }

  function consentCapture(): BrowserConsentCapture {
    if (capture.current === null) {
      capture.current = captureFactory();
      capture.current.subscribe(setCaptureSnapshot);
    }
    return capture.current;
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
  const resumed =
    workflow.createdAt !== workflow.updatedAt ||
    [
      workflow.projectAttempt,
      workflow.serviceTermAttempt,
      workflow.consentAttempt,
      workflow.sessionAttempt,
    ]
      .filter((value) => value !== null)
      .some((value) => value.state === 'unknown_response');

  return (
    <HomeFrame>
      <header className="new-interview-header">
        <div>
          <p className="context-label">倾听员工作区 · 新建访谈</p>
          <h1>建立一次有说明、有授权的访谈</h1>
          <p>每一步确认后才会进入下一步；创建项目本身不代表已经可以开始。</p>
        </div>
        <button
          className="button button--secondary"
          onClick={() => {
            navigate('/');
          }}
          type="button"
        >
          返回工作区
        </button>
      </header>

      <ol className="workflow-steps" aria-label="新建访谈进度">
        {(
          [
            ['project', '项目信息'],
            ['service_term', '服务说明'],
            ['consent_audio', '口头授权'],
            ['session', '准备访谈'],
          ] as const
        ).map(([step, label]) => (
          <li aria-current={stepIsCurrent(workflow.step, step) ? 'step' : undefined} key={step}>
            <StatusBadge tone={stepIsPast(workflow.step, step) ? 'active' : 'neutral'}>
              {label}
            </StatusBadge>
          </li>
        ))}
      </ol>

      {resumed ? (
        <p className="workflow-resume" role="status">
          已恢复这台浏览器上未完成的新建记录。响应未知的步骤只会重放原请求编号。
        </p>
      ) : null}

      <section className="new-interview-panel" aria-live="polite">
        {workflow.step === 'project' ? (
          <ProjectForm attempt={workflow.projectAttempt} busy={busy} onSubmit={submitProject} />
        ) : null}
        {workflow.step === 'service_term' ? (
          <ServiceTermForm
            attempt={workflow.serviceTermAttempt}
            busy={busy}
            onSubmit={submitServiceTerm}
          />
        ) : null}
        {workflow.step === 'consent_audio' ? (
          <ConsentRecordingStep
            busy={busy}
            capture={captureSnapshot}
            hasJob={workflow.consentAudioJobId !== null}
            onFinish={() => void finishConsentRecording()}
            onStart={() => void startConsentRecording()}
          />
        ) : null}
        {workflow.step === 'consent' ? (
          <ConsentConfirmationStep
            attempt={workflow.consentAttempt}
            busy={busy}
            onConfirm={() => void submitConsent()}
          />
        ) : null}
        {workflow.step === 'session' ? (
          <SessionStep
            attempt={workflow.sessionAttempt}
            busy={busy}
            onCreate={() => void createSession()}
          />
        ) : null}
        {workflow.step === 'complete' ? <p aria-busy="true">正在打开访谈准备页…</p> : null}
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
        {busy ? '正在确认…' : frozen ? '使用原请求重试' : '创建项目并继续'}
      </button>
    </form>
  );
}

function ServiceTermForm({
  attempt,
  busy,
  onSubmit,
}: {
  attempt: NewInterviewWorkflow['serviceTermAttempt'];
  busy: boolean;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => Promise<void>;
}): React.JSX.Element {
  const frozen = attempt !== null;
  return (
    <form onSubmit={(event) => void onSubmit(event)}>
      <p className="context-label">第 2 步</p>
      <h2>服务说明</h2>
      <p>请当面说明本次预计时长、服务包含时长和超时计费，再确认以下记录。</p>
      <div className="workflow-form-grid">
        <NumberField
          defaultValue={60}
          disabled={frozen}
          label="本次预计分钟"
          name="expected_current_minutes"
        />
        <NumberField
          defaultValue={3}
          disabled={frozen}
          label="预计访谈次数"
          name="estimated_session_count"
        />
        <NumberField
          defaultValue={180}
          disabled={frozen}
          label="服务包含分钟"
          name="included_minutes"
        />
        <NumberField
          defaultValue={30}
          disabled={frozen}
          label="超时计费单位（分钟）"
          name="overtime_unit_minutes"
        />
        <NumberField
          defaultValue={0}
          disabled={frozen}
          label="每单位费用（元）"
          name="overtime_price"
          step="0.01"
        />
      </div>
      <AttemptNotice attempt={attempt} />
      <button className="button button--primary" disabled={busy} type="submit">
        {busy ? '正在保存…' : frozen ? '使用原请求重试' : '已说明并保存'}
      </button>
    </form>
  );
}

function ConsentRecordingStep({
  busy,
  capture,
  hasJob,
  onFinish,
  onStart,
}: {
  busy: boolean;
  capture: AudioCaptureSnapshot;
  hasJob: boolean;
  onFinish: () => void;
  onStart: () => void;
}): React.JSX.Element {
  return (
    <div>
      <p className="context-label">第 3 步 · 正式口头授权</p>
      <h2>完整朗读，再请长者明确同意</h2>
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
          disabled={busy || capture.status === 'recording'}
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
        {busy ? '正在登记…' : attempt === null ? '确认并登记正式授权' : '使用原请求重试'}
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
      <p className="context-label">第 4 步</p>
      <h2>建立访谈会话</h2>
      <p>会话建立后仍需在准备页明确检测麦克风，再单独点击“开始访谈”。</p>
      <AttemptNotice attempt={attempt} />
      <button className="button button--primary" disabled={busy} onClick={onCreate} type="button">
        {busy ? '正在建立…' : attempt === null ? '进入设备检查' : '使用原请求重试'}
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
        ? '上次响应未知：表单已锁定，重试只会发送原 request ID 与原 payload。'
        : '请求已在首次联网前保存；提交期间不会生成第二个 request ID。'}
    </p>
  );
}

function NumberField({
  defaultValue,
  disabled,
  label,
  name,
  step = '1',
}: {
  defaultValue: number;
  disabled: boolean;
  label: string;
  name: string;
  step?: string;
}): React.JSX.Element {
  return (
    <label>
      {label}
      <input
        defaultValue={defaultValue}
        disabled={disabled}
        inputMode="decimal"
        min="0"
        name={name}
        required
        step={step}
        type="number"
      />
    </label>
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

function assertServiceTermAck(
  projectId: string,
  request: CreateServiceTermRequest,
  response: ServiceTermResponse,
): void {
  const payload = withoutRequestId(request);
  const returned = {
    currency: response.currency,
    estimated_session_count: response.estimated_session_count,
    expected_current_minutes: response.expected_current_minutes,
    included_minutes: response.included_minutes,
    overtime_price_minor: response.overtime_price_minor,
    overtime_unit_minutes: response.overtime_unit_minutes,
  };
  if (
    response.project_id !== projectId ||
    canonicalWorkflowPayload(payload) !== canonicalWorkflowPayload(returned)
  )
    throw new Error('SERVICE_TERM_ACK_MISMATCH');
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

const STEP_ORDER = ['project', 'service_term', 'consent_audio', 'consent', 'session', 'complete'];

function stepIsCurrent(current: string, displayed: string): boolean {
  return current === displayed || (displayed === 'consent_audio' && current === 'consent');
}

function stepIsPast(current: string, displayed: string): boolean {
  return STEP_ORDER.indexOf(current) > STEP_ORDER.indexOf(displayed);
}
