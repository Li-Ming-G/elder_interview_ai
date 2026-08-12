import { mkdir } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

const ACTOR_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000001';

test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['microphone'],
});

for (const viewport of [
  { height: 900, label: 'desktop', width: 1440 },
  { height: 844, label: 'mobile', width: 390 },
  { height: 568, label: 'compact', width: 320 },
] as const) {
  test(`new interview reaches formal verbal consent without overflow at ${String(viewport.width)}x${String(viewport.height)}`, async ({
    page,
  }) => {
    const requestIds: string[] = [];
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await routeNewInterview(page, requestIds);
    await page.goto('/interviews/new');

    await page.getByLabel('姓名、昵称或项目代号').fill('虚构长者新禾');
    await page.getByRole('button', { name: '创建项目并继续' }).click();
    await expect(page.getByRole('heading', { name: '服务说明' })).toBeVisible();
    await page.getByRole('button', { name: '已说明并保存' }).click();

    await expect(page.getByRole('heading', { name: '完整朗读，再请长者明确同意' })).toBeVisible();
    await expect(page.getByText('对话会被录音。')).toBeVisible();
    await expect(page.getByText('内容不会未经确认直接公开。')).toBeVisible();
    await expect(page.getByText('授权文本版本：mvp-v1')).toBeVisible();
    await expect(page.getByText(/electronic|written/i)).toHaveCount(0);
    expect(requestIds).toHaveLength(2);
    expect(new Set(requestIds).size).toBe(2);

    const layout = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(layout.body).toBeLessThanOrEqual(layout.viewport);
    expect(layout.document).toBeLessThanOrEqual(layout.viewport);
    expect(
      await page
        .getByRole('button')
        .evaluateAll((buttons) =>
          buttons.every((button) => button.getBoundingClientRect().height >= 44),
        ),
    ).toBe(true);
    expect(
      await page
        .getByRole('button', { name: '录制授权' })
        .evaluate((button) => getComputedStyle(button).transitionDuration),
    ).toBe('1e-05s');

    await page.getByRole('button', { name: '录制授权' }).focus();
    await expect(page.getByRole('button', { name: '录制授权' })).toBeFocused();
    await mkdir('output/playwright', { recursive: true });
    await page.screenshot({
      fullPage: true,
      path: `output/playwright/dev-008a2-verbal-consent-${viewport.label}-${String(viewport.width)}x${String(viewport.height)}.png`,
    });
  });
}

test('unknown project response survives reload and replays only the original request id', async ({
  page,
}) => {
  let projectAttempts = 0;
  const seenRequestIds: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/me') return route.fulfill({ json: actor() });
    if (path === '/api/v1/auth/csrf') return route.fulfill({ json: { csrf_token: 'csrf-test' } });
    if (path === '/api/v1/projects' && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      seenRequestIds.push(String(body.request_id));
      projectAttempts += 1;
      if (projectAttempts === 1) return route.abort('connectionreset');
      return route.fulfill({ json: projectAck(body), status: 201 });
    }
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto('/interviews/new');
  await page.getByLabel('姓名、昵称或项目代号').fill('虚构未知响应长者');
  await page.getByRole('button', { name: '创建项目并继续' }).click();
  await expect(page.getByText(/上次响应未知/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/已恢复这台浏览器上未完成/)).toBeVisible();
  await page.getByRole('button', { name: '使用原请求重试' }).click();
  await expect(page.getByRole('heading', { name: '服务说明' })).toBeVisible();
  expect(seenRequestIds).toHaveLength(2);
  expect(seenRequestIds[1]).toBe(seenRequestIds[0]);
});

test('SPA return stops consent recording and re-entry resumes the same audio job', async ({
  page,
}) => {
  await observeNativeConsentCapture(page);
  await routeNewInterview(page, []);
  await page.goto('/interviews/new');
  await page.getByLabel('姓名、昵称或项目代号').fill('虚构离页授权长者');
  await page.getByRole('button', { name: '创建项目并继续' }).click();
  await page.getByRole('button', { name: '已说明并保存' }).click();
  await page.getByRole('button', { name: '录制授权' }).click();
  await expect(page.getByText(/正在录制 ·/)).toBeVisible();
  await page.waitForTimeout(1_100);

  await page.getByRole('button', { name: '返回工作区' }).click();
  await expect(page.getByRole('heading', { name: '今天好，虚构倾听员 A' })).toBeVisible();
  await expectConsentMediaReleased(page);
  const first = await readConsentAudioState(page);
  expect(first.jobs).toHaveLength(1);
  expect(first.jobs[0]?.expectedChunkCount).toBeNull();
  expect(first.archiveCount).toBeGreaterThan(0);

  await page.goto('/interviews/new');
  await expect(page.getByRole('heading', { name: '完整朗读，再请长者明确同意' })).toBeVisible();
  await expect(page.getByText(/存在可恢复的授权录音记录/)).toBeVisible();
  await page.getByRole('button', { name: '继续录制授权' }).click();
  await expect(page.getByText(/正在录制 ·/)).toBeVisible();
  const resumed = await readConsentAudioState(page);
  expect(resumed.jobs).toHaveLength(1);
  expect(resumed.jobs[0]?.jobId).toBe(first.jobs[0]?.jobId);

  await page.getByRole('button', { name: '返回工作区' }).click();
  await expectConsentMediaReleased(page);
});

