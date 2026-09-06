import { expect, test } from '@playwright/test';

import { createTestPrismaClient } from '../../apps/api/test-support/prisma-client.js';

test('real Web and API use HttpOnly Cookie, Origin and CSRF for the login lifecycle', async ({
  context,
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('邮箱').fill('listener-a@example.test');
  await page.getByLabel('密码').fill('Fictional-only-Password-42!');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { name: '今天好，虚构倾听员 A' })).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toContain('elder_interview_session');

  await page.reload();
  await expect(page.getByRole('heading', { name: '今天好，虚构倾听员 A' })).toBeVisible();

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
  const webOrigin = new URL(page.url()).origin;
  const directMe = await context.request.get('http://127.0.0.1:3101/api/v1/auth/me', {
    headers: { Origin: webOrigin },
  });
  expect(directMe.status()).toBe(401);
});

test('logout failure preserves the authenticated UI state', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('邮箱').fill('listener-a@example.test');
  await page.getByLabel('密码').fill('Fictional-only-Password-42!');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { name: '今天好，虚构倾听员 A' })).toBeVisible();
  await page.route('**/api/v1/auth/logout', async (route) => route.fulfill({ status: 403 }));
  await page.route('**/api/v1/auth/csrf', async (route) => route.fulfill({ status: 500 }));
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '今天好，虚构倾听员 A' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('退出失败');
});

test('authenticated browser start uses first-session consent and fails closed after withdrawal or assignment drift', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('input[name="email"]').fill('listener-a@example.test');
  await page.locator('input[name="password"]').fill('Fictional-only-Password-42!');
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByRole('heading', { name: '今天好，虚构倾听员 A' })).toBeVisible();

  const scenarios = await page.evaluate(async () => {
    const csrfResponse = await fetch('/api/v1/auth/csrf', { cache: 'no-store' });
    const { csrf_token: csrf } = (await csrfResponse.json()) as { csrf_token: string };
    async function write(
      path: string,
      body?: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const response = await fetch(`/api/v1${path}`, {
        body: JSON.stringify(body ?? {}),
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        method: 'POST',
      });
      const responseBody = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          `${path} failed: ${String(response.status)} ${JSON.stringify(responseBody)}`,
        );
      }
      return responseBody;
    }
    async function prepare(
      label: string,
      consentTextVersion: string,
    ): Promise<{ consentId: string; projectId: string; sessionId: string }> {
      const project = await write('/projects', {
        display_name: `虚构浏览器门禁反例-${label}-${crypto.randomUUID()}`,
        request_id: crypto.randomUUID(),
      });
      const projectId = String(project.id);
      let consent = await write(`/projects/${projectId}/consents`, {
        consent_audio_object_id: null,
        consent_method: 'electronic',
        consent_text_version: 'fictional-test-continuing-consent-v1',
        consent_type: 'recording_transcription_ai',
        consented_at: new Date().toISOString(),
        request_id: crypto.randomUUID(),
      });
      if (consentTextVersion !== 'fictional-test-continuing-consent-v1') {
        consent = await write(`/projects/${projectId}/consents`, {
          consent_audio_object_id: null,
          consent_method: 'electronic',
          consent_text_version: consentTextVersion,
          consent_type: 'recording_transcription_ai',
          consented_at: new Date().toISOString(),
          request_id: crypto.randomUUID(),
        });
      }
      const session = await write(`/projects/${projectId}/sessions`, {
        request_id: crypto.randomUUID(),
      });
      const sessionId = String(session.id);
      await write(`/sessions/${sessionId}/device-check`, {
        input_detected: true,
        microphone_permission: 'granted',
      });
      return { consentId: String(consent.id), projectId, sessionId };
    }
    async function start(sessionId: string): Promise<{ body: { code?: string }; status: number }> {
      const response = await fetch(`/api/v1/sessions/${sessionId}/start`, {
        body: JSON.stringify({
          audio_stream_id: crypto.randomUUID(),
          mime_type: 'audio/webm;codecs=opus',
          recording_reminder_version: 'recording-reminder-v1',
          request_id: crypto.randomUUID(),
        }),
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        method: 'POST',
      });
      return {
        body: (await response.json()) as { code?: string },
        status: response.status,
      };
    }

    // Electronic consent is an API-only test fixture here; the ordinary product UI exposes only recorded verbal.
    const version = await prepare('version', 'mvp-v2');
    const versionStart = await start(version.sessionId);
    const withdrawn = await prepare('withdrawn', 'fictional-test-continuing-consent-v1');
    await write(`/consents/${withdrawn.consentId}/revoke`, { request_id: crypto.randomUUID() });
    const withdrawnStart = await start(withdrawn.sessionId);
    const assignment = await prepare('assignment', 'fictional-test-continuing-consent-v1');
    return { assignment, version, versionStart, withdrawn, withdrawnStart };
  });

  expect(scenarios.versionStart).toEqual({
    body: expect.objectContaining({ sequence_no: 1, status: 'recording' }),
    status: 201,
  });
  expect(scenarios.withdrawnStart).toEqual({
    body: expect.objectContaining({ code: 'PROJECT_NOT_STARTABLE' }),
    status: 409,
  });

  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
  const prisma = createTestPrismaClient(databaseUrl);
  try {
    await prisma.projectAssignment.updateMany({
      data: { revokedAt: new Date() },
      where: { projectId: scenarios.assignment.projectId, revokedAt: null },
    });
  } finally {
    await prisma.$disconnect();
  }

  const assignmentStart = await page.evaluate(async (sessionId) => {
    const csrfResponse = await fetch('/api/v1/auth/csrf', { cache: 'no-store' });
    const { csrf_token: csrf } = (await csrfResponse.json()) as { csrf_token: string };
    const response = await fetch(`/api/v1/sessions/${sessionId}/start`, {
      body: JSON.stringify({
        audio_stream_id: crypto.randomUUID(),
        mime_type: 'audio/webm;codecs=opus',
        recording_reminder_version: 'recording-reminder-v1',
        request_id: crypto.randomUUID(),
      }),
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      method: 'POST',
    });
    return { body: (await response.json()) as { code?: string }, status: response.status };
  }, scenarios.assignment.sessionId);
  expect(assignmentStart).toEqual({
    body: expect.objectContaining({ code: 'FORBIDDEN' }),
    status: 403,
  });

  const verificationPrisma = createTestPrismaClient(databaseUrl);
  try {
    expect(
      await verificationPrisma.audioObject.count({
        where: {
          sessionId: {
            in: [
              scenarios.version.sessionId,
              scenarios.withdrawn.sessionId,
              scenarios.assignment.sessionId,
            ],
          },
        },
      }),
    ).toBe(1);
  } finally {
    await verificationPrisma.$disconnect();
  }
});

