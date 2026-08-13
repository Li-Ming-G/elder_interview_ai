import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const AUDIO_ID = '33333333-3333-4333-8333-333333333333';
const CHECKSUM = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
const REVIEW_PATH = `/projects/${PROJECT_ID}/interview/${SESSION_ID}/review`;

for (const viewport of [
  { height: 900, label: 'desktop', width: 1440 },
  { height: 844, label: 'mobile', width: 390 },
  { height: 568, label: 'compact', width: 320 },
] as const) {
  test(`review is responsive, read-only and accessible at ${String(viewport.width)}x${String(viewport.height)}`, async ({
    page,
  }) => {
    const requests: string[] = [];
    await mockReviewApi(page, requests);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await seedVersionFourArchive(page);
    await page.goto(REVIEW_PATH);

    await expect(page.getByRole('heading', { name: '第 1 次访谈' })).toBeVisible();
    await expect(page.getByText('原始虚构文字')).toBeVisible();
    await expect(page.getByText('修订后的虚构文字')).toBeVisible();
    await expect(page.getByText('完整可播放')).toBeVisible();
    await expect(page.getByRole('button', { name: '载入完整录音' })).toBeEnabled();
    await expect(page.getByRole('button', { name: '只删除此浏览器副本' })).toBeEnabled();
    await expect(page.getByRole('textbox')).toHaveCount(0);
    expect(requests.some((url) => /download|signed|deletion/u.test(url))).toBe(false);

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
    await page.getByRole('button', { name: '载入完整录音' }).focus();
    await expect(page.getByRole('button', { name: '载入完整录音' })).toBeFocused();
    expect(
      await page
        .getByRole('button', { name: '载入完整录音' })
        .evaluate((button) => getComputedStyle(button).transitionDuration),
    ).toBe('1e-05s');
    await expect(page.locator('[aria-live="polite"]')).toHaveCount(1);

    await mkdir('output/playwright', { recursive: true });
    await page.screenshot({
      fullPage: true,
      path: `output/playwright/dev-008a3-review-${viewport.label}-${String(viewport.width)}x${String(viewport.height)}.png`,
    });
  });
}

test('two tabs serialize local deletion, commit all stores, replay receipt and survive refresh', async ({
  context,
  page,
}) => {
  await mockReviewApi(page, []);
  await page.goto('/');
  await seedVersionFourArchive(page);
  await page.goto(REVIEW_PATH);
  await expect(page.getByText('完整可播放')).toBeVisible();

  const blocker = await context.newPage();
  await mockReviewApi(blocker, []);
  await blocker.goto(REVIEW_PATH);
  await expect(blocker.getByText('完整可播放')).toBeVisible();
  await blocker.evaluate((sessionId) => {
    const scope = window as typeof window & { releaseReviewLock?: () => void };
    void navigator.locks.request(
      `elder-interview:capture:${sessionId}`,
      { mode: 'exclusive' },
      async () =>
        new Promise<void>((resolve) => {
          scope.releaseReviewLock = resolve;
        }),
    );
  }, SESSION_ID);
  await expect
    .poll(async () => {
      return blocker.evaluate(async (sessionId) => {
        const snapshot = await navigator.locks.query();
        return (
          snapshot.held?.some((lock) => lock.name === `elder-interview:capture:${sessionId}`) ??
          false
        );
      }, SESSION_ID);
    })
    .toBe(true);

  await page.getByRole('button', { name: '只删除此浏览器副本' }).click();
  await page.getByRole('button', { name: '确认删除本机副本' }).click();
  await expect(page.getByText(/另一个页面正在使用本次访谈/u)).toBeVisible();
  expect(await inspectArchive(page)).toMatchObject({ archive: 1, receipt: null });

  await blocker.evaluate(() => {
    const scope = window as typeof window & { releaseReviewLock?: () => void };
    scope.releaseReviewLock?.();
  });
  await blocker.close();

  await page.getByRole('button', { name: '只删除此浏览器副本' }).click();
  await page.getByRole('button', { name: '确认删除本机副本' }).click();
  await expect(page.getByText(/此浏览器中的录音副本已删除/u)).toBeVisible();
  expect(await inspectArchive(page)).toEqual({
    archive: 0,
    checkpoint: 0,
    delivery: 0,
    formalJob: 0,
    legacy: 0,
    otherJob: 1,
    receipt: '2026',
    reports: 0,
    state: 0,
    version: 5,
  });

  await page.reload();
  await expect(page.getByText('已从此浏览器删除')).toBeVisible();
  await expect(page.getByText(/服务器录音、转录、记忆和审计仍保留/u).first()).toBeVisible();

  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const deletion = indexedDB.deleteDatabase('elder-interview-audio-buffer');
      deletion.onerror = (): void => {
        reject(deletion.error ?? new Error('clear failed'));
      };
      deletion.onsuccess = (): void => {
        resolve();
      };
    });
  });
  await page.reload();
  await expect(page.getByText('此浏览器未找到副本')).toBeVisible();
  await expect(page.getByText(/当前网址 .* 未找到副本/u)).toBeVisible();
  await expect(page.getByText(/无法据此判断服务器录音缺失/u)).toBeVisible();
});

