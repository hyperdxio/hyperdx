import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import { getMetadata } from '@hyperdx/common-utils/dist/core/metadata';
import { getFirstTimestampValueExpression } from '@hyperdx/common-utils/dist/core/utils';
import { isRawSqlSavedChartConfig } from '@hyperdx/common-utils/dist/guards';
import type {
  BuilderSavedChartConfig,
  ChartConfigWithDateRange,
} from '@hyperdx/common-utils/dist/types';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { ObjectId } from 'mongodb';
import ms from 'ms';
import { z } from 'zod/v4';

import { getConnectionById } from '@/controllers/connection';
import { getSource } from '@/controllers/sources';
import {
  convertToInternalTileConfig,
  isConfigTile,
} from '@/routers/external-api/v2/utils/dashboards';
import logger from '@/utils/logger';
import { trimToolResponse } from '@/utils/trimToolResponse';
import type { ExternalDashboardTileWithId } from '@/utils/zod';

import { ToolDefinition } from './types';

// ─── Shared schemas ──────────────────────────────────────────────────────────

const mcpAggFnSchema = z
  .enum([
    'avg',
    'count',
    'count_distinct',
    'last_value',
    'max',
    'min',
    'quantile',
    'sum',
    'none',
  ])
  .describe(
    'Aggregation function:\n' +
      '  count – count matching rows (no valueExpression needed)\n' +
      '  sum / avg / min / max – aggregate a numeric column (valueExpression required)\n' +
      '  count_distinct – unique value count (valueExpression required)\n' +
      '  quantile – percentile; also set level (valueExpression required)\n' +
      '  last_value – most recent value of a column\n' +
      '  none – pass a raw expression through unchanged',
  );

const mcpSelectItemSchema = z.object({
  aggFn: mcpAggFnSchema,
  valueExpression: z
    .string()
    .optional()
    .describe(
      'Column or expression to aggregate. Required for every aggFn except "count". ' +
        'Use PascalCase for top-level columns (e.g. "Duration", "StatusCode"). ' +
        "For span attributes use: SpanAttributes['key'] (e.g. SpanAttributes['http.method']). " +
        "For resource attributes use: ResourceAttributes['key'] (e.g. ResourceAttributes['service.name']).",
    ),
  where: z
    .string()
    .optional()
    .default('')
    .describe(
      'Row filter in Lucene syntax. ' +
        'Examples: "level:error", "service.name:api AND http.status_code:>=500"',
    ),
  whereLanguage: z
    .enum(['lucene', 'sql'])
    .optional()
    .default('lucene')
    .describe('Query language for the where filter. Default: lucene'),
  alias: z
    .string()
    .optional()
    .describe('Display label for this series. Example: "Error rate"'),
  level: z
    .union([z.literal(0.5), z.literal(0.9), z.literal(0.95), z.literal(0.99)])
    .optional()
    .describe(
      'Percentile level. Only applicable when aggFn is "quantile". ' +
        'Allowed values: 0.5, 0.9, 0.95, 0.99',
    ),
});

const mcpTimeRangeSchema = z.object({
  startTime: z
    .string()
    .optional()
    .describe(
      'Start of the query window as ISO 8601. Default: 15 minutes ago. ' +
        'If results are empty, try a wider range (e.g. 24 hours).',
    ),
  endTime: z
    .string()
    .optional()
    .describe('End of the query window as ISO 8601. Default: now.'),
});

// ─── Shared helpers ──────────────────────────────────────────────────────────

function parseTimeRange(
  startTime?: string,
  endTime?: string,
): { error: string } | { startDate: Date; endDate: Date } {
  const endDate = endTime ? new Date(endTime) : new Date();
  const startDate = startTime
    ? new Date(startTime)
    : new Date(endDate.getTime() - ms('15m'));
  if (isNaN(endDate.getTime()) || isNaN(startDate.getTime())) {
    return {
      error: 'Invalid startTime or endTime: must be valid ISO 8601 strings',
    };
  }
  return { startDate, endDate };
}

