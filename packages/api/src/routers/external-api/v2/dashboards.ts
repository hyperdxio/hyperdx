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
  translateExternalChartToTileConfig,
  translateExternalFilterToFilter,
} from '@/utils/externalApi';
import {
  ExternalDashboardFilter,
  externalDashboardFilterSchema,
  externalDashboardFilterSchemaWithId,
  ExternalDashboardFilterWithId,
  externalDashboardTileListSchema,
  ExternalDashboardTileWithId,
  objectIdSchema,
  tagsSchema,
} from '@/utils/zod';

import {
  convertToExternalDashboard,
  convertToInternalTileConfig,
  isConfigTile,
  isSeriesTile,
} from './utils/dashboards';

/** Returns an array of source IDs that are referenced in the tiles/filters but do not exist in the team's sources */
async function getMissingSources(
  team: string | mongoose.Types.ObjectId,
  tiles: ExternalDashboardTileWithId[],
  filters?: (ExternalDashboardFilter | ExternalDashboardFilterWithId)[],
): Promise<string[]> {
  const sourceIds = new Set<string>();

  for (const tile of tiles) {
    if (isSeriesTile(tile)) {
      for (const series of tile.series) {
        if ('sourceId' in series) {
          sourceIds.add(series.sourceId);
        }
      }
    } else if (isConfigTile(tile)) {
      if ('sourceId' in tile.config) {
        sourceIds.add(tile.config.sourceId);
      }
    }
  }

  if (filters?.length) {
    for (const filter of filters) {
      if ('sourceId' in filter) {
        sourceIds.add(filter.sourceId);
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
 *     QuantileLevel:
 *       type: number
 *       enum: [0.5, 0.90, 0.95, 0.99]
 *       description: Percentile level; only valid when aggFn is "quantile".
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
 *         - whereLanguage
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
 *         - whereLanguage
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
 *         - whereLanguage
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
 *         - whereLanguage
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
 *     SelectItem:
 *       type: object
 *       required:
 *         - aggFn
 *       description: >
 *         A single aggregated value to compute. The valueExpression must be
 *         omitted when aggFn is "count", and required for all other functions.
 *         The level field may only be used with aggFn "quantile".
 *       properties:
 *         aggFn:
 *           $ref: '#/components/schemas/AggregationFunction'
 *           description: >
 *             Aggregation function to apply. "count" does not require a valueExpression; "quantile" requires a level field indicating the desired percentile (e.g., 0.95).
 *           example: "count"
 *         valueExpression:
 *           type: string
 *           maxLength: 10000
 *           description: >
 *             Expression for the column or value to aggregate. Must be omitted when
 *             aggFn is "count"; required for all other aggFn values.
 *           example: "Duration"
 *         alias:
 *           type: string
 *           maxLength: 10000
 *           description: Display alias for this select item in chart legends.
 *           example: "Request Duration"
 *         level:
 *           $ref: '#/components/schemas/QuantileLevel'
 *         where:
 *           type: string
 *           maxLength: 10000
 *           description: SQL or Lucene filter condition applied before aggregation.
 *           default: ""
 *           example: "service:api"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *         metricName:
 *           type: string
 *           description: Name of the metric to aggregate; only applicable when the source is a metrics source.
 *         metricType:
 *           $ref: '#/components/schemas/MetricDataType'
 *           description: Metric type; only applicable when the source is a metrics source.
 *         periodAggFn:
 *           type: string
 *           enum: [delta]
 *           description: Optional period aggregation function for Gauge metrics (e.g., compute the delta over the period).
 *
 *     LineChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *       description: Configuration for a line time-series chart.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [line]
 *           example: "line"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query.
 *           example: "65f5e4a3b9e77c001a111111"
 *         select:
 *           type: array
 *           minItems: 1
 *           maxItems: 20
 *           description: >
 *             One or more aggregated values to plot. When asRatio is true,
 *             exactly two select items are required.
 *           items:
 *             $ref: '#/components/schemas/SelectItem'
 *         groupBy:
 *           type: string
 *           description: Field expression to group results by (creates separate lines per group value).
 *           example: "host"
 *           maxLength: 10000
 *         asRatio:
 *           type: boolean
 *           description: Plot select[0] / select[1] as a ratio. Requires exactly two select items.
 *           default: false
 *         alignDateRangeToGranularity:
 *           type: boolean
 *           description: Expand date range boundaries to the query granularity interval.
 *           default: true
 *         fillNulls:
 *           type: boolean
 *           description: Fill missing time buckets with zero instead of leaving gaps.
 *           default: true
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *         compareToPreviousPeriod:
 *           type: boolean
 *           description: Overlay the equivalent previous time period for comparison.
 *           default: false
 *
 *     BarChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *       description: Configuration for a stacked-bar time-series chart.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [stacked_bar]
 *           example: "stacked_bar"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query.
 *           example: "65f5e4a3b9e77c001a111111"
 *         select:
 *           type: array
 *           minItems: 1
 *           maxItems: 20
 *           description: >
 *             One or more aggregated values to plot. When asRatio is true,
 *             exactly two select items are required.
 *           items:
 *             $ref: '#/components/schemas/SelectItem'
 *         groupBy:
 *           type: string
 *           description: Field expression to group results by (creates separate bars segments per group value).
 *           example: "service"
 *           maxLength: 10000
 *         asRatio:
 *           type: boolean
 *           description: Plot select[0] / select[1] as a ratio. Requires exactly two select items.
 *           default: false
 *         alignDateRangeToGranularity:
 *           type: boolean
 *           description: Align the date range boundaries to the query granularity interval.
 *           default: true
 *         fillNulls:
 *           type: boolean
 *           description: Fill missing time buckets with zero instead of leaving gaps.
 *           default: true
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *
 *     TableChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *       description: Configuration for a table aggregation chart.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [table]
 *           example: "table"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query.
 *           example: "65f5e4a3b9e77c001a111111"
 *         select:
 *           type: array
 *           minItems: 1
 *           maxItems: 20
 *           description: >
 *             One or more aggregated values to display as table columns.
 *             When asRatio is true, exactly two select items are required.
 *           items:
 *             $ref: '#/components/schemas/SelectItem'
 *         groupBy:
 *           type: string
 *           maxLength: 10000
 *           description: Field expression to group results by (one row per group value).
 *           example: "service"
 *         having:
 *           type: string
 *           maxLength: 10000
 *           description: Post-aggregation SQL HAVING condition.
 *           example: "count > 100"
 *         orderBy:
 *           type: string
 *           maxLength: 10000
 *           description: SQL ORDER BY expression for sorting table rows.
 *           example: "count DESC"
 *         asRatio:
 *           type: boolean
 *           description: Display select[0] / select[1] as a ratio. Requires exactly two select items.
 *           example: false
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *
 *     NumberChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *       description: Configuration for a single big-number chart.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [number]
 *           example: "number"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query.
 *           example: "65f5e4a3b9e77c001a111111"
 *         select:
 *           type: array
 *           minItems: 1
 *           maxItems: 1
 *           description: Exactly one aggregated value to display as a single number.
 *           items:
 *             $ref: '#/components/schemas/SelectItem'
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *
 *     PieChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *       description: Configuration for a pie chart tile. Each slice represents one group value.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [pie]
 *           example: "pie"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query.
 *           example: "65f5e4a3b9e77c001a111111"
 *         select:
 *           type: array
 *           minItems: 1
 *           maxItems: 1
 *           description: Exactly one aggregated value used to size each pie slice.
 *           items:
 *             $ref: '#/components/schemas/SelectItem'
 *         groupBy:
 *           type: string
 *           maxLength: 10000
 *           description: Field expression to group results by (one slice per group value).
 *           example: "service"
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *
 *     SearchChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *         - whereLanguage
 *       description: Configuration for a raw-event search / log viewer tile.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [search]
 *           example: "search"
 *         sourceId:
 *           type: string
 *           description: ID of the data source to query.
 *           example: "65f5e4a3b9e77c001a111111"
 *         select:
 *           type: string
 *           maxLength: 10000
 *           description: Comma-separated list of expressions to display.
 *           example: "timestamp, level, message"
 *         where:
 *           type: string
 *           maxLength: 10000
 *           description: Filter condition for the search (syntax depends on whereLanguage).
 *           default: ""
 *           example: "level:error"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *
 *     MarkdownChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *       description: Configuration for a freeform Markdown text tile.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [markdown]
 *           example: "markdown"
 *         markdown:
 *           type: string
 *           maxLength: 50000
 *           description: Markdown content to render inside the tile.
 *           example: "# Dashboard Title\n\nThis is a markdown widget."
 *
 *     TileConfig:
 *       description: >
 *         Tile chart configuration. The displayType field determines which
 *         variant is used.
 *       oneOf:
 *         - $ref: '#/components/schemas/LineChartConfig'
 *         - $ref: '#/components/schemas/BarChartConfig'
 *         - $ref: '#/components/schemas/TableChartConfig'
 *         - $ref: '#/components/schemas/NumberChartConfig'
 *         - $ref: '#/components/schemas/PieChartConfig'
 *         - $ref: '#/components/schemas/SearchChartConfig'
 *         - $ref: '#/components/schemas/MarkdownChartConfig'
 *       discriminator:
 *         propertyName: displayType
 *         mapping:
 *           line: '#/components/schemas/LineChartConfig'
 *           stacked_bar: '#/components/schemas/BarChartConfig'
 *           table: '#/components/schemas/TableChartConfig'
 *           number: '#/components/schemas/NumberChartConfig'
 *           pie: '#/components/schemas/PieChartConfig'
 *           search: '#/components/schemas/SearchChartConfig'
 *           markdown: '#/components/schemas/MarkdownChartConfig'
 *
 *     TileBase:
 *       type: object
 *       description: Common fields shared by tile input and output
 *       required:
 *         - name
 *         - x
 *         - y
 *         - w
 *         - h
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
 *         config:
 *           $ref: '#/components/schemas/TileConfig'
 *           description: Chart configuration for the tile. The displayType field determines which variant is used. Replaces the deprecated "series" and "asRatio" fields.
 *
 *     TileOutput:
 *       description: Response format for dashboard tiles
 *       allOf:
 *         - $ref: '#/components/schemas/TileBase'
 *         - type: object
 *           required:
 *             - id
 *           properties:
 *             id:
 *               type: string
 *               maxLength: 36
 *               example: "65f5e4a3b9e77c001a901234"
 *
 *     TileInput:
 *       description: >
 *         Input / request format when creating or updating tiles. The id field is
 *         optional: on create it is ignored (the server always assigns a new ID);
 *         on update, a matching id is used to identify the existing tile to
 *         preserve — tiles whose id does not match an existing tile are assigned
 *         a new generated ID.
 *       allOf:
 *         - $ref: '#/components/schemas/TileBase'
 *         - type: object
 *           properties:
 *             id:
 *               type: string
 *               maxLength: 36
 *               description: Optional tile ID. Omit to generate a new ID.
 *               example: "65f5e4a3b9e77c001a901234"
 *             asRatio:
 *               type: boolean
 *               description: Display two series as a ratio (series[0] / series[1]). Only applicable when providing "series". Deprecated in favor of "config.asRatio".
 *               example: false
 *               deprecated: true
 *             series:
 *               type: array
 *               minItems: 1
 *               description: Data series to display in this tile (all must be the same type). Deprecated; use "config" instead.
 *               deprecated: true
 *               items:
 *                 $ref: '#/components/schemas/DashboardChartSeries'
 *
 *     FilterInput:
 *       type: object
 *       description: Dashboard filter key that can be added to a dashboard
 *       required:
 *         - type
 *         - name
 *         - expression
 *         - sourceId
 *       properties:
 *         type:
 *           type: string
 *           enum: [QUERY_EXPRESSION]
 *         name:
 *           type: string
 *           minLength: 1
 *           description: Display name for the dashboard filter key
 *         expression:
 *           type: string
 *           minLength: 1
 *           description: Key expression used when applying this dashboard filter key
 *         sourceId:
 *           type: string
 *           description: Source ID this dashboard filter key applies to
 *         sourceMetricType:
 *           type: string
 *           enum: [sum, gauge, histogram, summary, exponential histogram]
 *           description: Metric type when source is metrics
 *
 *     Filter:
 *       allOf:
 *         - $ref: '#/components/schemas/FilterInput'
 *         - type: object
 *           required:
 *             - id
 *           properties:
 *             id:
 *               type: string
 *               description: Unique dashboard filter key ID
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
 *             $ref: '#/components/schemas/TileOutput'
 *         tags:
 *           type: array
 *           description: Tags for organizing and filtering dashboards
 *           items:
 *             type: string
 *             maxLength: 32
 *           maxItems: 50
 *           example: ["production", "monitoring"]
 *         filters:
 *           type: array
 *           description: Dashboard filter keys added to the dashboard and applied to all tiles
 *           items:
 *             $ref: '#/components/schemas/Filter'
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
 *         filters:
 *           type: array
 *           description: Dashboard filter keys to add to the dashboard and apply across all tiles
 *           items:
 *             $ref: '#/components/schemas/FilterInput'
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
 *             $ref: '#/components/schemas/TileInput'
 *           description: Full list of tiles for the dashboard. Existing tiles are matched by ID; tiles with an ID that does not match an existing tile will be assigned a new generated ID.
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *             maxLength: 32
 *           maxItems: 50
 *           example: ["production", "updated"]
 *         filters:
 *           type: array
 *           description: Dashboard filter keys on the dashboard, applied across all tiles
 *           items:
 *             $ref: '#/components/schemas/Filter'
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
 *                           config:
 *                             displayType: "line"
 *                             sourceId: "65f5e4a3b9e77c001a111111"
 *                             select:
 *                               - aggFn: "avg"
 *                                 valueExpression: "cpu.usage"
 *                                 where: "host:server-01"
 *                       tags: ["infrastructure", "monitoring"]
 *                       filters:
 *                         - id: "65f5e4a3b9e77c001a301001"
 *                           type: "QUERY_EXPRESSION"
 *                           name: "Environment"
 *                           expression: "environment"
 *                           sourceId: "65f5e4a3b9e77c001a111111"
 *                     - id: "65f5e4a3b9e77c001a567891"
 *                       name: "API Monitoring"
 *                       tiles:
 *                         - id: "65f5e4a3b9e77c001a901235"
 *                           name: "API Errors"
 *                           x: 0
 *                           y: 0
 *                           w: 6
 *                           h: 3
 *                           config:
 *                             displayType: "table"
 *                             sourceId: "65f5e4a3b9e77c001a111112"
 *                             select:
 *                               - aggFn: "count"
 *                                 where: "level:error"
 *                             groupBy: "service"
 *                             orderBy: "count DESC"
 *                       tags: ["api", "monitoring"]
 *                       filters:
 *                         - id: "65f5e4a3b9e77c001a301002"
 *                           type: "QUERY_EXPRESSION"
 *                           name: "Service"
 *                           expression: "service_name"
 *                           sourceId: "65f5e4a3b9e77c001a111112"
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
      { _id: 1, name: 1, tiles: 1, tags: 1, filters: 1 },
    ).sort({ name: -1 });

    res.json({
      data: dashboards.map(d => convertToExternalDashboard(d)),
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
 *                         config:
 *                           displayType: "line"
 *                           sourceId: "65f5e4a3b9e77c001a111111"
 *                           select:
 *                             - aggFn: "avg"
 *                               valueExpression: "cpu.usage"
 *                               where: "host:server-01"
 *                       - id: "65f5e4a3b9e77c001a901235"
 *                         name: "Memory Usage"
 *                         x: 6
 *                         y: 0
 *                         w: 6
 *                         h: 3
 *                         config:
 *                           displayType: "line"
 *                           sourceId: "65f5e4a3b9e77c001a111111"
 *                           select:
 *                             - aggFn: "avg"
 *                               valueExpression: "memory.usage"
 *                               where: "host:server-01"
 *                     tags: ["infrastructure", "monitoring"]
 *                     filters:
 *                       - id: "65f5e4a3b9e77c001a301003"
 *                         type: "QUERY_EXPRESSION"
 *                         name: "Environment"
 *                         expression: "environment"
 *                         sourceId: "65f5e4a3b9e77c001a111111"
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
        { _id: 1, name: 1, tiles: 1, tags: 1, filters: 1 },
      );

      if (dashboard == null) {
        return res.sendStatus(404);
      }

      res.json({
        data: convertToExternalDashboard(dashboard),
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
 *               summary: Dashboard with a line chart
 *               value:
 *                 name: "API Monitoring Dashboard"
 *                 tiles:
 *                   - name: "API Request Volume"
 *                     x: 0
 *                     y: 0
 *                     w: 6
 *                     h: 3
 *                     config:
 *                       displayType: "line"
 *                       sourceId: "65f5e4a3b9e77c001a111111"
 *                       select:
 *                         - aggFn: "count"
 *                           where: "service:api"
 *                 tags: ["api", "monitoring"]
 *                 filters:
 *                   - type: "QUERY_EXPRESSION"
 *                     name: "Environment"
 *                     expression: "environment"
 *                     sourceId: "65f5e4a3b9e77c001a111111"
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
 *                     config:
 *                       displayType: "line"
 *                       sourceId: "65f5e4a3b9e77c001a111111"
 *                       select:
 *                         - aggFn: "count"
 *                           where: "service:backend"
 *                   - name: "Error Distribution"
 *                     x: 6
 *                     y: 0
 *                     w: 6
 *                     h: 3
 *                     config:
 *                       displayType: "table"
 *                       sourceId: "65f5e4a3b9e77c001a111111"
 *                       select:
 *                         - aggFn: "count"
 *                           where: "level:error"
 *                       groupBy: "errorType"
 *                       orderBy: "count DESC"
 *                 tags: ["service-health", "production"]
 *                 filters:
 *                   - type: "QUERY_EXPRESSION"
 *                     name: "Service"
 *                     expression: "service_name"
 *                     sourceId: "65f5e4a3b9e77c001a111111"
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
 *                         config:
 *                           displayType: "line"
 *                           sourceId: "65f5e4a3b9e77c001a111111"
 *                           select:
 *                             - aggFn: "count"
 *                               where: "service:api"
 *                     tags: ["api", "monitoring"]
 *                     filters:
 *                       - id: "65f5e4a3b9e77c001a301004"
 *                         type: "QUERY_EXPRESSION"
 *                         name: "Environment"
 *                         expression: "environment"
 *                         sourceId: "65f5e4a3b9e77c001a111111"
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
      tiles: externalDashboardTileListSchema,
      tags: tagsSchema,
      filters: z.array(externalDashboardFilterSchema).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const { name, tiles, tags, filters } = req.body;

      const missingSources = await getMissingSources(teamId, tiles, filters);
      if (missingSources.length > 0) {
        return res.status(400).json({
          message: `Could not find the following source IDs: ${missingSources.join(
            ', ',
          )}`,
        });
      }

      const internalTiles = tiles.map(tile => {
        const tileId = new ObjectId().toString();
        if (isConfigTile(tile)) {
          return convertToInternalTileConfig({
            ...tile,
            id: tileId,
          });
        }

        return translateExternalChartToTileConfig({
          ...tile,
          id: tileId,
        });
      });

      const filtersWithIds = (filters || []).map(filter =>
        translateExternalFilterToFilter({
          ...filter,
          id: new ObjectId().toString(),
        }),
      );

      const newDashboard = await new Dashboard({
        name,
        tiles: internalTiles,
        tags: tags && uniq(tags),
        filters: filtersWithIds,
        team: teamId,
      }).save();

      res.json({
        data: convertToExternalDashboard(newDashboard),
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
 *                     name: "Updated Line Chart"
 *                     x: 0
 *                     y: 0
 *                     w: 6
 *                     h: 3
 *                     config:
 *                       displayType: "line"
 *                       sourceId: "65f5e4a3b9e77c001a111111"
 *                       select:
 *                         - aggFn: "count"
 *                           where: "level:error"
 *                   - id: "new-tile-123"
 *                     name: "New Number Chart"
 *                     x: 6
 *                     y: 0
 *                     w: 6
 *                     h: 3
 *                     config:
 *                       displayType: "number"
 *                       sourceId: "65f5e4a3b9e77c001a111111"
 *                       select:
 *                         - aggFn: "count"
 *                           where: "level:info"
 *                 tags: ["production", "updated"]
 *                 filters:
 *                   - id: "65f5e4a3b9e77c001a301005"
 *                     type: "QUERY_EXPRESSION"
 *                     name: "Environment"
 *                     expression: "environment"
 *                     sourceId: "65f5e4a3b9e77c001a111111"
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
 *                         name: "Updated Line Chart"
 *                         x: 0
 *                         y: 0
 *                         w: 6
 *                         h: 3
 *                         config:
 *                           displayType: "line"
 *                           sourceId: "65f5e4a3b9e77c001a111111"
 *                           select:
 *                             - aggFn: "count"
 *                               where: "level:error"
 *                       - id: "new-tile-123"
 *                         name: "New Number Chart"
 *                         x: 6
 *                         y: 0
 *                         w: 6
 *                         h: 3
 *                         config:
 *                           displayType: "number"
 *                           sourceId: "65f5e4a3b9e77c001a111111"
 *                           select:
 *                             - aggFn: "count"
 *                               where: "level:info"
 *                     tags: ["production", "updated"]
 *                     filters:
 *                       - id: "65f5e4a3b9e77c001a301005"
 *                         type: "QUERY_EXPRESSION"
 *                         name: "Environment"
 *                         expression: "environment"
 *                         sourceId: "65f5e4a3b9e77c001a111111"
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
      tiles: externalDashboardTileListSchema,
      tags: tagsSchema,
      filters: z.array(externalDashboardFilterSchemaWithId).optional(),
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

      const { name, tiles, tags, filters } = req.body ?? {};

      const missingSources = await getMissingSources(teamId, tiles, filters);
      if (missingSources.length > 0) {
        return res.status(400).json({
          message: `Could not find the following source IDs: ${missingSources.join(
            ', ',
          )}`,
        });
      }

      const existingDashboard = await Dashboard.findOne(
        { _id: dashboardId, team: teamId },
        { tiles: 1, filters: 1 },
      ).lean();
      const existingTileIds = new Set(
        (existingDashboard?.tiles ?? []).map((t: { id: string }) => t.id),
      );
      const existingFilterIds = new Set(
        (existingDashboard?.filters ?? []).map((f: { id: string }) => f.id),
      );

      // Convert external tiles to internal charts format.
      // Generate a new id for any tile whose id doesn't match an existing tile.
      const internalTiles = tiles.map(tile => {
        const tileId = existingTileIds.has(tile.id)
          ? tile.id
          : new ObjectId().toString();
        if (isConfigTile(tile)) {
          return convertToInternalTileConfig({ ...tile, id: tileId });
        }

        return translateExternalChartToTileConfig({ ...tile, id: tileId });
      });

      const setPayload: Record<string, unknown> = {
        name,
        tiles: internalTiles,
        tags: tags && uniq(tags),
      };
      if (filters !== undefined) {
        setPayload.filters = filters.map(
          (filter: ExternalDashboardFilterWithId) => {
            const filterId = existingFilterIds.has(filter.id)
              ? filter.id
              : new ObjectId().toString();
            return translateExternalFilterToFilter({ ...filter, id: filterId });
          },
        );
      }

      const updatedDashboard = await Dashboard.findOneAndUpdate(
        { _id: dashboardId, team: teamId },
        { $set: setPayload },
        { new: true },
      );

      if (updatedDashboard == null) {
        return res.sendStatus(404);
      }

      res.json({
        data: convertToExternalDashboard(updatedDashboard),
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
