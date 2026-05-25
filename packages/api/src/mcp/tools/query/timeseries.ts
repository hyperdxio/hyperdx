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
  mcpSelectItemSchema,
  orderBySchema,
  sourceIdSchema,
  startTimeSchema,
  whereLanguageSchema,
  whereSchema,
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
  where: whereSchema.describe(
    'Row filter applied to ALL select items. ' +
      'Scopes the entire query — use to restrict by service, severity, etc. ' +
      'Each select item can also have its own per-metric "where" for cohort comparisons. ' +
      'When both are set, they are ANDed together.',
  ),
  whereLanguage: whereLanguageSchema,
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
        'Requires sourceId — call hyperdx_list_sources then hyperdx_describe_source first. ' +
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

      // Inject top-level where into each select item (timeseries uses
      // per-select-item aggCondition, not chart-level where)
      const selectItems = mergeWhereIntoSelectItems(
        input.select,
        input.where,
        input.whereLanguage,
      );

      const tile = buildTile('MCP Timeseries', 12, 4, {
        displayType: input.shape,
        sourceId: input.sourceId,
        select: selectItems,
        groupBy: input.groupBy,
        orderBy: input.orderBy,
        ...(input.granularity ? { granularity: input.granularity } : {}),
      });

      const result = await runConfigTile(
        teamId.toString(),
        tile,
        startDate,
        endDate,
      );

      // Detect single-bucket collapse: when a timeseries query returns only
      // 1 row, the data likely collapsed into a single time bucket. Add a
      // hint so the agent knows to adjust the time range.
      if (
        result.content?.[0]?.type === 'text' &&
        !('isError' in result && result.isError)
      ) {
        try {
          const parsed = JSON.parse(result.content[0].text);
          const data = parsed?.result?.data;
          if (Array.isArray(data) && data.length === 1 && input.granularity) {
            parsed.hint =
              `Timeseries returned only 1 time bucket. ` +
              `All data may have collapsed into a single "${input.granularity}" bucket. ` +
              `The queried range was ${startDate.toISOString()} to ${endDate.toISOString()}. ` +
              `If this looks wrong, adjust startTime/endTime to match the actual data range, ` +
              `or try a coarser granularity.`;
            result.content[0].text = JSON.stringify(parsed);
          }
        } catch {
          // If parsing fails, return the original result unmodified
        }
      }

      return result;
    }),
  );
}