function isEmptyResult(result: unknown): boolean {
  if (result == null) return true;
  if (Array.isArray(result)) return result.length === 0;
  if (typeof result === 'object' && result !== null) {
    const obj = result as Record<string, unknown>;
    if (Array.isArray(obj.data) && obj.data.length === 0) return true;
    if (obj.rows != null && Number(obj.rows) === 0) return true;
  }
  return false;
}

function formatQueryResult(result: unknown) {
  const trimmedResult = trimToolResponse(result);
  const isTrimmed =
    JSON.stringify(trimmedResult).length < JSON.stringify(result).length;
  const empty = isEmptyResult(result);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            result: trimmedResult,
            ...(isTrimmed
              ? {
                  note: 'Result was trimmed for context size. Narrow the time range or add filters to reduce data.',
                }
              : {}),
            ...(empty
              ? {
                  hint: 'No data found in the queried time range. Try setting startTime to a wider window (e.g. 24 hours ago) or check that filters match existing data.',
                }
              : {}),
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function runConfigTile(
  teamId: string,
  tile: ExternalDashboardTileWithId,
  startDate: Date,
  endDate: Date,
  options?: { maxResults?: number },
) {
  if (!isConfigTile(tile)) {
    return {
      isError: true as const,
      content: [
        { type: 'text' as const, text: 'Invalid tile: config field missing' },
      ],
    };
  }

  const internalTile = convertToInternalTileConfig(tile);
  const savedConfig = internalTile.config;

  if (!isRawSqlSavedChartConfig(savedConfig)) {
    const builderConfig = savedConfig as BuilderSavedChartConfig & {
      source: string;
    };

    if (!builderConfig.source || builderConfig.source === 'markdown') {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Markdown tile: no query to execute.',
          },
        ],
      };
    }

    const source = await getSource(teamId, builderConfig.source);
    if (!source) {
      return {
        isError: true as const,
        content: [
          {
            type: 'text' as const,
            text: `Source not found: ${builderConfig.source}`,
          },
        ],
      };
    }

    const connection = await getConnectionById(
      teamId,
      source.connection.toString(),
      true, // decrypt password
    );
    if (!connection) {
      return {
        isError: true as const,
        content: [
          {
            type: 'text' as const,
            text: `Connection not found for source: ${builderConfig.source}`,
          },
        ],
      };
    }

    const clickhouseClient = new ClickhouseClient({
      host: connection.host,
      username: connection.username,
      password: connection.password,
    });

    // Search tiles need special handling: set defaults for select, orderBy, limit
    // to mirror how the frontend handles search display types
    const isSearch = builderConfig.displayType === DisplayType.Search;
    const defaultTableSelect =
      'defaultTableSelectExpression' in source
        ? source.defaultTableSelectExpression
        : undefined;
    const implicitColumn =
      'implicitColumnExpression' in source
        ? source.implicitColumnExpression
        : undefined;
    const searchOverrides = isSearch
      ? {
          select: builderConfig.select || defaultTableSelect || '*',
          groupBy: undefined,
          granularity: undefined,
          orderBy: [
            {
              ordering: 'DESC' as const,
              valueExpression: getFirstTimestampValueExpression(
                source.timestampValueExpression,
              ),
            },
          ],
          limit: { limit: options?.maxResults ?? 200, offset: 0 },
        }
      : {};

    const chartConfig = {
      ...builderConfig,
      ...searchOverrides,
      from: {
        databaseName: source.from.databaseName,
        tableName: source.from.tableName,
      },
      connection: source.connection.toString(),
      timestampValueExpression: source.timestampValueExpression,
      implicitColumnExpression: implicitColumn,
      dateRange: [startDate, endDate] as [Date, Date],
    } as ChartConfigWithDateRange;

    const metadata = getMetadata(clickhouseClient);
    const result = await clickhouseClient.queryChartConfig({
      config: chartConfig,
      metadata,
      querySettings: source.querySettings,
    });

    return formatQueryResult(result);
  }

  // Raw SQL tile — look up connection by ID
  const connection = await getConnectionById(
    teamId,
    savedConfig.connection,
    true, // decrypt password
  );
  if (!connection) {
    return {
      isError: true as const,
      content: [
        {
          type: 'text' as const,
          text: `Connection not found: ${savedConfig.connection}`,
        },
      ],
    };
  }

  const clickhouseClient = new ClickhouseClient({
    host: connection.host,
    username: connection.username,
    password: connection.password,
  });

  const chartConfig = {
    ...savedConfig,
    dateRange: [startDate, endDate] as [Date, Date],
  } as ChartConfigWithDateRange;

  const metadata = getMetadata(clickhouseClient);
  const result = await clickhouseClient.queryChartConfig({
    config: chartConfig,
    metadata,
    querySettings: undefined,
  });

  return formatQueryResult(result);
}

