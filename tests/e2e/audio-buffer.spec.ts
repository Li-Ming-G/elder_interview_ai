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

async function recordSyntheticAudio(page: Page): Promise<void> {
  const persistedBeforeStart = await page.getByTestId('audio-chunk').count();
  await page.getByRole('button', { name: '开始合成录音' }).click();
  await expect(page.getByTestId('capture-status')).toHaveText('recording');
  await expect
    .poll(async () => Number(await page.getByTestId('persisted-count').textContent()), {
      timeout: 5_000,
    })
    .toBeGreaterThan(persistedBeforeStart);
  await page.getByRole('button', { name: '停止并持久化' }).click();
  await expect(page.getByTestId('capture-status')).toHaveText('stopped');
}

async function numericText(page: Page, testId: string): Promise<number> {
  return Number(await page.getByTestId(testId).textContent());
}
