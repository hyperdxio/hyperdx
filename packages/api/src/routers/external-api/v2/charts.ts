import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { Granularity } from '@hyperdx/common-utils/dist/core/utils';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';
import express from 'express';
import _ from 'lodash';
import { z } from 'zod';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import { getTeam } from '@/controllers/team';
import { IConnection } from '@/models/connection';
import { ISource } from '@/models/source';
import { validateRequestWithEnhancedErrors as validateRequest } from '@/utils/enhancedErrors';
import { externalQueryChartSeriesSchema } from '@/utils/zod';

/**
 * @openapi
 * components:
 *   schemas:
 *     ChartSeries:
 *       type: object
 *       required:
 *         - sourceId
 *         - aggFn
 *         - where
 *         - groupBy
 *       properties:
 *         sourceId:
 *           type: string
 *           description: ID of the data source for this series
 *           example: "65f5e4a3b9e77c001a123456"
 *         aggFn:
 *           type: string
 *           description: Aggregation function to use on the data
 *           enum: [avg, count, count_distinct, last_value, max, min, quantile, sum]
 *           example: "count"
 *         field:
 *           type: string
 *           description: Field to aggregate
 *           example: "duration"
 *         where:
 *           type: string
 *           description: Filter condition in Lucene query syntax
 *           example: "service:api AND level:error"
 *         whereLanguage:
 *           type: string
 *           description: Query language used in the where clause
 *           enum: [lucene, sql]
 *           example: "lucene"
 *         groupBy:
 *           type: array
 *           description: Fields to group the results by
 *           items:
 *             type: string
 *           example: ["service", "host"]
 *         metricName:
 *           type: string
 *           description: Name of the metric (for metric data sources)
 *           example: "http_requests_total"
 *         metricDataType:
 *           type: string
 *           description: Type of metric data
 *           enum: [sum, gauge, histogram]
 *           example: "gauge"
 *
 *     SeriesQueryRequest:
 *       type: object
 *       required:
 *         - series
 *         - startTime
 *         - endTime
 *       properties:
 *         series:
 *           type: array
 *           description: Array of series configurations
 *           items:
 *             $ref: '#/components/schemas/ChartSeries'
 *           minItems: 1
 *           maxItems: 5
 *         startTime:
 *           type: number
 *           description: Start timestamp in milliseconds
 *           example: 1647014400000
 *         endTime:
 *           type: number
 *           description: End timestamp in milliseconds
 *           example: 1647100800000
 *         granularity:
 *           type: string
 *           description: Time bucket size for aggregations
 *           enum: [30s, 1m, 5m, 10m, 15m, 30m, 1h, 2h, 6h, 12h, 1d, 2d, 7d, 30d, auto]
 *           example: "1h"
 *         seriesReturnType:
 *           type: string
 *           description: Format of the returned data
 *           enum: [ratio, column]
 *           example: "column"
 *
 *     SeriesDataPoint:
 *       type: object
 *       properties:
 *         ts_bucket:
 *           type: number
 *           description: Timestamp of the data point (bucket start time)
 *           example: 1647014400000
 *         "series_0.data":
 *           type: number
 *           description: Value for the first series
 *           example: 42
 *         "series_1.data":
 *           type: number
 *           description: Value for the second series
 *           example: 18
 *         group:
 *           type: array
 *           description: Group by values if groupBy was specified
 *           items:
 *             type: string
 *           example: ["api", "prod-host-1"]
 *
 *     SeriesResponse:
 *       type: object
 *       properties:
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SeriesDataPoint'
 */

// Types
type ExternalSeriesInput = z.infer<typeof externalQueryChartSeriesSchema>;

// Mapping between short format granularity strings and clickhouse Granularity enum values
const API_GRANULARITY_TO_INTERNAL: Record<string, Granularity> = {
  '1s': '1 second' as Granularity, // For testing only
  '30s': Granularity.ThirtySecond,
  '1m': Granularity.OneMinute,
  '5m': Granularity.FiveMinute,
  '10m': Granularity.TenMinute,
  '15m': Granularity.FifteenMinute,
  '30m': Granularity.ThirtyMinute,
  '1h': Granularity.OneHour,
  '2h': Granularity.TwoHour,
  '6h': Granularity.SixHour,
  '12h': Granularity.TwelveHour,
  '1d': Granularity.OneDay,
  '2d': Granularity.TwoDay,
  '7d': Granularity.SevenDay,
  '30d': Granularity.ThirtyDay,
  auto: 'auto' as Granularity,
};

