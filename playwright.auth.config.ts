import { defineConfig, devices } from '@playwright/test';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://elder_interview_test:local_test_only@127.0.0.1:15433/elder_interview_test';
const apiPort = Number(process.env.E2E_AUTH_API_PORT ?? 3101);
const webPort = Number(process.env.E2E_AUTH_WEB_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${String(webPort)}`;

export default defineConfig({
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  testDir: './tests/e2e-auth',
  workers: 1,
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      env: {
        API_HOST: '127.0.0.1',
        API_PORT: String(apiPort),
        APP_ENV: 'test',
        AUTH_ALLOWED_ORIGINS: baseURL,
        AUTH_LOGIN_THROTTLE_PEPPER: 'test-only-login-throttle-pepper',
        AI_RETENTION_CLEANUP_PEPPER: 'test-only-retention-cleanup-pepper',
        DATABASE_URL: databaseUrl,
        TEST_CONSENT_CONTINUATION_POLICY: 'synthetic-fictional-v1',
      },
      reuseExistingServer: false,
      timeout: 60_000,
      url: `http://127.0.0.1:${String(apiPort)}/api/v1/health`,
    },
    {
      command: `node apps/web/node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port ${String(webPort)} --strictPort`,
      reuseExistingServer: false,
      timeout: 60_000,
      url: baseURL,
    },
  ],
  use: { baseURL },
});
