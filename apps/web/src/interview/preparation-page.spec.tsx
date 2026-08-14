// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  ConsentResponse,
  InterviewSessionResponse,
  ProjectResponse,
} from '@elder-interview/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InterviewApi, PreparationData } from './interview-api.js';
import { PreparationPage } from './preparation-page.js';
import type { InterviewCaptureControllerSnapshot } from './interview-capture-controller.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

describe('PreparationPage DEV-008A4 recovery route', () => {
  afterEach(cleanup);

  it('does not show service-price or microphone controls and resumes an already checked session', async () => {
    const api = createApi();
    const navigate = vi.fn();
    renderPage(api, navigate);
    await screen.findByRole('heading', { name: '继续建立正式录音' });
    expect(screen.queryByText(/服务说明|价格|费用|预计时长/)).toBeNull();
    expect(screen.queryByRole('button', { name: /麦克风|设备检查/ })).toBeNull();
    expect(screen.getByText(/本次仍会录音、转录并由 AI 辅助分析/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '开始访谈' }));
    await waitFor(() => {
      expect(api.captureStart).toHaveBeenCalledTimes(1);
    });
    expect(api.captureStart).toHaveBeenCalledWith('recording-reminder-v1');
    expect(navigate).toHaveBeenCalledWith(
      `/projects/${PROJECT_ID}/interview/${SESSION_ID}/workbench`,
    );
  });

  it('fails closed when the existing session was not checked before authorization', async () => {
    const api = createApi({ session: { ...SESSION, status: 'created' } });
    renderPage(api);
    expect(await screen.findByText(/待设备检查/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '开始访谈' }).disabled).toBe(true);
    expect(api.deviceCheck).not.toHaveBeenCalled();
  });

  it('fails closed when current formal consent is invalid', async () => {
    const api = createApi({ consents: [{ ...CONSENT, status: 'revoked' }] });
    renderPage(api);
    expect(await screen.findByText('最新正式授权当前无效。')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '开始访谈' }).disabled).toBe(true);
  });
});

function renderPage(api: MockApi, navigate = vi.fn()): void {
  render(
    <PreparationPage
      api={api}
      captureController={() => ({ start: api.captureStart })}
      initialSessionId={SESSION_ID}
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
    serviceTerms: [],
    session: SESSION,
    ...overrides,
  };
  return {
    captureStart: vi.fn(() =>
      Promise.resolve({ phase: 'active' } as InterviewCaptureControllerSnapshot),
    ),
    createSession: vi.fn(),
    deviceCheck: vi.fn(),
    loadPreparation: vi.fn(() => Promise.resolve(data)),
  };
}

const PROJECT: ProjectResponse = {
  approximate_age: null,
  birth_year: null,
  created_at: '2026-08-12T00:00:00.000Z',
  created_by: '10000000-0000-4000-8000-000000000001',
  current_city: null,
  display_name: '虚构长者小禾',
  id: PROJECT_ID,
  native_place: null,
  status: 'ready',
  updated_at: '2026-08-12T00:00:00.000Z',
};

const CONSENT: ConsentResponse = {
  consent_audio_object_id: '33333333-3333-4333-8333-333333333333',
  consent_method: 'recorded_verbal',
  consent_text_version: 'mvp-v1',
  consent_type: 'recording_transcription_ai',
  consented_at: '2026-08-12T00:00:00.000Z',
  created_at: '2026-08-12T00:00:00.000Z',
  created_by: '10000000-0000-4000-8000-000000000001',
  id: '44444444-4444-4444-8444-444444444444',
  project_id: PROJECT_ID,
  revoked_at: null,
  status: 'valid',
};

const SESSION: InterviewSessionResponse = {
  capture: null,
  created_at: '2026-08-12T00:00:00.000Z',
  created_by: '10000000-0000-4000-8000-000000000001',
  ended_at: null,
  id: SESSION_ID,
  project_id: PROJECT_ID,
  recording_start_reminder: {
    action_label: '开始访谈',
    creates_consent_record: false,
    requires_explicit_action: true,
    text: '本次仍会录音、转录并由 AI 辅助分析；长者可随时要求暂停、停止或撤回。',
    version: 'recording-reminder-v1',
  },
  sequence_no: 1,
  started_at: null,
  status: 'device_check',
  updated_at: '2026-08-12T00:00:00.000Z',
};
