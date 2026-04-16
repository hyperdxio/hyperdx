import express from 'express';
import rateLimit, { Options } from 'express-rate-limit';

export const rateLimiterKeyGenerator = (req: express.Request): string => {
  return req.headers.authorization ?? req.ip ?? 'unknown';
};

export default (config?: Partial<Options>) => {
  return rateLimit({
    ...config,
  });
};
