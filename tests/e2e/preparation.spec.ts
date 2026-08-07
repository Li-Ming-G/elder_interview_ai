import { expect, test } from '@playwright/test';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

test('assigned fictional project passes preparation and enters only the workbench shell', async ({
  page,
}) => {
  const writes: string[] = [];
  await page.addInitScript((): void => {
    const stream = {
      getTracks: (): Array<{ stop: () => undefined }> => [{ stop: () => undefined }],
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.resolve(stream) },
    });
    class FakeAudioContext {
      public createAnalyser(): {
        connect: () => void;
        disconnect: () => void;
        fftSize: number;
        getByteTimeDomainData: (samples: Uint8Array) => void;
      } {
        return {
          connect: () => undefined,
          disconnect: () => undefined,
          fftSize: 1024,
          getByteTimeDomainData: (samples): void => {
            samples.fill(128);
            samples[12] = 140;
          },
        };
      }
      public createMediaStreamSource(): {
        connect: () => void;
        disconnect: () => void;
      } {
        return { connect: () => undefined, disconnect: () => undefined };
      }
      public close(): Promise<void> {
        return Promise.resolve();
      }
    }
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });
  });

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST') writes.push(path);
    const payload = responseFor(path, request.method());
    await route.fulfill({
      body: JSON.stringify(payload),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.goto(`/projects/${PROJECT_ID}/interview/prepare`);
  await expect(page.getByRole('heading', { name: /和虚构长者小禾开始/ })).toBeVisible();
  await expect(page.getByText('30 分钟', { exact: true })).toBeVisible();
  await expect(page.getByText(/正式授权有效/)).toBeVisible();
  await expect(page.getByRole('button', { name: '开始访谈' })).toBeDisabled();
  await page.setViewportSize({ height: 844, width: 390 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= globalThis.innerWidth),
  ).toBe(true);

  await page.getByRole('button', { name: '检测麦克风' }).click();
  await expect(page.getByText('权限已允许，并检测到声音输入。')).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${PROJECT_ID}/interview/${SESSION_ID}/prepare$`),
  );
  await expect(page.getByRole('button', { name: '开始访谈' })).toBeEnabled();

  await page.getByRole('button', { name: '开始访谈' }).click();
  await expect(page.getByRole('heading', { name: '访谈已开始' })).toBeVisible();
  await expect(page.getByText(/DEV-005B 接入/)).toBeVisible();
  await expect(page.getByText(/不提供结束、完成模拟或 AI 建议/)).toBeVisible();

  expect(writes).toEqual([
    `/api/v1/projects/${PROJECT_ID}/sessions`,
    `/api/v1/sessions/${SESSION_ID}/device-check`,
    `/api/v1/sessions/${SESSION_ID}/start`,
  ]);
  expect(writes.some((path) => path.endsWith('/stop') || path.endsWith('/recover'))).toBe(false);
});

function responseFor(path: string, method: string): unknown {
  if (path === '/api/v1/auth/me') {
    return {
      display_name: '虚构倾听员 A',
      id: '33333333-3333-4333-8333-333333333333',
      role: 'interviewer',
      status: 'active',
    };
  }
  if (path === '/api/v1/auth/csrf') return { csrf_token: 'opaque-test-token' };
  if (path === `/api/v1/projects/${PROJECT_ID}`) {
    return {
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
  }
  if (path === `/api/v1/projects/${PROJECT_ID}/service-terms`) {
    return [
      {
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
      },
    ];
  }
  if (path === `/api/v1/projects/${PROJECT_ID}/consents`) {
    return [
      {
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
      },
    ];
  }
  if (path === `/api/v1/projects/${PROJECT_ID}/sessions` && method === 'POST') {
    return session('created');
  }
  if (path === `/api/v1/sessions/${SESSION_ID}/device-check` && method === 'POST') {
    return session('device_check');
  }
  if (path === `/api/v1/sessions/${SESSION_ID}` && method === 'GET') {
    return session('device_check');
  }
  if (path === `/api/v1/sessions/${SESSION_ID}/start` && method === 'POST') {
    return session('recording');
  }
  throw new Error(`Unhandled test request: ${method} ${path}`);
}

function session(status: 'created' | 'device_check' | 'recording'): unknown {
  return {
    created_at: '2026-08-07T00:00:00.000Z',
    created_by: '33333333-3333-4333-8333-333333333333',
    id: SESSION_ID,
    project_id: PROJECT_ID,
    sequence_no: 1,
    started_at: status === 'recording' ? '2026-08-07T00:01:00.000Z' : null,
    status,
    updated_at: '2026-08-07T00:01:00.000Z',
  };
}
