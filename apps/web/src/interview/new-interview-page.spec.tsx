// @vitest-environment jsdom

import { IDBFactory } from 'fake-indexeddb';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InterviewSessionResponse, ProjectResponse } from '@elder-interview/contracts';

import { InterviewApiError, type NewInterviewApi } from './interview-api.js';
import type { AudioCaptureSnapshot } from '../audio/browser-audio-recorder.js';
import type { ConsentCapture } from './browser-consent-capture.js';
import type { InterviewCaptureControllerSnapshot } from './interview-capture-controller.js';
import { NewInterviewPage } from './new-interview-page.js';
import { IndexedDbNewInterviewWorkflowStore } from './new-interview-workflow-store.js';

const ACTOR_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000001';
const RECORDING_START_REMINDER_VERSION = 'recording-reminder-v1' as const;
const RECORDING_START_REMINDER_TEXT =
  '本次仍会录音、转录并由 AI 辅助分析；长者可随时要求停止或撤回。' as const;

describe('NewInterviewPage', () => {
  afterEach(() => {
    cleanup();
  });
  it('shows only the approved verbal-consent path and locks double submission to one request', async () => {
    let resolveProject: ((value: ReturnType<typeof projectResponse>) => void) | undefined;
    const api = fakeApi();
    api.createProject.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProject = resolve;
        }),
    );
    renderPage(api);
    await screen.findByRole('heading', { name: '最低项目信息' });
    expect(screen.queryByText(/electronic|written/i)).toBeNull();
    fireEvent.change(screen.getByLabelText('姓名、昵称或项目代号'), {
      target: { value: '虚构长者小满' },
    });
    const submit = screen.getByRole('button', { name: '创建项目并继续' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => {
      expect(api.createProject).toHaveBeenCalledTimes(1);
    });
    const request = api.createProject.mock.calls[0]?.[0];
    expect(request?.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByLabelText<HTMLInputElement>('姓名、昵称或项目代号').disabled).toBe(true);
    resolveProject?.(projectResponse('虚构长者小满'));
    await screen.findByRole('heading', { name: '建立本次访谈会话' });
    expect(screen.queryByText(/已恢复这台浏览器/)).toBeNull();
    expect(screen.queryByText(/服务说明|价格|费用/)).toBeNull();
    expect(api.createServiceTerm).not.toHaveBeenCalled();
  });

  it('keeps ordinary consent copy truthful without promising pause-and-resume', async () => {
    const api = readyApi();
    renderPage(api);
    await reachConsentRecording();

    expect(screen.getByText('长者可随时要求停止。')).toBeTruthy();
    expect(screen.getByText('长者可要求某段内容不再使用。')).toBeTruthy();
    expect(screen.queryByText(/暂停|稍后恢复|pause|resume/i)).toBeNull();
    expect(screen.getByRole('button', { name: '停止并保存授权录音' })).toBeTruthy();
  });

  it('keeps the existing recovery handle until explicit discard is confirmed', async () => {
    const workflowStore = new IndexedDbNewInterviewWorkflowStore(new IDBFactory());
    const oldWorkflow = await workflowStore.create(ACTOR_ID);
    await workflowStore.put({
      ...oldWorkflow,
      projectAttempt: {
        payload: {
          approximate_age: null,
          birth_year: null,
          current_city: null,
          display_name: '虚构旧项目',
          native_place: null,
          request_id: '20000000-0000-4000-8000-000000000002',
        },
        requestId: '20000000-0000-4000-8000-000000000002',
        response: projectResponse('虚构旧项目'),
        state: 'acknowledged',
      },
      step: 'session',
    });
    const api = fakeApi();

    renderPage(api, { intent: 'new', workflowStore });

    expect(await screen.findByRole('heading', { name: '已有一条未完成访谈' })).toBeTruthy();
    expect(await workflowStore.getActive(ACTOR_ID)).toMatchObject({
      workflowId: oldWorkflow.workflowId,
      projectAttempt: { response: { display_name: '虚构旧项目' } },
    });
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it('keeps a server-backed prestart session discardable when the local session response is missing', async () => {
    const workflowStore = new IndexedDbNewInterviewWorkflowStore(new IDBFactory());
    const workflow = await workflowStore.create(ACTOR_ID);
    await workflowStore.put(workflowWithProjectOnly(workflow));
    const api = fakeApi();
    api.listProjectSessions.mockResolvedValue({
      items: [prestartSessionListItem('created')],
      next_cursor: null,
    });
    api.discardPrestartInterview.mockResolvedValue({
      project_id: PROJECT_ID,
      request_id: '50000000-0000-4000-8000-000000000001',
      result: 'discarded',
      session_id: '40000000-0000-4000-8000-000000000001',
    });

    renderPage(api, { intent: 'new', workflowStore });

    await screen.findByRole('heading', { name: '已有一条未完成访谈' });
    fireEvent.click(screen.getByRole('button', { name: '放弃未完成访谈并新建' }));
    await screen.findByRole('heading', { name: '最低项目信息' });
    expect(api.discardPrestartInterview).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ session_id: null }),
    );
  });

  it('requires confirmation and creates a fresh workflow only after server discard succeeds', async () => {
    const workflowStore = new IndexedDbNewInterviewWorkflowStore(new IDBFactory());
    const workflow = await workflowStore.create(ACTOR_ID);
    await workflowStore.put(workflowWithSession(workflow));
    const api = readyApi();
    api.discardPrestartInterview.mockResolvedValue({
      project_id: PROJECT_ID,
      request_id: '50000000-0000-4000-8000-000000000001',
      result: 'discarded',
      session_id: '40000000-0000-4000-8000-000000000001',
    });

    renderPage(api, { intent: 'new', workflowStore });

    expect(await screen.findByRole('heading', { name: '已有一条未完成访谈' })).toBeTruthy();
    expect(api.discardPrestartInterview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '放弃未完成访谈并新建' }));
    await screen.findByRole('heading', { name: '最低项目信息' });
    expect(api.discardPrestartInterview).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({
        session_id: '40000000-0000-4000-8000-000000000001',
        workflow_version: 'prestart-discard-v1',
      }),
    );
    expect((await workflowStore.getActive(ACTOR_ID))?.workflowId).not.toBe(workflow.workflowId);
  });

  it('keeps local recovery state when server discard fails', async () => {
    const workflowStore = new IndexedDbNewInterviewWorkflowStore(new IDBFactory());
    const workflow = await workflowStore.create(ACTOR_ID);
    await workflowStore.put(workflowWithSession(workflow));
    const api = readyApi();
    api.discardPrestartInterview.mockRejectedValue(
      new InterviewApiError('PRESTART_DISCARD_UNAVAILABLE', 'blocked', 409),
    );

    renderPage(api, { intent: 'new', workflowStore });
    await screen.findByRole('heading', { name: '已有一条未完成访谈' });
    fireEvent.click(screen.getByRole('button', { name: '放弃未完成访谈并新建' }));

    await screen.findByText(/已经有正式录音或其他证据/);
    expect((await workflowStore.getActive(ACTOR_ID))?.workflowId).toBe(workflow.workflowId);
  });

  it('retires a local workflow when the authoritative session has advanced beyond creation', async () => {
    const workflowStore = new IndexedDbNewInterviewWorkflowStore(new IDBFactory());
    const workflow = await workflowStore.create(ACTOR_ID);
    await workflowStore.put(workflowWithSession(workflow));
    const api = fakeApi();
    api.getSession.mockResolvedValue(sessionResponse('recording'));

    renderPage(api, { intent: 'resume', workflowStore });

    await screen.findByRole('heading', { name: '最低项目信息' });
    expect(await workflowStore.getActive(ACTOR_ID)).not.toEqual(workflow);
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it('fails closed when the authoritative session identity does not match the workflow', async () => {
    const workflowStore = new IndexedDbNewInterviewWorkflowStore(new IDBFactory());
    const workflow = await workflowStore.create(ACTOR_ID);
    await workflowStore.put(workflowWithSession(workflow));
    const api = fakeApi();
    api.getSession.mockResolvedValue({
      ...sessionResponse('created'),
      project_id: '99999999-9999-4999-8999-999999999999',
    });

    renderPage(api, { intent: 'resume', workflowStore });

    expect(await screen.findByRole('heading', { name: '无法安全开始新建访谈' })).toBeTruthy();
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it('automatically replays an unknown create with the frozen request identity', async () => {
    const api = fakeApi();
    api.createProject
      .mockRejectedValueOnce(new InterviewApiError('NETWORK_UNAVAILABLE', '网络不可用', 0))
      .mockResolvedValueOnce(projectResponse('虚构恢复长者'));
    renderPage(api);
    await screen.findByRole('heading', { name: '最低项目信息' });
    fireEvent.change(screen.getByLabelText('姓名、昵称或项目代号'), {
      target: { value: '虚构恢复长者' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建项目并继续' }));
    await screen.findByRole('heading', { name: '建立本次访谈会话' });
    const firstRequest = api.createProject.mock.calls[0]?.[0];
    expect(api.createProject).toHaveBeenCalledTimes(2);
    expect(api.createProject.mock.calls[1]?.[0]).toEqual(firstRequest);
    expect(screen.queryByText(/request ID|payload|表单已锁定/)).toBeNull();
  });

  it('waits for active consent capture disposal before SPA navigation', async () => {
    const api = readyApi();
    let releaseDispose: (() => void) | undefined;
    const capture = new FakeConsentCapture(
      () =>
        new Promise<void>((resolve) => {
          releaseDispose = resolve;
        }),
    );
    const navigate = vi.fn();
    renderPage(api, { capture, navigate });
    await reachConsentRecording();
    fireEvent.click(screen.getByRole('button', { name: '录制授权' }));
    await screen.findByText(/正在录制 ·/);

    fireEvent.click(screen.getByRole('button', { name: '返回工作区' }));

    expect(capture.dispose).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    releaseDispose?.();
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('/');
    });
    expect(capture.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('disposes and detaches the consent listener when the route unmounts while recording', async () => {
    const capture = new FakeConsentCapture(() => Promise.resolve());
    const rendered = renderPage(readyApi(), { capture });
    await reachConsentRecording();
    fireEvent.click(screen.getByRole('button', { name: '录制授权' }));
    await screen.findByText(/正在录制 ·/);

    rendered.unmount();

    expect(capture.dispose).toHaveBeenCalledTimes(1);
    expect(capture.unsubscribe).toHaveBeenCalledTimes(1);
    capture.emit({ error: null, persistedChunkCount: 2, status: 'stopped' });
  });

  it('restores mounted state after the StrictMode setup-cleanup-setup cycle', async () => {
    const workflowStore = new IndexedDbNewInterviewWorkflowStore(new IDBFactory());
    await workflowStore.create(ACTOR_ID);
    const capture = new FakeConsentCapture(() => Promise.resolve());
    renderPage(readyApi(), { capture, strict: true, workflowStore });

    await reachConsentRecording();
    fireEvent.click(screen.getByRole('button', { name: '录制授权' }));

    await screen.findByText(/正在录制 ·/);
    await screen.findByText(/正在录制授权。请完整朗读固定文本/);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '返回工作区' }).disabled).toBe(
      false,
    );
  });

  it('initializes a clean workflow once during the StrictMode setup-cleanup-setup cycle', async () => {
    const workflowStore = new IndexedDbNewInterviewWorkflowStore(new IDBFactory());

    renderPage(fakeApi(), { strict: true, workflowStore });

    await screen.findByRole('heading', { name: '最低项目信息' });
    expect(await workflowStore.getActive(ACTOR_ID)).toMatchObject({
      actorId: ACTOR_ID,
      status: 'active',
      step: 'project',
    });
  });

  it('requires a fresh current-page microphone check after refresh before consent recording', async () => {
    const workflowStore = new IndexedDbNewInterviewWorkflowStore(new IDBFactory());
    const first = renderPage(readyApi(), { workflowStore });
    await reachConsentRecording();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '录制授权' }).disabled).toBe(
      false,
    );
    first.unmount();

    renderPage(readyApi(), { workflowStore });
    await screen.findByRole('heading', { name: '完整朗读，再请长者明确同意' });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '录制授权' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '检查当前页麦克风' }));
    await screen.findByText('当前页麦克风检查通过。现在可以录制口头授权。');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '录制授权' }).disabled).toBe(
      false,
    );
  });

  it('shows the server reminder and waits for the explicit start action', async () => {
    const workflowStore = new IndexedDbNewInterviewWorkflowStore(new IDBFactory());
    const workflow = await workflowStore.create(ACTOR_ID);
    await workflowStore.put({
      ...workflow,
      consentAttempt: {
        payload: {
          consent_audio_object_id: '30000000-0000-4000-8000-000000000001',
          consent_method: 'recorded_verbal',
          consent_text_version: 'fictional-test-continuing-consent-v1',
          consent_type: 'recording_transcription_ai',
          consented_at: '2026-08-12T00:00:00.000Z',
          request_id: '30000000-0000-4000-8000-000000000002',
        },
        requestId: '30000000-0000-4000-8000-000000000002',
        response: {
          consent_audio_object_id: '30000000-0000-4000-8000-000000000001',
          consent_method: 'recorded_verbal',
          consent_text_version: 'fictional-test-continuing-consent-v1',
          consent_type: 'recording_transcription_ai',
          consented_at: '2026-08-12T00:00:00.000Z',
          created_at: '2026-08-12T00:00:00.000Z',
          created_by: ACTOR_ID,
          id: '30000000-0000-4000-8000-000000000003',
          project_id: PROJECT_ID,
          revoked_at: null,
          status: 'valid',
        },
        state: 'acknowledged',
      },
      consentAudioJobId: '30000000-0000-4000-8000-000000000004',
      consentAudioObjectId: '30000000-0000-4000-8000-000000000001',
      projectAttempt: {
        payload: {
          approximate_age: null,
          birth_year: null,
          current_city: null,
          display_name: 'Fictional elder',
          native_place: null,
          request_id: '20000000-0000-4000-8000-000000000002',
        },
        requestId: '20000000-0000-4000-8000-000000000002',
        response: projectResponse('Fictional elder'),
        state: 'acknowledged',
      },
      sessionAttempt: {
        payload: { request_id: '40000000-0000-4000-8000-000000000002' },
        requestId: '40000000-0000-4000-8000-000000000002',
        response: sessionResponse('device_check'),
        state: 'acknowledged',
      },
      step: 'start',
    });
    const start = vi.fn(() => Promise.resolve({ phase: 'active' } as never));

    renderPage(fakeApi(), { captureStart: start, workflowStore });

    expect(await screen.findByText(RECORDING_START_REMINDER_TEXT)).toBeTruthy();
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '开始访谈' }));
    await waitFor(() => {
      expect(start).toHaveBeenCalledWith(RECORDING_START_REMINDER_VERSION);
    });
  });
});

