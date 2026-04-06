import { isRawSqlSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import { SearchConditionLanguageSchema as whereLanguageSchema } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { uniq } from 'lodash';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import { z } from 'zod';

import { deleteDashboardAlerts } from '@/controllers/alerts';
import { getConnectionsByTeam } from '@/controllers/connection';
import { deleteDashboard } from '@/controllers/dashboard';
import { getSources } from '@/controllers/sources';
import Dashboard from '@/models/dashboard';
import { validateRequestWithEnhancedErrors as validateRequest } from '@/utils/enhancedErrors';
import {
  translateExternalChartToTileConfig,
  translateExternalFilterToFilter,
} from '@/utils/externalApi';
import logger from '@/utils/logger';
import {
  ExternalDashboardFilter,
  externalDashboardFilterSchema,
  externalDashboardFilterSchemaWithId,
  ExternalDashboardFilterWithId,
  externalDashboardSavedFilterValueSchema,
  externalDashboardTileListSchema,
  ExternalDashboardTileWithId,
  objectIdSchema,
  tagsSchema,
} from '@/utils/zod';

import {
  convertToExternalDashboard,
  convertToInternalTileConfig,
  isConfigTile,
  isRawSqlExternalTileConfig,
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
      if ('sourceId' in tile.config && tile.config.sourceId) {
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

/** Returns an array of connection IDs that are referenced in the tiles but do not belong to the team */
async function getMissingConnections(
  team: string | mongoose.Types.ObjectId,
  tiles: ExternalDashboardTileWithId[],
): Promise<string[]> {
  const connectionIds = new Set<string>();

  for (const tile of tiles) {
    if (isConfigTile(tile) && isRawSqlExternalTileConfig(tile.config)) {
      connectionIds.add(tile.config.connectionId);
    }
  }

  if (connectionIds.size === 0) return [];

  const existingConnections = await getConnectionsByTeam(team.toString());
  const existingConnectionIds = new Set(
    existingConnections.map(connection => connection._id.toString()),
  );

  return [...connectionIds].filter(
    connectionId => !existingConnectionIds.has(connectionId),
  );
}

async function getSourceConnectionMismatches(
  team: string | mongoose.Types.ObjectId,
  tiles: ExternalDashboardTileWithId[],
): Promise<string[]> {
  const existingSources = await getSources(team.toString());
  const sourceById = new Map(existingSources.map(s => [s._id.toString(), s]));

  const sourcesWithInvalidConnections: string[] = [];
  for (const tile of tiles) {
    if (
      isConfigTile(tile) &&
      isRawSqlExternalTileConfig(tile.config) &&
      tile.config.sourceId
    ) {
      const source = sourceById.get(tile.config.sourceId);
      if (source && source.connection.toString() !== tile.config.connectionId) {
        sourcesWithInvalidConnections.push(tile.config.sourceId);
      }
    }
  }

  return sourcesWithInvalidConnections;
}

type SavedQueryLanguage = z.infer<typeof whereLanguageSchema>;

function resolveSavedQueryLanguage(params: {
  savedQuery: string | null | undefined;
  savedQueryLanguage: SavedQueryLanguage | null | undefined;
}): SavedQueryLanguage | null | undefined {
  const { savedQuery, savedQueryLanguage } = params;
  if (savedQueryLanguage !== undefined) return savedQueryLanguage;
  if (savedQuery === null) return null;
  if (savedQuery) return 'lucene';

  return undefined;
}

const dashboardBodyBaseShape = {
  name: z.string().max(1024),
  tiles: externalDashboardTileListSchema,
  tags: tagsSchema,
  savedQuery: z.string().nullable().optional(),
  savedQueryLanguage: whereLanguageSchema.nullable().optional(),
  savedFilterValues: z
    .array(externalDashboardSavedFilterValueSchema)
    .optional(),
};

function buildDashboardBodySchema(filterSchema: z.ZodTypeAny): z.ZodEffects<
  z.ZodObject<
    typeof dashboardBodyBaseShape & {
      filters: z.ZodOptional<z.ZodArray<z.ZodTypeAny>>;
    }
  >
> {
  return z
    .object({
      ...dashboardBodyBaseShape,
      filters: z.array(filterSchema).optional(),
    })
    .superRefine((data, ctx) => {
      if (data.savedQuery != null && data.savedQueryLanguage === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'savedQueryLanguage cannot be null when savedQuery is provided',
          path: ['savedQueryLanguage'],
        });
      }
    });
}

const createDashboardBodySchema = buildDashboardBodySchema(
  externalDashboardFilterSchema,
);
const updateDashboardBodySchema = buildDashboardBodySchema(
  externalDashboardFilterSchemaWithId,
);

/**
 * @openapi
 * components:
 *   schemas:
 *     NumberFormatOutput:
 *       type: string
 *       enum: [currency, percent, byte, time, number, data_rate, throughput]
 *       description: Output format type (currency, percent, byte, time, number, data_rate, throughput).
 *     AggregationFunction:
 *       type: string
 *       enum: [avg, count, count_distinct, last_value, max, min, quantile, sum, any, none]
 *       description: Aggregation function to apply to the field or metric value.
 *     QueryLanguage:
 *       type: string
 *       enum: [sql, lucene]
 *       description: Query language for the where clause.
 *     SavedFilterValue:
 *       type: object
 *       required: [condition]
 *       properties:
 *         type:
 *           type: string
 *           enum: [sql]
 *           default: sql
 *           description: Filter type. Currently only "sql" is supported.
 *           example: "sql"
 *         condition:
 *           type: string
 *           description: SQL filter condition. For example use expressions in the form "column IN ('value')".
 *           example: "ServiceName IN ('hdx-oss-dev-api')"
 *     MetricDataType:
 *       type: string
 *       enum: [sum, gauge, histogram, summary, exponential histogram]
 *       description: Metric data type, only for metrics data sources.
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
 *           description: Output format applied to the number.
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
 *         numericUnit:
 *           type: string
 *           enum: [bytes_iec, bytes_si, bits_iec, bits_si, kibibytes, kilobytes, mebibytes, megabytes, gibibytes, gigabytes, tebibytes, terabytes, pebibytes, petabytes, packets_sec, bytes_sec_iec, bytes_sec_si, bits_sec_iec, bits_sec_si, kibibytes_sec, kibibits_sec, kilobytes_sec, kilobits_sec, mebibytes_sec, mebibits_sec, megabytes_sec, megabits_sec, gibibytes_sec, gibibits_sec, gigabytes_sec, gigabits_sec, tebibytes_sec, tebibits_sec, terabytes_sec, terabits_sec, pebibytes_sec, pebibits_sec, petabytes_sec, petabits_sec, cps, ops, rps, reads_sec, wps, iops, cpm, opm, rpm_reads, wpm]
 *           description: Numeric unit for data, data rate, or throughput formats.
 *           example: "bytes_iec"
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
 *           description: Series type discriminator. Must be "time" for time-series charts.
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
 *           description: Column or expression to aggregate (required for most aggregation functions except count)
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
 *           description: Number formatting options for displayed values.
 *         metricDataType:
 *           $ref: '#/components/schemas/MetricDataType'
 *           description: Metric data type, only for metrics data sources.
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
 *           description: Series type discriminator. Must be "table" for table charts.
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
 *           description: Column or expression to aggregate (required for most aggregation functions except count)
 *           example: "duration"
 *         alias:
 *           type: string
 *           description: Display name for the series
 *           example: "Total Count"
 *         where:
 *           type: string
 *           description: Filter query for the data (syntax depends on whereLanguage)
 *           example: "level:error"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           description: Query language for the where clause
 *           example: "lucene"
 *         groupBy:
 *           type: array
 *           items:
 *             type: string
 *           maxItems: 10
 *           description: Fields to group results by (creates separate rows for each group)
 *           example: ["errorType"]
 *         sortOrder:
 *           $ref: '#/components/schemas/SortOrder'
 *           description: Sort order for table rows
 *           example: "desc"
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *           description: Number formatting options for displayed values.
 *         metricDataType:
 *           $ref: '#/components/schemas/MetricDataType'
 *           description: Metric data type, only for metrics data sources.
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
 *           description: Series type discriminator. Must be "number" for single-value number charts.
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
 *           description: Column or expression to aggregate (required for most aggregation functions except count)
 *           example: "duration"
 *         alias:
 *           type: string
 *           description: Display name for the series in the chart
 *           example: "Total Requests"
 *         where:
 *           type: string
 *           description: Filter query for the data (syntax depends on whereLanguage)
 *           example: "service:api"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           description: Query language for the where clause
 *           example: "lucene"
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *           description: Number formatting options for displayed values.
 *         metricDataType:
 *           $ref: '#/components/schemas/MetricDataType'
 *           description: Metric data type, only for metrics data sources.
 *           example: "sum"
 *         metricName:
 *           type: string
 *           description: Metric name for metrics data sources.
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
 *           description: Series type discriminator. Must be "search" for search/log viewer charts.
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
 *           description: Series type discriminator. Must be "markdown" for markdown text widgets.
 *           example: "markdown"
 *         content:
 *           type: string
 *           description: Markdown content to render inside the widget.
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
 *           description: Percentile level; only valid when aggFn is "quantile".
 *         where:
 *           type: string
 *           maxLength: 10000
 *           description: SQL or Lucene filter condition applied before aggregation.
 *           default: ""
 *           example: "service:api"
 *         whereLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           description: Query language for the where clause.
 *         metricName:
 *           type: string
 *           description: Name of the metric to aggregate; only applicable when the source is a metrics source.
 *           example: "http.server.duration"
 *         metricType:
 *           $ref: '#/components/schemas/MetricDataType'
 *           description: Metric type; only applicable when the source is a metrics source.
 *         periodAggFn:
 *           type: string
 *           enum: [delta]
 *           description: Optional period aggregation function for Gauge metrics (e.g., compute the delta over the period).
 *           example: "delta"
 *
 *     LineBuilderChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *       description: Builder configuration for a line time-series chart.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [line]
 *           description: Display type discriminator. Must be "line" for line charts.
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
 *           description: Number formatting options for displayed values.
 *         compareToPreviousPeriod:
 *           type: boolean
 *           description: Overlay the equivalent previous time period for comparison.
 *           default: false
 *
 *     BarBuilderChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *       description: Builder configuration for a stacked-bar time-series chart.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [stacked_bar]
 *           description: Display type discriminator. Must be "stacked_bar" for stacked-bar charts.
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
 *           description: Number formatting options for displayed values.
 *
 *     TableBuilderChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *       description: Builder configuration for a table aggregation chart.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [table]
 *           description: Display type discriminator. Must be "table" for table charts.
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
 *           description: Number formatting options for displayed values.
 *
 *     NumberBuilderChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *       description: Builder configuration for a single big-number chart.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [number]
 *           description: Display type discriminator. Must be "number" for single big-number charts.
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
 *           description: Number formatting options for displayed values.
 *
 *     PieBuilderChartConfig:
 *       type: object
 *       required:
 *         - displayType
 *         - sourceId
 *         - select
 *       description: Builder configuration for a pie chart tile. Each slice represents one group value.
 *       properties:
 *         displayType:
 *           type: string
 *           enum: [pie]
 *           description: Display type discriminator. Must be "pie" for pie charts.
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
 *           description: Number formatting options for displayed values.
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
 *           description: Display type discriminator. Must be "search" for search/log viewer tiles.
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
 *           description: Query language for the where clause.
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
 *           description: Display type discriminator. Must be "markdown" for markdown text tiles.
 *           example: "markdown"
 *         markdown:
 *           type: string
 *           maxLength: 50000
 *           description: Markdown content to render inside the tile.
 *           example: "# Dashboard Title\n\nThis is a markdown widget."
 *
 *     RawSqlChartConfigBase:
 *       type: object
 *       required:
 *         - configType
 *         - connectionId
 *         - sqlTemplate
 *       description: Shared fields for Raw SQL chart configs. Set configType to "sql" and provide connectionId + sqlTemplate instead of sourceId + select.
 *       properties:
 *         configType:
 *           type: string
 *           enum: [sql]
 *           description: Must be "sql" to use the Raw SQL chart config variant.
 *           example: "sql"
 *         connectionId:
 *           type: string
 *           description: ID of the ClickHouse connection to execute the query against.
 *           example: "65f5e4a3b9e77c001a567890"
 *         sqlTemplate:
 *           type: string
 *           maxLength: 100000
 *           description: SQL query template to execute. Supports HyperDX template variables.
 *           example: "SELECT count() FROM otel_logs WHERE timestamp > now() - INTERVAL 1 HOUR"
 *         sourceId:
 *           type: string
 *           description: Optional ID of the data source associated with this Raw SQL chart. Used for applying dashboard filters.
 *           example: "65f5e4a3b9e77c001a567890"
 *         numberFormat:
 *           $ref: '#/components/schemas/NumberFormat'
 *           description: Number formatting options for displayed values.
 *
 *     LineRawSqlChartConfig:
 *       description: Raw SQL configuration for a line time-series chart.
 *       allOf:
 *         - $ref: '#/components/schemas/RawSqlChartConfigBase'
 *         - type: object
 *           required:
 *             - displayType
 *           properties:
 *             displayType:
 *               type: string
 *               enum: [line]
 *               description: Display as a line time-series chart.
 *               example: "line"
 *             compareToPreviousPeriod:
 *               type: boolean
 *               description: Overlay the equivalent previous time period for comparison.
 *               default: false
 *             fillNulls:
 *               type: boolean
 *               description: Fill missing time buckets with zero instead of leaving gaps.
 *               default: true
 *             alignDateRangeToGranularity:
 *               type: boolean
 *               description: Expand date range boundaries to the query granularity interval.
 *               default: true
 *
 *     BarRawSqlChartConfig:
 *       description: Raw SQL configuration for a stacked-bar time-series chart.
 *       allOf:
 *         - $ref: '#/components/schemas/RawSqlChartConfigBase'
 *         - type: object
 *           required:
 *             - displayType
 *           properties:
 *             displayType:
 *               type: string
 *               enum: [stacked_bar]
 *               description: Display as a stacked-bar time-series chart.
 *               example: "stacked_bar"
 *             fillNulls:
 *               type: boolean
 *               description: Fill missing time buckets with zero instead of leaving gaps.
 *               default: true
 *             alignDateRangeToGranularity:
 *               type: boolean
 *               description: Expand date range boundaries to the query granularity interval.
 *               default: true
 *
 *     TableRawSqlChartConfig:
 *       description: Raw SQL configuration for a table chart.
 *       allOf:
 *         - $ref: '#/components/schemas/RawSqlChartConfigBase'
 *         - type: object
 *           required:
 *             - displayType
 *           properties:
 *             displayType:
 *               type: string
 *               enum: [table]
 *               description: Display as a table chart.
 *               example: "table"
 *
 *     NumberRawSqlChartConfig:
 *       description: Raw SQL configuration for a single big-number chart.
 *       allOf:
 *         - $ref: '#/components/schemas/RawSqlChartConfigBase'
 *         - type: object
 *           required:
 *             - displayType
 *           properties:
 *             displayType:
 *               type: string
 *               enum: [number]
 *               description: Display as a single big-number chart.
 *               example: "number"
 *
 *     PieRawSqlChartConfig:
 *       description: Raw SQL configuration for a pie chart.
 *       allOf:
 *         - $ref: '#/components/schemas/RawSqlChartConfigBase'
 *         - type: object
 *           required:
 *             - displayType
 *           properties:
 *             displayType:
 *               type: string
 *               enum: [pie]
 *               description: Display as a pie chart.
 *               example: "pie"
 *
 *     LineChartConfig:
 *       description: >
 *         Line chart. Omit configType for the builder variant (requires sourceId
 *         and select). Set configType to "sql" for the Raw SQL variant (requires
 *         connectionId and sqlTemplate).
 *       oneOf:
 *         - $ref: '#/components/schemas/LineBuilderChartConfig'
 *         - $ref: '#/components/schemas/LineRawSqlChartConfig'
 *       discriminator:
 *         propertyName: configType
 *         mapping:
 *           sql: '#/components/schemas/LineRawSqlChartConfig'
 *
 *     BarChartConfig:
 *       description: >
 *         Stacked-bar chart. Omit configType for the builder variant (requires
 *         sourceId and select). Set configType to "sql" for the Raw SQL variant
 *         (requires connectionId and sqlTemplate).
 *       oneOf:
 *         - $ref: '#/components/schemas/BarBuilderChartConfig'
 *         - $ref: '#/components/schemas/BarRawSqlChartConfig'
 *       discriminator:
 *         propertyName: configType
 *         mapping:
 *           sql: '#/components/schemas/BarRawSqlChartConfig'
 *
 *     TableChartConfig:
 *       description: >
 *         Table chart. Omit configType for the builder variant (requires sourceId
 *         and select). Set configType to "sql" for the Raw SQL variant (requires
 *         connectionId and sqlTemplate).
 *       oneOf:
 *         - $ref: '#/components/schemas/TableBuilderChartConfig'
 *         - $ref: '#/components/schemas/TableRawSqlChartConfig'
 *       discriminator:
 *         propertyName: configType
 *         mapping:
 *           sql: '#/components/schemas/TableRawSqlChartConfig'
 *
 *     NumberChartConfig:
 *       description: >
 *         Single big-number chart. Omit configType for the builder variant
 *         (requires sourceId and select). Set configType to "sql" for the Raw
 *         SQL variant (requires connectionId and sqlTemplate).
 *       oneOf:
 *         - $ref: '#/components/schemas/NumberBuilderChartConfig'
 *         - $ref: '#/components/schemas/NumberRawSqlChartConfig'
 *       discriminator:
 *         propertyName: configType
 *         mapping:
 *           sql: '#/components/schemas/NumberRawSqlChartConfig'
 *
 *     PieChartConfig:
 *       description: >
 *         Pie chart. Omit configType for the builder variant (requires sourceId
 *         and select). Set configType to "sql" for the Raw SQL variant (requires
 *         connectionId and sqlTemplate).
 *       oneOf:
 *         - $ref: '#/components/schemas/PieBuilderChartConfig'
 *         - $ref: '#/components/schemas/PieRawSqlChartConfig'
 *       discriminator:
 *         propertyName: configType
 *         mapping:
 *           sql: '#/components/schemas/PieRawSqlChartConfig'
 *
 *     TileConfig:
 *       description: >
 *         Tile chart configuration. displayType is the primary discriminant and
 *         determines which variant group applies. For displayTypes that support
 *         both builder and Raw SQL modes (line, stacked_bar, table, number, pie),
 *         configType is the secondary discriminant: omit it for the builder
 *         variant or set it to "sql" for the Raw SQL variant. The search and
 *         markdown displayTypes only have a builder variant.
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
 *               description: Unique tile ID assigned by the server.
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
 *           description: Filter type. Must be "QUERY_EXPRESSION".
 *           example: "QUERY_EXPRESSION"
 *         name:
 *           type: string
 *           minLength: 1
 *           description: Display name for the dashboard filter key
 *           example: "Environment"
 *         expression:
 *           type: string
 *           minLength: 1
 *           description: Key expression used when applying this dashboard filter key
 *           example: "environment"
 *         sourceId:
 *           type: string
 *           description: Source ID this dashboard filter key applies to
 *           example: "65f5e4a3b9e77c001a111111"
 *         sourceMetricType:
 *           type: string
 *           enum: [sum, gauge, histogram, summary, exponential histogram]
 *           description: Metric type when source is metrics
 *           example: "gauge"
 *         where:
 *           type: string
 *           description: Optional WHERE condition to scope which rows this filter key reads values from
 *           example: "ServiceName:api"
 *         whereLanguage:
 *           type: string
 *           enum: [sql, lucene]
 *           description: Language of the where condition
 *           default: "sql"
 *           example: "lucene"
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
 *         savedQuery:
 *           type: string
 *           nullable: true
 *           description: Optional default dashboard query restored when loading the dashboard.
 *           example: "service.name = 'api'"
 *         savedQueryLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           nullable: true
 *           description: Query language used by savedQuery.
 *           default: "lucene"
 *           example: "sql"
 *         savedFilterValues:
 *           type: array
 *           description: Optional default dashboard filter values restored when loading the dashboard.
 *           items:
 *             $ref: '#/components/schemas/SavedFilterValue'
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
 *           description: Dashboard name.
 *           example: "New Dashboard"
 *         tiles:
 *           type: array
 *           description: List of tiles/charts to include in the dashboard.
 *           items:
 *             $ref: '#/components/schemas/TileInput'
 *         tags:
 *           type: array
 *           description: Tags for organizing and filtering dashboards.
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
 *         savedQuery:
 *           type: string
 *           nullable: true
 *           description: Optional default dashboard query to persist on the dashboard.
 *           example: "service.name = 'api'"
 *         savedQueryLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           nullable: true
 *           description: Query language used by savedQuery.
 *           default: "lucene"
 *           example: "sql"
 *         savedFilterValues:
 *           type: array
 *           description: Optional default dashboard filter values to persist on the dashboard.
 *           items:
 *             $ref: '#/components/schemas/SavedFilterValue'
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
 *           description: Dashboard name.
 *           example: "Updated Dashboard Name"
 *         tiles:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/TileInput'
 *           description: Full list of tiles for the dashboard. Existing tiles are matched by ID; tiles with an ID that does not match an existing tile will be assigned a new generated ID.
 *         tags:
 *           type: array
 *           description: Tags for organizing and filtering dashboards.
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
 *         savedQuery:
 *           type: string
 *           nullable: true
 *           description: Optional default dashboard query to persist on the dashboard.
 *           example: "service.name = 'api'"
 *         savedQueryLanguage:
 *           $ref: '#/components/schemas/QueryLanguage'
 *           nullable: true
 *           description: Query language used by savedQuery.
 *           default: "lucene"
 *           example: "sql"
 *         savedFilterValues:
 *           type: array
 *           description: Optional default dashboard filter values to persist on the dashboard.
 *           items:
 *             $ref: '#/components/schemas/SavedFilterValue'
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
 *           description: The dashboard object.
 *
 *     DashboardsListResponse:
 *       type: object
 *       properties:
 *         data:
 *           type: array
 *           description: List of dashboard objects.
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
      {
        _id: 1,
        name: 1,
        tiles: 1,
        tags: 1,
        filters: 1,
        savedQuery: 1,
        savedQueryLanguage: 1,
        savedFilterValues: 1,
      },
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
        {
          _id: 1,
          name: 1,
          tiles: 1,
          tags: 1,
          filters: 1,
          savedQuery: 1,
          savedQueryLanguage: 1,
          savedFilterValues: 1,
        },
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
    body: createDashboardBodySchema,
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const {
        name,
        tiles,
        tags,
        filters,
        savedQuery,
        savedQueryLanguage,
        savedFilterValues,
      } = req.body;

      const [missingSources, missingConnections, sourceConnectionMismatches] =
        await Promise.all([
          getMissingSources(teamId, tiles, filters),
          getMissingConnections(teamId, tiles),
          getSourceConnectionMismatches(teamId, tiles),
        ]);
      if (missingSources.length > 0) {
        return res.status(400).json({
          message: `Could not find the following source IDs: ${missingSources.join(
            ', ',
          )}`,
        });
      }
      if (missingConnections.length > 0) {
        return res.status(400).json({
          message: `Could not find the following connection IDs: ${missingConnections.join(
            ', ',
          )}`,
        });
      }
      if (sourceConnectionMismatches.length > 0) {
        return res.status(400).json({
          message: `The following source IDs do not match the specified connections: ${sourceConnectionMismatches.join(
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

      const normalizedSavedQueryLanguage = resolveSavedQueryLanguage({
        savedQuery,
        savedQueryLanguage,
      });

      const newDashboard = await new Dashboard({
        name,
        tiles: internalTiles,
        tags: tags && uniq(tags),
        filters: filtersWithIds,
        savedQuery,
        savedQueryLanguage: normalizedSavedQueryLanguage,
        savedFilterValues,
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
    body: updateDashboardBodySchema,
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

      const {
        name,
        tiles,
        tags,
        filters,
        savedQuery,
        savedQueryLanguage,
        savedFilterValues,
      } = req.body ?? {};

      const [missingSources, missingConnections, sourceConnectionMismatches] =
        await Promise.all([
          getMissingSources(teamId, tiles, filters),
          getMissingConnections(teamId, tiles),
          getSourceConnectionMismatches(teamId, tiles),
        ]);
      if (missingSources.length > 0) {
        return res.status(400).json({
          message: `Could not find the following source IDs: ${missingSources.join(
            ', ',
          )}`,
        });
      }
      if (missingConnections.length > 0) {
        return res.status(400).json({
          message: `Could not find the following connection IDs: ${missingConnections.join(
            ', ',
          )}`,
        });
      }
      if (sourceConnectionMismatches.length > 0) {
        return res.status(400).json({
          message: `The following source IDs do not match the specified connections: ${sourceConnectionMismatches.join(
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
      if (savedQuery !== undefined) {
        setPayload.savedQuery = savedQuery;
      }
      const normalizedSavedQueryLanguage = resolveSavedQueryLanguage({
        savedQuery,
        savedQueryLanguage,
      });
      if (normalizedSavedQueryLanguage !== undefined) {
        setPayload.savedQueryLanguage = normalizedSavedQueryLanguage;
      }
      if (savedFilterValues !== undefined) {
        setPayload.savedFilterValues = savedFilterValues;
      }

      const updatedDashboard = await Dashboard.findOneAndUpdate(
        { _id: dashboardId, team: teamId },
        { $set: setPayload },
        { new: true },
      );

      if (updatedDashboard == null) {
        return res.sendStatus(404);
      }

      // Delete alerts for tiles that are now raw SQL (unsupported) or were removed
      const newTileIdSet = new Set(internalTiles.map(t => t.id));
      const tileIdsToDeleteAlerts = [
        ...internalTiles
          .filter(tile => isRawSqlSavedChartConfig(tile.config))
          .map(tile => tile.id),
        ...[...existingTileIds].filter(id => !newTileIdSet.has(id)),
      ];
      if (tileIdsToDeleteAlerts.length > 0) {
        logger.info(
          { dashboardId, teamId, tileIds: tileIdsToDeleteAlerts },
          `Deleting alerts for tiles with unsupported config or removed tiles`,
        );
        await deleteDashboardAlerts(dashboardId, teamId, tileIdsToDeleteAlerts);
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
