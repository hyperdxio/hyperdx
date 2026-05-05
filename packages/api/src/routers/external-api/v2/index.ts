import express from 'express';

import { validateUserAccessKey } from '@/middleware/auth';
import dashboardRouter from '@/routers/external-api/v2/dashboards';
import sourcesRouter from '@/routers/external-api/v2/sources';
import rateLimiter, { rateLimiterKeyGenerator } from '@/utils/rateLimiter';

const router = express.Router();

const defaultRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Limit each API key to 100 requests per `window`
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  keyGenerator: rateLimiterKeyGenerator,
});

router.get('/', validateUserAccessKey, (req, res, next) => {
  res.json({
    version: 'v2',
    user: req.user?.toJSON(),
  });
});

router.use(
  '/dashboards',
  defaultRateLimiter,
  validateUserAccessKey,
  dashboardRouter,
);

router.use(
  '/sources',
  defaultRateLimiter,
  validateUserAccessKey,
  sourcesRouter,
);

export default router;
