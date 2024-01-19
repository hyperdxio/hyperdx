import express from 'express';

import { validateUserAccessKey } from '@/middleware/auth';
import { annotateSpanOnError, Api400Error, Api403Error } from '@/utils/errors';

import { getDefaultRateLimiter } from '@/utils/rateLimiter';
import {
  createAlert,
  updateAlert,
  deleteAlert,
  getAlert,
  getAllAlerts,
  zAlert,
} from '@/controllers/alerts';
import { validateRequest } from 'zod-express-middleware';

const router = express.Router();

router.get(
  '/',
  getDefaultRateLimiter(),
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    if (team === undefined) {
      throw new Api400Error('Team not found');
    }
    const alerts = await getAllAlerts(team);
    res.json({
      version: 'v1',
      data: alerts,
    });
  }),
);

router.get(
  '/:id',
  getDefaultRateLimiter(),
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    if (team === undefined) {
      throw new Api400Error('Team not found');
    }
    const alert = await getAlert(req.params.id, team);
    res.json({
      version: 'v1',
      data: alert,
    });
  }),
);

router.post(
  '/',
  getDefaultRateLimiter(),
  validateRequest({ body: zAlert }),
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    if (team === undefined) {
      throw new Api400Error('Team not found');
    }
    const alert = await createAlert(team, req.body);
    res.json({
      version: 'v1',
      data: alert,
    });
  }),
);

router.put(
  '/:id',
  getDefaultRateLimiter(),
  validateRequest({ body: zAlert }),
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    if (team === undefined) {
      throw new Api400Error('Team not found');
    }

    const alert = await updateAlert(req.params.id, team, req.body);

    res.json({
      version: 'v1',
      data: alert,
    });
  }),
);

router.delete(
  '/:id',
  getDefaultRateLimiter(),
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    if (team === undefined) {
      throw new Api400Error('Team not found');
    }
    const deleted = await deleteAlert(req.params.id, team);
    res.json({
      version: 'v1',
      data: deleted,
    });
  }),
);

export { router as AlertsRouter };
