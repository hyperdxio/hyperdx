import { TileSchema } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { uniq } from 'lodash';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  deleteDashboard,
  getDashboard,
  updateDashboard,
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
        { _id: 1, name: 1, tiles: 1, tags: 1 },
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
      { _id: 1, name: 1, tiles: 1, tags: 1 },
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
      tiles: z.array(externalChartSchema),
      tags: tagsSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const { name, tiles, tags } = req.body;

      const charts = tiles.map(tile => {
        const chartId = new ObjectId().toString();
        return translateExternalChartToInternalChart({
          id: chartId,
          ...tile,
        });
      });

      // Create new dashboard from name and charts
      const newDashboard = await new Dashboard({
        name,
        tiles: charts,
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
      tiles: z.array(externalChartSchemaWithId),
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

      const { name, tiles, tags } = req.body ?? {};

      // Get the existing dashboard to preserve any fields not included in the update
      const existingDashboard = await getDashboard(dashboardId, teamId);
      if (existingDashboard == null) {
        return res.sendStatus(404);
      }

      // Convert external tiles to internal charts format
      const charts = tiles.map(tile =>
        translateExternalChartToInternalChart(tile),
      );

      // Use updateDashboard to handle the update and all related data (like alerts)
      const updatedDashboard = await Dashboard.findOneAndUpdate(
        { _id: dashboardId, team: teamId },
        {
          $set: {
            name,
            tiles: charts,
            tags: tags && uniq(tags),
          },
        },
        { new: true },
      );

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

      await deleteDashboard(dashboardId, teamId);

      res.json({});
    } catch (e) {
      next(e);
    }
  },
);

export default router;
