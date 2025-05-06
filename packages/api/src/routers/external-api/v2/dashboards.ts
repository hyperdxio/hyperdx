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

/**
 * @openapi
 * components:
 *   schemas:
 *     ChartSeries:
 *       type: object
 *       properties:
 *         type:
 *           type: string
 *           enum: [time, table, number, histogram, search, markdown]
 *           example: "time"
 *         dataSource:
 *           type: string
 *           enum: [events, metrics]
 *           example: "events"
 *         aggFn:
 *           type: string
 *           example: "count"
 *         where:
 *           type: string
 *           example: "level:error"
 *         groupBy:
 *           type: array
 *           items:
 *             type: string
 *           example: []
 *
 *     Tile:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "65f5e4a3b9e77c001a901234"
 *         name:
 *           type: string
 *           example: "Error Rate"
 *         x:
 *           type: integer
 *           example: 0
 *         y:
 *           type: integer
 *           example: 0
 *         w:
 *           type: integer
 *           example: 6
 *         h:
 *           type: integer
 *           example: 3
 *         asRatio:
 *           type: boolean
 *           example: false
 *         series:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ChartSeries'
 *
 *     Dashboard:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "65f5e4a3b9e77c001a567890"
 *         name:
 *           type: string
 *           example: "Service Overview"
 *         tiles:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Tile'
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *           example: ["production", "monitoring"]
 *
 *     CreateDashboardRequest:
 *       type: object
 *       required:
 *         - name
 *       properties:
 *         name:
 *           type: string
 *           example: "New Dashboard"
 *         tiles:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Tile'
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *           example: ["development"]
 *
 *     UpdateDashboardRequest:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           example: "Updated Dashboard Name"
 *         tiles:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Tile'
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *           example: ["production", "updated"]
 *
 *     DashboardResponse:
 *       type: object
 *       properties:
 *         data:
 *           $ref: '#/components/schemas/Dashboard'
 *
 *     DashboardsListResponse:
 *       type: object
 *       properties:
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Dashboard'
 */

const router = express.Router();

/**
 * @openapi
 * /api/v2/dashboards:
 *   get:
 *     summary: List Dashboards
 *     description: Retrieves a list of all dashboards for the authenticated team
 *     operationId: listDashboards
 *     tags: [Dashboards]
 *     responses:
 *       '200':
 *         description: Successfully retrieved dashboards
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardsListResponse'
 *       '401':
 *         description: Unauthorized
 */
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

/**
 * @openapi
 * /api/v2/dashboards/{id}:
 *   get:
 *     summary: Get Dashboard
 *     description: Retrieves a specific dashboard by ID
 *     operationId: getDashboard
 *     tags: [Dashboards]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Dashboard ID
 *         example: "65f5e4a3b9e77c001a567890"
 *     responses:
 *       '200':
 *         description: Successfully retrieved dashboard
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardResponse'
 *             examples:
 *               dashboard:
 *                 summary: Single dashboard response
 *                 value:
 *                   data:
 *                     id: "65f5e4a3b9e77c001a567890"
 *                     name: "Infrastructure Monitoring"
 *                     tiles:
 *                       - id: "65f5e4a3b9e77c001a901234"
 *                         name: "Server CPU"
 *                         x: 0
 *                         y: 0
 *                         w: 6
 *                         h: 3
 *                         asRatio: false
 *                         series:
 *                           - type: "time"
 *                             dataSource: "metrics"
 *                             aggFn: "avg"
 *                             field: "cpu.usage"
 *                             where: "host:server-01"
 *                             groupBy: []
 *                       - id: "65f5e4a3b9e77c001a901235"
 *                         name: "Memory Usage"
 *                         x: 6
 *                         y: 0
 *                         w: 6
 *                         h: 3
 *                         asRatio: false
 *                         series:
 *                           - type: "time"
 *                             dataSource: "metrics"
 *                             aggFn: "avg"
 *                             field: "memory.usage"
 *                             where: "host:server-01"
 *                             groupBy: []
 *                     tags: ["infrastructure", "monitoring"]
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '404':
 *         description: Dashboard not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Dashboard not found"
 */
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