function renderPage(
  api: MockApi,
  options: {
    capture?: ConsentCapture;
    captureStart?: (
      recordingReminderVersion: string,
    ) => Promise<InterviewCaptureControllerSnapshot>;
    navigate?: (path: string, replace?: boolean) => void;
    intent?: 'new' | 'resume';
    strict?: boolean;
    workflowStore?: IndexedDbNewInterviewWorkflowStore;
  } = {},
): ReturnType<typeof render> {
  const configuredCapture = options.capture;
  const captureProps =
    configuredCapture === undefined
      ? {}
      : { captureFactory: (): ConsentCapture => configuredCapture };
  const intentProps = options.intent === undefined ? {} : { intent: options.intent };
  const page = (
    <NewInterviewPage
      {...captureProps}
      {...intentProps}
      actorId={ACTOR_ID}
      api={api}
      captureController={() => ({
        start: options.captureStart ?? vi.fn(() => Promise.resolve({ phase: 'active' } as never)),
      })}
      checkMicrophone={() =>
        Promise.resolve({ inputDetected: true as const, permission: 'granted' as const })
      }
      csrfToken="csrf-test"
      navigate={options.navigate ?? vi.fn()}
      workflowStore={
        options.workflowStore ?? new IndexedDbNewInterviewWorkflowStore(new IDBFactory())
      }
    />
  );
  return render(options.strict === true ? <StrictMode>{page}</StrictMode> : page);
}

