import { expect, test, type Page } from '@playwright/test';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const AUDIO_OBJECT_ID = '66666666-6666-4666-8666-666666666666';
const VIEWPORTS = [
  { height: 900, width: 1440 },
  { height: 768, width: 1024 },
  { height: 1024, width: 768 },
  { height: 844, width: 390 },
  { height: 568, width: 320 },
] as const;

test('real controller facts drive the complete workbench state and responsive screenshot matrix', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const server = await installWorkbenchHarness(page);
  const workbenchUrl = `/projects/${PROJECT_ID}/interview/${SESSION_ID}/workbench`;

  await page.goto(`/projects/${PROJECT_ID}/interview/prepare`);
  await page.getByRole('button', { name: '检测麦克风' }).click();
  await expect(page.getByText('权限已允许，并检测到声音输入。')).toBeVisible();
  await page.getByRole('button', { name: '开始访谈' }).click();
  await expect(page).toHaveURL(new RegExp(`${workbenchUrl}$`));
  await expect(page.getByText('那时候我们住在河边。')).toBeVisible();
  const micBeforeCorrection = await page.evaluate(() =>
    Number(Reflect.get(globalThis, '__micRequests')),
  );
  await page.setViewportSize({ height: 844, width: 390 });
  const firstLine = page.locator('.transcript-line').first();
  await firstLine.getByRole('button', { name: '修正角色' }).click();
  const roleSelect = firstLine.getByRole('combobox', { name: '角色' });
  await expect(roleSelect).toBeFocused();
  await roleSelect.selectOption('interviewer');
  const correctionControls = firstLine.locator('.speaker-correction').locator('button, select');
  expect(
    Math.min(
      ...(await correctionControls.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().height),
      )),
    ),
  ).toBeGreaterThanOrEqual(44);
  await firstLine.getByRole('button', { name: '保存' }).click();
  await expect(firstLine.getByText('倾听员', { exact: true })).toBeVisible();
  await expect(firstLine.getByText('角色已修正为倾听员')).toBeAttached();
  expect(server.correctionRequests).toBe(1);

  await page.setViewportSize({ height: 568, width: 320 });
  server.conflictNextCorrection();
  await firstLine.getByRole('button', { name: '修正角色' }).click();
  await firstLine.getByRole('combobox', { name: '角色' }).selectOption('elder');
  await firstLine.getByRole('button', { name: '保存' }).click();
  await expect(firstLine.getByText(/已重新读取服务端事实/)).toBeAttached();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => Number(Reflect.get(globalThis, '__micRequests')))).toBe(
    micBeforeCorrection,
  );
  await captureStateMatrix(page, 'recording');
  expect(await page.evaluate(() => Number(Reflect.get(globalThis, '__micRequests')))).toBe(2);
  expect(server.createdSessions).toBe(1);

  server.setState('interrupted');
  await triggerReadOnlyVerification(page);
  await expect(page.getByRole('heading', { name: '先保护已经录下的内容' })).toBeVisible();
  await expect(page.getByRole('button', { name: '继续同一次访谈' })).toBeVisible();
  await expect(page.getByRole('button', { name: '安全结束已有音频' })).toBeVisible();
  await captureStateMatrix(page, 'interrupted');
  expect(await page.evaluate(() => Number(Reflect.get(globalThis, '__micRequests')))).toBe(2);
  await expect(page).toHaveURL(new RegExp(`${workbenchUrl}$`));

  await page.setViewportSize({ height: 844, width: 390 });
  const interruptedEndTrigger = page.getByRole('button', { name: '安全结束已有音频' });
  await interruptedEndTrigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: '继续访谈' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(interruptedEndTrigger).toBeFocused();
  await interruptedEndTrigger.click();
  await page.getByRole('button', { name: '确认结束' }).click();
  await expect(page.getByRole('heading', { name: '正在安全保存录音' })).toBeVisible();
  await captureStateMatrix(page, 'stopping');
  expect(server.finalizeRequests).toBe(1);
  expect(server.completeRequests).toBe(1);

  for (const [state, heading] of [
    ['processing', '正在完成转录处理'],
    ['completed', '录音和转录已完成'],
    ['failed', '本次访谈未能自动收束'],
    ['no-audio', '没有录到可保存的内容'],
  ] as const) {
    server.setState(state);
    await triggerReadOnlyVerification(page);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    if (state === 'completed') {
      await expect(page.getByRole('button', { name: '完成并离开' })).toBeVisible();
    }
    if (state === 'failed') {
      await expect(page.getByRole('button', { name: '保留现状并离开' })).toBeVisible();
      await expect(page.getByRole('button', { name: '完成并离开' })).toHaveCount(0);
    }
    await captureStateMatrix(page, state);
    await expect(page).toHaveURL(new RegExp(`${workbenchUrl}$`));
  }
});

