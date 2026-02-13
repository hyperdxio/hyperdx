import { defineConfig, devices } from '@playwright/test';
import path from 'path';

// Check if we should use full-stack mode (with backend)
const USE_FULLSTACK = process.env.E2E_FULLSTACK === 'true';
const AUTH_FILE = path.join(__dirname, 'tests/e2e/.auth/user.json');

// Timeout configuration constants (in milliseconds)
const TEST_TIMEOUT_MS = 60 * 1000; // 60 seconds per test
const API_SERVER_STARTUP_TIMEOUT_MS = 120 * 1000; // 2 minutes for API to start
const APP_SERVER_STARTUP_TIMEOUT_MS = 180 * 1000; // 3 minutes for Next.js build + start

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',
  /* Global setup to ensure server is ready */
  globalSetup: USE_FULLSTACK
    ? require.resolve('./tests/e2e/global-setup-fullstack.ts')
    : require.resolve('./tests/e2e/global-setup-local.ts'),
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 1,
  /* Use multiple workers on CI for faster execution */
  workers: process.env.CI ? 2 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
    ...(process.env.CI
      ? [['github'] as const, ['list'] as const]
      : [['list'] as const]),
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: USE_FULLSTACK
      ? 'http://localhost:28081'
      : process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8081',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* Take screenshot on failure */
    screenshot: 'only-on-failure',
    /* Record video on failure */
    video: 'retain-on-failure',
  },

  /* Global test timeout - CI needs more time than local */
  timeout: TEST_TIMEOUT_MS,

  /* Configure projects for different test environments */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use saved authentication state for full-stack mode
        ...(USE_FULLSTACK && {
          storageState: AUTH_FILE,
        }),
      },
    },
  ],

  /* Run your local dev server before starting the tests */
  // Note: webServer array syntax requires Playwright v1.32.0+ (current: v1.57.0)
  webServer: USE_FULLSTACK
    ? [
        // Full-stack mode: Start API and App servers (infrastructure started separately)
        {
          // Connections/sources come from env (injected by run-e2e.js from e2e-fixtures.json)
          command: `cd ../api && ${process.env.MONGO_URI ? `MONGO_URI="${process.env.MONGO_URI}"` : ''} DOTENV_CONFIG_PATH=.env.e2e npx ts-node --transpile-only -r tsconfig-paths/register -r dotenv-expand/config -r @hyperdx/node-opentelemetry/build/src/tracing src/index.ts`,
          port: 29000,
          reuseExistingServer: !process.env.CI,
          timeout: API_SERVER_STARTUP_TIMEOUT_MS,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          command:
            'SERVER_URL=http://localhost:29000 PORT=28081 yarn build && SERVER_URL=http://localhost:29000 PORT=28081 yarn start',
          port: 28081,
          reuseExistingServer: !process.env.CI,
          timeout: APP_SERVER_STARTUP_TIMEOUT_MS,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ]
    : {
        // Local mode: Frontend only
        command:
          'NEXT_PUBLIC_IS_LOCAL_MODE=true yarn build && NEXT_PUBLIC_IS_LOCAL_MODE=true PORT=8081 yarn start',
        port: 8081,
        reuseExistingServer: !process.env.CI,
        timeout: APP_SERVER_STARTUP_TIMEOUT_MS,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
