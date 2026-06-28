import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests for the Tirelo Services API. They run against an in-memory
 * test server (no MongoDB needed), so the suite is fully self-contained and
 * runs in CI. The `webServer` block boots `src/test-server.js` automatically.
 *
 * Browser/UI journeys live under e2e/ui and require the built Ionic app served
 * alongside this API; they are documented in docs/TESTING.md and excluded from
 * the default run to keep CI deterministic.
 */
const PORT = process.env.E2E_PORT || '4010';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/ui/**'],
  timeout: 30_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `PORT=${PORT} node src/test-server.js`,
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