test('canonical calibration snapshots render all small-screen panel states without another mic request', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installWorkbenchHarness(page);
  await page.goto(`/projects/${PROJECT_ID}/interview/prepare`);
  await page.getByRole('button').first().click();
  await expect(page.getByRole('button').last()).toBeEnabled();
  await page.getByRole('button').last().click();
  await expect(page).toHaveURL(
    new RegExp(`/projects/${PROJECT_ID}/interview/${SESSION_ID}/workbench$`),
  );
  const panel = page.locator('.speaker-calibration');
  await expect(panel).toBeVisible();
  await expect(page.locator('.workbench--recording')).toBeVisible();
  await expect(panel.locator('strong')).toBeVisible();
  await expect(panel).toContainText('\u6b63\u5728\u5f55\u97f3');
  await expect(panel.locator('[aria-live="polite"]')).toBeVisible();
  await expect(panel.getByRole('button')).toHaveCount(4);
  const micRequests = await page.evaluate(() => Number(Reflect.get(globalThis, '__micRequests')));

  for (const viewport of [
    { height: 844, width: 390 },
    { height: 568, width: 320 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.workbench--recording')).toBeVisible();
    await expect(panel.locator('strong')).toBeVisible();
    await expect(panel).toContainText('\u6b63\u5728\u5f55\u97f3');
    const dimensions = await panel.evaluate((element) => {
      const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')];
      return {
        buttonHeights: buttons.map((button) => button.getBoundingClientRect().height),
        buttonWidths: buttons.map((button) => button.getBoundingClientRect().width),
        pageOverflow: document.documentElement.scrollWidth - globalThis.innerWidth,
        pageVerticalOverflow: document.documentElement.scrollHeight - globalThis.innerHeight,
        panelOverflow: element.scrollWidth - element.clientWidth,
      };
    });
    expect(dimensions.pageOverflow).toBeLessThanOrEqual(0);
    expect(dimensions.pageVerticalOverflow).toBeLessThanOrEqual(0);
    expect(dimensions.panelOverflow).toBeLessThanOrEqual(0);
    expect(Math.min(...dimensions.buttonHeights)).toBeGreaterThanOrEqual(44);
    expect(Math.min(...dimensions.buttonWidths)).toBeGreaterThanOrEqual(44);
    const firstButton = panel.getByRole('button').first();
    await firstButton.focus();
    await expect(firstButton).toBeFocused();
    expect(await page.evaluate(() => Number(Reflect.get(globalThis, '__micRequests')))).toBe(
      micRequests,
    );
    await page.screenshot({
      animations: 'disabled',
      path: `test-results/dev-004c1/calibration-collecting-${String(viewport.width)}x${String(viewport.height)}.png`,
    });
  }

  await emitCalibration(page, calibrationSnapshot('confirmed', 1));
  await expect(page.locator('.workbench--recording')).toBeVisible();
  await expect(panel).toHaveClass(/speaker-calibration--confirmed/u);
  await expect(panel.locator('strong')).toBeVisible();
  await expect(panel).toContainText('\u6b63\u5728\u5f55\u97f3');
  await expect(panel).toContainText('\u8bf4\u8bdd\u4eba\u5df2\u786e\u8ba4');
  await expect(panel).toHaveAttribute('aria-live', 'polite');

  for (const status of ['failed', 'skipped'] as const) {
    await emitCalibration(page, calibrationSnapshot(status, 0));
    await expect(page.locator('.workbench--recording')).toBeVisible();
    await expect(panel.locator('strong')).toBeVisible();
    await expect(panel).toContainText('\u6b63\u5728\u5f55\u97f3');
    await expect(panel).toHaveAttribute('aria-live', 'polite');
    const retry = panel.getByRole('button');
    await expect(retry).toHaveCount(1);
    const retryBox = await retry.boundingBox();
    expect(retryBox?.height).toBeGreaterThanOrEqual(44);
    expect(retryBox?.width).toBeGreaterThanOrEqual(44);
    const beforeRetry = await page.evaluate(() => Number(Reflect.get(globalThis, '__micRequests')));
    await retry.click();
    await emitCalibration(page, calibrationSnapshot('collecting', 0));
    await expect(panel.getByRole('button')).toHaveCount(4);
    expect(await page.evaluate(() => Number(Reflect.get(globalThis, '__micRequests')))).toBe(
      beforeRetry,
    );
    await page.screenshot({
      animations: 'disabled',
      path: `test-results/dev-004c1/calibration-${status}-320x568.png`,
    });
  }
});

async function captureStateMatrix(page: Page, state: string): Promise<void> {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expect(page.locator('.workbench')).toBeVisible();
    const dimensions = await page.evaluate(() => {
      const workbench = document.querySelector<HTMLElement>('.workbench');
      const header = document.querySelector<HTMLElement>('.workbench-bar');
      const content = document.querySelector<HTMLElement>('.workbench-content');
      const suggestion = document.querySelector<HTMLElement>('.suggestion-panel');
      const transcript = document.querySelector<HTMLElement>('.transcript-viewport');
      const firstLine = document.querySelector<HTMLElement>('.transcript-line');
      const metadata = document.querySelector<HTMLElement>('.transcript-meta');
      const paragraph = firstLine?.querySelector<HTMLElement>('p') ?? null;
      const visibleButtons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
        (button) => button.getClientRects().length > 0,
      );
      return {
        bodyScrollHeight: document.documentElement.scrollHeight,
        contentHeight: content?.getBoundingClientRect().height ?? 0,
        headerHeight: header?.getBoundingClientRect().height ?? 0,
        horizontalOverflow: document.documentElement.scrollWidth - globalThis.innerWidth,
        metadataWidth: metadata?.getBoundingClientRect().width ?? 0,
        pageHeight: workbench?.getBoundingClientRect().height ?? 0,
        paragraphX: paragraph?.getBoundingClientRect().x ?? 0,
        metadataX: metadata?.getBoundingClientRect().x ?? 0,
        smallestButtonHeight: Math.min(
          ...visibleButtons.map((button) => button.getBoundingClientRect().height),
        ),
        smallestButtonWidth: Math.min(
          ...visibleButtons.map((button) => button.getBoundingClientRect().width),
        ),
        suggestionHeight: suggestion?.getBoundingClientRect().height ?? 0,
        transcriptClientHeight: transcript?.clientHeight ?? 0,
        transcriptScrollHeight: transcript?.scrollHeight ?? 0,
      };
    });

    expect(dimensions.horizontalOverflow).toBeLessThanOrEqual(0);
    expect(dimensions.pageHeight).toBe(viewport.height);
    expect(dimensions.bodyScrollHeight).toBeLessThanOrEqual(viewport.height);
    expect(dimensions.smallestButtonHeight).toBeGreaterThanOrEqual(44);
    if (viewport.width <= 390) {
      expect(dimensions.metadataWidth).toBeGreaterThanOrEqual(52);
      expect(dimensions.metadataWidth).toBeLessThanOrEqual(64);
      expect(dimensions.paragraphX).toBeGreaterThan(dimensions.metadataX);
    }
    if (state === 'recording') {
      expect(dimensions.transcriptScrollHeight).toBeGreaterThan(dimensions.transcriptClientHeight);
      const headerRatio = dimensions.headerHeight / viewport.height;
      const contentRatio = dimensions.contentHeight / viewport.height;
      const suggestionRatio = dimensions.suggestionHeight / viewport.height;
      if (viewport.width === 1440) {
        expect(headerRatio).toBeGreaterThanOrEqual(0.05);
        expect(headerRatio).toBeLessThanOrEqual(0.11);
        expect(contentRatio).toBeGreaterThanOrEqual(0.76);
        expect(contentRatio).toBeLessThanOrEqual(0.82);
        expect(suggestionRatio).toBeGreaterThanOrEqual(0.1);
        expect(suggestionRatio).toBeLessThanOrEqual(0.16);
      }
      if (viewport.width === 390) {
        expect(headerRatio).toBeGreaterThanOrEqual(0.06);
        expect(headerRatio).toBeLessThanOrEqual(0.12);
        expect(contentRatio).toBeGreaterThanOrEqual(0.75);
        expect(contentRatio).toBeLessThanOrEqual(0.78);
        expect(suggestionRatio).toBeGreaterThanOrEqual(0.14);
        expect(suggestionRatio).toBeLessThanOrEqual(0.15);
      }
      if (viewport.width === 320) {
        expect(dimensions.headerHeight).toBeLessThanOrEqual(72);
        expect(dimensions.suggestionHeight).toBeLessThanOrEqual(120);
        expect(contentRatio).toBeGreaterThanOrEqual(0.6);
      }
    }
    await page.screenshot({
      animations: 'disabled',
      path: `test-results/dev-005r3/${state}-${String(viewport.width)}x${String(viewport.height)}.png`,
    });
  }
}