async function reachConsentRecording(): Promise<void> {
  await screen.findByRole('heading', { name: '最低项目信息' });
  fireEvent.change(screen.getByLabelText('姓名、昵称或项目代号'), {
    target: { value: '虚构授权长者' },
  });
  fireEvent.click(screen.getByRole('button', { name: '创建项目并继续' }));
  await screen.findByRole('heading', { name: '建立本次访谈会话' });
  fireEvent.click(screen.getByRole('button', { name: '建立会话并检查麦克风' }));
  await screen.findByRole('heading', { name: '完整朗读，再请长者明确同意' });
  fireEvent.click(screen.getByRole('button', { name: '检查当前页麦克风' }));
  await screen.findByText('当前页麦克风检查通过。现在可以录制口头授权。');
}

function projectResponse(displayName: string): ProjectResponse {
  return {
    approximate_age: null,
    birth_year: null,
    created_at: '2026-08-12T00:00:00.000Z',
    created_by: ACTOR_ID,
    current_city: null,
    display_name: displayName,
    id: PROJECT_ID,
    native_place: null,
    status: 'draft' as const,
    updated_at: '2026-08-12T00:00:00.000Z',
  };
}

function workflowWithSession(
  workflow: Awaited<ReturnType<IndexedDbNewInterviewWorkflowStore['create']>>,
): Awaited<ReturnType<IndexedDbNewInterviewWorkflowStore['create']>> {
  return {
    ...workflow,
    projectAttempt: {
      payload: {
        approximate_age: null,
        birth_year: null,
        current_city: null,
        display_name: '虚构已建立项目',
        native_place: null,
        request_id: '20000000-0000-4000-8000-000000000002',
      },
      requestId: '20000000-0000-4000-8000-000000000002',
      response: projectResponse('虚构已建立项目'),
      state: 'acknowledged',
    },
    sessionAttempt: {
      payload: { request_id: '40000000-0000-4000-8000-000000000002' },
      requestId: '40000000-0000-4000-8000-000000000002',
      response: sessionResponse('created'),
      state: 'acknowledged',
    },
    step: 'consent_audio',
  };
}