const granularitySchema = z.enum(
  Object.keys(API_GRANULARITY_TO_INTERNAL).filter(key => key !== '1s') as [
    string,
    ...string[],
  ],
);

const apiGranularitySchema =
  process.env.NODE_ENV === 'test'
    ? z.union([granularitySchema, z.literal('1s')])
    : granularitySchema;

/**
 * Reusable schema for millisecond timestamps validation
 */
const millisecondTimestampSchema = z
  .number()
  .int({ message: 'Timestamp must be an integer' })
  .positive({ message: 'Timestamp must be positive' })
  .refine(val => val.toString().length >= 13, {
    message: 'Timestamp must be in milliseconds',
  });

/**
 * Translates short granularity string (e.g., "30s", "1m") to ClickHouse INTERVAL syntax.
 */
const translateGranularityToInterval = (
  granularity: string | undefined,
): string | undefined => {
  if (!granularity || granularity === 'auto') {
    return undefined;
  }
  return API_GRANULARITY_TO_INTERNAL[granularity];
};

/**
 * Builds the internal chart configuration object based on the external API request for a specific series.
 */
const buildChartConfigFromRequest = async (
  params: {
    externalSeries: ExternalSeriesInput;
    sourceId: string;
    seriesIndex: number;
    startTime: number;
    endTime: number;
    granularity?: string;
    seriesReturnType?: 'ratio' | 'column';
    teamId: string;
  },
  source: ISource,
  connection: IConnection,
): Promise<{
  chartConfig: ChartConfigWithOptDateRange;
  groupByFields: string[] | undefined;
}> => {
  const translatedGranularity = translateGranularityToInterval(
    params.granularity,
  );

  const {
    aggFn,
    level,
    field = undefined,
    where = undefined,
    whereLanguage,
    metricDataType,
    metricName,
    groupBy,
  } = params.externalSeries;

  const isMetricSource = source.kind === SourceKind.Metric;

  // For metric sources, if metricName is not provided but field is,
  // use field as the metric name (matching the natural API usage pattern
  // where users pass the metric name as the field they want to query)
  const resolvedMetricName = isMetricSource
    ? (metricName ?? field)
    : metricName;

  // For metric sources, valueExpression should be 'Value' (the ClickHouse column)
  // unless the user explicitly provides both metricName and field
  const resolvedValueExpression = isMetricSource
    ? metricName && field
      ? field.includes('.')
        ? `'${field}'`
        : field
      : 'Value'
    : field?.includes('.')
      ? `'${field}'`
      : (field ?? '');

  const hasGroupBy = groupBy?.length > 0;

  if (aggFn == null) {
    throw new Error('aggFn must be set for time chart');
  }

  const chartConfig: ChartConfigWithOptDateRange = {
    displayType: DisplayType.Line,
    connection: connection._id.toString(),
    from: {
      databaseName: source.from.databaseName,
      tableName: !isMetricSource ? source.from.tableName : '',
    },
    ...(isMetricSource && {
      metricTables: source.metricTables,
    }),
    select: [
      {
        aggFn,
        level,
        valueExpression: resolvedValueExpression,
        aggCondition: where?.trim() ?? '',
        aggConditionLanguage: whereLanguage ?? 'lucene',
        alias: `series_${params.seriesIndex}`,
        ...(isMetricSource && {
          metricName: resolvedMetricName,
          metricType: metricDataType,
        }),
      },
    ],
    where: '',
    timestampValueExpression: source.timestampValueExpression,
    dateRange: [new Date(params.startTime), new Date(params.endTime)] as [
      Date,
      Date,
    ],
    granularity: translatedGranularity ?? 'auto',
    seriesReturnType: params.seriesReturnType,
    ...(hasGroupBy && {
      groupBy: groupBy.map(field => ({
        valueExpression: field,
      })),
    }),
  };

  return { chartConfig, groupByFields: groupBy ?? [] };
};

/**
 * Formats the raw Clickhouse query result rows into the structure expected by the API response (for row-based results).
 * 
 * Example input:
 * [
  { series_0: '42', ServiceName: 'api-service', __hdx_time_bucket: '2023-06-15T14:00:00Z' },
  { series_0: '17', ServiceName: 'web-service', __hdx_time_bucket: '2023-06-15T14:00:00Z' },
  { series_1: '35', ServiceName: 'api-service', __hdx_time_bucket: '2023-06-15T14:00:00Z' },
  { series_0: '22', ServiceName: 'api-service', __hdx_time_bucket: '2023-06-15T14:10:00Z' },
] 
 * 
 * Example output:
 * [
  { ts_bucket: 1686837600000, group: ['api-service'], 'series_0.data': '42', 'series_1.data': '35' },
  { ts_bucket: 1686837600000, group: ['web-service'], 'series_0.data': '17' },
  { ts_bucket: 1686838200000, group: ['api-service'], 'series_0.data': '22' },
]
 */
