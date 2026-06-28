import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'fs';

// Use the environment's pre-installed Chromium when present (its version may not
// match Playwright's bundled one); CI runners install browsers normally.
const PREINSTALLED = '/opt/pw-browsers/chromium';
const launchOptions = {
  args: ['--no-sandbox'],
  ...(existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {}),
};

/**
 * Browser UI E2E. Boots the in-memory API (on :4000 so the dev-built PWA's
 * `apiBaseUrl` matches) and a static server for `mobile/www`, then drives real
 * Chromium journeys. Produces HTML report, screenshots, video and traces.
 *
 * Build the app for E2E first:  cd mobile && npx ng build --configuration development
 * Run:                          npx playwright test --config playwright.ui.config.ts
 */
const API_PORT = process.env.E2E_API_PORT || '4000';
const UI_PORT = process.env.UI_STATIC_PORT || '8100';

export default defineConfig({
  testDir: './e2e/ui',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-ui' }]],
  use: {
    baseURL: `http://127.0.0.1:${UI_PORT}`,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    launchOptions,
    ...devices['Desktop Chrome'],
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
    { name: 'mobile-safari-viewport', use: { ...devices['iPhone 13'], browserName: 'chromium', launchOptions } },
  ],
  webServer: [
    {
      command: `PORT=${API_PORT} node src/test-server.js`,
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `UI_STATIC_PORT=${UI_PORT} node e2e/ui/static-server.js`,
      url: `http://127.0.0.1:${UI_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
