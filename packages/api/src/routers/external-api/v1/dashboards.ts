import express from 'express';
import { uniq } from 'lodash';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  deleteDashboardAndAlerts,
  updateDashboard,
  updateDashboardAndAlerts,
} from '@/controllers/dashboard';
import Dashboard, { IDashboard } from '@/models/dashboard';
import {
  translateDashboardDocumentToExternalDashboard,
  translateExternalChartToInternalChart,
} from '@/utils/externalApi';
import {
  externalChartSchema,
  externalChartSchemaWithId,
  objectIdSchema,
  tagsSchema,
} from '@/utils/zod';

const router = express.Router();

router.get(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const dashboard = await Dashboard.findOne(
        { team: teamId, _id: req.params.id },
        { _id: 1, name: 1, charts: 1, query: 1 },
      );

      if (dashboard == null) {
        return res.sendStatus(404);
      }

      res.json({
        data: translateDashboardDocumentToExternalDashboard(dashboard),
      });
    } catch (e) {
      next(e);
    }
  },
);

router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    const dashboards = await Dashboard.find(
      { team: teamId },
      { _id: 1, name: 1, charts: 1, query: 1 },
    ).sort({ name: -1 });

    res.json({
      data: dashboards.map(d =>
        translateDashboardDocumentToExternalDashboard(d),
      ),
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
      charts: z.array(externalChartSchema),
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

      const { name, charts, query, tags } = req.body;

      const internalCharts = charts.map(chart => {
        const chartId = new ObjectId().toString();
        return translateExternalChartToInternalChart({
          id: chartId,
          ...chart,
        });
      });

      // Create new dashboard from name and charts
      const newDashboard = await new Dashboard({
        name,
        charts: internalCharts,
        query,
        tags: tags && uniq(tags),
        team: teamId,
      }).save();

      res.json({
        data: translateDashboardDocumentToExternalDashboard(newDashboard),
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
      charts: z.array(externalChartSchemaWithId),
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
      if (!dashboardId) {
        return res.sendStatus(400);
      }

      const { name, charts, query, tags } = req.body ?? {};

      const internalCharts = charts.map(chart => {
        return translateExternalChartToInternalChart(chart);
      });

      const updatedDashboard = await updateDashboard(dashboardId, teamId, {
        name,
        charts: internalCharts,
        query,
        tags,
      });

      if (updatedDashboard == null) {
        return res.sendStatus(404);
      }

      res.json({
        data: translateDashboardDocumentToExternalDashboard(updatedDashboard),
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