function workflowWithProjectOnly(
  workflow: Awaited<ReturnType<IndexedDbNewInterviewWorkflowStore['create']>>,
): Awaited<ReturnType<IndexedDbNewInterviewWorkflowStore['create']>> {
  return {
    ...workflow,
    projectAttempt: {
      payload: {
        approximate_age: null,
        birth_year: null,
        current_city: null,
        display_name: '虚构已建立项目',
        native_place: null,
        request_id: '20000000-0000-4000-8000-000000000002',
      },
      requestId: '20000000-0000-4000-8000-000000000002',
      response: projectResponse('虚构已建立项目'),
      state: 'acknowledged',
    },
    sessionAttempt: null,
    step: 'session',
  };
}

type MockApi = {
  [Key in keyof NewInterviewApi]: ReturnType<typeof vi.fn<NewInterviewApi[Key]>>;
} & {
  getSession: ReturnType<typeof vi.fn>;
  listProjectSessions: ReturnType<typeof vi.fn>;
};

function fakeApi(): MockApi {
  return {
    createConsent: vi.fn<NewInterviewApi['createConsent']>(),
    createProject: vi.fn<NewInterviewApi['createProject']>(),
    createServiceTerm: vi.fn<NewInterviewApi['createServiceTerm']>(),
    createSession: vi.fn<NewInterviewApi['createSession']>(),
    discardPrestartInterview: vi.fn<NewInterviewApi['discardPrestartInterview']>(),
    deviceCheck: vi.fn<NewInterviewApi['deviceCheck']>(),
    getSession: vi.fn().mockResolvedValue(sessionResponse('created')),
    listProjectSessions: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
    startSession: vi.fn<NewInterviewApi['startSession']>(),
  };
}

