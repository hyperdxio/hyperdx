// Per-user in-memory rate limiter. Intentionally simple: a sliding window
// counter per user id. Swap for a Redis-backed limiter if the API scales
// beyond a single process — the interface stays the same.
//
// Not a DDoS defense. Purpose: protect shared LLM API budget from runaway
// callers (scripts, bugs, honest-mistake retry loops).

import type { NextFunction, Request, Response } from 'express';

import { getNonNullUserWithTeam } from '@/middleware/auth';
import { Api429Error } from '@/utils/errors';
import logger from '@/utils/logger';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  name: string; // shown in logs, helps identify which limiter fired
}

interface WindowState {
  count: number;
  resetAt: number;
}

export function createRateLimiter({ windowMs, max, name }: RateLimitOptions) {
  const buckets = new Map<string, WindowState>();

  // Opportunistic cleanup — runs on every request, O(1) amortized.
  function gc(now: number) {
    if (buckets.size < 1000) return;
    for (const [k, v] of buckets) {
      if (v.resetAt <= now) buckets.delete(k);
    }
  }

  return function rateLimitMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ) {
    try {
      const { userId } = getNonNullUserWithTeam(req);
      const key = String(userId);
      const now = Date.now();
      gc(now);

      let state = buckets.get(key);
      if (!state || state.resetAt <= now) {
        state = { count: 0, resetAt: now + windowMs };
        buckets.set(key, state);
      }

      state.count++;
      if (state.count > max) {
        logger.warn({
          message: 'rate limit exceeded',
          limiter: name,
          userId: key,
          count: state.count,
          max,
        });
        throw new Api429Error(
          `Rate limit exceeded for ${name}. Try again in ${Math.ceil((state.resetAt - now) / 1000)}s.`,
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
