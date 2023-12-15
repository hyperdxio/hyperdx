import express from 'express';

import Dashboard from '@/models/dashboard';
import Alert from '@/models/alert';
import { validateRequest } from 'zod-express-middleware';
import { z } from 'zod';
import { groupBy, differenceBy } from 'lodash';

// create routes that will get and update dashboards
const router = express.Router();

const zChart = z.object({
  id: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  series: z.array(
    // We can't do a strict validation here since mongo and the frontend
    // have a bug where chart types will not delete extraneous properties
    // when attempting to save.
    z.object({
      type: z.enum([
        'time',
        'histogram',
        'search',
        'number',
        'table',
        'markdown',
      ]),
      table: z.string().optional(),
      aggFn: z.string().optional(), // TODO: Replace with the actual AggFn schema
      field: z.union([z.string(), z.undefined()]).optional(),
      where: z.string().optional(),
      groupBy: z.array(z.string()).optional(),
      sortOrder: z.union([z.literal('desc'), z.literal('asc')]).optional(),
      content: z.string().optional(),
    }),
  ),
});

router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    const dashboards = await Dashboard.find(
      { team: teamId },
      { _id: 1, name: 1, createdAt: 1, updatedAt: 1, charts: 1, query: 1 },
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
      name: z.string(),
      charts: z.array(zChart),
      query: z.string(),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const { name, charts, query } = req.body ?? {};
      // Create new dashboard from name and charts
      const newDashboard = await new Dashboard({
        name,
        charts,
        query,
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
    body: z.object({
      name: z.string(),
      charts: z.array(zChart),
      query: z.string(),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const { id: dashboardId } = req.params;
      if (teamId == null) {
        return res.sendStatus(403);
      }
      if (!dashboardId) {
        return res.sendStatus(400);
      }

      const { name, charts, query } = req.body ?? {};
      // Update dashboard from name and charts
      const oldDashboard = await Dashboard.findById(dashboardId);
      const updatedDashboard = await Dashboard.findByIdAndUpdate(
        dashboardId,
        {
          name,
          charts,
          query,
        },
        { new: true },
      );

      // Delete related alerts
      const deletedChartIds = differenceBy(
        oldDashboard?.charts || [],
        updatedDashboard?.charts || [],
        'id',
      ).map(c => c.id);

      if (deletedChartIds?.length > 0) {
        await Alert.deleteMany({
          dashboardId: dashboardId,
          chartId: { $in: deletedChartIds },
        });
      }

      res.json({
        data: updatedDashboard,
      });
    } catch (e) {
      next(e);
    }
  },
);

router.delete('/:id', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const { id: dashboardId } = req.params;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    if (!dashboardId) {
      return res.sendStatus(400);
    }
    await Dashboard.findByIdAndDelete(dashboardId);
    await Alert.deleteMany({ dashboardId: dashboardId });
    res.json({});
  } catch (e) {
    next(e);
  }
});

export default router;