test('danger confirmation keeps keyboard focus inside and restores it on cancel and success', async ({
  page,
}) => {
  await mockReviewApi(page, []);
  await page.goto('/');
  await seedVersionFourArchive(page);
  await page.goto(REVIEW_PATH);
  const trigger = page.getByRole('button', { name: '只删除此浏览器副本' });
  await expect(trigger).toBeEnabled();

  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute('aria-modal', 'true');
  await expect(page.getByRole('button', { name: '取消' })).toBeFocused();
  await expect(dialog).toContainText('这里只删除当前浏览器/此设备副本');
  await expect(dialog).toContainText('服务器录音、转录、记忆和审计仍保留');
  await expect(dialog).toContainText('需走独立删除申请流程；本页面不提供该流程');
  expect(
    await dialog
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons.every((button) => button.getBoundingClientRect().height >= 44),
      ),
  ).toBe(true);
  expect(
    await page
      .getByRole('button', { name: '取消' })
      .evaluate((button) => getComputedStyle(button).outlineWidth),
  ).toBe('3px');

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '确认删除本机副本' })).toBeFocused();
  expect(
    await page
      .getByRole('button', { name: '确认删除本机副本' })
      .evaluate((button) => getComputedStyle(button).outlineWidth),
  ).toBe('3px');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: '取消' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '取消' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: '确认删除本机副本' })).toBeFocused();
  await page.keyboard.press('Enter');
  const notice = page.getByText(/此浏览器中的录音副本已删除/u);
  await expect(notice).toBeVisible();
  await expect(notice).toBeFocused();
  await expect(notice).toContainText('服务器录音、转录、记忆和审计仍保留');
});

test('unload before the receipt completion never exposes a mixed local state', async ({
  context,
  page,
}) => {
  await mockReviewApi(page, []);
  await page.goto('/');
  await seedVersionFourArchive(page);
  await page.goto(REVIEW_PATH);
  await expect(page.getByText('完整可播放')).toBeVisible();
  await page.evaluate(() => {
    // The test intentionally preserves the native request while observing one receipt write.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function patchedPut(
      value: unknown,
      key?: IDBValidKey,
    ): IDBRequest<IDBValidKey> {
      if (
        typeof value === 'object' &&
        value !== null &&
        (value as { kind?: string }).kind === 'deletion_receipt'
      ) {
        (window as typeof window & { receiptPutStarted?: boolean }).receiptPutStarted = true;
      }
      return key === undefined
        ? Reflect.apply(originalPut, this, [value])
        : Reflect.apply(originalPut, this, [value, key]);
    };
  });
  await page.getByRole('button', { name: '只删除此浏览器副本' }).click();
  await page.getByRole('button', { name: '确认删除本机副本' }).click();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (window as typeof window & { receiptPutStarted?: boolean }).receiptPutStarted === true,
      ),
    )
    .toBe(true);
  await page.close();

  const reopened = await context.newPage();
  await mockReviewApi(reopened, []);
  await reopened.goto(REVIEW_PATH);
  const state = await inspectArchive(reopened);
  const fullyCommitted = state.receipt !== null;
  if (fullyCommitted) {
    expect(state).toMatchObject({
      archive: 0,
      checkpoint: 0,
      formalJob: 0,
      legacy: 0,
      reports: 0,
      state: 0,
    });
  } else {
    expect(state).toMatchObject({
      archive: 1,
      checkpoint: 1,
      formalJob: 1,
      legacy: 1,
      reports: 2,
      state: 1,
    });
  }
});

