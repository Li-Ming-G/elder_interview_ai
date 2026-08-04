import { defineConfig, devices } from '@playwright/test';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://elder_interview_test:local_test_only@127.0.0.1:5433/elder_interview_test';

export default defineConfig({
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  testDir: './tests/e2e-auth',
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      env: {
        API_HOST: '127.0.0.1',
        API_PORT: '3101',
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-login-throttle-pepper',
        DATABASE_URL: databaseUrl,
      },
      reuseExistingServer: false,
      timeout: 60_000,
      url: 'http://127.0.0.1:3101/api/v1/health',
    },
    {
      command:
        'node apps/web/node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port 4173 --strictPort',
      reuseExistingServer: false,
      timeout: 60_000,
      url: 'http://127.0.0.1:4173',
    },
  ],
  use: { baseURL: 'http://127.0.0.1:4173' },
});
