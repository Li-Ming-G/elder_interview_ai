import { expect, test, type Page } from '@playwright/test';

test('native MediaRecorder and IndexedDB preserve audio queue progress across reopen and ACK', async ({
  context,
  page,
}) => {
  const sessionId = `synthetic-audio-${Date.now().toString()}`;
  const harnessUrl = `/?audio_harness=1&session_id=${encodeURIComponent(sessionId)}`;

  await page.goto(harnessUrl);
  await expect(page.getByTestId('audio-browser-harness')).toBeVisible();
  await expect(page.getByTestId('audio-source')).toHaveText('web-audio-oscillator');
  await expect(page.getByTestId('media-recorder-runtime')).toHaveText('native-available');
  await expect(page.getByTestId('indexeddb-runtime')).toHaveText('[object IDBFactory]');
  expect(
    await page.evaluate(() => Function.prototype.toString.call(globalThis.MediaRecorder)),
  ).toContain('[native code]');

  await recordSyntheticAudio(page);

  const firstChunks = page.getByTestId('audio-chunk');
  const firstCount = await firstChunks.count();
  expect(firstCount).toBeGreaterThan(0);
  for (let index = 0; index < firstCount; index += 1) {
    const chunk = firstChunks.nth(index);
    expect(Number(await chunk.getAttribute('data-byte-length'))).toBeGreaterThan(0);
    expect(await chunk.getAttribute('data-mime-type')).toMatch(/^audio\/webm/);
  }

  const firstNextSequence = await numericText(page, 'next-sequence');
  const firstTimelineEnd = await numericText(page, 'timeline-end');
  expect(firstNextSequence).toBeGreaterThanOrEqual(firstCount);
  expect(firstTimelineEnd).toBeGreaterThan(0);

  await page.reload();
  await expect(page.getByTestId('audio-chunk')).toHaveCount(firstCount);
  await expect(page.getByTestId('next-sequence')).toHaveText(firstNextSequence.toString());
  await expect(page.getByTestId('timeline-end')).toHaveText(firstTimelineEnd.toString());

  const reopened = await context.newPage();
  await reopened.goto(harnessUrl);
  await expect(reopened.getByTestId('audio-chunk')).toHaveCount(firstCount);
  await expect(reopened.getByTestId('next-sequence')).toHaveText(firstNextSequence.toString());
  await expect(reopened.getByTestId('timeline-end')).toHaveText(firstTimelineEnd.toString());

  await reopened.getByRole('button', { name: 'ACK 第一片' }).click();
  await expect(reopened.getByTestId('audio-chunk')).toHaveCount(firstCount - 1);
  await expect(reopened.getByTestId('next-sequence')).toHaveText(firstNextSequence.toString());
  await expect(reopened.getByTestId('timeline-end')).toHaveText(firstTimelineEnd.toString());

  await recordSyntheticAudio(reopened);
  await expect
    .poll(async () => numericText(reopened, 'next-sequence'))
    .toBeGreaterThan(firstNextSequence);
  const newestChunk = reopened.getByTestId('audio-chunk').last();
  expect(Number(await newestChunk.getAttribute('data-sequence-no'))).toBeGreaterThanOrEqual(
    firstNextSequence,
  );
  expect(Number(await newestChunk.getAttribute('data-started-at-ms'))).toBeGreaterThanOrEqual(
    firstTimelineEnd,
  );
  expect(await numericText(reopened, 'timeline-end')).toBeGreaterThan(firstTimelineEnd);
});