async function triggerReadOnlyVerification(page: Page): Promise<void> {
  await page.evaluate(() => globalThis.dispatchEvent(new Event('online')));
}

type HarnessState =
  'recording' | 'interrupted' | 'stopping' | 'processing' | 'completed' | 'failed' | 'no-audio';

async function installWorkbenchHarness(
  page: Page,
  initiallyStarted = false,
): Promise<{
  completeRequests: number;
  conflictNextCorrection: () => void;
  correctionRequests: number;
  createdSessions: number;
  finalizeRequests: number;
  setState: (state: HarnessState) => void;
  stopRequests: number;
}> {
  let state: HarnessState = 'recording';
  let started = initiallyStarted;
  let captureStatus: 'preparing' | 'active' | 'interrupted' | 'stopped' | 'abandoned_empty' =
    'active';
  let audioStreamId = '99999999-9999-4999-8999-999999999999';
  let nextCorrectionConflicts = false;
  const counts = {
    completeRequests: 0,
    correctionRequests: 0,
    createdSessions: 0,
    finalizeRequests: 0,
    stopRequests: 0,
  };

  await page.addInitScript((): void => {
    Reflect.set(globalThis, '__micRequests', 0);
    const track = {
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      stop: (): void => undefined,
    };
    const stream = {
      getAudioTracks: (): (typeof track)[] => [track],
      getTracks: (): (typeof track)[] => [track],
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: () => {
          Reflect.set(
            globalThis,
            '__micRequests',
            Number(Reflect.get(globalThis, '__micRequests')) + 1,
          );
          return Promise.resolve(stream);
        },
      },
    });
    class FakeAudioContext {
      public readonly audioWorklet = { addModule: (): Promise<void> => Promise.resolve() };
      public createAnalyser(): {
        connect: () => void;
        disconnect: () => void;
        fftSize: number;
        getByteTimeDomainData: (samples: Uint8Array) => void;
      } {
        const startedAt = performance.now();
        return {
          connect: () => undefined,
          disconnect: () => undefined,
          fftSize: 2048,
          getByteTimeDomainData: (samples): void => {
            samples.fill(128);
            if (performance.now() - startedAt > 700) samples[12] = 220;
          },
        };
      }
      public createMediaStreamSource(): { connect: () => void; disconnect: () => void } {
        return { connect: () => undefined, disconnect: () => undefined };
      }
      public close(): Promise<void> {
        return Promise.resolve();
      }
      public resume(): Promise<void> {
        return Promise.resolve();
      }
    }
    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: FakeAudioContext,
    });
    class FakeAudioWorkletNode {
      public readonly port = { close: (): void => undefined, onmessage: null };
      public connect(): this {
        return this;
      }
      public disconnect(): void {}
    }
    Object.defineProperty(globalThis, 'AudioWorkletNode', {
      configurable: true,
      value: FakeAudioWorkletNode,
    });
    class FakeMediaRecorder {
      public static isTypeSupported(): boolean {
        return true;
      }
      public readonly mimeType = 'audio/webm;codecs=opus';
      public ondataavailable: ((event: { data: Blob }) => void) | null = null;
      public onerror: ((event: Event) => void) | null = null;
      public onstop: ((event: Event) => void) | null = null;
      public state: RecordingState = 'inactive';
      public start(): void {
        this.state = 'recording';
      }
      public stop(): void {
        this.state = 'inactive';
        this.ondataavailable?.({
          data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType }),
        });
        this.onstop?.(new Event('stop'));
      }
    }
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      value: FakeMediaRecorder,
    });
    class WorkbenchWebSocket extends EventTarget {
      public static readonly OPEN = 1;
      public readonly OPEN = 1;
      public readyState = 0;
      public nextSequence = 25;
      public sessionId = '';
      public constructor() {
        super();
        Reflect.set(globalThis, '__workbenchSocket', this);
        setTimeout(() => {
          this.readyState = this.OPEN;
          this.dispatchEvent(new Event('open'));
        }, 0);
      }
      public send(value: string): void {
        const message = JSON.parse(value) as {
          payload: { audio_stream_id?: string };
          session_id: string;
          type: string;
        };
        if (message.type !== 'session.join') return;
        this.sessionId = message.session_id;
        const envelope = (type: string, payload: unknown, sequence: number): string =>
          JSON.stringify({
            event_id: crypto.randomUUID(),
            event_stream_id: '77777777-7777-4777-8777-777777777777',
            payload,
            schema_version: '1.1',
            server_sequence: sequence,
            session_id: message.session_id,
            timestamp: '2026-08-08T08:00:00.000Z',
            type,
          });
        setTimeout(() => {
          this.dispatchEvent(
            new MessageEvent('message', {
              data: envelope(
                'session.ready',
                {
                  audio_stream_id: message.payload.audio_stream_id,
                  highest_audio_sequence_acked: -1,
                  resumed: false,
                  resume_window_events: 512,
                  resume_window_seconds: 300,
                  speaker_calibration: {
                    attempt: {
                      attempt_no: 1,
                      boundary: {
                        end_sequence_no_exclusive: null,
                        end_timeline_ms: null,
                        start_sequence_no: 0,
                        start_timeline_ms: 0,
                      },
                      confirmed_mappings: [],
                      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                      observed_provider_labels: ['speaker_1', 'speaker_2'],
                      resolved_at: null,
                      started_at: '2026-08-08T08:00:01.000Z',
                      status: 'collecting',
                    },
                    session_id: message.session_id,
                    speaker_role_revision: 0,
                    speaker_stream: {
                      audio_stream_id: message.payload.audio_stream_id,
                      capture_generation_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                      status: 'active',
                    },
                    status: 'collecting',
                    updated_at: '2026-08-08T08:00:01.000Z',
                  },
                },
                0,
              ),
            }),
          );
          for (let index = 0; index < 24; index += 1) {
            this.dispatchEvent(
              new MessageEvent('message', {
                data: envelope(
                  'asr.final',
                  {
                    end_ms: (index + 1) * 2_000,
                    effective_speaker_role: index % 2 === 0 ? 'elder' : 'interviewer',
                    finality: 'final',
                    segment_id: `segment-${String(index)}`,
                    speaker_provider_id: `speaker-${String(index % 2)}`,
                    speaker_role: index % 2 === 0 ? 'elder' : 'interviewer',
                    speaker_role_authority: 'unconfirmed',
                    speaker_role_revision: 0,
                    speaker_stream_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                    content_kind: 'conversation',
                    start_ms: index * 2_000,
                    text:
                      index === 0
                        ? '那时候我们住在河边。'
                        : `这是用于核对连续转录滚动与移动端元数据栏的第 ${String(index + 1)} 段虚构访谈内容。`,
                    trusted_effective_speaker_role: 'unknown',
                    trusted_speaker_role: 'unknown',
                  },
                  index + 1,
                ),
              }),
            );
          }
        }, 0);
      }
      public emitCalibration(payload: unknown): void {
        this.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({
              event_id: crypto.randomUUID(),
              event_stream_id: '77777777-7777-4777-8777-777777777777',
              payload,
              schema_version: '1.1',
              server_sequence: this.nextSequence,
              session_id: this.sessionId,
              timestamp: '2026-08-08T08:00:02.000Z',
              type: 'speaker.calibration.updated',
            }),
          }),
        );
        this.nextSequence += 1;
      }
      public close(code = 1000): void {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent('close', { code }));
      }
    }
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: WorkbenchWebSocket,
    });
  });

  const setState = (next: HarnessState): void => {
    state = next;
    captureStatus =
      next === 'interrupted'
        ? 'interrupted'
        : next === 'no-audio'
          ? 'abandoned_empty'
          : next === 'recording'
            ? 'active'
            : 'stopped';
  };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    if (path === '/api/v1/auth/me') return route.fulfill({ json: user() });
    if (path === '/api/v1/auth/csrf') return route.fulfill({ json: { csrf_token: 'test-token' } });
    if (path === `/api/v1/projects/${PROJECT_ID}`) return route.fulfill({ json: project() });
    if (path === `/api/v1/projects/${PROJECT_ID}/service-terms`) {
      return route.fulfill({ json: serviceTerms() });
    }
    if (path === `/api/v1/projects/${PROJECT_ID}/consents`)
      return route.fulfill({ json: consents() });
    if (path === `/api/v1/projects/${PROJECT_ID}/sessions` && method === 'POST') {
      counts.createdSessions += 1;
      return route.fulfill({ json: sessionPayload('created', null, audioStreamId) });
    }
    if (path === `/api/v1/sessions/${SESSION_ID}/device-check`) {
      return route.fulfill({ json: sessionPayload('device_check', null, audioStreamId) });
    }
    if (path === `/api/v1/sessions/${SESSION_ID}/start`) {
      started = true;
      audioStreamId = (request.postDataJSON() as { audio_stream_id: string }).audio_stream_id;
      state = 'recording';
      captureStatus = 'preparing';
      return route.fulfill({ json: sessionPayload('recording', captureStatus, audioStreamId) });
    }
    if (path === `/api/v1/sessions/${SESSION_ID}/capture/confirm-active`) {
      captureStatus = 'active';
      return route.fulfill({ json: sessionPayload('recording', captureStatus, audioStreamId) });
    }
    if (path === `/api/v1/sessions/${SESSION_ID}/speaker-calibrations`) {
      return route.fulfill({ json: calibrationSnapshot('collecting', 0) });
    }
    if (/^\/api\/v1\/speaker-calibrations\/[^/]+\/resolve$/u.test(path)) {
      const action = (request.postDataJSON() as { action: 'confirm' | 'fail' | 'skip' }).action;
      return route.fulfill({
        json: calibrationSnapshot(
          action === 'confirm' ? 'confirmed' : action,
          action === 'confirm' ? 1 : 0,
        ),
      });
    }
    if (/^\/api\/v1\/transcripts\/[^/]+\/speaker-role$/u.test(path) && method === 'PATCH') {
      counts.correctionRequests += 1;
      if (nextCorrectionConflicts) {
        nextCorrectionConflicts = false;
        return route.fulfill({
          json: { code: 'SPEAKER_ROLE_VERSION_CONFLICT', details: {}, message: 'conflict' },
          status: 409,
        });
      }
      const body = request.postDataJSON() as {
        corrected_speaker_role: 'elder' | 'interviewer' | 'unknown';
      };
      return route.fulfill({
        json: {
          operation_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          segment: transcriptSegment(body.corrected_speaker_role, 1),
          speaker_role_revision: 1,
        },
      });
    }
    if (path === `/api/v1/sessions/${SESSION_ID}/transcripts` && method === 'GET') {
      return route.fulfill({
        json: { items: [transcriptSegment('interviewer', 1)], next_cursor: null },
      });
    }
    if (path === `/api/v1/sessions/${SESSION_ID}/suggestions/current` && method === 'GET') {
      return route.fulfill({ json: emptySuggestion() });
    }
    if (path === `/api/v1/sessions/${SESSION_ID}` && method === 'GET') {
      if (!started) {
        return route.fulfill({ json: sessionPayload('device_check', null, audioStreamId) });
      }
      return route.fulfill({ json: currentSession(state, captureStatus, audioStreamId) });
    }
    if (path === `/api/v1/sessions/${SESSION_ID}/stop`) {
      counts.stopRequests += 1;
      setState('stopping');
      return route.fulfill({ json: currentSession(state, captureStatus, audioStreamId) });
    }
    if (path === `/api/v1/sessions/${SESSION_ID}/recover`) {
      const action = (request.postDataJSON() as { action: string }).action;
      if (action === 'resume_capture') {
        state = 'recording';
        captureStatus = 'preparing';
      } else if (action === 'finalize_interrupted') {
        counts.finalizeRequests += 1;
        setState('stopping');
      }
      return route.fulfill({ json: currentSession(state, captureStatus, audioStreamId) });
    }
    if (path === `/api/v1/sessions/${SESSION_ID}/capture/abandon-empty`) {
      setState('no-audio');
      return route.fulfill({ json: currentSession(state, captureStatus, audioStreamId) });
    }
    if (path === `/api/v1/audio-objects/${AUDIO_OBJECT_ID}/complete`) {
      counts.completeRequests += 1;
      return route.fulfill({ json: manifest() });
    }
    if (method === 'PUT' && path.includes('/audio-objects/')) {
      const headers = request.headers();
      const sequenceNo = Number(path.split('/').at(-1));
      return route.fulfill({
        json: {
          audio_object_id: AUDIO_OBJECT_ID,
          checksum: headers['x-chunk-sha256'],
          end_ms: Number(headers['x-chunk-end-ms']),
          id: '88888888-8888-4888-8888-888888888888',
          mime_type: headers['content-type'],
          sequence_no: sequenceNo,
          size_bytes: request.postDataBuffer()?.byteLength ?? 0,
          start_ms: Number(headers['x-chunk-start-ms']),
          upload_status: 'uploaded',
          uploaded_at: '2026-08-08T08:00:00.000Z',
        },
      });
    }
    throw new Error(`Unhandled test request: ${method} ${path}`);
  });

  return {
    get completeRequests(): number {
      return counts.completeRequests;
    },
    conflictNextCorrection: (): void => {
      nextCorrectionConflicts = true;
    },
    get correctionRequests(): number {
      return counts.correctionRequests;
    },
    get createdSessions(): number {
      return counts.createdSessions;
    },
    get finalizeRequests(): number {
      return counts.finalizeRequests;
    },
    setState,
    get stopRequests(): number {
      return counts.stopRequests;
    },
  };
}

