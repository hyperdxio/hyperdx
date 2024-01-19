import express from 'express';

import {
  createDashboard,
  deleteDashboard,
  getAllDashboards,
  getDashboard,
  updateDashboard,
} from '@/controllers/dashboards';
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
    const dashboards = await getAllDashboards(team);
    res.json({
      version: 'v1',
      data: dashboards,
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
    const dashboard = await getDashboard(req.params.id, team);
    res.json({
      version: 'v1',
      data: dashboard,
    });
  }),
);

router.post(
  '/',
  getDefaultRateLimiter(),
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    if (team === undefined) {
      throw new Api400Error('Team not found');
    }
    const dashboard = await createDashboard(team, req.body);
    res.json({
      version: 'v1',
      data: dashboard,
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
    const dashboard = await updateDashboard(req.params.id, team, req.body);
    res.json({
      version: 'v1',
      data: dashboard,
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
    const deleted = await deleteDashboard(req.params.id, team);
    res.json({
      version: 'v1',
      data: deleted,
    });
  }),
);

export { router as DashboardsRouter };
