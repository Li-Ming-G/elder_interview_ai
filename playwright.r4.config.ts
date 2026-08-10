import { defineConfig, devices } from '@playwright/test';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://elder_interview_test:local_test_only@127.0.0.1:5433/elder_interview_test';
const fakeAudioPath = process.env.DEV005R4_FAKE_AUDIO_PATH;

export default defineConfig({
  expect: { timeout: 15_000 },
  fullyParallel: false,
  projects: [
    {
      name: 'desktop-chromium-formal-route',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--autoplay-policy=no-user-gesture-required',
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            ...(fakeAudioPath === undefined
              ? []
              : [`--use-file-for-fake-audio-capture=${fakeAudioPath}`]),
          ],
        },
        permissions: ['microphone'],
      },
    },
  ],
  reporter: [['list']],
  testDir: './tests/e2e-r4',
  timeout: 480_000,
  use: {
    baseURL: 'http://127.0.0.1:4176',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      env: {
        API_HOST: '127.0.0.1',
        API_PORT: '3101',
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4176',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-r4-throttle-pepper',
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-r4-retention-cleanup-pepper',
        DATABASE_URL: databaseUrl,
      },
      reuseExistingServer: false,
      timeout: 60_000,
      url: 'http://127.0.0.1:3101/api/v1/health',
    },
    {
      command:
        'node apps/web/node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port 4176 --strictPort',
      reuseExistingServer: false,
      timeout: 60_000,
      url: 'http://127.0.0.1:4176',
    },
  ],
  workers: 1,
});