function emptySuggestion(): unknown {
  return {
    display_sequence: null,
    displayed_at: null,
    history: { has_previous: false },
    kind: 'continue_listening',
    presentation_revision: 0,
    question: null,
    reason: null,
    session_id: SESSION_ID,
    snapshot_id: null,
    withdrawal_reason: null,
  };
}

function transcriptSegment(role: 'elder' | 'interviewer' | 'unknown', revision: number): unknown {
  return {
    content_kind: 'conversation',
    corrected_speaker_role: role,
    corrected_text: null,
    effective_speaker_role: role,
    end_ms: 2_000,
    id: 'segment-0',
    original_speaker_role: 'elder',
    original_speaker_role_authority: 'unconfirmed',
    original_text: '那时候我们住在河边。',
    speaker_provider_id: 'speaker-0',
    speaker_role_revision: revision,
    speaker_stream_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    start_ms: 0,
    trusted_effective_speaker_role: role,
  };
}

async function emitCalibration(page: Page, snapshot: unknown): Promise<void> {
  await page.evaluate((payload) => {
    const socket = Reflect.get(globalThis, '__workbenchSocket') as
      { emitCalibration: (value: unknown) => void } | undefined;
    if (socket === undefined) throw new Error('workbench socket is not connected');
    socket.emitCalibration(payload);
  }, snapshot);
}

