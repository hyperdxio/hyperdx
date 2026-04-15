jest.retryTimes(1, { logErrorsBeforeRetry: true });

// Suppress noisy console output during test runs.
// - debug/info: ClickHouse query logging, server startup messages
// - warn: expected column-not-found warnings from renderChartConfig on CTE tables
jest.spyOn(console, 'debug').mockImplementation(() => {});
jest.spyOn(console, 'info').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

// Suppress pino logger output during tests. Tests intentionally trigger
// operational errors (validation failures, bad requests, MCP tool errors,
// etc.) that produce warn/error log lines via the logger.
const noop = jest.fn();
jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: jest.fn().mockReturnValue({
      trace: noop,
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
      fatal: noop,
    }),
  },
  expressLogger: (_req: any, _res: any, next: any) => next(),
}));

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
