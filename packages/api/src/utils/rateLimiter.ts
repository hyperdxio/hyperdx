import express from 'express';
import rateLimit, { Options } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';

import redisClient from './redis';

export const rateLimiter =
  (config?: Partial<Options>) => async (req, rs, next) => {
    return rateLimit({
      ...config,
      // Redis store configuration
      store: new RedisStore({
        sendCommand: (...args: string[]) => redisClient.sendCommand(args),
      }),
    })(req, rs, next);
  };

export const rateLimiterKeyGenerator = (req: express.Request) => {
  return req.headers.authorization || req.ip;
};

export const getDefaultRateLimiter = () =>
  rateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // Limit each IP to 100 requests per `window`
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    keyGenerator: rateLimiterKeyGenerator,
  });

export default rateLimiter;
