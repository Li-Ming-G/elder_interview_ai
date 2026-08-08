import { expect, test } from '@playwright/test';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

test('assigned fictional project passes preparation and enters only the workbench shell', async ({
  page,
}) => {
  const writes: string[] = [];
  let captureStreamId = '99999999-9999-4999-8999-999999999999';
  await page.addInitScript((): void => {
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
      value: { getUserMedia: () => Promise.resolve(stream) },
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
          fftSize: 1024,
          getByteTimeDomainData: (samples): void => {
            samples.fill(128);
            if (performance.now() - startedAt > 700) samples[12] = 220;
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
          data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }),
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
      public constructor() {
        super();
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
        const envelope = (type: string, payload: unknown, server_sequence: number): string =>
          JSON.stringify({
            event_id: crypto.randomUUID(),
            event_stream_id: '77777777-7777-4777-8777-777777777777',
            payload,
            schema_version: '1.0',
            server_sequence,
            session_id: message.session_id,
            timestamp: '2026-08-07T00:02:00.000Z',
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
                },
                0,
              ),
            }),
          );
          this.dispatchEvent(
            new MessageEvent('message', {
              data: envelope(
                'asr.interim',
                {
                  end_ms: 1800,
                  finality: 'interim',
                  hypothesis_id: 'h1',
                  revision: 1,
                  start_ms: 1000,
                  text: '那时候我们',
                },
                1,
              ),
            }),
          );
          this.dispatchEvent(
            new MessageEvent('message', {
              data: envelope(
                'asr.interim',
                {
                  end_ms: 2200,
                  finality: 'interim',
                  hypothesis_id: 'h1',
                  revision: 2,
                  start_ms: 1000,
                  text: '那时候我们住在河边',
                },
                2,
              ),
            }),
          );
          this.dispatchEvent(
            new MessageEvent('message', {
              data: envelope(
                'asr.final',
                {
                  end_ms: 2200,
                  finality: 'final',
                  segment_id: 'segment-1',
                  speaker_provider_id: 'speaker-1',
                  speaker_role: 'elder',
                  start_ms: 1000,
                  text: '那时候我们住在河边。',
                },
                3,
              ),
            }),
          );
        }, 0);
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

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST') writes.push(path);
    if (request.method() === 'PUT' && path.includes('/audio-objects/')) {
      const headers = request.headers();
      const sequenceNo = Number(path.split('/').at(-1));
      await route.fulfill({
        json: {
          audio_object_id: '66666666-6666-4666-8666-666666666666',
          checksum: headers['x-chunk-sha256'],
          end_ms: Number(headers['x-chunk-end-ms']),
          id: '88888888-8888-4888-8888-888888888888',
          mime_type: headers['content-type'],
          sequence_no: sequenceNo,
          size_bytes: request.postDataBuffer()?.byteLength ?? 0,
          start_ms: Number(headers['x-chunk-start-ms']),
          upload_status: 'uploaded',
          uploaded_at: '2026-08-08T00:00:00.000Z',
        },
      });
      return;
    }
    if (path === `/api/v1/sessions/${SESSION_ID}/start` && request.method() === 'POST') {
      captureStreamId = (request.postDataJSON() as { audio_stream_id: string }).audio_stream_id;
      await route.fulfill({ json: session('recording', 'preparing', captureStreamId) });
      return;
    }
    if (
      path === `/api/v1/sessions/${SESSION_ID}/capture/confirm-active` &&
      request.method() === 'POST'
    ) {
      await route.fulfill({ json: session('recording', 'active', captureStreamId) });
      return;
    }
    const payload =
      path === `/api/v1/sessions/${SESSION_ID}` &&
      request.method() === 'GET' &&
      writes.includes(`/api/v1/sessions/${SESSION_ID}/start`)
        ? session('recording', 'active', captureStreamId)
        : responseFor(path, request.method());
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
  await expect(page.getByRole('heading', { name: '当前对话' })).toBeVisible();
  await expect(page.getByText('那时候我们住在河边。')).toBeVisible();
  await expect(
    page.getByTestId('workbench-finals').getByText('长者', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('继续倾听', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '结束访谈' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ fullPage: true, path: 'test-results/dev-005b-workbench-narrow.png' });

  expect(writes).toEqual([
    `/api/v1/projects/${PROJECT_ID}/sessions`,
    `/api/v1/sessions/${SESSION_ID}/device-check`,
    `/api/v1/sessions/${SESSION_ID}/start`,
    `/api/v1/sessions/${SESSION_ID}/capture/confirm-active`,
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
    return session('recording', 'preparing');
  }
  if (path === `/api/v1/sessions/${SESSION_ID}/capture/confirm-active` && method === 'POST') {
    return session('recording', 'active');
  }
  throw new Error(`Unhandled test request: ${method} ${path}`);
}

function session(
  status: 'created' | 'device_check' | 'recording',
  captureStatus: 'active' | 'preparing' | null = null,
  audioStreamId = '99999999-9999-4999-8999-999999999999',
): unknown {
  return {
    capture:
      captureStatus === null
        ? null
        : {
            audio_object_id: '66666666-6666-4666-8666-666666666666',
            audio_stream_id: audioStreamId,
            generation_no: 0,
            interrupted_at: null,
            interruption_reason: null,
            status: captureStatus,
            timeline_offset_ms: 0,
            uploaded_chunk_count: 0,
          },
    created_at: '2026-08-07T00:00:00.000Z',
    created_by: '33333333-3333-4333-8333-333333333333',
    id: SESSION_ID,
    project_id: PROJECT_ID,
    sequence_no: 1,
    started_at: status === 'recording' ? new Date().toISOString() : null,
    status,
    updated_at: '2026-08-07T00:01:00.000Z',
  };
}
