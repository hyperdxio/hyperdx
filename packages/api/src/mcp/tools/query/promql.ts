import { SQLIntervalSchema } from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import { READ_ONLY_TOOL } from '@/mcp/tools/annotations';
import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';

import { buildTile, parseTimeRange, runConfigTile } from './helpers';
import { endTimeSchema, startTimeSchema } from './schemas';

// ─── Schema ──────────────────────────────────────────────────────────────────

const promqlSchema = z.object({
  sourceId: z
    .string()
    .describe(
      'ID of a source whose kind is "promql". Call clickstack_list_sources to ' +
        'find it, and clickstack_describe_source for its metric and label names.',
    ),
  expression: z
    .string()
    .max(10000)
    .describe(
      'PromQL expression, e.g. sum by (job) (rate(http_requests_total[$__rate_interval])). ' +
        'The $__interval, $__rate_interval and $__range macros expand as they do ' +
        'in a PromQL tile. Dashboard variables such as $job do not resolve here: ' +
        'write the value inline.',
    ),
  queryType: z
    .enum(['range', 'instant'])
    .optional()
    .describe(
      '"range" (the default) evaluates the expression at every step between ' +
        'startTime and endTime and returns time series rows. "instant" evaluates ' +
        'it once at endTime and returns one row per series with a column per label.',
    ),
  granularity: z
    .union([SQLIntervalSchema, z.literal('auto')])
    .optional()
    .describe(
      'Step between points of a range query, as "<number> <unit>" with unit ' +
        'second, minute, hour or day (e.g. "30 second", "5 minute"). Same format ' +
        "as a PromQL tile's granularity; also sets $__interval. Omit for the " +
        'auto step a tile would use (about 80 points over the range). Ignored ' +
        'for instant queries.',
    ),
  startTime: startTimeSchema,
  endTime: endTimeSchema,
});

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerPromql({ context, registerTool }: ToolRegistrar) {
  const { teamId } = context;

  registerTool(
    'clickstack_promql',
    {
      title: 'PromQL Query',
      annotations: READ_ONLY_TOOL,
      description:
        'Run a PromQL expression against a PromQL source (a Prometheus-compatible ' +
        'endpoint or a ClickHouse TimeSeries table). Use this for every question ' +
        'about Prometheus metrics; the builder tools (clickstack_timeseries, ' +
        'clickstack_table, clickstack_search) do not read PromQL sources.\n\n' +
        'Discovery: clickstack_list_sources lists sources with kind "promql"; ' +
        'clickstack_describe_source lists their metric names and label names.\n\n' +
        'A range query (the default) returns rows { __hdx_time_bucket, ' +
        'series_name, value } plus seriesLabels, which maps each series_name to ' +
        'its labels once. An instant query returns one row per series with a ' +
        'column per label plus Value, capped at 10,000 series.\n\n' +
        'Counters need rate() or increase(), e.g. ' +
        'sum by (job) (rate(http_requests_total[$__rate_interval])). Percentiles ' +
        'from histograms: histogram_quantile(0.95, sum by (le) ' +
        '(rate(http_request_duration_seconds_bucket[$__rate_interval]))). ' +
        'Fetch the query_guide prompt for more.\n\n' +
        'The result matches what a PromQL dashboard tile with the same ' +
        'expression and granularity shows, so an expression that works here can ' +
        'be saved as a tile with clickstack_save_dashboard as is.',
      inputSchema: promqlSchema,
    },
    async input => {
      const timeRange = parseTimeRange(input.startTime, input.endTime);
      if ('error' in timeRange) {
        return mcpUserError(timeRange.error);
      }
      const { startDate, endDate } = timeRange;

      // The query runs as a one-tile dashboard that is never saved, through
      // the same path as clickstack_query_tile, so results and errors match a
      // saved PromQL tile. A range query is a line tile; an instant query is a
      // table tile, which lays each series out with a column per label.
      const tile =
        input.queryType === 'instant'
          ? buildTile('MCP PromQL', 24, 6, {
              configType: 'promql' as const,
              displayType: 'table' as const,
              sourceId: input.sourceId,
              expressions: [
                { expression: input.expression, queryType: 'instant' as const },
              ],
            })
          : buildTile('MCP PromQL', 24, 6, {
              configType: 'promql' as const,
              displayType: 'line' as const,
              sourceId: input.sourceId,
              expressions: [{ expression: input.expression }],
              granularity: input.granularity,
            });

      return runConfigTile(teamId.toString(), tile, startDate, endDate);
    },
  );
}
