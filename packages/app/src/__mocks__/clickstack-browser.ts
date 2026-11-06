// @clickhouse/clickstack-browser is ESM-only, which Jest's CommonJS runtime
// cannot load. Same surface, no-op bodies.
const noop = (): void => undefined;

export const init = noop;
export const setUser = noop;
export const setAttributes = noop;
export const getSessionId = (): string | null => null;
export const startNewSession = noop;
export const recordException = noop;
export const pauseReplay = noop;
export const resumeReplay = noop;
export const shutdown = (): Promise<void> => Promise.resolve();