test('synthetic Chromium audio survives IndexedDB then uploads and completes through the real API', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('邮箱').fill('listener-a@example.test');
  await page.getByLabel('密码').fill('Fictional-only-Password-42!');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { name: '今天好，虚构倾听员 A' })).toBeVisible();
  const projectId = await page.evaluate(async () => {
    const csrfResponse = await fetch('/api/v1/auth/csrf', { cache: 'no-store' });
    const csrf = (await csrfResponse.json()) as { csrf_token: string };
    const response = await fetch('/api/v1/projects', {
      body: JSON.stringify({
        display_name: '虚构 Chromium 可靠上传项目',
        request_id: crypto.randomUUID(),
      }),
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrf_token },
      method: 'POST',
    });
    if (!response.ok) throw new Error(`project create failed: ${String(response.status)}`);
    return ((await response.json()) as { id: string }).id;
  });
  const bufferSessionId = `synthetic-${crypto.randomUUID()}`;
  await page.goto(
    `/engineering-harness.html?audio_harness=1&project_id=${encodeURIComponent(projectId)}&session_id=${encodeURIComponent(bufferSessionId)}`,
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
  const webSocketEvents: string[] = [];
  page.on('websocket', (socket) => {
    webSocketEvents.push(`opened:${socket.url()}`);
    socket.on('framesent', ({ payload }) => {
      webSocketEvents.push(`sent:${webSocketMessageType(payload)}`);
    });
    socket.on('framereceived', ({ payload }) => {
      const type = webSocketMessageType(payload);
      const code = webSocketMessageCode(payload);
      webSocketEvents.push(`received:${type}${code === null ? '' : `:${code}`}`);
    });
    socket.on('socketerror', (error) => webSocketEvents.push(`error:${error}`));
    socket.on('close', () => webSocketEvents.push('closed'));
  });
  await page.goto('/');
  await page.locator('input[name="email"]').fill('listener-a@example.test');
  await page.locator('input[name="password"]').fill('Fictional-only-Password-42!');
  const loginResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/auth/login') && response.status() === 200,
  );
  await page.locator('form button[type="submit"]').click();
  const login = (await (await loginResponse).json()) as { csrf_token: string };
  await expect(page.getByRole('heading', { name: '今天好，虚构倾听员 A' })).toBeVisible();
  const { audioStreamId, sessionId } = await page.evaluate(async (csrf) => {
    async function write(path: string, body?: unknown): Promise<Record<string, unknown>> {
      const createRequest =
        path === '/projects' || /^\/projects\/[^/]+\/(service-terms|consents|sessions)$/.test(path);
      const requestBody = createRequest
        ? { ...((body ?? {}) as Record<string, unknown>), request_id: crypto.randomUUID() }
        : body;
      const response = await fetch(`/api/v1${path}`, {
        ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
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
      consent_text_version: 'fictional-test-continuing-consent-v1',
      consent_type: 'recording_transcription_ai',
      consented_at: new Date().toISOString(),
    });
    const session = await write(`/projects/${projectId}/sessions`);
    const id = String(session.id);
    await write(`/sessions/${id}/device-check`, {
      input_detected: true,
      microphone_permission: 'granted',
    });
    const audioStreamId = crypto.randomUUID();
    await write(`/sessions/${id}/start`, {
      audio_stream_id: audioStreamId,
      mime_type: 'audio/webm;codecs=opus',
      recording_reminder_version: 'recording-reminder-v1',
      request_id: crypto.randomUUID(),
    });
    return { audioStreamId, sessionId: id };
  }, login.csrf_token);

  // The engineering harness is intentionally rendered under StrictMode. Its setup-cleanup-setup
  // cycle may rotate CSRF twice concurrently, leaving the transport with the losing token. Keep
  // both setup reads on the authenticated login token so this test exercises the real WS join.
  await page.route('**/api/v1/auth/csrf', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { csrf_token: login.csrf_token },
      status: 200,
    });
  });

  await page.addInitScript((captureAudioStreamId) => {
    const randomUuid = crypto.randomUUID.bind(crypto);
    let captureStreamIssued = false;
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: (): `${string}-${string}-${string}-${string}-${string}` => {
        if (!captureStreamIssued) {
          captureStreamIssued = true;
          return captureAudioStreamId;
        }
        return randomUuid();
      },
    });
  }, audioStreamId);

  await page.goto(
    `/engineering-harness.html?realtime_harness=1&session_id=${encodeURIComponent(sessionId)}`,
  );
  try {
    await expect(page.getByTestId('realtime-connection')).toHaveText('connected');
  } catch (error) {
    throw new Error(
      `initial realtime connection failed: ${webSocketEvents.join(',')}; ${await page.locator('main').innerText()}`,
      { cause: error },
    );
  }
  await page.getByRole('button', { name: '发送一帧合成 PCM' }).click();
  await expect.poll(() => webSocketEvents).toContain('received:asr.interim');
  await expect(page.getByTestId('realtime-finals').locator('li')).toHaveCount(1);
  await page.getByRole('button', { name: '发送一帧合成 PCM' }).click();
  await expect(page.getByTestId('realtime-finals').locator('li')).toHaveCount(2);
  const segmentId = await page
    .getByTestId('realtime-finals')
    .locator('li')
    .first()
    .getAttribute('data-segment-id');
  expect(segmentId).not.toBeNull();
  await expect
    .poll(async () => (await realtimeDatabaseSnapshot(sessionId, segmentId)).segmentExists)
    .toBe(true);
  const beforeAsrFailure = await realtimeDatabaseSnapshot(sessionId, segmentId);

  await page.getByRole('button', { name: '模拟短时断线' }).click();
  await expect(page.getByTestId('realtime-connection')).toHaveText('reconnecting');
  try {
    await expect(page.getByTestId('realtime-connection')).toHaveText('connected', {
      timeout: 15_000,
    });
  } catch (error) {
    throw new Error(`realtime recovery failed: ${webSocketEvents.join(',')}`, { cause: error });
  }
  await expect(page.getByText('已在窗口内恢复')).toBeVisible();
  await expect(page.getByTestId('realtime-finals').locator('li')).toHaveCount(2);

  await page.getByRole('button', { name: '发送一帧合成 PCM' }).click();
  await expect(page.getByRole('alert')).toContainText('实时转录暂不可用，原始录音不受影响');
  await expect(page.getByRole('alert')).toContainText('ASR_UNAVAILABLE');
  await expect(page.getByTestId('realtime-finals').locator('li')).toHaveCount(2);
  expect(await realtimeDatabaseSnapshot(sessionId, segmentId)).toEqual(beforeAsrFailure);
});

