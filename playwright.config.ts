import { defineConfig, devices } from '@playwright/test';

const webPort = Number(process.env.E2E_WEB_PORT ?? 4173);
const baseURL = `http://127.0.0.1:${String(webPort)}`;

export default defineConfig({
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  testDir: './tests/e2e',
  webServer: {
    command: `node apps/web/node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port ${String(webPort)} --strictPort`,
    reuseExistingServer: false,
    timeout: 60_000,
    url: baseURL,
  },
  use: {
    baseURL,
  },
});