function calibrationSnapshot(
  status: 'collecting' | 'confirmed' | 'failed' | 'skipped',
  revision: number,
): unknown {
  const resolved = status !== 'collecting';
  return {
    attempt: {
      attempt_no: 1,
      boundary: {
        end_sequence_no_exclusive: resolved ? 2 : null,
        end_timeline_ms: resolved ? 200 : null,
        start_sequence_no: 0,
        start_timeline_ms: 0,
      },
      confirmed_mappings:
        status === 'confirmed'
          ? [
              {
                authority: 'user_confirmed',
                speaker_provider_id: 'speaker_1',
                speaker_role: 'interviewer',
              },
              {
                authority: 'user_confirmed',
                speaker_provider_id: 'speaker_2',
                speaker_role: 'elder',
              },
            ]
          : [],
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      observed_provider_labels: ['speaker_1', 'speaker_2'],
      resolved_at: resolved ? '2026-08-08T08:00:02.000Z' : null,
      started_at: '2026-08-08T08:00:01.000Z',
      status,
    },
    session_id: SESSION_ID,
    speaker_role_revision: revision,
    speaker_stream: {
      audio_stream_id: '99999999-9999-4999-8999-999999999999',
      capture_generation_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      status: 'active',
    },
    status,
    updated_at: resolved ? '2026-08-08T08:00:02.000Z' : '2026-08-08T08:00:01.000Z',
  };
}

