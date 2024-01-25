import express from 'express';
import { differenceBy, groupBy, uniq } from 'lodash';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  deleteDashboardAndAlerts,
  updateDashboardAndAlerts,
} from '@/controllers/dashboard';
import Alert from '@/models/alert';
import Dashboard from '@/models/dashboard';
import { chartSchema, objectIdSchema, tagsSchema } from '@/utils/zod';

// create routes that will get and update dashboards
const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    const dashboards = await Dashboard.find(
      { team: teamId },
      {
        _id: 1,
        name: 1,
        createdAt: 1,
        updatedAt: 1,
        charts: 1,
        query: 1,
        tags: 1,
      },
    ).sort({ name: -1 });

    const alertsByDashboard = groupBy(
      await Alert.find({
        dashboardId: { $in: dashboards.map(d => d._id) },
      }),
      'dashboardId',
    );

    res.json({
      data: dashboards.map(d => ({
        ...d.toJSON(),
        alerts: alertsByDashboard[d._id.toString()],
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  validateRequest({
    body: z.object({
      name: z.string().max(1024),
      charts: z.array(chartSchema),
      query: z.string().max(2048),
      tags: tagsSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const { name, charts, query, tags } = req.body ?? {};

      // Create new dashboard from name and charts
      const newDashboard = await new Dashboard({
        name,
        charts,
        query,
        tags: tags && uniq(tags),
        team: teamId,
      }).save();
      res.json({
        data: newDashboard,
      });
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    body: z.object({
      name: z.string().max(1024),
      charts: z.array(chartSchema),
      query: z.string().max(2048),
      tags: tagsSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const { id: dashboardId } = req.params;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const { name, charts, query, tags } = req.body ?? {};

      const updatedDashboard = await updateDashboardAndAlerts(
        dashboardId,
        teamId,
        {
          name,
          charts,
          query,
          tags,
        },
      );

      res.json({
        data: updatedDashboard,
      });
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const { id: dashboardId } = req.params;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      await deleteDashboardAndAlerts(dashboardId, teamId);

      res.json({});
    } catch (e) {
      next(e);
    }
  },
);

export default router;
