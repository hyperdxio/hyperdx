// @eslint-disable @typescript-eslint/no-var-requires

// Test-environment env defaults.
//
// `src/config.ts` captures `FRONTEND_URL` at module-load time, so any test
// that imports a module which imports `@/config` (e.g. `mcp/tools/query/helpers`)
// gets the value frozen on first load. Without a default, `FRONTEND_URL`
// resolves to `http://localhost:undefined`, and `new URL(...)` rejects it.
// Setting the port here gives every test suite a stable, deterministic
// frontend URL without requiring shell-level env setup.
process.env.HYPERDX_APP_PORT ||= '8080';

jest.retryTimes(1, { logErrorsBeforeRetry: true });

global.console = {
  ...console,
  // Turn off noisy console logs in tests
  debug: jest.fn(),
  info: jest.fn(),
};

// Mock alert notification functions to prevent HTTP calls during tests
jest.mock('@/utils/slack', () => ({
  ...jest.requireActual('@/utils/slack'),
  postMessageToWebhook: jest.fn().mockResolvedValue(null),
}));

// Mock global fetch for generic webhook calls
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  text: jest.fn().mockResolvedValue(''),
  json: jest.fn().mockResolvedValue({}),
} as any);
