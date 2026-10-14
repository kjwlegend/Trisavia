import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: 'list',
  outputDir: 'outputs/e2e',
  use: {
    baseURL: 'http://127.0.0.1:8897', browserName: 'chromium',
    trace: 'off', screenshot: 'off', video: 'off',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'node scripts/e2e-server.ts', url: 'http://127.0.0.1:8897/health',
    reuseExistingServer: false, timeout: 20_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
});
