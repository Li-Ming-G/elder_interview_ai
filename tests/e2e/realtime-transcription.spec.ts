import { expect, test } from '@playwright/test';

test('mock WebSocket stops at twenty unacknowledged PCM frames', async ({ page }) => {
  await page.route('**/api/v1/auth/csrf', async (route) =>
    route.fulfill({
      body: JSON.stringify({ csrf_token: 'mock-csrf' }),
      contentType: 'application/json',
      status: 200,
    }),
  );
  await page.addInitScript(() => {
    const sent: string[] = [];
    Object.defineProperty(window, '__realtimeSent', { value: sent });
    class MockWebSocket extends EventTarget {
      public static readonly OPEN = 1;
      public readonly OPEN = 1;
      public readyState = 0;

      public constructor(url: string) {
        super();
        void url;
        setTimeout(() => {
          if (this.readyState === 3) return;
          this.readyState = this.OPEN;
          this.dispatchEvent(new Event('open'));
        }, 0);
      }

      public send(value: string): void {
        sent.push(value);
        const message = JSON.parse(value) as {
          payload: { audio_stream_id?: string };
          session_id: string;
          type: string;
        };
        if (message.type !== 'session.join') return;
        setTimeout(
          () =>
            this.dispatchEvent(
              new MessageEvent('message', {
                data: JSON.stringify({
                  event_id: '40000000-0000-4000-8000-000000000004',
                  event_stream_id: '30000000-0000-4000-8000-000000000003',
                  payload: {
                    audio_stream_id: message.payload.audio_stream_id,
                    highest_audio_sequence_acked: -1,
                    resume_window_events: 512,
                    resume_window_seconds: 300,
                    resumed: false,
                  },
                  schema_version: '1.1',
                  server_sequence: 0,
                  session_id: message.session_id,
                  timestamp: '2026-08-07T00:00:00.000Z',
                  type: 'session.ready',
                }),
              }),
            ),
          0,
        );
      }

      public close(code = 1000): void {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent('close', { code }));
      }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: MockWebSocket });
  });

  await page.goto(
    '/engineering-harness.html?realtime_harness=1&session_id=10000000-0000-4000-8000-000000000001',
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __realtimeSent: string[] }).__realtimeSent.length,
      ),
    )
    .toBeGreaterThan(0);
  await expect(page.getByTestId('realtime-connection')).toHaveText('connected');
  await page.getByRole('button', { name: '填满背压窗口' }).click();
  await expect(page.getByTestId('realtime-backpressure')).toContainText('20/20');
  const frames = await page.evaluate(() => {
    const values = (window as unknown as { __realtimeSent: string[] }).__realtimeSent;
    return values
      .map((value) => JSON.parse(value) as { type: string })
      .filter(({ type }) => type === 'audio.frame');
  });
  expect(frames).toHaveLength(20);
  await expect(page.getByRole('button', { name: '发送一帧合成 PCM' })).toBeDisabled();
});
