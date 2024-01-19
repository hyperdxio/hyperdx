import express from 'express';

import {
  createLogView,
  deleteLogView,
  getAllLogViews,
  getLogView,
  updateLogView,
} from '@/controllers/logViews';
import { validateUserAccessKey } from '@/middleware/auth';
import { annotateSpanOnError, Api400Error, Api403Error } from '@/utils/errors';
import { getDefaultRateLimiter } from '@/utils/rateLimiter';

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
    const logViews = await getAllLogViews(team);
    res.json({
      version: 'v1',
      data: logViews,
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
    const logView = await getLogView(req.params.id, team);
    res.json({
      version: 'v1',
      data: logView,
    });
  }),
);

router.post(
  '/',
  getDefaultRateLimiter(),
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    if (req.user == undefined) {
      throw new Api400Error('User not found');
    }

    if (team === undefined) {
      throw new Api400Error('Team not found');
    }
    const logView = await createLogView(req.user._id, team, req.body);
    res.json({
      version: 'v1',
      data: logView,
    });
  }),
);

router.put(
  '/:id',
  getDefaultRateLimiter(),
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    if (team === undefined) {
      throw new Api400Error('Team not found');
    }
    const logView = await updateLogView(req.params.id, team, req.body);
    res.json({
      version: 'v1',
      data: logView,
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
    const deleted = await deleteLogView(req.params.id, team);
    res.json({
      version: 'v1',
      data: deleted,
    });
  }),
);

export { router as LogViewsRouter };
