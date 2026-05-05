jest.retryTimes(1, { logErrorsBeforeRetry: true });

// Suppress noisy console output during test runs.
// - debug/info: ClickHouse query logging, server startup messages
// - warn: expected column-not-found warnings from renderChartConfig on CTE tables
jest.spyOn(console, 'debug').mockImplementation(() => {});
jest.spyOn(console, 'info').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

// NOTE (Berg / Task 2): @/utils/slack was deleted along with the alert
// surface; the previous `jest.mock('@/utils/slack', ...)` would now error
// out before any test file could load.  We keep the global `fetch` mock so
// the few remaining webhook callsites (e.g. external API integrations) do
// not hit the network during tests.

// Mock global fetch for generic webhook calls
global.fetch = jest.fn().mockResolvedValue({
  ok: true,
  text: jest.fn().mockResolvedValue(''),
  json: jest.fn().mockResolvedValue({}),
} as any);
