import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

/**
 * Metric kinds the query renderer can translate today. Mirrors the three
 * MetricsDataType members that `translateMetricChartConfig` in
 * common-utils branches over; `summary` and `"exponential histogram"`
 * are intentionally excluded because the renderer throws on them.
 *
 * Declared as plain string literals (not MetricsDataType enum members)
 * so `z.enum(...)` narrows correctly at the MCP SDK callback boundary —
 * referencing the enum here pessimises Zod's inference to `unknown` on
 * every optional field of the surrounding tool input schema, which then
 * cascades into "not assignable to type string" errors at every handler
 * call site. The compile-time assertion below guarantees the literals
 * stay in sync with the enum so adding a new queryable kind cannot be
 * done in only one place.
 *
 * Imported by every metric-aware MCP tool (clickstack_describe_source,
 * clickstack_list_metrics, clickstack_describe_metric) and by the
 * clickstack_timeseries / clickstack_table select-item schema.
 */
export const QUERYABLE_METRIC_KINDS = ['gauge', 'sum', 'histogram'] as const;

export type QueryableMetricKind = (typeof QUERYABLE_METRIC_KINDS)[number];

// Compile-time assertion that the string literals above still match the
// MetricsDataType enum members. If a future MetricsDataType rename
// breaks this list, this line fails to type-check.
const _assertKindsMatchEnum: readonly QueryableMetricKind[] = [
  MetricsDataType.Gauge,
  MetricsDataType.Sum,
  MetricsDataType.Histogram,
];
void _assertKindsMatchEnum;
