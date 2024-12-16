import express from 'express';
import { differenceBy, groupBy, uniq } from 'lodash';
import _ from 'lodash';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  DashboardSchema,
  DashboardWithoutIdSchema,
} from '@/common/commonTypes';
import {
  createDashboard,
  deleteDashboardAndAlerts,
  getDashboard,
  getDashboards,
  updateDashboardAndAlerts,
} from '@/controllers/dashboard';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import Alert from '@/models/alert';
import { chartSchema, objectIdSchema, tagsSchema } from '@/utils/zod';

// create routes that will get and update dashboards
const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);

    const dashboards = await getDashboards(teamId);

    const alertsByDashboard = groupBy(
      await Alert.find({
        dashboard: { $in: dashboards.map(d => d._id) },
      }),
      'dashboard',
    );

    res.json(
      dashboards.map(d => ({
        ...d.toJSON(),
        alerts: alertsByDashboard[d._id.toString()],
      })),
    );
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  validateRequest({
    body: DashboardWithoutIdSchema,
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);

      const dashboard = req.body;

      const newDashboard = await createDashboard(teamId, dashboard);

      res.json(newDashboard.toJSON());
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    body: DashboardSchema.partial(),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { id: dashboardId } = req.params;

      const dashboard = await getDashboard(dashboardId, teamId);

      if (dashboard == null) {
        return res.sendStatus(404);
      }

      const updates = _.omitBy(req.body, _.isNil);

      const updatedDashboard = await updateDashboardAndAlerts(
        dashboardId,
        teamId,
        {
          ...dashboard.toJSON(),
          ...updates,
        },
      );

      res.json(updatedDashboard);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id',
  validateRequest({
    params: z.object({ id: objectIdSchema }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { id: dashboardId } = req.params;

      await deleteDashboardAndAlerts(dashboardId, teamId);

      res.sendStatus(204);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