function webSocketMessageType(payload: string | Buffer): string {
  if (typeof payload !== 'string') return 'binary';
  try {
    const parsed = JSON.parse(payload) as { type?: unknown };
    return typeof parsed.type === 'string' ? parsed.type : 'unknown';
  } catch {
    return 'invalid-json';
  }
}

function webSocketMessageCode(payload: string | Buffer): string | null {
  if (typeof payload !== 'string') return null;
  try {
    const parsed = JSON.parse(payload) as { payload?: { code?: unknown } };
    return typeof parsed.payload?.code === 'string' ? parsed.payload.code : null;
  } catch {
    return null;
  }
}

async function realtimeDatabaseSnapshot(
  sessionId: string,
  segmentId: string | null,
): Promise<{
  audioChunks: number;
  audioObjects: number;
  segmentCount: number;
  segmentExists: boolean;
}> {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (databaseUrl === undefined) throw new Error('TEST_DATABASE_URL is required');
  const prisma = createTestPrismaClient(databaseUrl);
  try {
    const [audioObjects, audioChunks, segmentCount, segment] = await Promise.all([
      prisma.audioObject.count({ where: { sessionId } }),
      prisma.audioChunk.count({ where: { audioObject: { sessionId } } }),
      prisma.transcriptSegment.count({ where: { sessionId } }),
      segmentId === null
        ? Promise.resolve(null)
        : prisma.transcriptSegment.findUnique({ where: { id: segmentId } }),
    ]);
    return {
      audioChunks,
      audioObjects,
      segmentCount,
      segmentExists: segment?.sessionId === sessionId,
    };
  } finally {
    await prisma.$disconnect();
  }
}