async function mockReviewApi(page: Page, requests: string[]): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    requests.push(`${route.request().method()} ${url.pathname}`);
    const response = apiResponse(url.pathname);
    await route.fulfill({ contentType: 'application/json', json: response, status: 200 });
  });
}

function apiResponse(pathname: string): unknown {
  if (pathname === '/api/v1/auth/me') {
    return { display_name: '虚构倾听员', id: 'actor', role: 'interviewer', status: 'active' };
  }
  if (pathname === '/api/v1/auth/csrf') return { csrf_token: 'opaque-test-token' };
  if (pathname === '/api/v1/projects') return { items: [] };
  if (pathname === `/api/v1/projects/${PROJECT_ID}/sessions`) {
    return {
      items: [
        {
          capture: { status: 'stopped' },
          capture_failure_code: null,
          created_at: '2026-08-12T08:00:00.000Z',
          duration_seconds: 1,
          ended_at: '2026-08-12T08:00:01.000Z',
          finalization: {
            failure_code: null,
            manifest_checksum: 'manifest',
            recording_status: 'stopped',
            transcript_status: 'drained',
            upload_status: 'complete',
          },
          home_state: 'review_ready',
          id: SESSION_ID,
          primary_action: 'view_review',
          project_id: PROJECT_ID,
          review_access: 'read_only',
          sequence_no: 1,
          started_at: '2026-08-12T08:00:00.000Z',
          status: 'completed',
        },
      ],
      next_cursor: null,
    };
  }
  if (pathname === `/api/v1/sessions/${SESSION_ID}`) return sessionResponse();
  if (pathname === `/api/v1/sessions/${SESSION_ID}/transcripts`) {
    return {
      items: [
        {
          content_kind: 'conversation',
          corrected_speaker_role: null,
          corrected_text: '修订后的虚构文字',
          effective_speaker_role: 'elder',
          end_ms: 1_000,
          id: 'segment',
          original_speaker_role: 'elder',
          original_speaker_role_authority: 'user_confirmed',
          original_text: '原始虚构文字',
          speaker_provider_id: 'speaker',
          speaker_role_revision: 1,
          speaker_stream_id: 'stream',
          start_ms: 0,
          trusted_effective_speaker_role: 'elder',
        },
      ],
      next_cursor: null,
    };
  }
  if (pathname === `/api/v1/audio-objects/${AUDIO_ID}/manifest`) return manifestResponse();
  return {};
}

function sessionResponse(): unknown {
  return {
    capture: {
      audio_object_id: AUDIO_ID,
      audio_stream_id: 'stream',
      generation_no: 1,
      interrupted_at: null,
      interruption_reason: null,
      status: 'stopped',
      timeline_offset_ms: 0,
      uploaded_chunk_count: 1,
    },
    capture_failure_code: null,
    created_at: '2026-08-12T08:00:00.000Z',
    created_by: 'actor',
    duration_seconds: 1,
    ended_at: '2026-08-12T08:00:01.000Z',
    finalization: {
      audio_object_id: AUDIO_ID,
      completed_at: '2026-08-12T08:00:02.000Z',
      expected_chunk_count: 1,
      failure_code: null,
      manifest_checksum: 'manifest',
      processing_started_at: '2026-08-12T08:00:01.500Z',
      recording_status: 'stopped',
      total_size_bytes: 5,
      transcript_error_code: null,
      transcript_status: 'drained',
      upload_status: 'complete',
      uploaded_chunk_count: 1,
    },
    id: SESSION_ID,
    project_id: PROJECT_ID,
    sequence_no: 1,
    started_at: '2026-08-12T08:00:00.000Z',
    status: 'completed',
    updated_at: '2026-08-12T08:00:02.000Z',
  };
}

