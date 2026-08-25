import { expect, test, type Page } from '@playwright/test';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const AUDIO_OBJECT_ID = '33333333-3333-4333-8333-333333333333';

test('formal controller preserves one stream, archive, delivery, refresh recovery and safe handoff', async ({
  page,
}) => {
  const server = await installCaptureApi(page);
  const harnessUrl = `/engineering-harness.html?interview_controller_harness=1&project_id=${PROJECT_ID}&session_id=${SESSION_ID}`;
  await page.goto(harnessUrl);
  await expect(page.getByTestId('interview-controller-harness')).toBeVisible();

  await page.getByTestId('controller-start').click();
  await expect(page.getByTestId('controller-phase')).toHaveText('active');
  await expect(page.getByTestId('controller-source-count')).toHaveText('1');
  await expect(page.getByTestId('controller-object')).toHaveText(AUDIO_OBJECT_ID);
  await expect(page.getByTestId('controller-generation')).toHaveText('0');
  const generation0Stream = await page.getByTestId('controller-stream').textContent();
  expect(generation0Stream).toBeTruthy();
  await expect.poll(() => numericText(page, 'controller-pcm-frames')).toBeGreaterThan(0);
  await expect(page.getByTestId('controller-pcm-bytes')).toHaveText('3200');
  await expect.poll(() => numericText(page, 'controller-archive-count')).toBeGreaterThan(0);
  await expect.poll(() => numericText(page, 'controller-delivery-count')).toBe(0);
  const archiveBeforeRotation = await numericText(page, 'controller-archive-count');
  const highWaterBeforeRotation = await numericText(page, 'controller-archive-high-water');

  await page.setViewportSize({ width: 412, height: 915 });
  await page.setViewportSize({ width: 915, height: 412 });
  await expect(page.getByTestId('controller-source-count')).toHaveText('1');
  await expect(page.getByTestId('controller-stream')).toHaveText(generation0Stream ?? '');
  await expect(page.getByTestId('controller-generation')).toHaveText('0');
  await expect
    .poll(() => numericText(page, 'controller-archive-count'))
    .toBeGreaterThanOrEqual(archiveBeforeRotation);

  await page.reload();
  await expect(page.getByTestId('controller-source-count')).toHaveText('0');
  await page.getByTestId('controller-recover').click();
  await expect(page.getByTestId('controller-phase')).toHaveText('interrupted');
  await expect(page.getByTestId('controller-source-count')).toHaveText('0');
  await expect(page.getByTestId('controller-object')).toHaveText(AUDIO_OBJECT_ID);
  await expect(page.getByTestId('controller-stream')).toHaveText(generation0Stream ?? '');
  await expect
    .poll(() => numericText(page, 'controller-archive-high-water'))
    .toBeGreaterThanOrEqual(highWaterBeforeRotation);

  const archiveBeforeResume = await numericText(page, 'controller-archive-count');
  await page.getByTestId('controller-resume').click();
  await expect(page.getByTestId('controller-phase')).toHaveText('active');
  await expect(page.getByTestId('controller-source-count')).toHaveText('1');
  await expect(page.getByTestId('controller-object')).toHaveText(AUDIO_OBJECT_ID);
  await expect(page.getByTestId('controller-generation')).toHaveText('1');
  const generation1Stream = await page.getByTestId('controller-stream').textContent();
  expect(generation1Stream).toBeTruthy();
  expect(generation1Stream).not.toBe(generation0Stream);
  await expect
    .poll(() => numericText(page, 'controller-archive-count'))
    .toBeGreaterThan(archiveBeforeResume);
  await expect(page.getByTestId('controller-pcm-bytes')).toHaveText('3200');
  await expect.poll(() => numericText(page, 'controller-delivery-count')).toBe(0);

  await page.getByTestId('controller-freeze').click();
  await expect(page.getByTestId('controller-phase')).toHaveText('stopped');
  const archiveAtHandoff = await numericText(page, 'controller-archive-count');
  await expect(page.getByTestId('controller-handoff-count')).toHaveText(
    archiveAtHandoff.toString(),
  );
  await expect(page.getByTestId('controller-stop-request')).not.toHaveText('none');

  expect(server.startRequests).toHaveLength(1);
  expect(server.startRequests[0]).toMatchObject({
    audio_stream_id: generation0Stream,
    mime_type: 'audio/webm;codecs=opus',
  });
  expect(server.confirmRequests.map((request) => request.generation_no)).toEqual([0, 1]);
  expect(server.interruptionRequests).toHaveLength(1);
  expect(server.interruptionRequests[0]).toMatchObject({
    audio_stream_id: generation0Stream,
    generation_no: 0,
    reason: 'page_recovery_detected',
  });
  expect(server.resumeRequests).toHaveLength(1);
  expect(server.resumeRequests[0]).toMatchObject({
    action: 'resume_capture',
    audio_stream_id: generation1Stream,
  });
  expect(server.chunkRequestIds.size).toBeGreaterThan(0);
  for (const attempts of server.chunkRequestIds.values()) {
    expect(new Set(attempts).size).toBe(1);
  }
});

interface CaptureApiHarness {
  chunkRequestIds: Map<number, string[]>;
  confirmRequests: Array<{ audio_stream_id: string; generation_no: number; request_id: string }>;
  interruptionRequests: Array<{
    audio_stream_id: string;
    generation_no: number;
    reason: CaptureInterruptionReasonValue;
    request_id: string;
  }>;
  resumeRequests: Array<Record<string, unknown>>;
  startRequests: Array<Record<string, unknown>>;
}

type CaptureInterruptionReasonValue =
  | 'capture_start_failed'
  | 'page_recovery_detected'
  | 'microphone_ended'
  | 'recorder_error'
  | 'local_archive_failed'
  | 'auth_lost'
  | 'unknown';

