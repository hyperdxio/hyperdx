import type { NextFunction, Request, Response } from 'express';

jest.mock('@/utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Dynamic user id per test so we can simulate multiple callers
let mockUserId = 'user-a';
jest.mock('@/middleware/auth', () => ({
  getNonNullUserWithTeam: () => ({
    teamId: 't',
    userId: mockUserId,
    email: 'e',
  }),
}));

import { createRateLimiter } from '../rateLimit';

function makeReq(): Request {
  return {} as Request;
}
function makeRes(): Response {
  return {} as Response;
}

// Invoke the middleware and capture what it passes to next()
function invoke(mw: ReturnType<typeof createRateLimiter>): {
  error?: unknown;
  passed: boolean;
} {
  let captured: unknown;
  let passed = false;
  const next: NextFunction = err => {
    if (err) captured = err;
    else passed = true;
  };
  mw(makeReq(), makeRes(), next);
  return { error: captured, passed };
}

describe('createRateLimiter', () => {
  beforeEach(() => {
    mockUserId = 'user-a';
  });

  it('allows requests under the limit', () => {
    const mw = createRateLimiter({ windowMs: 60_000, max: 3, name: 'test' });
    expect(invoke(mw).passed).toBe(true);
    expect(invoke(mw).passed).toBe(true);
    expect(invoke(mw).passed).toBe(true);
  });

  it('rejects the (max+1)th request with a 429', () => {
    const mw = createRateLimiter({ windowMs: 60_000, max: 2, name: 'test' });
    invoke(mw);
    invoke(mw);
    const { passed, error } = invoke(mw);
    expect(passed).toBe(false);
    expect(error).toBeDefined();
    // Api429Error has statusCode 429. The project's BaseError pattern puts
    // the detail message in `.name` and a generic description in `.message`.
    expect((error as { statusCode?: number }).statusCode).toBe(429);
    expect((error as Error).name).toContain('Rate limit');
  });

  it('resets after the window elapses', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const mw = createRateLimiter({ windowMs: 1000, max: 1, name: 'test' });
    expect(invoke(mw).passed).toBe(true);
    expect(invoke(mw).passed).toBe(false); // over
    jest.setSystemTime(new Date('2026-01-01T00:00:01.500Z')); // past window
    expect(invoke(mw).passed).toBe(true);
    jest.useRealTimers();
  });

  it('tracks users independently', () => {
    const mw = createRateLimiter({ windowMs: 60_000, max: 1, name: 'test' });
    mockUserId = 'user-a';
    expect(invoke(mw).passed).toBe(true);
    expect(invoke(mw).passed).toBe(false); // a is over

    mockUserId = 'user-b';
    expect(invoke(mw).passed).toBe(true); // b is fresh
  });

  it('returns independent buckets per limiter instance', () => {
    const mwA = createRateLimiter({ windowMs: 60_000, max: 1, name: 'A' });
    const mwB = createRateLimiter({ windowMs: 60_000, max: 1, name: 'B' });
    expect(invoke(mwA).passed).toBe(true);
    expect(invoke(mwA).passed).toBe(false);
    // different limiter — still fresh
    expect(invoke(mwB).passed).toBe(true);
  });

  it('includes the limiter name and retry seconds in the error message', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const mw = createRateLimiter({
      windowMs: 30_000,
      max: 1,
      name: 'summarize',
    });
    invoke(mw);
    const { error } = invoke(mw);
    expect((error as Error).name).toContain('summarize');
    expect((error as Error).name).toMatch(/Try again in \d+s/);
    jest.useRealTimers();
  });
});