function manifestResponse(): unknown {
  return {
    chunk_count: 1,
    chunks: [
      {
        checksum: CHECKSUM,
        end_ms: 1_000,
        mime_type: 'audio/webm',
        sequence_no: 0,
        size_bytes: 5,
        start_ms: 0,
        uploaded_at: '2026-08-12T08:00:01.000Z',
      },
    ],
    completed_at: '2026-08-12T08:00:02.000Z',
    created_at: '2026-08-12T08:00:00.000Z',
    created_by: 'actor',
    id: AUDIO_ID,
    manifest_checksum: 'manifest',
    mime_type: 'audio/webm',
    project_id: PROJECT_ID,
    purpose: 'interview',
    session_id: SESSION_ID,
    status: 'complete',
    total_size_bytes: 5,
  };
}

async function seedVersionFourArchive(page: Page): Promise<void> {
  await page.evaluate(
    async ({ audioId, checksum, projectId, sessionId }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('elder-interview-audio-buffer', 4);
        open.onerror = (): void => {
          reject(open.error ?? new Error('seed open failed'));
        };
        open.onupgradeneeded = (): void => {
          const legacy = open.result.createObjectStore('chunks', { keyPath: 'chunk.key' });
          legacy.createIndex('by-session', 'chunk.sessionId');
          const archive = open.result.createObjectStore('archive-chunks', { keyPath: 'key' });
          archive.createIndex('by-session', 'sessionId');
          const delivery = open.result.createObjectStore('delivery-queue', { keyPath: 'key' });
          delivery.createIndex('by-session', 'sessionId');
          open.result.createObjectStore('session-state', { keyPath: 'sessionId' });
          open.result.createObjectStore('upload-jobs', { keyPath: 'jobId' });
          open.result.createObjectStore('capture-checkpoints', { keyPath: 'localJobId' });
          open.result.createObjectStore('canary', { keyPath: 'key' });
          const blob = new Blob(['hello'], { type: 'audio/webm' });
          const chunk = {
            blob,
            byteLength: 5,
            checksumSha256: checksum,
            createdAt: '2026-08-12T08:00:00.000Z',
            endedAtMs: 1_000,
            key: `${sessionId}:0`,
            mimeType: 'audio/webm',
            sequenceNo: 0,
            sessionId,
            startedAtMs: 0,
          };
          archive.add(chunk);
          legacy.add({ chunk, delivery: { lastError: null, retryCount: 0, status: 'pending' } });
          open.transaction?.objectStore('session-state').add({
            archiveByteLength: 5,
            deliveryAcknowledgedHighWaterSequenceNo: 0,
            nextSequenceNo: 1,
            sessionId,
            timelineEndMs: 1_000,
          });
          open.transaction?.objectStore('upload-jobs').add({
            audioObjectId: audioId,
            bufferSessionId: sessionId,
            chunkRequestIds: {},
            completeRequestId: 'complete',
            createRequestId: 'create',
            expectedChunkCount: 1,
            interviewCapture: {
              audioObjectId: audioId,
              audioStreamId: 'stream',
              confirmActiveRequests: {},
              generationNo: 1,
              interruptionReports: {},
              pendingResume: null,
              protocolVersion: 1,
              startRequestId: 'start',
              status: 'stopped',
              stopRequestId: 'stop',
              timelineOffsetMs: 0,
            },
            jobId: `interview-capture:${sessionId}`,
            lastError: null,
            mimeType: 'audio/webm',
            projectId,
            purpose: 'interview',
            serverSessionId: sessionId,
            status: 'complete',
          });
          for (const generation of [1, 2]) {
            open.transaction?.objectStore('upload-jobs').add({
              audioObjectId: audioId,
              audioStreamId: `stream-${String(generation)}`,
              createdAt: '2026-08-12T08:00:00.000Z',
              generationNo: generation,
              jobId: `capture-interruption-report:v1:${sessionId}:${String(generation)}:stream-${String(generation)}`,
              lastError: null,
              projectId,
              reason: 'page_recovery_detected',
              recordType: 'capture-interruption-report-v1',
              requestId: `request-${String(generation)}`,
              sessionId,
              status: 'acknowledged',
              updatedAt: '2026-08-12T08:00:00.000Z',
            });
          }
          open.transaction?.objectStore('upload-jobs').add({
            audioObjectId: null,
            bufferSessionId: 'other',
            chunkRequestIds: {},
            completeRequestId: null,
            createRequestId: 'other',
            expectedChunkCount: null,
            jobId: 'other-consent-job',
            lastError: null,
            mimeType: 'audio/webm',
            projectId,
            purpose: 'consent',
            serverSessionId: null,
            status: 'complete',
          });
          open.transaction?.objectStore('capture-checkpoints').add({
            archiveHighWaterSequenceNo: 0,
            audioStreamId: 'stream',
            deliveryAcknowledgedHighWaterSequenceNo: 0,
            dirty: false,
            localJobId: `interview-capture:${sessionId}`,
            mimeType: 'audio/webm',
            sessionId,
            status: 'stopped',
            timelineEndMs: 1_000,
            updatedAt: '2026-08-12T08:00:00.000Z',
          });
          open.transaction?.objectStore('canary').add({ key: 'preserve', value: 1 });
        };
        open.onsuccess = (): void => {
          open.result.close();
          resolve();
        };
      });
    },
    { audioId: AUDIO_ID, checksum: CHECKSUM, projectId: PROJECT_ID, sessionId: SESSION_ID },
  );
}

