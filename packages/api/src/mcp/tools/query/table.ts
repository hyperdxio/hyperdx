import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { withToolTracing } from '../../utils/tracing';
import type { McpContext } from '../types';
import { buildTile, parseTimeRange, runConfigTile } from './helpers';
import {
  endTimeSchema,
  groupBySchema,
  mcpSelectItemSchema,
  orderBySchema,
  sourceIdSchema,
  startTimeSchema,
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
  groupBy: groupBySchema,
  orderBy: orderBySchema,
  startTime: startTimeSchema,
  endTime: endTimeSchema,
});

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
        'Each select item can have its own "where" filter, which compiles to ' +
        '<aggFn>If(...) for multi-cohort comparison in one call ' +
        '(e.g. p99_before + p99_after side-by-side).\n\n' +
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

      const tile = buildTile('MCP Table', 12, 4, {
        displayType,
        sourceId: input.sourceId,
        select: input.select,
        groupBy: displayType === 'number' ? undefined : input.groupBy,
        orderBy: input.orderBy,
      });

      return runConfigTile(teamId.toString(), tile, startDate, endDate);
    }),
  );
}