const formatCHResult = (
  dataRows: Record<string, unknown>[],
  groupByFields: string[] | undefined,
): Record<string, unknown>[] => {
  if (!dataRows.length) return [];
  const groupByColNames = groupByFields ?? [];
  const map = new Map();

  for (const item of dataRows) {
    const ts = new Date(String(item.__hdx_time_bucket)).getTime();
    const group = groupByColNames.map(f => item[f]);
    const key = `${ts}|${group.join('|')}`;

    if (!map.has(key)) {
      map.set(key, { ts_bucket: ts, group });
    }

    const row = map.get(key);
    for (const k of Object.keys(item)) {
      if (k.startsWith('series_')) {
        row[`${k}.data`] = item[k];
      }
    }
  }
  return Array.from(map.values());
};

const router = express.Router();

type SeriesResult = {
  data?: Record<string, unknown>[];
  groupByFields?: string[];
  error?: {
    status: number;
    message: string;
  };
};

/**
 * @openapi
 * /api/v2/charts/series:
 *   post:
 *     summary: Query Chart Series Data
 *     description: Retrieves time series data based on configured series parameters
 *     operationId: queryChartSeries
 *     tags: [Charts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SeriesQueryRequest'
 *           examples:
 *             basicTimeSeries:
 *               summary: Basic time series query
 *               value:
 *                 startTime: 1647014400000
 *                 endTime: 1647100800000
 *                 granularity: "1h"
 *                 series:
 *                   - sourceId: "65f5e4a3b9e77c001a123456"
 *                     aggFn: "count"
 *                     where: "SeverityText:error"
 *                     groupBy: []
 *             multiSeriesWithGroupBy:
 *               summary: Multiple series with group by
 *               value:
 *                 startTime: 1647014400000
 *                 endTime: 1647100800000
 *                 granularity: "15m"
 *                 series:
 *                   - sourceId: "65f5e4a3b9e77c001a123456"
 *                     aggFn: "count"
 *                     where: "SeverityText:error"
 *                     groupBy: ["service"]
 *                   - sourceId: "65f5e4a3b9e77c001a123456"
 *                     aggFn: "avg"
 *                     field: "duration"
 *                     where: "SeverityText:error"
 *                     groupBy: ["service"]
 *             multiSourceSeries:
 *               summary: Series from multiple sources
 *               value:
 *                 startTime: 1647014400000
 *                 endTime: 1647100800000
 *                 granularity: "5m"
 *                 series:
 *                   - sourceId: "65f5e4a3b9e77c001a123456"
 *                     aggFn: "count"
 *                     where: "SeverityText:error"
 *                     groupBy: []
 *                   - sourceId: "65f5e4a3b9e77c001a789012"
 *                     aggFn: "avg"
 *                     metricName: "http_requests_total"
 *                     metricDataType: "gauge"
 *                     where: "service:api"
 *                     groupBy: []
 *             metricSeries:
 *               summary: Metric data series
 *               value:
 *                 startTime: 1647014400000
 *                 endTime: 1647100800000
 *                 granularity: "5m"
 *                 series:
 *                   - sourceId: "65f5e4a3b9e77c001a789012"
 *                     aggFn: "avg"
 *                     metricName: "http_requests_total"
 *                     metricDataType: "gauge"
 *                     where: "service:api"
 *                     groupBy: []
 *     responses:
 *       '200':
 *         description: Successfully retrieved time series data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SeriesResponse'
 *             examples:
 *               timeSeriesData:
 *                 summary: Time series data points
 *                 value:
 *                   data:
 *                     - ts_bucket: 1647014400000
 *                       "series_0.data": 42
 *                     - ts_bucket: 1647018000000
 *                       "series_0.data": 37
 *                     - ts_bucket: 1647021600000
 *                       "series_0.data": 53
 *               groupedTimeSeriesData:
 *                 summary: Grouped time series data
 *                 value:
 *                   data:
 *                     - ts_bucket: 1647014400000
 *                       "series_0.data": 15
 *                       group: ["api"]
 *                     - ts_bucket: 1647014400000
 *                       "series_0.data": 8
 *                       group: ["frontend"]
 *                     - ts_bucket: 1647018000000
 *                       "series_0.data": 22
 *                       group: ["api"]
 *       '400':
 *         description: Invalid request parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *             examples:
 *               invalidParams:
 *                 value:
 *                   error: "All series must have the same groupBy fields"
 *               invalidTimestamp:
 *                 value:
 *                   error: "Timestamp must be in milliseconds"
 *       '403':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *             example:
 *               error: "Team context missing"
 *       '404':
 *         description: Source not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *             example:
 *               error: "Source not found"
 *       '500':
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *             example:
 *               error: "Internal server error"
 */
