import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';
import {
  buildTile,
  mergeWhereIntoSelectItems,
  parseTimeRange,
  runConfigTile,
} from './helpers';
import {
  endTimeSchema,
  groupBySchema,
  MCP_AGG_FN_OPTIONS,
  mcpSelectItemSchema,
  orderBySchema,
  sourceIdSchema,
  startTimeSchema,
  whereLanguageSchema,
  whereSchema,
} from './schemas';

// ─── Schema ──────────────────────────────────────────────────────────────────

const tableSchema = z.object({
  sourceId: sourceIdSchema,
  select: z
    .array(mcpSelectItemSchema)
    .min(1)
    .max(10)
    .describe(
      'Metrics to compute. Each item defines one aggregation column. ' +
        'For "number" shape, provide exactly 1 item. ' +
        'Example: [{ aggFn: "count" }, { aggFn: "avg", valueExpression: "Duration" }]',
    ),
  shape: z
    .enum(['table', 'number', 'pie'])
    .optional()
    .default('table')
    .describe(
      'Output shape: "table" (grouped rows, default), "number" (single scalar), or "pie" (pie chart). ' +
        'If "number" or "pie" is set with select.length > 1, it is auto-upgraded to "table". ' +
        'groupBy is ignored when shape is "number".',
    ),
  where: whereSchema.describe(
    'Row filter applied to ALL select items. ' +
      'This scopes the entire query — use it to restrict by service, severity, etc. ' +
      'Each select item can also have its own per-metric "where" for cohort comparisons. ' +
      'When both are set, they are ANDed together.\n\n' +
      'Lucene example: "ServiceName:frontend"\n' +
      'SQL example: "ServiceName = \'frontend\'"',
  ),
  whereLanguage: whereLanguageSchema,
  groupBy: groupBySchema,
  orderBy: orderBySchema,
  startTime: startTimeSchema,
  endTime: endTimeSchema,
});

// ─── orderBy resolution ──────────────────────────────────────────────────────

/** Aggregation function names that ClickHouse cannot resolve as bare identifiers in ORDER BY. */
const AGG_FN_NAMES: ReadonlySet<string> = new Set(MCP_AGG_FN_OPTIONS);

/**
 * Resolve an orderBy value that matches a bare aggregation function name
 * (e.g. "count") to something ClickHouse can resolve in ORDER BY.
 *
 * The model frequently writes `orderBy: "count"`, which generates
 * `ORDER BY count ASC` in ClickHouse — but ClickHouse can't resolve bare
 * `count` since it's a function, not a column. We fix this by finding
 * the select item whose aggFn matches and using its alias, or synthesizing
 * the ClickHouse expression (e.g. `count()`) when no alias is set.
 *
 * Resolution order:
 *   1. If orderBy matches a select item's alias exactly → keep as-is
 *   2. If orderBy matches an aggFn name → use that item's alias if set,
 *      otherwise synthesize the ClickHouse expression (e.g. `count()`)
 *   3. Otherwise → pass through unchanged
 */
function resolveOrderBy(
  orderBy: string | undefined,
  selectItems: {
    aggFn: string;
    alias?: string;
    valueExpression?: string;
    level?: number;
  }[],
): string | undefined {
  if (!orderBy) return undefined;

  const lower = orderBy.toLowerCase();

  // Already matches an alias? No fixup needed.
  if (selectItems.some(s => s.alias && s.alias.toLowerCase() === lower)) {
    return orderBy;
  }

  // Matches an aggFn name? Resolve to that item's alias or synthesize.
  if (AGG_FN_NAMES.has(lower)) {
    const match = selectItems.find(s => s.aggFn.toLowerCase() === lower);
    if (match) {
      // Prefer the explicit alias if set
      if (match.alias) {
        return match.alias;
      }
      // Synthesize the ClickHouse expression so ORDER BY works
      if (match.aggFn === 'count') return 'count()';
      if (
        match.aggFn === 'quantile' &&
        match.level != null &&
        match.valueExpression
      ) {
        return `quantile(${match.level})(${match.valueExpression})`;
      }
      if (match.valueExpression) {
        return `${match.aggFn}(${match.valueExpression})`;
      }
    }
  }

  return orderBy;
}

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerTable(server: McpServer, context: McpContext) {
  const { teamId } = context;

  server.registerTool(
    'hyperdx_table',
    {
      title: 'Aggregation Table',
      description:
        'Compute aggregated metrics as a table, single number, or pie chart. ' +
        'Use this for grouped aggregations, top-N queries, single-value KPIs, ' +
        'or proportional breakdowns.\n\n' +
        'Requires sourceId — call hyperdx_list_sources then hyperdx_describe_source first.\n\n' +
        'Use the top-level "where" to scope the entire query (e.g. filter by service). ' +
        'Each select item can also have its own "where" for per-metric cohort ' +
        'comparisons (compiles to <aggFn>If(...)). Both can be used together.\n\n' +
        'Column naming: top-level columns are PascalCase (Duration, StatusCode). ' +
        "Map attributes use bracket syntax: SpanAttributes['http.method']. " +
        'Map attributes work in groupBy and valueExpression, including ' +
        "toFloat64OrZero(SpanAttributes['key']).\n\n" +
        'Shape auto-upgrade: if shape is "number" or "pie" but select has >1 item, ' +
        'it is transparently upgraded to "table".',
      inputSchema: tableSchema,
    },
    withToolTracing('hyperdx_table', context, async input => {
      const timeRange = parseTimeRange(input.startTime, input.endTime);
      if ('error' in timeRange) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: timeRange.error }],
        };
      }
      const { startDate, endDate } = timeRange;

      // Auto-upgrade shape when select has multiple items but shape is
      // single-value (number/pie). This is the #1 Zod error class from agents.
      let displayType: 'table' | 'number' | 'pie' = input.shape;
      if (
        (displayType === 'number' || displayType === 'pie') &&
        input.select.length > 1
      ) {
        displayType = 'table';
      }

      // Inject top-level where into each select item so it becomes part
      // of the aggCondition for every metric. Table/line/number/pie display
      // types don't have a chart-level where — filtering is per-select-item.
      const selectItems = mergeWhereIntoSelectItems(
        input.select,
        input.where,
        input.whereLanguage,
      );

      const tile = buildTile('MCP Table', 12, 4, {
        displayType,
        sourceId: input.sourceId,
        select: selectItems,
        groupBy: displayType === 'number' ? undefined : input.groupBy,
        orderBy: resolveOrderBy(input.orderBy, selectItems),
      });

      return runConfigTile(teamId.toString(), tile, startDate, endDate);
    }),
  );
}
