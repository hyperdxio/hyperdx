import { hasMacro } from '@hyperdx/common-utils/dist/macros';
import { hasVariableMacro } from '@hyperdx/common-utils/dist/variables';
import { z } from 'zod';

import { getSource } from '@/controllers/sources';
import { READ_ONLY_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';

import { BUILDER_TOOLS_LIST, SQL_FALLBACK_CRITERIA } from './builderCatalog';
import { buildTile, parseTimeRange, runConfigTile } from './helpers';
import { endTimeSchema, startTimeSchema } from './schemas';

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
  startTime: startTimeSchema,
  endTime: endTimeSchema,
});

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerSql({ context, registerTool }: ToolRegistrar) {
  const { teamId } = context;

  registerTool(
    'clickstack_sql',
    {
      title: 'Raw SQL Query',
      // Enforces ClickHouse readonly=2, so effectively read-only.
      annotations: READ_ONLY_TOOL,
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
        'include a time column and ORDER BY it in your SQL.',
      inputSchema: sqlSchema,
    },
    async input => {
      const timeRange = parseTimeRange(input.startTime, input.endTime);
      if ('error' in timeRange) {
        return mcpUserError(timeRange.error);
      }
      const { startDate, endDate } = timeRange;

      // $__filter / $__conditionalAll read the variables a dashboard's filters
      // declare, and this tool has no dashboard behind it.
      if (hasVariableMacro(input.sql)) {
        return mcpUserError(
          'The $__filter and $__conditionalAll macros only resolve for a tile ' +
            'on a dashboard, because they read the dashboard variables its ' +
            'filters declare. This tool has no dashboard, so they would be ' +
            'sent to ClickHouse as literal text. Inline the condition here, ' +
            'or save the query as a dashboard tile and validate it with ' +
            'clickstack_query_tile.',
        );
      }

      if (input.sourceId) {
        const source = await getSource(teamId.toString(), input.sourceId);
        if (!source) {
          return mcpUserError(
            `Source not found: ${input.sourceId}. Call clickstack_list_sources to discover available source IDs.`,
          );
        }
        // $__sourceTable expands to the source's table, so a mismatch would run
        // the query against a table on another server.
        const sourceConnectionId = source.connection.toString();
        if (sourceConnectionId !== input.connectionId) {
          return mcpUserError(
            `connectionId "${input.connectionId}" does not match the connection of source ` +
              `"${input.sourceId}" ("${sourceConnectionId}"). Use the source's own ` +
              'connection or drop sourceId from the call.',
          );
        }
      } else if (hasMacro(input.sql, 'sourceTable')) {
        return mcpUserError(
          '$__sourceTable needs a sourceId to know which table to expand to. ' +
            'Pass the sourceId of a source from clickstack_list_sources, or write ' +
            "the source's `table` in place of the macro.",
        );
      }

      // Raw SQL only uses displayType to pick which query params to bind, and
      // only time-series types bind the interval params this tool advertises
      // ({intervalSeconds}, $__interval_s, $__timeInterval). Rows come back
      // the same either way, and ClickHouse ignores params a query never uses.
      const tile = buildTile('MCP SQL', 24, 6, {
        configType: 'sql' as const,
        displayType: 'line' as const,
        connectionId: input.connectionId,
        sourceId: input.sourceId,
        sqlTemplate: input.sql,
      });

      return runConfigTile(teamId.toString(), tile, startDate, endDate);
    },
  );
}
