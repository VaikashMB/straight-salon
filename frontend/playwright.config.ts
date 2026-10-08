import { defineConfig, devices } from '@playwright/test';

// End-to-end tests (10-testing-and-quality §2, §4; 05 §9) against the running docker-compose
// stack with seed data: `npm run up && npm run seed`, then `npm run test:e2e`.
// E2E_BASE_URL points at another deployment (default: the local frontend).
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // One worker: the scenarios share the stack's data and the API's per-IP auth rate limit
  // (10 sign-ins per 15 min, 06 §4), so they run one after another.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results',
  reporter: CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'reports/e2e-junit.xml' }],
      ]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The customer flow is the one that must work one-handed on a phone (05 §2).
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: /customer-booking\.spec\.ts/,
    },
  ],
});
