import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  testDir: './tests/e2e',
  webServer: {
    command:
      'node apps/web/node_modules/vite/bin/vite.js preview apps/web --host 127.0.0.1 --port 4173 --strictPort',
    reuseExistingServer: false,
    timeout: 60_000,
    url: 'http://127.0.0.1:4173',
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
  },
});