/**
 * @openapi
 * /api/v2/dashboards:
 *   post:
 *     summary: Create Dashboard
 *     description: Creates a new dashboard
 *     operationId: createDashboard
 *     tags: [Dashboards]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateDashboardRequest'
 *           examples:
 *             simpleTimeSeriesDashboard:
 *               summary: Dashboard with time series chart
 *               value:
 *                 name: "API Monitoring Dashboard"
 *                 tiles:
 *                   - name: "API Request Volume"
 *                     x: 0
 *                     y: 0
 *                     w: 6
 *                     h: 3
 *                     asRatio: false
 *                     series:
 *                       - type: "time"
 *                         dataSource: "events"
 *                         aggFn: "count"
 *                         where: "service:api"
 *                         groupBy: []
 *                 tags: ["api", "monitoring"]
 *             complexDashboard:
 *               summary: Dashboard with multiple chart types
 *               value:
 *                 name: "Service Health Overview"
 *                 tiles:
 *                   - name: "Request Count"
 *                     x: 0
 *                     y: 0
 *                     w: 6
 *                     h: 3
 *                     asRatio: false
 *                     series:
 *                       - type: "time"
 *                         dataSource: "events"
 *                         aggFn: "count"
 *                         where: "service:backend"
 *                         groupBy: []
 *                   - name: "Error Distribution"
 *                     x: 6
 *                     y: 0
 *                     w: 6
 *                     h: 3
 *                     asRatio: false
 *                     series:
 *                       - type: "table"
 *                         dataSource: "events"
 *                         aggFn: "count"
 *                         where: "level:error"
 *                         groupBy: ["errorType"]
 *                         sortOrder: "desc"
 *                 tags: ["service-health", "production"]
 *     responses:
 *       '200':
 *         description: Successfully created dashboard
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardResponse'
 *             examples:
 *               createdDashboard:
 *                 summary: Created dashboard response
 *                 value:
 *                   data:
 *                     id: "65f5e4a3b9e77c001a567890"
 *                     name: "API Monitoring Dashboard"
 *                     tiles:
 *                       - id: "65f5e4a3b9e77c001a901234"
 *                         name: "API Request Volume"
 *                         x: 0
 *                         y: 0
 *                         w: 6
 *                         h: 3
 *                         asRatio: false
 *                         series:
 *                           - type: "time"
 *                             dataSource: "events"
 *                             aggFn: "count"
 *                             where: "service:api"
 *                             groupBy: []
 *                     tags: ["api", "monitoring"]
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '500':
 *         description: Server error or validation failure
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Dashboard validation failed: name is required"
 */
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

/**
 * @openapi
 * /api/v2/dashboards/{id}:
 *   put:
 *     summary: Update Dashboard
 *     description: Updates an existing dashboard
 *     operationId: updateDashboard
 *     tags: [Dashboards]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Dashboard ID
 *         example: "65f5e4a3b9e77c001a567890"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateDashboardRequest'
 *           examples:
 *             updateDashboard:
 *               summary: Update dashboard properties and tiles
 *               value:
 *                 name: "Updated Dashboard Name"
 *                 tiles:
 *                   - id: "65f5e4a3b9e77c001a901234"
 *                     name: "Updated Time Series Chart"
 *                     x: 0
 *                     y: 0
 *                     w: 6
 *                     h: 3
 *                     asRatio: false
 *                     series:
 *                       - type: "time"
 *                         dataSource: "events"
 *                         aggFn: "count"
 *                         where: "level:error"
 *                         groupBy: []
 *                   - name: "New Number Chart"
 *                     x: 6
 *                     y: 0
 *                     w: 6
 *                     h: 3
 *                     asRatio: false
 *                     series:
 *                       - type: "number"
 *                         dataSource: "events"
 *                         aggFn: "count"
 *                         where: "level:info"
 *                 tags: ["production", "updated"]
 *     responses:
 *       '200':
 *         description: Successfully updated dashboard
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardResponse'
 *             examples:
 *               updatedDashboard:
 *                 summary: Updated dashboard response
 *                 value:
 *                   data:
 *                     id: "65f5e4a3b9e77c001a567890"
 *                     name: "Updated Dashboard Name"
 *                     tiles:
 *                       - id: "65f5e4a3b9e77c001a901234"
 *                         name: "Updated Time Series Chart"
 *                         x: 0
 *                         y: 0
 *                         w: 6
 *                         h: 3
 *                         asRatio: false
 *                         series:
 *                           - type: "time"
 *                             dataSource: "events"
 *                             aggFn: "count"
 *                             where: "level:error"
 *                             groupBy: []
 *                       - id: "65f5e4a3b9e77c001a901236"
 *                         name: "New Number Chart"
 *                         x: 6
 *                         y: 0
 *                         w: 6
 *                         h: 3
 *                         asRatio: false
 *                         series:
 *                           - type: "number"
 *                             dataSource: "events"
 *                             aggFn: "count"
 *                             where: "level:info"
 *                     tags: ["production", "updated"]
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '404':
 *         description: Dashboard not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Dashboard not found"
 *       '500':
 *         description: Server error or validation failure
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Invalid dashboard configuration"
 */
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

/**
 * @openapi
 * /api/v2/dashboards/{id}:
 *   delete:
 *     summary: Delete Dashboard
 *     description: Deletes a dashboard
 *     operationId: deleteDashboard
 *     tags: [Dashboards]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Dashboard ID
 *         example: "65f5e4a3b9e77c001a567890"
 *     responses:
 *       '200':
 *         description: Successfully deleted dashboard
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmptyResponse'
 *             example: {}
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '404':
 *         description: Dashboard not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Dashboard not found"
 */
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