interface CaptureSnapshotValue {
  audio_object_id: string;
  audio_stream_id: string;
  generation_no: number;
  interrupted_at: string | null;
  interruption_reason: CaptureInterruptionReasonValue | null;
  status: 'preparing' | 'active' | 'interrupted' | 'stopped' | 'abandoned_empty';
  timeline_offset_ms: number;
  uploaded_chunk_count: number;
}

interface SessionResponseValue {
  capture: CaptureSnapshotValue;
  created_at: string;
  created_by: string;
  id: string;
  project_id: string;
  sequence_no: number;
  started_at: string;
  status: 'recording' | 'reconnecting' | 'interrupted';
  updated_at: string;
}

async function installCaptureApi(page: Page): Promise<CaptureApiHarness> {
  let capture = captureSnapshot('preparing', 0, '00000000-0000-4000-8000-000000000000');
  let sessionStatus: 'recording' | 'reconnecting' | 'interrupted' = 'recording';
  const startRequests: Array<Record<string, unknown>> = [];
  const confirmRequests: Array<{
    audio_stream_id: string;
    generation_no: number;
    request_id: string;
  }> = [];
  const interruptionRequests: Array<{
    audio_stream_id: string;
    generation_no: number;
    reason: CaptureInterruptionReasonValue;
    request_id: string;
  }> = [];
  const resumeRequests: Array<Record<string, unknown>> = [];
  const chunkRequestIds = new Map<number, string[]>();

  await page.route(`**/api/v1/sessions/${SESSION_ID}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ json: sessionResponse(sessionStatus, capture) });
  });
  await page.route(`**/api/v1/sessions/${SESSION_ID}/start`, async (route) => {
    const request = route.request().postDataJSON() as {
      audio_stream_id: string;
      mime_type: string;
      request_id: string;
    };
    startRequests.push(request);
    capture = captureSnapshot('preparing', 0, request.audio_stream_id);
    sessionStatus = 'recording';
    await route.fulfill({ json: sessionResponse(sessionStatus, capture) });
  });
  await page.route(`**/api/v1/sessions/${SESSION_ID}/capture/confirm-active`, async (route) => {
    const request = route.request().postDataJSON() as (typeof confirmRequests)[number];
    confirmRequests.push(request);
    capture = { ...capture, status: 'active' };
    sessionStatus = 'recording';
    await route.fulfill({ json: sessionResponse(sessionStatus, capture) });
  });
  await page.route(`**/api/v1/sessions/${SESSION_ID}/capture/interrupted`, async (route) => {
    const request = route.request().postDataJSON() as (typeof interruptionRequests)[number];
    interruptionRequests.push(request);
    capture = {
      ...capture,
      interrupted_at: '2026-08-08T00:00:00.000Z',
      interruption_reason: request.reason,
      status: 'interrupted',
    };
    sessionStatus = 'interrupted';
    await route.fulfill({ json: sessionResponse(sessionStatus, capture) });
  });
  await page.route(`**/api/v1/sessions/${SESSION_ID}/recover`, async (route) => {
    const request = route.request().postDataJSON() as {
      action: string;
      audio_stream_id: string;
      request_id: string;
    };
    resumeRequests.push(request);
    capture = captureSnapshot('preparing', capture.generation_no + 1, request.audio_stream_id);
    sessionStatus = 'reconnecting';
    await route.fulfill({ json: sessionResponse(sessionStatus, capture) });
  });
  await page.route('**/api/v1/audio-objects/*/chunks/*', async (route) => {
    const request = route.request();
    const sequenceNo = Number(new URL(request.url()).pathname.split('/').at(-1));
    const headers = request.headers();
    const attempts = chunkRequestIds.get(sequenceNo) ?? [];
    attempts.push(headers['x-request-id'] ?? '');
    chunkRequestIds.set(sequenceNo, attempts);
    await route.fulfill({
      json: {
        audio_object_id: AUDIO_OBJECT_ID,
        checksum: headers['x-chunk-sha256'],
        end_ms: Number(headers['x-chunk-end-ms']),
        id: `55555555-5555-4555-8555-${sequenceNo.toString().padStart(12, '0')}`,
        mime_type: headers['content-type'],
        sequence_no: sequenceNo,
        size_bytes: request.postDataBuffer()?.byteLength ?? 0,
        start_ms: Number(headers['x-chunk-start-ms']),
        upload_status: 'uploaded',
        uploaded_at: '2026-08-08T00:00:00.000Z',
      },
    });
  });

  return {
    chunkRequestIds,
    confirmRequests,
    interruptionRequests,
    resumeRequests,
    startRequests,
  };
}

function captureSnapshot(
  status: CaptureSnapshotValue['status'],
  generationNo: number,
  audioStreamId: string,
): CaptureSnapshotValue {
  return {
    audio_object_id: AUDIO_OBJECT_ID,
    audio_stream_id: audioStreamId,
    generation_no: generationNo,
    interrupted_at: null,
    interruption_reason: null,
    status,
    timeline_offset_ms: generationNo * 1_000,
    uploaded_chunk_count: 0,
  };
}

function sessionResponse(
  status: SessionResponseValue['status'],
  capture: CaptureSnapshotValue,
): SessionResponseValue {
  return {
    capture,
    created_at: '2026-08-08T00:00:00.000Z',
    created_by: '44444444-4444-4444-8444-444444444444',
    id: SESSION_ID,
    project_id: PROJECT_ID,
    sequence_no: 1,
    started_at: '2026-08-08T00:00:00.000Z',
    status,
    updated_at: '2026-08-08T00:00:00.000Z',
  };
}

async function numericText(page: Page, testId: string): Promise<number> {
  return Number(await page.getByTestId(testId).textContent());
}
