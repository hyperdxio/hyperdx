import express from 'express';
import rateLimit, { Options } from 'express-rate-limit';

import { getAccessKeyFromRequest } from '@/middleware/auth';

export const rateLimiterKeyGenerator = (req: express.Request): string => {
  return getAccessKeyFromRequest(req) || req.ip || 'unknown';
};

export default (config?: Partial<Options>) => {
  return rateLimit({
    ...config,
  });
};
