import express from 'express';
import { uniq } from 'lodash';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import { z } from 'zod';

import { deleteDashboard } from '@/controllers/dashboard';
import { getSources } from '@/controllers/sources';
import Dashboard from '@/models/dashboard';
import { validateRequestWithEnhancedErrors as validateRequest } from '@/utils/enhancedErrors';
import {
  translateDashboardDocumentToExternalDashboard,
  translateExternalChartToTileConfig,
} from '@/utils/externalApi';
import {
  externalDashboardTileSchema,
  externalDashboardTileSchemaWithId,
  ExternalDashboardTileWithId,
  objectIdSchema,
  tagsSchema,
} from '@/utils/zod';

/** Returns an array of source IDs that are referenced in the tiles but do not exist in the team's sources */
async function getMissingSources(
  team: string | mongoose.Types.ObjectId,
  tiles: ExternalDashboardTileWithId[],
) {
  const sourceIds = new Set<string>();
  for (const tile of tiles) {
    for (const series of tile.series) {
      if ('sourceId' in series) {
        sourceIds.add(series.sourceId);
      }
    }
  }

  const existingSources = await getSources(team.toString());
  const existingSourceIds = new Set(
    existingSources.map(source => source._id.toString()),
  );
  return [...sourceIds].filter(sourceId => !existingSourceIds.has(sourceId));
}

