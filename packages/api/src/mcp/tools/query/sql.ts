import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';
import { buildTile, parseTimeRange, runConfigTile } from './helpers';
import { endTimeSchema, startTimeSchema } from './schemas';

// ─── Schema ──────────────────────────────────────────────────────────────────

const sqlSchema = z.object({
  connectionId: z
    .string()
    .describe(
      'Connection ID (required). This is the only split tool that needs a connectionId ' +
        'instead of sourceId. Call clickstack_list_sources to find available connections.',
    ),
  sql: z
    .string()
    .describe(
      'Raw ClickHouse SQL query. Always include a LIMIT clause to avoid excessive data.\n\n' +
        'TIME FILTERING (preferred path):\n' +
        '  $__timeFilter(column)    — column >= <start> AND column <= <end> (DateTime precision)\n' +
        '  $__timeFilter_ms(column) — same with DateTime64 millisecond precision\n' +
        '  {startDateMilliseconds:Int64} / {endDateMilliseconds:Int64} — epoch ms parameters\n\n' +
        'LITERAL-CAST FALLBACKS:\n' +
        "  parseDateTime64BestEffortOrNull('2024-01-01T00:00:00Z')\n" +
        "  toDateTime64('2024-01-01 00:00:00', 9)\n\n" +
        'OTHER MACROS:\n' +
        '  $__dateFilter(column) — Date precision\n' +
        '  $__dateTimeFilter(dateCol, timeCol) — filters on Date + DateTime columns\n' +
        '  $__dt(dateCol, timeCol) — alias for $__dateTimeFilter\n' +
        '  $__fromTime / $__toTime — start/end as DateTime values\n' +
        '  $__fromTime_ms / $__toTime_ms — start/end as DateTime64 values\n' +
        '  $__timeInterval(column) — time bucket expression: toStartOfInterval(toDateTime(column), INTERVAL ...)\n' +
        '  $__timeInterval_ms(column) — same with millisecond precision\n' +
        '  $__interval_s — raw interval in seconds\n' +
        '  $__filters — dashboard filter conditions (resolves to 1=1 when no filters)\n' +
        '  {intervalSeconds:Int64} / {intervalMilliseconds:Int64} — bucket size parameters\n\n' +
        'Example (time-series):\n' +
        '  SELECT $__timeInterval(TimestampTime) AS ts, ServiceName, count() ' +
        'FROM otel_logs WHERE $__timeFilter(TimestampTime) GROUP BY ServiceName, ts ORDER BY ts\n\n' +
        'Example (table):\n' +
        '  SELECT ServiceName, count() AS n FROM otel_logs ' +
        'WHERE TimestampTime >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) ' +
        'AND TimestampTime < fromUnixTimestamp64Milli({endDateMilliseconds:Int64}) ' +
        'GROUP BY ServiceName ORDER BY n DESC LIMIT 20',
    ),
  startTime: startTimeSchema,
  endTime: endTimeSchema,
});

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerSql(server: McpServer, context: McpContext) {
  const { teamId } = context;

  server.registerTool(
    'clickstack_sql',
    {
      title: 'Raw SQL Query',
      description:
        'Execute raw ClickHouse SQL. ' +
        'ADVANCED: only use this when you need capabilities the builder tools cannot express — ' +
        'JOINs, sub-queries, CTEs, or querying tables not registered as sources.\n\n' +
        'Requires connectionId (not sourceId) — call clickstack_list_sources to find connections. ' +
        'Call clickstack_describe_source to discover column names before writing SQL.\n\n' +
        'Results are always returned as table rows — for time-series semantics, ' +
        'include a time column and ORDER BY it in your SQL.\n\n' +
        'For standard aggregations use clickstack_table. ' +
        'For time-series charts use clickstack_timeseries. ' +
        'For browsing rows use clickstack_search.',
      inputSchema: sqlSchema,
    },
    withToolTracing('clickstack_sql', context, async input => {
      const timeRange = parseTimeRange(input.startTime, input.endTime);
      if ('error' in timeRange) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: timeRange.error }],
        };
      }
      const { startDate, endDate } = timeRange;

      const tile = buildTile('MCP SQL', 24, 6, {
        configType: 'sql' as const,
        displayType: 'table' as const,
        connectionId: input.connectionId,
        sqlTemplate: input.sql,
      });

      return runConfigTile(teamId.toString(), tile, startDate, endDate);
    }),
  );
}
