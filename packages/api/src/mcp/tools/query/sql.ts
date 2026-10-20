import { trace } from '@opentelemetry/api';
import { z } from 'zod';

import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';

import { BUILDER_TOOLS_LIST, SQL_FALLBACK_CRITERIA } from './builderCatalog';
import { parseTimeRange, runConfigTile } from './helpers';
import { createSourceLookup, prepareSqlQuery } from './prepareSql';
import { endTimeSchema, startTimeSchema } from './schemas';
import {
  MAX_SQL_BATCH_QUERIES,
  runSqlBatch,
  SQL_BATCH_DEADLINE_MS,
  sqlBatchQuerySchema,
} from './sqlBatch';

// ─── Schema ──────────────────────────────────────────────────────────────────

const sqlSchema = z.object({
  connectionId: z
    .string()
    .describe(
      'Connection to query. This is the only query tool that takes a connectionId ' +
        'instead of sourceId. Call clickstack_list_sources to find available connections.',
    ),
  sourceId: z
    .string()
    .optional()
    .describe(
      'Source ID. Set it when the query reads a table backed by a source, so ' +
        "`$__sourceTable` expands to that source's database.table. The source's " +
        'connection must match connectionId. Call clickstack_list_sources to find source IDs.',
    ),
  sql: z
    .string()
    .optional()
    .describe(
      'Raw ClickHouse SQL query. Use this or queries, not both. Always include a LIMIT clause to avoid excessive data.\n\n' +
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
        "  $__sourceTable — the source's database.table. Requires sourceId.\n" +
        '  {intervalSeconds:Int64} / {intervalMilliseconds:Int64} — bucket size parameters\n\n' +
        "In the examples, replace <table> with a source's `table` and <timestampColumn> " +
        'with the first expression in its `timestampColumn`, both from ' +
        'clickstack_list_sources, or pass that source as sourceId and use ' +
        '$__sourceTable. For a metric source, use a table from its metricTables ' +
        'qualified with its `database`. Table and column names differ between ' +
        'sources, so do not guess them.\n\n' +
        'Example (time-series, with sourceId):\n' +
        '  SELECT $__timeInterval(<timestampColumn>) AS ts, ServiceName, count() ' +
        'FROM $__sourceTable WHERE $__timeFilter(<timestampColumn>) GROUP BY ServiceName, ts ORDER BY ts\n\n' +
        'Example (table):\n' +
        '  SELECT ServiceName, count() AS n FROM <table> ' +
        'WHERE <timestampColumn> >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) ' +
        'AND <timestampColumn> < fromUnixTimestamp64Milli({endDateMilliseconds:Int64}) ' +
        'GROUP BY ServiceName ORDER BY n DESC LIMIT 20',
    ),
  queries: z
    .array(sqlBatchQuerySchema)
    .min(1)
    .max(MAX_SQL_BATCH_QUERIES)
    .optional()
    .describe(
      `Up to ${MAX_SQL_BATCH_QUERIES} independent queries to run in parallel instead of sql. ` +
        'They share startTime/endTime and default to the top-level connectionId and sourceId.',
    ),
  startTime: startTimeSchema,
  endTime: endTimeSchema,
});

const SQL_OR_QUERIES_ERROR =
  'Pass exactly one of sql (a single query) or queries (several independent ' +
  'queries run in parallel).';

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerSql({ context, registerTool }: ToolRegistrar) {
  const { teamId } = context;

  registerTool(
    'clickstack_sql',
    {
      title: 'Raw SQL Query',
      // Enforces ClickHouse readonly=2, so effectively read-only.
      annotations: { readOnlyHint: true },
      description:
        'Execute raw ClickHouse SQL. LAST-RESORT TOOL — do NOT reach for this first.\n\n' +
        'Default to the builder tools for querying; they are more reliable and produce ' +
        'richer, structured results:\n' +
        BUILDER_TOOLS_LIST +
        '\n\n' +
        'ONLY use raw SQL when the query genuinely cannot be expressed by a builder tool — ' +
        `i.e. it requires ${SQL_FALLBACK_CRITERIA}. ` +
        'A single-table aggregation, top-N, time-series, or row browse is ALWAYS a ' +
        'builder-tool job, never raw SQL. If you are unsure, try the builder tool first and only ' +
        'fall back to SQL if it cannot express what you need.\n\n' +
        'Requires connectionId — call clickstack_list_sources to find connections. Pass sourceId ' +
        'too when querying a source, so $__sourceTable resolves to its table. ' +
        'Call clickstack_describe_source to discover column names before writing SQL.\n\n' +
        'Results are always returned as table rows — for time-series semantics, ' +
        'include a time column and ORDER BY it in your SQL.\n\n' +
        'To run several independent queries at once (e.g. comparing sources, or several ' +
        'breakdowns for one investigation), pass queries instead of sql. They run in ' +
        `parallel under a shared ${SQL_BATCH_DEADLINE_MS / 1000}s budget, and each result ` +
        'reports its own status (ok, error, or timeout), so one failing query does not ' +
        'fail the others.',
      inputSchema: sqlSchema,
    },
    async input => {
      const timeRange = parseTimeRange(input.startTime, input.endTime);
      if ('error' in timeRange) {
        return mcpUserError(timeRange.error);
      }
      const { startDate, endDate } = timeRange;

      const { sql, queries } = input;
      if (queries !== undefined) {
        if (sql !== undefined) {
          return mcpUserError(SQL_OR_QUERIES_ERROR);
        }
        trace.getActiveSpan()?.setAttribute('mcp.sql.mode', 'batch');
        return runSqlBatch({
          teamId: teamId.toString(),
          queries,
          defaults: {
            connectionId: input.connectionId,
            sourceId: input.sourceId,
          },
          startDate,
          endDate,
        });
      }

      if (sql === undefined) {
        return mcpUserError(SQL_OR_QUERIES_ERROR);
      }
      trace.getActiveSpan()?.setAttribute('mcp.sql.mode', 'single');
      const prepared = await prepareSqlQuery(
        {
          sql,
          connectionId: input.connectionId,
          sourceId: input.sourceId,
        },
        createSourceLookup(teamId.toString()),
      );
      if ('error' in prepared) {
        return prepared.error;
      }

      return runConfigTile(
        teamId.toString(),
        prepared.tile,
        startDate,
        endDate,
      );
    },
  );
}
