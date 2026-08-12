// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  ConsentResponse,
  InterviewSessionResponse,
  ProjectResponse,
  ServiceTermResponse,
} from '@elder-interview/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InterviewApi, PreparationData } from './interview-api.js';
import { InterviewApiError } from './interview-api.js';
import type { MicrophoneChecker } from './microphone-check.js';
import { PreparationPage } from './preparation-page.js';
import type { InterviewCaptureControllerSnapshot } from './interview-capture-controller.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

describe('PreparationPage', () => {
  afterEach(cleanup);

  it('loads a valid project, lazily creates/checks one session, and navigates to the shell once', async () => {
    const api = createApi();
    const navigate = vi.fn();
    renderPage(api, navigate);
    expect(await screen.findByText('虚构长者小禾')).toBeTruthy();
    expect(screen.getByText('30 分钟')).toBeTruthy();
    expect(screen.getByText(/正式授权有效/)).toBeTruthy();
    expect(api.createSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '检测麦克风' }));
    await screen.findByText('权限已允许，并检测到声音输入。');
    expect(api.createSession).toHaveBeenCalledTimes(1);
    expect(api.deviceCheck).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      `/projects/${PROJECT_ID}/interview/${SESSION_ID}/prepare`,
      true,
    );

    const start = screen.getByRole('button', { name: '开始访谈' });
    fireEvent.click(start);
    fireEvent.click(start);
    await waitFor(() => {
      expect(api.captureStart).toHaveBeenCalledTimes(1);
    });
    expect(navigate).toHaveBeenLastCalledWith(
      `/projects/${PROJECT_ID}/interview/${SESSION_ID}/workbench`,
    );
  });

  it.each([
    [
      '未分配项目',
      new InterviewApiError('FORBIDDEN', '无法访问此项目，请联系项目负责人确认分配', 403),
    ],
    ['未登录', new InterviewApiError('AUTH_REQUIRED', '登录已失效，请重新登录', 401)],
  ])('shows a non-disclosing load failure for %s', async (_label, failure) => {
    const api = createApi();
    api.loadPreparation.mockRejectedValue(failure);
    renderPage(api);
    expect((await screen.findByRole('alert')).textContent).toContain(failure.message);
    expect(screen.queryByText('虚构长者小禾')).toBeNull();
  });

  it('blocks start when consent is invalid or the project is not ready', async () => {
    const api = createApi({
      consents: [{ ...CONSENT, status: 'revoked' }],
      project: { ...PROJECT, status: 'restricted' },
    });
    renderPage(api);
    expect(await screen.findByText(/没有有效的正式授权记录/)).toBeTruthy();
    expect(screen.getByText(/项目状态当前不允许开始/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '开始访谈' }).hasAttribute('disabled')).toBe(true);
  });

  it('blocks an existing session in the wrong state', async () => {
    const api = createApi({ session: { ...SESSION, status: 'recording' } });
    renderPage(api, vi.fn(), SESSION_ID);
    expect(await screen.findByText(/当前会话状态为“正在访谈”/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '开始访谈' }).hasAttribute('disabled')).toBe(true);
  });

  it('explains denied microphone permission without creating a session', async () => {
    const api = createApi();
    renderPage(api, vi.fn(), null, () =>
      Promise.resolve({ inputDetected: false, permission: 'denied' }),
    );
    await screen.findByText('虚构长者小禾');
    fireEvent.click(screen.getByRole('button', { name: '检测麦克风' }));
    expect(await screen.findByText(/麦克风权限被拒绝/)).toBeTruthy();
    expect(api.createSession).not.toHaveBeenCalled();
    expect(api.deviceCheck).not.toHaveBeenCalled();
  });

  it('explains missing input without creating a session', async () => {
    const api = createApi();
    renderPage(api, vi.fn(), null, () =>
      Promise.resolve({ inputDetected: false, permission: 'granted' }),
    );
    await screen.findByText('虚构长者小禾');
    fireEvent.click(screen.getByRole('button', { name: '检测麦克风' }));
    expect(await screen.findByText(/没有检测到声音/)).toBeTruthy();
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it('distinguishes very low input from silence and keeps the real input gate closed', async () => {
    const api = createApi();
    renderPage(api, vi.fn(), null, () =>
      Promise.resolve({ inputDetected: false, permission: 'granted', reason: 'too_low' }),
    );
    await screen.findByText('虚构长者小禾');
    fireEvent.click(screen.getByRole('button', { name: '检测麦克风' }));
    expect(await screen.findByText(/声音太弱/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '开始访谈' }).hasAttribute('disabled')).toBe(true);
    expect(api.createSession).not.toHaveBeenCalled();
    expect(api.deviceCheck).not.toHaveBeenCalled();
  });

  it('uses a plain fallback when the formal elder display name is unusable', async () => {
    const api = createApi({ project: { ...PROJECT, display_name: '？？？？？' } });
    renderPage(api);
    expect(await screen.findByText('这位长者')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /和这位长者开始/ })).toBeTruthy();
    expect(screen.queryByText('？？？？？')).toBeNull();
  });

  it('keeps the page and disables concurrent actions while device-check or start is pending', async () => {
    const api = createApi();
    let resolveCheck: (() => void) | undefined;
    const checkMicrophone = vi.fn(
      async () =>
        new Promise<{ inputDetected: true; permission: 'granted' }>((resolve) => {
          resolveCheck = function resolveMicrophoneCheck(): void {
            resolve({ inputDetected: true, permission: 'granted' });
          };
        }),
    );
    renderPage(api, vi.fn(), null, checkMicrophone);
    await screen.findByText('虚构长者小禾');
    const check = screen.getByRole('button', { name: '检测麦克风' });
    fireEvent.click(check);
    fireEvent.click(check);
    expect(screen.getByRole('button', { name: '正在听取输入…' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(checkMicrophone).toHaveBeenCalledTimes(1);
    resolveCheck?.();
    await screen.findByText('权限已允许，并检测到声音输入。');

    let resolveStart: ((snapshot: InterviewCaptureControllerSnapshot) => void) | undefined;
    api.captureStart.mockImplementation(
      async () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
    );
    const start = screen.getByRole('button', { name: '开始访谈' });
    fireEvent.click(start);
    expect(
      (await screen.findByRole('button', { name: '正在开始…' })).hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '正在开始…' }));
    expect(api.captureStart).toHaveBeenCalledTimes(1);
    resolveStart?.(ACTIVE_CAPTURE);
  });

  it.each([
    ['device-check', '设备检测未能完成，请检查设备后重试'],
    ['start', '正式授权当前无效，请先核对授权记录'],
  ])('keeps a clear retryable failure when %s fails', async (phase, expected) => {
    const api = createApi();
    if (phase === 'device-check') api.deviceCheck.mockRejectedValue(new Error('failed'));
    if (phase === 'start') {
      api.captureStart.mockRejectedValue(new InterviewApiError('CONSENT_REQUIRED', expected, 409));
    }
    renderPage(api);
    await screen.findByText('虚构长者小禾');
    fireEvent.click(screen.getByRole('button', { name: '检测麦克风' }));
    if (phase === 'device-check') {
      expect(await screen.findByText(expected)).toBeTruthy();
      return;
    }
    await screen.findByText('权限已允许，并检测到声音输入。');
    fireEvent.click(screen.getByRole('button', { name: '开始访谈' }));
    expect((await screen.findByRole('alert')).textContent).toContain(expected);
    expect(screen.getByRole('button', { name: '开始访谈' }).hasAttribute('disabled')).toBe(false);
  });
});

