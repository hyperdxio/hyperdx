import { SourceKind } from '@hyperdx/common-utils/dist/types';

import * as config from '@/config';
import type { McpContext } from '@/mcp/tools/types';

export function isPromqlEnabled(context: McpContext): boolean {
  return context.promqlEnabled ?? config.IS_PROMQL_ENABLED;
}

/** Whether MCP hides `source` from the agent: PromQL sources while PromQL is off. */
export function isHiddenSource(
  context: McpContext,
  source: { kind: SourceKind },
): boolean {
  return source.kind === SourceKind.Promql && !isPromqlEnabled(context);
}

export const PROMQL_QUERY_USAGE =
  'PromQL sources hold Prometheus metrics and are queried with PromQL. The ' +
  'builder query tools (clickstack_timeseries, clickstack_table, ' +
  'clickstack_search) do not read them.';

export function timeSeriesSqlUsage(table: string): string {
  return (
    `clickstack_sql can read ${table} through the timeSeriesTags(${table}) ` +
    `(id, metric_name, tags) and timeSeriesData(${table}) (id, timestamp, ` +
    'value) table functions, joined on id.'
  );
}

export const PROMQL_SOURCE_USAGE =
  `${PROMQL_QUERY_USAGE} A PromQL source with backend "clickhouse" is a ` +
  `ClickHouse TimeSeries table: ${timeSeriesSqlUsage('<table>')} ` +
  'Call clickstack_describe_source to list label names and metric names.';
