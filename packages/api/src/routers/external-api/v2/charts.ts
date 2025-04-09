import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/types';
import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';
import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as clickhouse from '@/clickhouse';
import { getTeam } from '@/controllers/team';

// Define Zod schema for v2 API based on OpenAPI spec
const chartSeriesQueryPayloadSchema = z.object({
  type: z.string(),
  query: z.string(),
  granularityMillis: z.number(),
  startTime: z.number(),
  endTime: z.number(),
  groupBy: z.array(z.string()).optional(),
  field: z.string().optional(),
  aggFn: z.string().optional(),
  metricDataType: z.string().optional(),
});

const router = express.Router();

// Define the expected ClickHouse result row structure
interface ChartDataRow {
  ts_bucket: number;
  data?: number;
  value?: number;
  group?: string[];
  [key: string]: any;
}

// Helper function to convert payload to ChartConfig
async function queryChartSeriesV2(
  teamId: string,
  payload: z.infer<typeof chartSeriesQueryPayloadSchema>,
) {
  const team = await getTeam(teamId);
  if (!team) {
    throw new Error('Team not found');
  }

  const startDate = new Date(payload.startTime);
  const endDate = new Date(payload.endTime);

  // Convert milliseconds to ClickHouse interval
  const granularity = payload.granularityMillis
    ? `${Math.floor(payload.granularityMillis / 1000)} second`
    : undefined;

  // Create a minimal chart config from the payload
  const chartConfig: ChartConfigWithOptDateRange = {
    select: [
      {
        aggFn: (payload.aggFn || 'count') as any,
        valueExpression: payload.field || '*',
        alias: 'value',
        aggCondition: '', // Required field
        ...(payload.metricDataType
          ? { metricType: payload.metricDataType as any }
          : {}),
      },
    ],
    from: {
      databaseName: 'default',
      tableName: payload.type === 'metrics' ? 'metrics' : 'logs',
    },
    where: payload.query,
    timestampValueExpression: 'timestamp',
    dateRange: [startDate, endDate],
    granularity,
    groupBy: payload.groupBy as any,
    connection: 'default', // Required field
  };

  // Create a simplified metadata instance for our needs
  // In a real implementation, this would use a proper Metadata instance
  const metadata = {
    getColumns: async () => [],
    getMaterializedColumnsLookupTable: async () => new Map(),
    getColumn: async () => undefined,
    getMapKeys: async () => [],
    getMapValues: async () => [],
    getAllFields: async () => [],
    getTableMetadata: async () => undefined,
    getKeyValues: async () => ({}),
  };

  try {
    // Use renderChartConfig from common-utils to build the SQL
    const chSql = await renderChartConfig(chartConfig, metadata as any);

    // Execute the query using ClickHouse client
    const result = await clickhouse.client.query({
      query: chSql.sql,
      query_params: chSql.params,
      format: 'JSONEachRow',
    });

    // Process and format the results
    const rows = await result.json<ChartDataRow[]>();

    // Transform into the expected format
    const series = [
      {
        name: 'value',
        data: rows.map(row => ({
          x: new Date(row.ts_bucket * 1000).getTime(),
          y: row.data !== undefined ? row.data : row.value,
        })),
      },
    ];

    return {
      series,
      metadata: {
        query: payload.query,
        startTime: payload.startTime,
        endTime: payload.endTime,
        granularityMillis: payload.granularityMillis,
      },
    };
  } catch (error) {
    console.error('Error querying chart series:', error);
    throw error;
  }
}

// POST /v1/chart/series
// Note: Route path is /v1/chart/series as per OpenAPI spec,
// even though the router file lives in the v2 directory structure.
router.post(
  '/v1/chart/series',
  validateRequest({ body: chartSeriesQueryPayloadSchema }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (!teamId) {
        return res.sendStatus(403);
      }

      const seriesData = await queryChartSeriesV2(teamId.toString(), req.body);
      return res.json(seriesData);
    } catch (e) {
      const span = opentelemetry.trace.getActiveSpan();
      span?.recordException(e as Error);
      span?.setStatus({ code: SpanStatusCode.ERROR });
      next(e);
    }
  },
);

export default router;