async function routeNewInterview(page: Page, requestIds: string[]): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/auth/me') return route.fulfill({ json: actor() });
    if (path === '/api/v1/auth/csrf') return route.fulfill({ json: { csrf_token: 'csrf-test' } });
    if (path === '/api/v1/projects' && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      requestIds.push(String(body.request_id));
      return route.fulfill({ json: projectAck(body), status: 201 });
    }
    if (path === `/api/v1/projects/${PROJECT_ID}/service-terms` && request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      requestIds.push(String(body.request_id));
      const payload = withoutRequestId(body);
      return route.fulfill({
        json: {
          ...payload,
          created_at: '2026-08-12T00:00:00.000Z',
          effective_from: '2026-08-12T00:00:00.000Z',
          explained_at: '2026-08-12T00:00:00.000Z',
          explained_by: ACTOR_ID,
          id: '30000000-0000-4000-8000-000000000001',
          project_id: PROJECT_ID,
          superseded_at: null,
        },
        status: 201,
      });
    }
    return route.fulfill({ json: { items: [] } });
  });
}

function actor(): Record<string, unknown> {
  return {
    display_name: '虚构倾听员 A',
    id: ACTOR_ID,
    role: 'interviewer',
    status: 'active',
  };
}

function projectAck(body: Record<string, unknown>): Record<string, unknown> {
  const payload = withoutRequestId(body);
  return {
    ai_policy_revision: 0,
    approximate_age: null,
    birth_year: null,
    created_at: '2026-08-12T00:00:00.000Z',
    created_by: ACTOR_ID,
    current_city: null,
    deleted_at: null,
    native_place: null,
    ...payload,
    id: PROJECT_ID,
    status: 'draft',
    updated_at: '2026-08-12T00:00:00.000Z',
  };
}

function withoutRequestId(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'request_id'));
}

async function observeNativeConsentCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const observed = {
      recorders: [] as MediaRecorder[],
      tracks: [] as MediaStreamTrack[],
    };
    Object.defineProperty(globalThis, '__consentCaptureObserved', { value: observed });
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints): Promise<MediaStream> => {
      const stream = await nativeGetUserMedia(constraints);
      observed.tracks.push(...stream.getTracks());
      return stream;
    };
    const NativeMediaRecorder = globalThis.MediaRecorder;
    globalThis.MediaRecorder = class ObservedMediaRecorder extends NativeMediaRecorder {
      public constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options);
        observed.recorders.push(this);
      }
    };
  });
}

async function expectConsentMediaReleased(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const observed = (
          globalThis as typeof globalThis & {
            __consentCaptureObserved: {
              recorders: MediaRecorder[];
              tracks: MediaStreamTrack[];
            };
          }
        ).__consentCaptureObserved;
        return {
          recordersInactive:
            observed.recorders.length > 0 &&
            observed.recorders.every((recorder) => recorder.state === 'inactive'),
          tracksEnded:
            observed.tracks.length > 0 &&
            observed.tracks.every((track) => track.readyState === 'ended'),
        };
      }),
    )
    .toEqual({ recordersInactive: true, tracksEnded: true });
}

async function readConsentAudioState(page: Page): Promise<{
  archiveCount: number;
  jobs: Array<{ expectedChunkCount: number | null; jobId: string }>;
}> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('elder-interview-audio-buffer');
        open.onerror = (): void => {
          reject(open.error ?? new Error('audio buffer database open failed'));
        };
        open.onsuccess = (): void => {
          const database = open.result;
          const transaction = database.transaction(['archive-chunks', 'upload-jobs'], 'readonly');
          const archives = transaction.objectStore('archive-chunks').getAll();
          const jobs = transaction.objectStore('upload-jobs').getAll();
          transaction.onerror = (): void => {
            reject(transaction.error ?? new Error('audio buffer read failed'));
          };
          transaction.oncomplete = (): void => {
            resolve({
              archiveCount: (archives.result as unknown[]).length,
              jobs: jobs.result as Array<{ expectedChunkCount: number | null; jobId: string }>,
            });
          };
        };
      }),
  );
}
