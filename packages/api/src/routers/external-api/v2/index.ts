import express from 'express';

import { validateUserAccessKey } from '@/middleware/auth';
import alertsRouter from '@/routers/external-api/v2/alerts';
import chartsRouter from '@/routers/external-api/v2/charts';
import dashboardRouter from '@/routers/external-api/v2/dashboards';
import sourcesRouter from '@/routers/external-api/v2/sources';
import webhooksRouter from '@/routers/external-api/v2/webhooks';
import rateLimiter from '@/utils/rateLimiter';

const router = express.Router();

const rateLimiterKeyGenerator = (req: express.Request): string => {
  return req.headers.authorization ?? req.ip ?? 'unknown';
};

const defaultRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 requests per `window`
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

router.use('/alerts', defaultRateLimiter, validateUserAccessKey, alertsRouter);

router.use('/charts', defaultRateLimiter, validateUserAccessKey, chartsRouter);

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

router.use(
  '/webhooks',
  defaultRateLimiter,
  validateUserAccessKey,
  webhooksRouter,
);

export default router;