async function inspectArchive(page: Page): Promise<Record<string, number | string | null>> {
  return page.evaluate(
    async ({ sessionId }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('elder-interview-audio-buffer');
        open.onerror = (): void => {
          reject(open.error ?? new Error('inspect open failed'));
        };
        open.onsuccess = (): void => {
          resolve(open.result);
        };
      });
      const stores = [
        'archive-chunks',
        'delivery-queue',
        'session-state',
        'upload-jobs',
        'capture-checkpoints',
        'local-deletion-receipts',
        'chunks',
      ];
      const transaction = database.transaction(stores, 'readonly');
      const read = <T>(request: IDBRequest<T>): Promise<T> =>
        new Promise((resolve, reject) => {
          request.onerror = (): void => {
            reject(request.error ?? new Error('inspect failed'));
          };
          request.onsuccess = (): void => {
            resolve(request.result);
          };
        });
      const archivePromise = read(
        transaction.objectStore('archive-chunks').index('by-session').count(sessionId),
      );
      const deliveryPromise = read(
        transaction.objectStore('delivery-queue').index('by-session').count(sessionId),
      );
      const statePromise = read(transaction.objectStore('session-state').count(sessionId));
      const jobsPromise = read(
        transaction.objectStore('upload-jobs').getAll() as IDBRequest<unknown[]>,
      );
      const checkpointsPromise = read(
        transaction.objectStore('capture-checkpoints').getAll() as IDBRequest<unknown[]>,
      );
      const receiptPromise = read(
        transaction.objectStore('local-deletion-receipts').get(sessionId) as IDBRequest<unknown>,
      );
      const legacyPromise = read(
        transaction.objectStore('chunks').index('by-session').count(sessionId),
      );
      const [archive, delivery, state, jobs, checkpoints, receipt, legacy] = await Promise.all([
        archivePromise,
        deliveryPromise,
        statePromise,
        jobsPromise,
        checkpointsPromise,
        receiptPromise,
        legacyPromise,
      ]);
      database.close();
      return {
        archive,
        checkpoint: checkpoints.filter(
          (value) => (value as { sessionId?: string }).sessionId === sessionId,
        ).length,
        delivery,
        formalJob: jobs.filter(
          (value) => (value as { jobId?: string }).jobId === `interview-capture:${sessionId}`,
        ).length,
        legacy,
        otherJob: jobs.filter(
          (value) => (value as { jobId?: string }).jobId === 'other-consent-job',
        ).length,
        receipt:
          receipt === undefined ? null : (receipt as { deleted_at: string }).deleted_at.slice(0, 4),
        reports: jobs.filter(
          (value) =>
            (value as { recordType?: string; sessionId?: string }).recordType ===
              'capture-interruption-report-v1' &&
            (value as { sessionId?: string }).sessionId === sessionId,
        ).length,
        state,
        version: database.version,
      };
    },
    { sessionId: SESSION_ID },
  );
}