// ─── Discriminated union schema for hyperdx_query ───────────────────────────

const builderQuerySchema = mcpTimeRangeSchema.extend({
  displayType: z
    .enum(['line', 'stacked_bar', 'table', 'number', 'pie'])
    .describe(
      'How to visualize the query results:\n' +
        '  line – time-series line chart\n' +
        '  stacked_bar – time-series stacked bar chart\n' +
        '  table – grouped aggregation as rows\n' +
        '  number – single aggregate scalar\n' +
        '  pie – pie chart (one metric, grouped)',
    ),
  sourceId: z
    .string()
    .describe(
      'Source ID. Call hyperdx_list_sources to find available sources.',
    ),
  select: z
    .array(mcpSelectItemSchema)
    .min(1)
    .max(10)
    .describe(
      'Metrics to compute. Each item defines an aggregation. ' +
        'For "number" display, provide exactly 1 item. ' +
        'Example: [{ aggFn: "count" }, { aggFn: "avg", valueExpression: "Duration" }]',
    ),
  groupBy: z
    .string()
    .optional()
    .describe(
      'Column to group/split by. ' +
        'Top-level columns use PascalCase (e.g. "SpanName", "StatusCode"). ' +
        "Span attributes: SpanAttributes['key'] (e.g. SpanAttributes['http.method']). " +
        "Resource attributes: ResourceAttributes['key'] (e.g. ResourceAttributes['service.name']).",
    ),
  orderBy: z
    .string()
    .optional()
    .describe('Column to sort results by (table display only).'),
});

const searchQuerySchema = mcpTimeRangeSchema.extend({
  displayType: z
    .literal('search')
    .describe('Search and filter individual log/event rows'),
  sourceId: z
    .string()
    .describe(
      'Source ID. Call hyperdx_list_sources to find available sources.',
    ),
  where: z
    .string()
    .optional()
    .default('')
    .describe(
      'Row filter. Examples: "level:error", "service.name:api AND duration:>500"',
    ),
  whereLanguage: z
    .enum(['lucene', 'sql'])
    .optional()
    .default('lucene')
    .describe('Query language for the where filter. Default: lucene'),
  columns: z
    .string()
    .optional()
    .default('')
    .describe(
      'Comma-separated columns to include. Leave empty for defaults. ' +
        'Example: "body,service.name,duration"',
    ),
  maxResults: z
    .number()
    .min(1)
    .max(200)
    .optional()
    .default(50)
    .describe(
      'Maximum number of rows to return (1–200). Default: 50. ' +
        'Use smaller values to reduce response size.',
    ),
});

