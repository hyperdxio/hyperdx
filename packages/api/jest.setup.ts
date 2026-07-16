jest.retryTimes(Number(process.env.JEST_RETRY_TIMES ?? '1'), {
  logErrorsBeforeRetry: true,
});

// http-proxy-middleware v4 is ESM-only and Jest's CJS module loader cannot
// load ESM packages. Auto-mock since no test exercises the proxy directly.
jest.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: jest.fn(() => jest.fn()),
}));

// Suppress noisy console output during test runs.
// - debug/info: ClickHouse query logging, server startup messages
// - warn: expected column-not-found warnings from renderChartConfig on CTE tables
jest.spyOn(console, 'debug').mockImplementation(() => {});
jest.spyOn(console, 'info').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

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
