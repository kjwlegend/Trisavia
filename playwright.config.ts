import { defineConfig } from '@playwright/test';

const port=Number(process.env.M1_E2E_PORT);
if(!Number.isInteger(port)||port<1||port>65535||[8789,8799,8801,8787,8846,8897,18892,15432].includes(port))throw new Error('Use scripts/run-e2e.ts or an explicit isolated M1_E2E_PORT');
const origin=`http://127.0.0.1:${port}`;
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
    baseURL: origin, browserName: 'chromium',
    trace: 'off', screenshot: 'off', video: 'off',
    ...(process.env.M1_TEST_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.M1_TEST_CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'node scripts/e2e-server.ts', url: `${origin}/health`,
    reuseExistingServer: false, timeout: 30_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
  },
});
