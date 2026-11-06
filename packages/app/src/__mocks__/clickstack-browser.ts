import type * as ClickStackBrowser from '@clickhouse/clickstack-browser';

// @clickhouse/clickstack-browser and its OpenTelemetry browser dependencies
// are ESM-only, which Jest (with transformIgnorePatterns: ['/node_modules/'])
// cannot parse. Unit tests never start RUM, so each export behaves as the SDK
// does before init.
export const init: typeof ClickStackBrowser.init = jest.fn();
export const getSessionId: typeof ClickStackBrowser.getSessionId = jest.fn(
  () => null,
);
export const startNewSession: typeof ClickStackBrowser.startNewSession =
  jest.fn();
export const pauseReplay: typeof ClickStackBrowser.pauseReplay = jest.fn();
export const resumeReplay: typeof ClickStackBrowser.resumeReplay = jest.fn();
export const shutdown: typeof ClickStackBrowser.shutdown = jest.fn(() =>
  Promise.resolve(),
);
export const recordException: typeof ClickStackBrowser.recordException =
  jest.fn();
export const setUser: typeof ClickStackBrowser.setUser = jest.fn();
export const setAttributes: typeof ClickStackBrowser.setAttributes = jest.fn();