/**
 * @openapi
 * components:
 *   schemas:
 *     NumberFormatOutput:
 *       type: string
 *       enum: [currency, percent, byte, time, number]
 *       description: Output format type (currency, percent, byte, time, number).
 *     AggregationFunction:
 *       type: string
 *       enum: [avg, count, count_distinct, last_value, max, min, quantile, sum, any, none]
 *       description: Aggregation function to apply to the field or metric value.
 *     QueryLanguage:
 *       type: string
 *       enum: [sql, lucene]
 *       description: Query language for the where clause.
 *     MetricDataType:
 *       type: string
 *       enum: [sum, gauge, histogram, summary, exponential histogram]
 *       description: Metric data type for metrics data sources.
 *     TimeSeriesDisplayType:
 *       type: string
 *       enum: [stacked_bar, line]
 *       description: Visual representation type for the time series.
 *     SortOrder:
 *       type: string
 *       enum: [desc, asc]
 *       description: Sort order for table rows.
 *     NumberFormat:
 *       type: object
 *       properties:
 *         output:
 *           $ref: '#/components/schemas/NumberFormatOutput'
 *           example: "number"
 *         mantissa:
 *           type: integer
 *           description: Number of decimal places.
 *           example: 2
 *         thousandSeparated:
 *           type: boolean
 *           description: Whether to use thousand separators.
 *           example: true
 *         average:
 *           type: boolean
 *           description: Whether to show as average.
 *           example: false
 *         decimalBytes:
 *           type: boolean
 *           description: Use decimal bytes (1000) vs binary bytes (1024).
 *           example: false
 *         factor:
 *           type: number
 *           description: Multiplication factor.
 *           example: 1
 *         currencySymbol:
 *           type: string
 *           description: Currency symbol for currency format.
 *           example: "$"
 *         unit:
 *           type: string
 *           description: Custom unit label.
 *           example: "ms"
 *
 *     TimeChartSeries:
 *       type: object
 *       required:
 *         - type
 *         - sourceId
 *         - aggFn
 *         - where
 *         - groupBy
 *       properties:
 *         type:
 *           type: string
 *           enum: [time]
 *           example: "time"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query
 *           example: "65f5e4a3b9e77c001a567890"
 *         aggFn:
 *           $ref: '#/components/schemas/AggregationFunction'
 *           description: Aggregation function to apply to the field or metric value
 *           example: "count"
 *         level:
 *           type: number
 *           minimum: 0
 *           maximum: 1
 *           description: Percentile level for quantile aggregations (e.g., 0.95 for p95)
 *           example: 0.95
 *         field:
 *           type: string
 *           description: Field/property name to aggregate (required for most aggregation functions except count)
 *           example: "duration"
 *         alias:
 *           type: string
 *           description: Display name for the series in the chart
 *           example: "Request Duration"
 *         where:
 *           type: string
 *           description: Filter query for the data (syntax depends on whereLanguage)
 *           example: "service:api"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           description: Query language for the where clause
 *           example: "lucene"
 *         groupBy:
 *           type: array
 *           items:
 *             type: string
 *           maxItems: 10
 *           description: Fields to group results by (creates separate series for each group)
 *           example: ["host"]
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *         metricDataType:
 *           $ref: '#/components/schemas/MetricDataType'
 *           example: "sum"
 *         metricName:
 *           type: string
 *           description: Metric name for metrics data sources
 *           example: "http.server.duration"
 *         displayType:
 *           $ref: '#/components/schemas/TimeSeriesDisplayType'
 *           description: Visual representation type for the time series
 *           example: "line"
 *
 *     TableChartSeries:
 *       type: object
 *       required:
 *         - type
 *         - sourceId
 *         - aggFn
 *         - where
 *         - groupBy
 *       properties:
 *         type:
 *           type: string
 *           enum: [table]
 *           example: "table"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query
 *           example: "65f5e4a3b9e77c001a567890"
 *         aggFn:
 *           $ref: '#/components/schemas/AggregationFunction'
 *           description: Aggregation function to apply to the field or metric value
 *           example: "count"
 *         level:
 *           type: number
 *           minimum: 0
 *           maximum: 1
 *           description: Percentile level for quantile aggregations (e.g., 0.95 for p95)
 *           example: 0.95
 *         field:
 *           type: string
 *           example: "duration"
 *         alias:
 *           type: string
 *           example: "Total Count"
 *         where:
 *           type: string
 *           example: "level:error"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           example: "lucene"
 *         groupBy:
 *           type: array
 *           items:
 *             type: string
 *           maxItems: 10
 *           example: ["errorType"]
 *         sortOrder:
 *           $ref: '#/components/schemas/SortOrder'
 *           description: Sort order for table rows
 *           example: "desc"
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *         metricDataType:
 *           $ref: '#/components/schemas/MetricDataType'
 *           description: Metric data type for metrics data sources
 *           example: "sum"
 *         metricName:
 *           type: string
 *           description: Metric name for metrics data sources
 *           example: "http.server.duration"
 *
 *     NumberChartSeries:
 *       type: object
 *       required:
 *         - type
 *         - sourceId
 *         - aggFn
 *         - where
 *       properties:
 *         type:
 *           type: string
 *           enum: [number]
 *           example: "number"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query
 *           example: "65f5e4a3b9e77c001a567890"
 *         aggFn:
 *           $ref: '#/components/schemas/AggregationFunction'
 *           description: Aggregation function to apply to the field or metric value
 *           example: "count"
 *         level:
 *           type: number
 *           minimum: 0
 *           maximum: 1
 *           description: Percentile level for quantile aggregations (e.g., 0.95 for p95)
 *           example: 0.95
 *         field:
 *           type: string
 *           example: "duration"
 *         alias:
 *           type: string
 *           example: "Total Requests"
 *         where:
 *           type: string
 *           example: "service:api"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           example: "lucene"
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *         metricDataType:
 *           $ref: '#/components/schemas/MetricDataType'
 *           example: "sum"
 *         metricName:
 *           type: string
 *           example: "http.server.duration"
 *
 *     SearchChartSeries:
 *       type: object
 *       required:
 *         - type
 *         - sourceId
 *         - fields
 *         - where
 *       properties:
 *         type:
 *           type: string
 *           enum: [search]
 *           example: "search"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query
 *           example: "65f5e4a3b9e77c001a567890"
 *         fields:
 *           type: array
 *           items:
 *             type: string
 *           description: List of field names to display in the search results table
 *           example: ["timestamp", "level", "message"]
 *         where:
 *           type: string
 *           description: Filter query for the data (syntax depends on whereLanguage)
 *           example: "level:error"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           description: Query language for the where clause
 *           example: "lucene"
 *
 *     MarkdownChartSeries:
 *       type: object
 *       required:
 *         - type
 *         - content
 *       properties:
 *         type:
 *           type: string
 *           enum: [markdown]
 *           example: "markdown"
 *         content:
 *           type: string
 *           example: "# Dashboard Title\n\nThis is a markdown widget."
 *           maxLength: 100000
 *
 *     DashboardChartSeries:
 *       oneOf:
 *         - $ref: '#/components/schemas/TimeChartSeries'
 *         - $ref: '#/components/schemas/TableChartSeries'
 *         - $ref: '#/components/schemas/NumberChartSeries'
 *         - $ref: '#/components/schemas/SearchChartSeries'
 *         - $ref: '#/components/schemas/MarkdownChartSeries'
 *       discriminator:
 *         propertyName: type
 *         mapping:
 *           time: '#/components/schemas/TimeChartSeries'
 *           table: '#/components/schemas/TableChartSeries'
 *           number: '#/components/schemas/NumberChartSeries'
 *           search: '#/components/schemas/SearchChartSeries'
 *           markdown: '#/components/schemas/MarkdownChartSeries'
 *
 *     TileInput:
 *       type: object
 *       description: Dashboard tile/chart configuration for creation
 *       required:
 *         - name
 *         - x
 *         - y
 *         - w
 *         - h
 *         - series
 *       properties:
 *         name:
 *           type: string
 *           description: Display name for the tile
 *           example: "Error Rate"
 *         x:
 *           type: integer
 *           minimum: 0
 *           maximum: 23
 *           description: Horizontal position in the grid (0-based)
 *           example: 0
 *         y:
 *           type: integer
 *           minimum: 0
 *           description: Vertical position in the grid (0-based)
 *           example: 0
 *         w:
 *           type: integer
 *           minimum: 1
 *           maximum: 24
 *           description: Width in grid units
 *           example: 6
 *         h:
 *           type: integer
 *           minimum: 1
 *           description: Height in grid units
 *           example: 3
 *         asRatio:
 *           type: boolean
 *           description: Display two series as a ratio (series[0] / series[1])
 *           example: false
 *         series:
 *           type: array
 *           minItems: 1
 *           description: Data series to display in this tile (all must be the same type)
 *           items:
 *             $ref: '#/components/schemas/DashboardChartSeries'
 *
 *     Tile:
 *       allOf:
 *         - $ref: '#/components/schemas/TileInput'
 *         - type: object
 *           required:
 *             - id
 *           properties:
 *             id:
 *               type: string
 *               maxLength: 36
 *               example: "65f5e4a3b9e77c001a901234"
 *
 *     Dashboard:
 *       type: object
 *       description: Dashboard with tiles and configuration
 *       properties:
 *         id:
 *           type: string
 *           description: Dashboard ID
 *           example: "65f5e4a3b9e77c001a567890"
 *         name:
 *           type: string
 *           description: Dashboard name
 *           maxLength: 1024
 *           example: "Service Overview"
 *         tiles:
 *           type: array
 *           description: List of tiles/charts in the dashboard
 *           items:
 *             $ref: '#/components/schemas/Tile'
 *         tags:
 *           type: array
 *           description: Tags for organizing and filtering dashboards
 *           items:
 *             type: string
 *             maxLength: 32
 *           maxItems: 50
 *           example: ["production", "monitoring"]
 *
 *     CreateDashboardRequest:
 *       type: object
 *       required:
 *         - name
 *         - tiles
 *       properties:
 *         name:
 *           type: string
 *           maxLength: 1024
 *           example: "New Dashboard"
 *         tiles:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/TileInput'
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *             maxLength: 32
 *           maxItems: 50
 *           example: ["development"]
 *
 *     UpdateDashboardRequest:
 *       type: object
 *       required:
 *         - name
 *         - tiles
 *       properties:
 *         name:
 *           type: string
 *           maxLength: 1024
 *           example: "Updated Dashboard Name"
 *         tiles:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Tile'
 *           description: Tiles must include their IDs for updates. To add a new tile, generate a unique ID (max 36 chars).
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *             maxLength: 32
 *           maxItems: 50
 *           example: ["production", "updated"]
 *
 *     DashboardResponse:
 *       allOf:
 *         - $ref: '#/components/schemas/Dashboard'
 *
 *     DashboardResponseEnvelope:
 *       type: object
 *       properties:
 *         data:
 *           $ref: '#/components/schemas/DashboardResponse'
 *
 *     DashboardsListResponse:
 *       type: object
 *       properties:
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/DashboardResponse'
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
 *             examples:
 *               dashboards:
 *                 summary: Dashboards list response
 *                 value:
 *                   data:
 *                     - id: "65f5e4a3b9e77c001a567890"
 *                       name: "Infrastructure Monitoring"
 *                       tiles:
 *                         - id: "65f5e4a3b9e77c001a901234"
 *                           name: "Server CPU"
 *                           x: 0
 *                           y: 0
 *                           w: 6
 *                           h: 3
 *                           asRatio: false
 *                           series:
 *                             - type: "time"
 *                               sourceId: "65f5e4a3b9e77c001a111111"
 *                               aggFn: "avg"
 *                               field: "cpu.usage"
 *                               where: "host:server-01"
 *                               groupBy: []
 *                       tags: ["infrastructure", "monitoring"]
 *                     - id: "65f5e4a3b9e77c001a567891"
 *                       name: "API Monitoring"
 *                       tiles:
 *                         - id: "65f5e4a3b9e77c001a901235"
 *                           name: "API Errors"
 *                           x: 0
 *                           y: 0
 *                           w: 6
 *                           h: 3
 *                           series:
 *                             - type: "table"
 *                               sourceId: "65f5e4a3b9e77c001a111112"
 *                               aggFn: "count"
 *                               where: "level:error"
 *                               groupBy: ["service"]
 *                               sortOrder: "desc"
 *                       tags: ["api", "monitoring"]
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
 *               $ref: '#/components/schemas/DashboardResponseEnvelope'
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
 *                             sourceId: "65f5e4a3b9e77c001a111111"
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
 *                             sourceId: "65f5e4a3b9e77c001a111111"
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
 *                     series:
 *                       - type: "time"
 *                         sourceId: "65f5e4a3b9e77c001a111111"
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
 *                     series:
 *                       - type: "time"
 *                         sourceId: "65f5e4a3b9e77c001a111111"
 *                         aggFn: "count"
 *                         where: "service:backend"
 *                         groupBy: []
 *                   - name: "Error Distribution"
 *                     x: 6
 *                     y: 0
 *                     w: 6
 *                     h: 3
 *                     series:
 *                       - type: "table"
 *                         sourceId: "65f5e4a3b9e77c001a111111"
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
 *               $ref: '#/components/schemas/DashboardResponseEnvelope'
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
 *                         series:
 *                           - type: "time"
 *                             sourceId: "65f5e4a3b9e77c001a111111"
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
 *       '400':
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Could not find the following source IDs: 68fa86308aa879b977aa6af6"
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
      tiles: z.array(externalDashboardTileSchema),
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

      const missingSources = await getMissingSources(teamId, tiles);
      if (missingSources.length > 0) {
        return res.status(400).json({
          message: `Could not find the following source IDs: ${missingSources.join(
            ', ',
          )}`,
        });
      }

      const charts = tiles.map(tile => {
        const chartId = new ObjectId().toString();
        return translateExternalChartToTileConfig({
          ...tile,
          id: chartId,
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
 *                     series:
 *                       - type: "time"
 *                         sourceId: "65f5e4a3b9e77c001a111111"
 *                         aggFn: "count"
 *                         where: "level:error"
 *                         groupBy: []
 *                   - id: "new-tile-123"
 *                     name: "New Number Chart"
 *                     x: 6
 *                     y: 0
 *                     w: 6
 *                     h: 3
 *                     series:
 *                       - type: "number"
 *                         sourceId: "65f5e4a3b9e77c001a111111"
 *                         aggFn: "count"
 *                         where: "level:info"
 *                 tags: ["production", "updated"]
 *     responses:
 *       '200':
 *         description: Successfully updated dashboard
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardResponseEnvelope'
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
 *                         series:
 *                           - type: "time"
 *                             sourceId: "65f5e4a3b9e77c001a111111"
 *                             aggFn: "count"
 *                             where: "level:error"
 *                             groupBy: []
 *                       - id: "new-tile-123"
 *                         name: "New Number Chart"
 *                         x: 6
 *                         y: 0
 *                         w: 6
 *                         h: 3
 *                         series:
 *                           - type: "number"
 *                             sourceId: "65f5e4a3b9e77c001a111111"
 *                             aggFn: "count"
 *                             where: "level:info"
 *                     tags: ["production", "updated"]
 *       '400':
 *         description: Bad request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Could not find the following source IDs: 68fa86308aa879b977aa6af6"
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
      tiles: z.array(externalDashboardTileSchemaWithId),
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

      const missingSources = await getMissingSources(teamId, tiles);
      if (missingSources.length > 0) {
        return res.status(400).json({
          message: `Could not find the following source IDs: ${missingSources.join(
            ', ',
          )}`,
        });
      }

      // Convert external tiles to internal charts format
      const charts = tiles.map(translateExternalChartToTileConfig);

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
