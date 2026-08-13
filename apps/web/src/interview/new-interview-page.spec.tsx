// @vitest-environment jsdom

import { IDBFactory } from 'fake-indexeddb';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InterviewSessionResponse, ProjectResponse } from '@elder-interview/contracts';

import { InterviewApiError, type NewInterviewApi } from './interview-api.js';
import type { AudioCaptureSnapshot } from '../audio/browser-audio-recorder.js';
import type { ConsentCapture } from './browser-consent-capture.js';
import { NewInterviewPage } from './new-interview-page.js';
import { IndexedDbNewInterviewWorkflowStore } from './new-interview-workflow-store.js';

const ACTOR_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000001';

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
    expect(screen.queryByText(/服务说明|价格|费用/)).toBeNull();
    expect(api.createServiceTerm).not.toHaveBeenCalled();
  });

  it('marks a network response unknown and replays the frozen request identity', async () => {
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
    await screen.findByText(/上次响应未知/);
    const firstRequest = api.createProject.mock.calls[0]?.[0];
    fireEvent.click(screen.getByRole('button', { name: '使用原请求重试' }));
    await screen.findByRole('heading', { name: '建立本次访谈会话' });
    expect(api.createProject.mock.calls[1]?.[0]).toEqual(firstRequest);
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
});

function renderPage(
  api: MockApi,
  options: {
    capture?: ConsentCapture;
    navigate?: (path: string, replace?: boolean) => void;
    strict?: boolean;
    workflowStore?: IndexedDbNewInterviewWorkflowStore;
  } = {},
): ReturnType<typeof render> {
  const configuredCapture = options.capture;
  const captureProps =
    configuredCapture === undefined
      ? {}
      : { captureFactory: (): ConsentCapture => configuredCapture };
  const page = (
    <NewInterviewPage
      {...captureProps}
      actorId={ACTOR_ID}
      api={api}
      captureController={() => ({
        start: vi.fn(() => Promise.resolve({ phase: 'active' } as never)),
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

type MockApi = {
  [Key in keyof NewInterviewApi]: ReturnType<typeof vi.fn<NewInterviewApi[Key]>>;
};

function fakeApi(): MockApi {
  return {
    createConsent: vi.fn<NewInterviewApi['createConsent']>(),
    createProject: vi.fn<NewInterviewApi['createProject']>(),
    createServiceTerm: vi.fn<NewInterviewApi['createServiceTerm']>(),
    createSession: vi.fn<NewInterviewApi['createSession']>(),
    deviceCheck: vi.fn<NewInterviewApi['deviceCheck']>(),
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
    sequence_no: 1,
    started_at: null,
    status,
    updated_at: '2026-08-12T00:00:00.000Z',
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