function renderPage(
  api: MockApi,
  navigate = vi.fn(),
  initialSessionId: string | null = null,
  checkMicrophone: MicrophoneChecker = vi.fn(() =>
    Promise.resolve({ inputDetected: true as const, permission: 'granted' as const }),
  ),
): void {
  render(
    <PreparationPage
      actorId="10000000-0000-4000-8000-000000000001"
      api={api}
      captureController={() => ({ start: api.captureStart })}
      checkMicrophone={checkMicrophone}
      initialSessionId={initialSessionId}
      navigate={navigate}
      projectId={PROJECT_ID}
    />,
  );
}

type MockApi = {
  [Key in keyof InterviewApi]: ReturnType<typeof vi.fn<InterviewApi[Key]>>;
} & { captureStart: ReturnType<typeof vi.fn<() => Promise<InterviewCaptureControllerSnapshot>>> };

function createApi(overrides: Partial<PreparationData> = {}): MockApi {
  const data: PreparationData = {
    consents: [CONSENT],
    project: PROJECT,
    serviceTerms: [SERVICE_TERM],
    session: null,
    ...overrides,
  };
  return {
    createSession: vi.fn(() => Promise.resolve(SESSION)),
    captureStart: vi.fn(() => Promise.resolve(ACTIVE_CAPTURE)),
    deviceCheck: vi.fn(() => Promise.resolve({ ...SESSION, status: 'device_check' })),
    loadPreparation: vi.fn(() => Promise.resolve(data)),
  };
}

const ACTIVE_CAPTURE = { phase: 'active' } as InterviewCaptureControllerSnapshot;

const PROJECT: ProjectResponse = {
  approximate_age: null,
  birth_year: null,
  created_at: '2026-08-07T00:00:00.000Z',
  created_by: '33333333-3333-4333-8333-333333333333',
  current_city: null,
  display_name: '虚构长者小禾',
  id: PROJECT_ID,
  native_place: null,
  status: 'ready',
  updated_at: '2026-08-07T00:00:00.000Z',
};

const SERVICE_TERM: ServiceTermResponse = {
  created_at: '2026-08-07T00:00:00.000Z',
  currency: 'CNY',
  effective_from: '2026-08-07T00:00:00.000Z',
  estimated_session_count: 1,
  expected_current_minutes: 30,
  explained_at: '2026-08-07T00:00:00.000Z',
  explained_by: '33333333-3333-4333-8333-333333333333',
  id: '44444444-4444-4444-8444-444444444444',
  included_minutes: 60,
  overtime_price_minor: 0,
  overtime_unit_minutes: 30,
  project_id: PROJECT_ID,
  superseded_at: null,
};

const CONSENT: ConsentResponse = {
  consent_audio_object_id: null,
  consent_method: 'electronic',
  consent_text_version: 'mvp-v1',
  consent_type: 'recording_transcription_ai',
  consented_at: '2026-08-07T00:00:00.000Z',
  created_at: '2026-08-07T00:00:00.000Z',
  created_by: '33333333-3333-4333-8333-333333333333',
  id: '55555555-5555-4555-8555-555555555555',
  project_id: PROJECT_ID,
  revoked_at: null,
  status: 'valid',
};

const SESSION: InterviewSessionResponse = {
  created_at: '2026-08-07T00:00:00.000Z',
  created_by: '33333333-3333-4333-8333-333333333333',
  id: SESSION_ID,
  project_id: PROJECT_ID,
  sequence_no: 1,
  started_at: null,
  status: 'created',
  updated_at: '2026-08-07T00:00:00.000Z',
};
