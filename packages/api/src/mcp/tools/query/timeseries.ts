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
  McpSelectItem,
  mcpSelectItemSchema,
  orderBySchema,
  sourceIdSchema,
  startTimeSchema,
  validateMetricSelectItems,
  whereLanguageSchema,
  whereSchema,
} from './schemas';
import { resolveOrderBy } from './table';

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
    'clickstack_timeseries',
    {
      title: 'Time-Series Chart',
      description:
        'Plot metrics over time as a line or stacked bar chart. ' +
        'Use this when you need to visualize trends, compare time-series, ' +
        'or monitor metric changes over a time window.\n\n' +
        'Requires sourceId — call clickstack_list_sources then clickstack_describe_source first. ' +
        'Each select item defines one plotted series.\n\n' +
        'Column naming: top-level columns are PascalCase (Duration, StatusCode). ' +
        "Map attributes use bracket syntax: SpanAttributes['http.method'].\n\n" +
        '── METRIC SOURCES ──\n' +
        'When sourceId is a metric source, each select item MUST set ' +
        'metricType ("gauge"|"sum"|"histogram") and metricName (the OTel metric name). ' +
        'valueExpression defaults to "Value" — set it explicitly only to transform the value.\n' +
        'Discovery: clickstack_describe_source returns a per-kind metric-name sample; ' +
        'clickstack_list_metrics paginates the full catalog; clickstack_describe_metric ' +
        'returns attribute keys + sampled values for a single metric.\n' +
        'Per kind: gauge uses last_value/avg/min/max (or aggFn:any + isDelta:true for Prometheus-style delta); ' +
        'sum uses aggFn:"increase" for the counter increase, or sum/avg on the computed rate; ' +
        'histogram uses aggFn:"quantile" + level for percentiles, or aggFn:"count" for total bucket count.\n' +
        'TOP-N CAP: aggFn:"increase" + groupBy is capped at 20 groups by the renderer ' +
        '(top by max bucket sum). Narrow with where/groupBy to see other groups.\n' +
        'summary and exponential histogram kinds are not supported by the query renderer yet.',
      inputSchema: timeseriesSchema,
    },
    withToolTracing('clickstack_timeseries', context, async input => {
      const timeRange = parseTimeRange(input.startTime, input.endTime);
      if ('error' in timeRange) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: timeRange.error }],
        };
      }
      const { startDate, endDate } = timeRange;

      // Cast to the concrete `McpSelectItem[]` because Zod 3.x widens
      // optional-field inference at the MCP-SDK tool boundary; the
      // runtime parser still produces the correct shape.
      const select = input.select as McpSelectItem[];

      // Validate cross-field constraints (metric rules, level/quantile,
      // valueExpression presence) and surface friendly errors before we
      // touch ClickHouse.
      const validation = validateMetricSelectItems(select);
      if (validation) return validation;

      // Inject top-level where into each select item (timeseries uses
      // per-select-item aggCondition, not chart-level where)
      const { items: selectItems, warnings: mergeWarnings } =
        mergeWhereIntoSelectItems(select, input.where, input.whereLanguage);

      const tile = buildTile('MCP Timeseries', 12, 4, {
        displayType: input.shape,
        sourceId: input.sourceId,
        select: selectItems,
        groupBy: input.groupBy,
        orderBy: resolveOrderBy(input.orderBy, selectItems),
        ...(input.granularity ? { granularity: input.granularity } : {}),
      });

      const result = await runConfigTile(
        teamId.toString(),
        tile,
        startDate,
        endDate,
      );

      // Surface language-mismatch warnings so the agent knows the top-level
      // where was not applied to every select item.
      if (mergeWarnings.length > 0 && result.content?.[0]?.type === 'text') {
        try {
          const parsed = JSON.parse(result.content[0].text);
          parsed.warnings = mergeWarnings;
          result.content[0].text = JSON.stringify(parsed, null, 2);
        } catch {
          // leave result unmodified
        }
      }

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
            result.content[0].text = JSON.stringify(parsed, null, 2);
          }
        } catch {
          // If parsing fails, return the original result unmodified
        }
      }

      return result;
    }),
  );
}
