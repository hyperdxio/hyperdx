// @eslint-disable @typescript-eslint/no-var-requires
jest.retryTimes(1, { logErrorsBeforeRetry: true });

global.console = {
  ...console,
  // Turn off console.debug logs in tests (useful since we log db queries aggressively)
  debug: jest.fn(),
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