const sqlQuerySchema = mcpTimeRangeSchema.extend({
  displayType: z.literal('sql').describe('Execute raw SQL against ClickHouse'),
  connectionId: z
    .string()
    .describe(
      'Connection ID. Call hyperdx_list_sources to find available connections.',
    ),
  sql: z
    .string()
    .describe(
      'SQL query to execute. ' +
        'Use {{start_time}} and {{end_time}} as date-range placeholders. ' +
        'Example: "SELECT service, count() as n FROM logs ' +
        'WHERE timestamp >= {{start_time}} AND timestamp < {{end_time}} ' +
        'GROUP BY service ORDER BY n DESC LIMIT 20"',
    ),
});

const hyperdxQuerySchema = z.discriminatedUnion('displayType', [
  builderQuerySchema,
  searchQuerySchema,
  sqlQuerySchema,
]);

// ─── Tool definition ────────────────────────────────────────────────────────

const queryTools: ToolDefinition = (server, context) => {
  const { teamId } = context;

  server.registerTool(
    'hyperdx_query',
    {
      title: 'Query Data',
      description:
        'Query observability data (logs, metrics, traces) from HyperDX. ' +
        'Supports aggregated metrics (line/bar/table/number/pie charts), ' +
        'log search, and raw SQL. Use hyperdx_list_sources first to find ' +
        'sourceId/connectionId values. Set displayType to control the query shape.\n\n' +
        'Column naming: Top-level columns are PascalCase (Duration, StatusCode, SpanName). ' +
        "Map attributes use bracket syntax: SpanAttributes['http.method'], ResourceAttributes['service.name']. " +
        'Call hyperdx_list_sources to discover available columns and attribute keys for each source.',
      inputSchema: hyperdxQuerySchema,
    },
    async input => {
      const timeRange = parseTimeRange(input.startTime, input.endTime);
      if ('error' in timeRange) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: timeRange.error }],
        };
      }
      const { startDate, endDate } = timeRange;

      let tile: ExternalDashboardTileWithId;

      if (input.displayType === 'sql') {
        tile = {
          id: new ObjectId().toString(),
          name: 'MCP SQL',
          x: 0,
          y: 0,
          w: 24,
          h: 6,
          config: {
            configType: 'sql' as const,
            displayType: 'table' as const,
            connectionId: input.connectionId,
            sqlTemplate: input.sql,
          },
        } as unknown as ExternalDashboardTileWithId;
      } else if (input.displayType === 'search') {
        tile = {
          id: new ObjectId().toString(),
          name: 'MCP Search',
          x: 0,
          y: 0,
          w: 24,
          h: 6,
          config: {
            displayType: 'search' as const,
            sourceId: input.sourceId,
            select: input.columns ?? '',
            where: input.where ?? '',
            whereLanguage: input.whereLanguage ?? 'lucene',
          },
        } as unknown as ExternalDashboardTileWithId;
      } else {
        // Builder query: line, stacked_bar, table, number, pie
        tile = {
          id: new ObjectId().toString(),
          name: 'MCP Query',
          x: 0,
          y: 0,
          w: 12,
          h: 4,
          config: {
            displayType: input.displayType,
            sourceId: input.sourceId,
            select: input.select.map(s => ({
              aggFn: s.aggFn,
              where: s.where ?? '',
              whereLanguage: s.whereLanguage ?? 'lucene',
              valueExpression: s.valueExpression,
              alias: s.alias,
              level: s.level,
            })),
            groupBy: input.groupBy ?? undefined,
            orderBy: input.orderBy ?? undefined,
          },
        } as unknown as ExternalDashboardTileWithId;
      }

      logger.debug(
        { teamId, displayType: input.displayType },
        'MCP hyperdx_query',
      );
      try {
        return await runConfigTile(
          teamId.toString(),
          tile,
          startDate,
          endDate,
          input.displayType === 'search'
            ? { maxResults: input.maxResults }
            : undefined,
        );
      } catch (e) {
        logger.error({ teamId, error: e }, 'MCP hyperdx_query error');
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Query failed: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
        };
      }
    },
  );
};

export default queryTools;