function currentSession(state: HarnessState, captureStatus: string, streamId: string): unknown {
  const sessionStatus = state === 'no-audio' ? 'failed' : state;
  const finalization = ['stopping', 'processing', 'completed', 'failed'].includes(state)
    ? {
        audio_object_id: AUDIO_OBJECT_ID,
        completed_at: state === 'completed' ? '2026-08-08T08:30:00.000Z' : null,
        expected_chunk_count: 1,
        failure_code: state === 'failed' ? 'FINALIZATION_INTERNAL_FAILURE' : null,
        manifest_checksum: state === 'stopping' ? null : 'manifest',
        processing_started_at: '2026-08-08T08:29:00.000Z',
        recording_status: 'stopped',
        transcript_error_code: null,
        transcript_status:
          state === 'completed' ? 'drained' : state === 'processing' ? 'draining' : 'pending',
        upload_status: state === 'stopping' ? 'verifying' : 'complete',
        uploaded_chunk_count: 1,
      }
    : undefined;
  return sessionPayload(sessionStatus, captureStatus, streamId, {
    ...(state === 'no-audio' ? { capture_failure_code: 'NO_AUDIO_CAPTURED' } : {}),
    ...(finalization === undefined ? {} : { finalization }),
  });
}

function sessionPayload(
  status: string,
  captureStatus: string | null,
  streamId: string,
  extra: Record<string, unknown> = {},
): unknown {
  return {
    capture:
      captureStatus === null
        ? null
        : {
            audio_object_id: AUDIO_OBJECT_ID,
            audio_stream_id: streamId,
            generation_no: 0,
            interrupted_at: captureStatus === 'interrupted' ? '2026-08-08T08:20:00.000Z' : null,
            interruption_reason: captureStatus === 'interrupted' ? 'microphone_ended' : null,
            status: captureStatus,
            timeline_offset_ms: 0,
            uploaded_chunk_count: captureStatus === 'active' ? 0 : 1,
          },
    created_at: '2026-08-08T08:00:00.000Z',
    created_by: '33333333-3333-4333-8333-333333333333',
    duration_seconds: ['completed', 'failed'].includes(status) ? 1_800 : undefined,
    ended_at: ['completed', 'failed'].includes(status) ? '2026-08-08T08:30:00.000Z' : undefined,
    id: SESSION_ID,
    project_id: PROJECT_ID,
    sequence_no: 1,
    started_at: ['created', 'device_check'].includes(status) ? null : '2026-08-08T08:00:00.000Z',
    status,
    updated_at: '2026-08-08T08:30:00.000Z',
    ...extra,
  };
}

