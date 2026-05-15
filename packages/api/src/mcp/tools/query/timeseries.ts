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

const timeseriesSchema = z.object({
  sourceId: sourceIdSchema,
  select: z
    .array(mcpSelectItemSchema)
    .min(1)
    .max(10)
    .describe(
      'Metrics to plot on the chart. Each item defines one series. ' +
        'Example: [{ aggFn: "count" }, { aggFn: "avg", valueExpression: "Duration" }]',
    ),
  shape: z
    .enum(['line', 'stacked_bar'])
    .optional()
    .default('line')
    .describe(
      'Chart shape. "line" for line chart (default), "stacked_bar" for stacked bar chart.',
    ),
  groupBy: groupBySchema,
  orderBy: orderBySchema,
  granularity: z
    .string()
    .optional()
    .describe(
      'Time bucket size for the chart. ' +
        'Format: "<number> <unit>" where unit is second, minute, hour, or day.\n' +
        'CORRECT: "1 minute", "5 minute", "1 hour", "1 day"\n' +
        'WRONG:   "1m", "5min", "1h" (abbreviations are not supported)\n\n' +
        'Omit to let HyperDX pick automatically based on the time range.',
    ),
  startTime: startTimeSchema,
  endTime: endTimeSchema,
});

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerTimeseries(server: McpServer, context: McpContext) {
  const { teamId } = context;

  server.registerTool(
    'hyperdx_timeseries',
    {
      title: 'Time-Series Chart',
      description:
        'Plot metrics over time as a line or stacked bar chart. ' +
        'Use this when you need to visualize trends, compare time-series, ' +
        'or monitor metric changes over a time window.\n\n' +
        'Requires sourceId — call hyperdx_list_sources first. ' +
        'Each select item defines one plotted series.\n\n' +
        'Column naming: top-level columns are PascalCase (Duration, StatusCode). ' +
        "Map attributes use bracket syntax: SpanAttributes['http.method'].",
      inputSchema: timeseriesSchema,
    },
    withToolTracing('hyperdx_timeseries', context, async input => {
      const timeRange = parseTimeRange(input.startTime, input.endTime);
      if ('error' in timeRange) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: timeRange.error }],
        };
      }
      const { startDate, endDate } = timeRange;

      const tile = buildTile('MCP Timeseries', 12, 4, {
        displayType: input.shape,
        sourceId: input.sourceId,
        select: input.select.map(s => ({
          aggFn: s.aggFn,
          where: s.where,
          whereLanguage: s.whereLanguage,
          valueExpression: s.valueExpression,
          alias: s.alias,
          level: s.level,
        })),
        groupBy: input.groupBy,
        orderBy: input.orderBy,
        ...(input.granularity ? { granularity: input.granularity } : {}),
      });

      return runConfigTile(teamId.toString(), tile, startDate, endDate);
    }),
  );
}