test('persistent upload job retries the same chunk request after response loss and reload', async ({
  page,
}) => {
  const projectId = '20000000-0000-4000-8000-000000000001';
  const objectId = '10000000-0000-4000-8000-000000000001';
  const sessionId = `upload-recovery-${Date.now().toString()}`;
  const chunkRequestIds = new Map<number, string[]>();
  let firstChunkResponseLost = false;

  await page.route('**/api/v1/auth/csrf', async (route) => {
    await route.fulfill({ json: { csrf_token: 'fictional-csrf' } });
  });
  await page.route('**/api/v1/projects/*/audio-objects', async (route) => {
    const payload = route.request().postDataJSON() as { mime_type: string };
    await route.fulfill({
      json: {
        created_at: '2026-08-04T00:00:00.000Z',
        created_by: '30000000-0000-4000-8000-000000000001',
        id: objectId,
        mime_type: payload.mime_type,
        project_id: projectId,
        purpose: 'consent',
        session_id: null,
        status: 'initiated',
      },
      status: 201,
    });
  });
  await page.route('**/api/v1/audio-objects/*/chunks/*', async (route) => {
    const request = route.request();
    const sequenceNo = Number(new URL(request.url()).pathname.split('/').at(-1));
    const headers = request.headers();
    const attempts = chunkRequestIds.get(sequenceNo) ?? [];
    attempts.push(headers['x-request-id'] ?? '');
    chunkRequestIds.set(sequenceNo, attempts);
    if (sequenceNo === 0 && !firstChunkResponseLost) {
      firstChunkResponseLost = true;
      await route.abort('connectionreset');
      return;
    }
    await route.fulfill({
      json: {
        audio_object_id: objectId,
        checksum: headers['x-chunk-sha256'],
        end_ms: Number(headers['x-chunk-end-ms']),
        id: `40000000-0000-4000-8000-${sequenceNo.toString().padStart(12, '0')}`,
        mime_type: headers['content-type'],
        sequence_no: sequenceNo,
        size_bytes: request.postDataBuffer()?.byteLength ?? 0,
        start_ms: Number(headers['x-chunk-start-ms']),
        upload_status: 'uploaded',
        uploaded_at: '2026-08-04T00:00:01.000Z',
      },
    });
  });
  await page.route('**/api/v1/audio-objects/*/complete', async (route) => {
    const payload = route.request().postDataJSON() as { expected_chunk_count: number };
    await route.fulfill({
      json: {
        chunk_count: payload.expected_chunk_count,
        chunks: [],
        completed_at: '2026-08-04T00:00:02.000Z',
        created_at: '2026-08-04T00:00:00.000Z',
        created_by: '30000000-0000-4000-8000-000000000001',
        id: objectId,
        manifest_checksum: 'fictional-manifest-checksum',
        mime_type: 'audio/webm',
        project_id: projectId,
        purpose: 'consent',
        session_id: null,
        status: 'complete',
        total_size_bytes: 1,
      },
    });
  });

  const harnessUrl = `/?audio_harness=1&session_id=${encodeURIComponent(sessionId)}&project_id=${projectId}`;
  await page.goto(harnessUrl);
  await recordSyntheticAudio(page);
  const frozenChunkCount = await page.getByTestId('audio-chunk').count();
  expect(frozenChunkCount).toBeGreaterThan(0);

  await page.getByTestId('upload-action').click();
  await expect(page.getByTestId('upload-status')).toHaveText('failed');
  await expect(page.getByTestId('audio-chunk')).toHaveCount(frozenChunkCount);
  expect(chunkRequestIds.get(0)).toHaveLength(1);

  await page.reload();
  await expect(page.getByTestId('upload-status')).toHaveText('failed');
  await expect(page.getByTestId('audio-chunk')).toHaveCount(frozenChunkCount);
  await page.getByTestId('upload-action').click();
  await expect(page.getByTestId('upload-status')).toHaveText('complete');
  await expect(page.getByTestId('audio-chunk')).toHaveCount(0);
  expect(chunkRequestIds.get(0)?.[0]).toBe(chunkRequestIds.get(0)?.[1]);
});

async function recordSyntheticAudio(page: Page): Promise<void> {
  const persistedBeforeStart = await page.getByTestId('audio-chunk').count();
  await page.getByTestId('start-recording').click();
  await expect(page.getByTestId('capture-status')).toHaveText('recording');
  await expect
    .poll(async () => Number(await page.getByTestId('persisted-count').textContent()), {
      timeout: 5_000,
    })
    .toBeGreaterThan(persistedBeforeStart);
  await page.getByTestId('stop-recording').click();
  await expect(page.getByTestId('capture-status')).toHaveText('stopped');
}

async function numericText(page: Page, testId: string): Promise<number> {
  return Number(await page.getByTestId(testId).textContent());
}