function user(): unknown {
  return {
    display_name: '虚构倾听员 A',
    id: '33333333-3333-4333-8333-333333333333',
    role: 'interviewer',
    status: 'active',
  };
}

function project(): unknown {
  return {
    approximate_age: null,
    birth_year: null,
    created_at: '2026-08-08T08:00:00.000Z',
    created_by: '33333333-3333-4333-8333-333333333333',
    current_city: null,
    display_name: '虚构长者小禾',
    id: PROJECT_ID,
    native_place: null,
    status: 'ready',
    updated_at: '2026-08-08T08:00:00.000Z',
  };
}

function serviceTerms(): unknown {
  return [
    {
      created_at: '2026-08-08T08:00:00.000Z',
      currency: 'CNY',
      effective_from: '2026-08-08T08:00:00.000Z',
      estimated_session_count: 1,
      expected_current_minutes: 30,
      explained_at: '2026-08-08T08:00:00.000Z',
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

function consents(): unknown {
  return [
    {
      consent_audio_object_id: null,
      consent_method: 'electronic',
      consent_text_version: 'mvp-v1',
      consent_type: 'recording_transcription_ai',
      consented_at: '2026-08-08T08:00:00.000Z',
      created_at: '2026-08-08T08:00:00.000Z',
      created_by: '33333333-3333-4333-8333-333333333333',
      id: '55555555-5555-4555-8555-555555555555',
      project_id: PROJECT_ID,
      revoked_at: null,
      status: 'valid',
    },
  ];
}

function manifest(): unknown {
  return {
    chunk_count: 1,
    chunks: [],
    completed_at: '2026-08-08T08:30:00.000Z',
    created_at: '2026-08-08T08:00:00.000Z',
    created_by: '33333333-3333-4333-8333-333333333333',
    id: AUDIO_OBJECT_ID,
    manifest_checksum: 'manifest',
    mime_type: 'audio/webm;codecs=opus',
    project_id: PROJECT_ID,
    purpose: 'interview',
    session_id: SESSION_ID,
    status: 'complete',
    total_size_bytes: 4,
  };
}
