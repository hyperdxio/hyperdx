import { FIXED_TIME_BUCKET_EXPR_ALIAS } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { z } from 'zod';

import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';

import {
  annotateIncreaseTopNHint,
  appendHint,
  buildTile,
  mergeWhereIntoSelectItems,
  parseTimeRange,
  runConfigTile,
} from './helpers';
import {
  applyMetricSelectDefaults,
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

export function registerTimeseries({ context, registerTool }: ToolRegistrar) {
  const { teamId } = context;

  registerTool(
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
    async input => {
      const timeRange = parseTimeRange(input.startTime, input.endTime);
      if ('error' in timeRange) {
        return mcpUserError(timeRange.error);
      }
      const { startDate, endDate } = timeRange;

      // Cast to the concrete `McpSelectItem[]` because Zod 3.x widens
      // optional-field inference at the MCP-SDK tool boundary; the
      // runtime parser still produces the correct shape.
      const rawSelect = input.select as McpSelectItem[];

      // Validate cross-field constraints (metric rules, level/quantile,
      // valueExpression presence) and surface friendly errors before we
      // touch ClickHouse.
      const validation = validateMetricSelectItems(rawSelect);
      if (validation) return validation;

      // Default valueExpression="Value" for metric items BEFORE we call
      // buildTile, because the external dashboard tile schema's
      // superRefine rejects non-count aggregations with empty
      // valueExpression and agents normally omit the field on metric
      // queries.
      const select = applyMetricSelectDefaults(rawSelect);

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
        { granularity: input.granularity },
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

      // Surface the increase+groupBy top-N cap so the agent knows results
      // may be truncated to 20 groups.
      annotateIncreaseTopNHint(result, select, input.groupBy);

      // Time-dimension hints, keyed on the renderer's time-bucket column
      // (FIXED_TIME_BUCKET_EXPR_ALIAS) in result.meta rather than on a raw
      // row count. Counting rows conflated three cases: genuine collapse,
      // a single group under groupBy (working as intended), and the
      // no-time-bucket case — where "use a coarser granularity" is
      // actively wrong advice.
      if (
        result.content?.[0]?.type === 'text' &&
        !('isError' in result && result.isError)
      ) {
        try {
          const parsed = JSON.parse(result.content[0].text);
          const data = parsed?.result?.data;
          const meta = parsed?.result?.meta;
          if (Array.isArray(data) && data.length > 0) {
            const hasTimeBucket =
              Array.isArray(meta) &&
              meta.some(
                (m: { name?: string }) =>
                  m?.name === FIXED_TIME_BUCKET_EXPR_ALIAS,
              );
            if (!hasTimeBucket) {
              // No time bucket column — the result is not bucketed over
              // time at all (a single aggregate per group). Adjusting
              // granularity cannot help here.
              appendHint(
                parsed,
                `Result is not bucketed over time (no ${FIXED_TIME_BUCKET_EXPR_ALIAS} column). ` +
                  `Each row is a single aggregate over the whole range ` +
                  `(${startDate.toISOString()} to ${endDate.toISOString()}). ` +
                  `Pass a granularity (e.g. "1 minute", "1 hour") to get a per-bucket time series.`,
              );
              result.content[0].text = JSON.stringify(parsed, null, 2);
            } else if (data.length === 1) {
              // Genuine single-bucket collapse: the time bucket is present
              // but everything landed in one bucket. Coarser/adjust-range
              // advice is appropriate here.
              appendHint(
                parsed,
                `Timeseries returned only 1 time bucket. ` +
                  `All data may have collapsed into a single bucket over ` +
                  `${startDate.toISOString()} to ${endDate.toISOString()}. ` +
                  `If this looks wrong, widen startTime/endTime to match the actual data range, ` +
                  `or try a finer granularity.`,
              );
              result.content[0].text = JSON.stringify(parsed, null, 2);
            }
          }
        } catch {
          // If parsing fails, return the original result unmodified
        }
      }

      return result;
    },
  );
}
