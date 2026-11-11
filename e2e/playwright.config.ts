import { defineConfig, devices } from '@playwright/test';

import { WEB } from './stack';

/** `pnpm e2e` — the stack (mock NEAR AI, game server, web app) is started by global-setup.ts. */
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './global-setup.ts',
  globalTimeout: 4 * 60_000,
  timeout: 3 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: './.test-results',
  use: {
    baseURL: WEB,
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
