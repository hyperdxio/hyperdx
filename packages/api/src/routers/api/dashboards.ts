import { DashboardWithoutIdSchema } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { groupBy } from 'lodash';
import _ from 'lodash';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  createDashboard,
  deleteDashboard,
  getDashboard,
  getDashboards,
  updateDashboard,
} from '@/controllers/dashboard';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { objectIdSchema } from '@/utils/zod';

// create routes that will get and update dashboards
const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);

    const dashboards = await getDashboards(teamId);

    return res.json(dashboards);
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
    body: DashboardWithoutIdSchema.partial(),
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

      const updatedDashboard = await updateDashboard(
        dashboardId,
        teamId,
        updates,
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

      await deleteDashboard(dashboardId, teamId);

      res.sendStatus(204);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
