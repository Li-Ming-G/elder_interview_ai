import { expect, test } from '@playwright/test';

test('real Web and API use HttpOnly Cookie, Origin and CSRF for the login lifecycle', async ({
  context,
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('邮箱').fill('listener-a@example.test');
  await page.getByLabel('密码').fill('Fictional-only-Password-42!');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { name: '已登录' })).toBeVisible();
  await expect(page.getByText('虚构倾听员 A')).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toContain('elder_interview_session');

  await page.reload();
  await expect(page.getByRole('heading', { name: '已登录' })).toBeVisible();

  await page.evaluate(async () => fetch('/api/v1/auth/csrf'));

  const cookiesBeforeLogout = await context.cookies(page.url());
  expect(cookiesBeforeLogout.map((cookie) => cookie.name)).toEqual(['elder_interview_session']);
  const logoutStatuses: number[] = [];
  page.on('response', (response) => {
    if (!response.url().endsWith('/api/v1/auth/logout')) return;
    logoutStatuses.push(response.status());
  });
  const successfulLogout = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/auth/logout') && response.status() === 200,
  );
  await page.getByRole('button', { name: '退出登录' }).click();
  const successfulLogoutResponse = await successfulLogout;
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
  await expect.poll(() => logoutStatuses).toEqual([403, 200]);
  await expect(successfulLogoutResponse.headerValue('set-cookie')).resolves.toContain('Max-Age=0');
  const cookiesAfterLogout = await context.cookies(page.url());
  expect(
    cookiesAfterLogout.filter((cookie) => cookie.name === 'elder_interview_session'),
  ).toHaveLength(0);
  const meStatus = await page.evaluate(
    async () => (await fetch('/api/v1/auth/me', { cache: 'no-store' })).status,
  );
  expect(meStatus).toBe(401);
  const directMe = await context.request.get('http://127.0.0.1:3101/api/v1/auth/me', {
    headers: { Origin: 'http://127.0.0.1:4173' },
  });
  expect(directMe.status()).toBe(401);
});

test('logout failure preserves the authenticated UI state', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('邮箱').fill('listener-a@example.test');
  await page.getByLabel('密码').fill('Fictional-only-Password-42!');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { name: '已登录' })).toBeVisible();
  await page.route('**/api/v1/auth/logout', async (route) => route.fulfill({ status: 403 }));
  await page.route('**/api/v1/auth/csrf', async (route) => route.fulfill({ status: 500 }));
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '已登录' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('退出失败');
});

test('synthetic Chromium audio survives IndexedDB then uploads and completes through the real API', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('邮箱').fill('listener-a@example.test');
  await page.getByLabel('密码').fill('Fictional-only-Password-42!');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { name: '已登录' })).toBeVisible();
  const projectId = await page.evaluate(async () => {
    const csrfResponse = await fetch('/api/v1/auth/csrf', { cache: 'no-store' });
    const csrf = (await csrfResponse.json()) as { csrf_token: string };
    const response = await fetch('/api/v1/projects', {
      body: JSON.stringify({ display_name: '虚构 Chromium 可靠上传项目' }),
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrf_token },
      method: 'POST',
    });
    if (!response.ok) throw new Error(`project create failed: ${String(response.status)}`);
    return ((await response.json()) as { id: string }).id;
  });
  const bufferSessionId = `synthetic-${crypto.randomUUID()}`;
  await page.goto(
    `/?audio_harness=1&project_id=${encodeURIComponent(projectId)}&session_id=${encodeURIComponent(bufferSessionId)}`,
  );
  await page.getByTestId('start-recording').click();
  await expect
    .poll(async () => Number(await page.getByTestId('persisted-count').textContent()))
    .toBeGreaterThan(0);
  await page.getByTestId('stop-recording').click();
  await expect(page.getByTestId('capture-status')).toHaveText('stopped');
  await expect
    .poll(async () => {
      const value = await page.getByTestId('chunk-count').textContent();
      return Number(value?.split('：')[1] ?? 0);
    })
    .toBeGreaterThan(0);

  await page.getByTestId('upload-action').click();
  await expect(page.getByTestId('upload-status')).toHaveText('complete');
  await expect(page.getByTestId('chunk-count')).toHaveText('待上传分片：0');
  await expect(page.getByTestId('audio-object-id')).not.toHaveText('none');

  await page.reload();
  await expect(page.getByTestId('upload-status')).toHaveText('complete');
  await expect(page.getByTestId('chunk-count')).toHaveText('待上传分片：0');
  await expect(page.getByTestId('next-sequence')).not.toHaveText('0');
});

test('real Chromium streams synthetic PCM, renders interim/final, reconnects, and classifies ASR failure', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[name="email"]').fill('listener-a@example.test');
  await page.locator('input[name="password"]').fill('Fictional-only-Password-42!');
  await page.locator('form button[type="submit"]').click();
  await expect(page.locator('section h2')).toBeVisible();
  const sessionId = await page.evaluate(async () => {
    const csrfResponse = await fetch('/api/v1/auth/csrf', { cache: 'no-store' });
    const { csrf_token: csrf } = (await csrfResponse.json()) as { csrf_token: string };
    async function write(path: string, body?: unknown): Promise<Record<string, unknown>> {
      const response = await fetch(`/api/v1${path}`, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        method: 'POST',
      });
      if (!response.ok) throw new Error(`${path} failed: ${String(response.status)}`);
      return (await response.json()) as Record<string, unknown>;
    }
    const project = await write('/projects', { display_name: '虚构 Chromium 实时转录项目' });
    const projectId = String(project.id);
    await write(`/projects/${projectId}/service-terms`, {
      currency: 'CNY',
      estimated_session_count: 1,
      expected_current_minutes: 10,
      included_minutes: 60,
      overtime_price_minor: 0,
      overtime_unit_minutes: 30,
    });
    await write(`/projects/${projectId}/consents`, {
      consent_audio_object_id: null,
      consent_method: 'electronic',
      consent_text_version: 'test-v1',
      consent_type: 'recording_transcription_ai',
      consented_at: new Date().toISOString(),
    });
    const session = await write(`/projects/${projectId}/sessions`);
    const id = String(session.id);
    await write(`/sessions/${id}/device-check`, {
      input_detected: true,
      microphone_permission: 'granted',
    });
    await write(`/sessions/${id}/start`, { request_id: crypto.randomUUID() });
    return id;
  });

  await page.goto(`/?realtime_harness=1&session_id=${encodeURIComponent(sessionId)}`);
  await expect(page.getByTestId('realtime-connection')).toHaveText('connected');
  await page.getByRole('button', { name: '发送一帧合成 PCM' }).click();
  await expect(page.getByTestId('realtime-interim')).not.toHaveText('暂无中间态');
  await page.getByRole('button', { name: '发送一帧合成 PCM' }).click();
  await expect(page.getByTestId('realtime-finals').locator('li')).toHaveCount(1);

  await page.getByRole('button', { name: '模拟短时断线' }).click();
  await expect(page.getByTestId('realtime-connection')).toHaveText('reconnecting');
  await expect(page.getByTestId('realtime-connection')).toHaveText('connected');
  await expect(page.getByText('已在窗口内恢复')).toBeVisible();
  await expect(page.getByTestId('realtime-finals').locator('li')).toHaveCount(1);

  await page.getByRole('button', { name: '发送一帧合成 PCM' }).click();
  await expect(page.getByRole('alert')).toContainText('实时转录暂不可用，原始录音不受影响');
  await expect(page.getByRole('alert')).toContainText('ASR_UNAVAILABLE');
  await expect(page.getByTestId('realtime-finals').locator('li')).toHaveCount(1);
});
