import express from 'express';

import { validateUserAccessKey } from '@/middleware/auth';
import alertsRouter from '@/routers/external-api/v1/alerts';
import dashboardRouter from '@/routers/external-api/v1/dashboards';
import { Api400Error, Api403Error } from '@/utils/errors';
import rateLimiter from '@/utils/rateLimiter';

const router = express.Router();

const rateLimiterKeyGenerator = (req: express.Request) => {
  return req.headers.authorization || req.ip;
};

const getDefaultRateLimiter = () =>
  rateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // Limit each IP to 100 requests per `window`
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    keyGenerator: rateLimiterKeyGenerator,
  });

router.get('/', validateUserAccessKey, (req, res, next) => {
  res.json({
    version: 'v1',
    user: req.user?.toJSON(),
  });
});

router.use(
  '/alerts',
  getDefaultRateLimiter(),
  validateUserAccessKey,
  alertsRouter,
);

router.use(
  '/dashboards',
  getDefaultRateLimiter(),
  validateUserAccessKey,
  dashboardRouter,
);

export default router;