router.post(
  '/series',
  validateRequest({
    body: z.object({
      series: z
        .array(externalQueryChartSeriesSchema)
        .min(1, { message: 'Series array cannot be empty' })
        .max(5)
        .refine(
          currentSeries => {
            // The .min(1) validator should ensure currentSeries is not empty.
            // This check is a safeguard: if currentSeries is unexpectedly empty,
            // we return true to let .min(1) be the definitive validator for emptiness,
            // thus preventing a TypeError from currentSeries[0] here.
            if (currentSeries.length === 0) {
              return true;
            }
            // refine should only run if min(1) passes
            const firstGroupBy = currentSeries[0].groupBy;
            return currentSeries.every(s => _.isEqual(s.groupBy, firstGroupBy));
          },
          {
            message: 'All series must have the same groupBy fields',
          },
        ),
      endTime: millisecondTimestampSchema,
      granularity: apiGranularitySchema.optional(),
      startTime: millisecondTimestampSchema,
      seriesReturnType: z.enum(['ratio', 'column']).optional(),
    }),
  }),
  async (req, res) => {
    const span = opentelemetry.trace.getActiveSpan();
    try {
      const teamId = req.user?.team;
      if (!teamId) {
        return res.status(403).send({ error: 'Team context missing' });
      }
      const team = await getTeam(teamId);
      if (!team) {
        return res.status(403).send({ error: 'Team not found' });
      }

      const {
        endTime,
        granularity,
        startTime,
        seriesReturnType,
        series: externalSeries,
      } = req.body;

      const allResults = await Promise.all(
        externalSeries.map(async (series, index) => {
          try {
            const source = await getSource(teamId.toString(), series.sourceId);
            if (!source || !source.connection) {
              // Return a structured error object instead of throwing
              return {
                error: {
                  status: 404,
                  message: `Source not found for series ${index}`,
                },
              } as SeriesResult;
            }

            const connection = await getConnectionById(
              teamId.toString(),
              source.connection.toString(),
              true, // Decrypt password
            );

            if (!connection) {
              return {
                error: {
                  status: 404,
                  message: `Connection not found for series ${index}`,
                },
              } as SeriesResult;
            }

            const { chartConfig, groupByFields } =
              await buildChartConfigFromRequest(
                {
                  externalSeries: series,
                  sourceId: series.sourceId,
                  seriesIndex: index,
                  startTime,
                  endTime,
                  granularity,
                  seriesReturnType,
                  teamId: teamId.toString(),
                },
                source,
                connection,
              );

            const clickhouseClient = new ClickhouseClient({
              host: connection.host,
              username: connection.username,
              password: connection.password,
            });

            const metadata = getMetadata(clickhouseClient);
            const result = await clickhouseClient.queryChartConfig({
              config: chartConfig,
              metadata,
              querySettings: source.querySettings,
            });

            return {
              data: result.data || [],
              groupByFields,
            } as SeriesResult;
          } catch (err) {
            console.error(`Error processing series ${index}:`, err);
            throw err;
          }
        }),
      );

      // Check if any results contain errors
      const errorResult = allResults.find(
        result => 'error' in result && result.error,
      ) as SeriesResult | undefined;
      if (errorResult && errorResult.error) {
        const { status, message } = errorResult.error;
        return res.status(status).json({ error: message });
      }

      // Combine all data rows across all series
      const combinedResults = allResults.flatMap(
        result => result.data || [],
      ) as Record<string, unknown>[];

      // Format based on requested type
      let responseData;
      if (seriesReturnType === 'column') {
        responseData = combinedResults;
      } else {
        const primaryGroupByFields = allResults.find(
          r => r.groupByFields,
        )?.groupByFields;
        responseData = formatCHResult(combinedResults, primaryGroupByFields);
      }

      res.json({ data: responseData });
    } catch (e) {
      span?.recordException(e as Error);
      span?.setStatus({ code: SpanStatusCode.ERROR });
      console.error('Error in /series endpoint:', e);

      const errMsg = e instanceof Error ? e.message : 'Internal server error';
      const statusCode = (e as any).statusCode || 500;
      res.status(statusCode).json({ error: errMsg });
    }
  },
);

export default router;