function readyApi(): MockApi {
  const api = fakeApi();
  api.createProject.mockResolvedValue(projectResponse('虚构授权长者'));
  api.createSession.mockResolvedValue(sessionResponse('created'));
  api.deviceCheck.mockResolvedValue(sessionResponse('device_check'));
  return api;
}

function sessionResponse(status: InterviewSessionResponse['status']): InterviewSessionResponse {
  return {
    capture: null,
    created_at: '2026-08-12T00:00:00.000Z',
    created_by: ACTOR_ID,
    ended_at: null,
    id: '40000000-0000-4000-8000-000000000001',
    project_id: PROJECT_ID,
    recording_start_reminder: {
      action_label: '开始访谈',
      creates_consent_record: false,
      requires_explicit_action: true,
      text: RECORDING_START_REMINDER_TEXT,
      version: RECORDING_START_REMINDER_VERSION,
    },
    sequence_no: 1,
    started_at: null,
    status,
    updated_at: '2026-08-12T00:00:00.000Z',
  };
}

function prestartSessionListItem(
  status: 'created' | 'device_check',
): import('@elder-interview/contracts').ProjectSessionListItem {
  return {
    capture: null,
    capture_failure_code: null,
    created_at: '2026-08-12T00:00:00.000Z',
    duration_seconds: null,
    ended_at: null,
    finalization: null,
    home_state: 'preparation_required',
    id: '40000000-0000-4000-8000-000000000001',
    primary_action: 'continue_preparation',
    project_id: PROJECT_ID,
    review_access: 'unavailable',
    sequence_no: 1,
    started_at: null,
    status,
  };
}

class FakeConsentCapture implements ConsentCapture {
  private listener: ((snapshot: AudioCaptureSnapshot) => void) | null = null;
  public readonly dispose: ReturnType<typeof vi.fn<ConsentCapture['dispose']>>;
  public readonly unsubscribe = vi.fn();

  public constructor(dispose: () => Promise<void>) {
    this.dispose = vi.fn(dispose);
  }

  public emit(snapshot: AudioCaptureSnapshot): void {
    this.listener?.(snapshot);
  }

  public finishAndUpload(): Promise<string> {
    return Promise.reject(new Error('not used'));
  }

  public start(): Promise<void> {
    this.emit({ error: null, persistedChunkCount: 1, status: 'recording' });
    return Promise.resolve();
  }

  public subscribe(listener: (snapshot: AudioCaptureSnapshot) => void): () => void {
    this.listener = listener;
    listener({ error: null, persistedChunkCount: 0, status: 'idle' });
    return (): void => {
      this.listener = null;
      this.unsubscribe();
    };
  }
}
