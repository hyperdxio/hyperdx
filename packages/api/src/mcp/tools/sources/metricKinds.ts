import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

/**
 * Metric kinds the query renderer can translate today. Mirrors the three
 * MetricsDataType members that `translateMetricChartConfig` in
 * common-utils branches over. `summary` is intentionally excluded because
 * the renderer throws on it.
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
export const QUERYABLE_METRIC_KINDS = [
  'gauge',
  'sum',
  'histogram',
  'exponential histogram',
] as const;

export type QueryableMetricKind = (typeof QUERYABLE_METRIC_KINDS)[number];

// Compile-time assertion that the string literals above still match the
// MetricsDataType enum members. If a future MetricsDataType rename
// breaks this list, this line fails to type-check.
const _assertKindsMatchEnum: readonly QueryableMetricKind[] = [
  MetricsDataType.Gauge,
  MetricsDataType.Sum,
  MetricsDataType.Histogram,
  MetricsDataType.ExponentialHistogram,
];
void _assertKindsMatchEnum;

/**
 * Allowed kind keys on the `metricTables` map when serialising a metric
 * source into an MCP response. Includes the non-queryable `summary` kind
 * because the model schema declares its table even though the query renderer
 * cannot translate it.
 */
const ALLOWED_METRIC_TABLE_KINDS: readonly string[] =
  Object.values(MetricsDataType);

/**
 * Filter source.metricTables to the known kind keys before emitting it
 * in a clickstack_list_sources / clickstack_describe_source response.
 *
 * Belt-and-braces defense: even after the model schema declares
 * `_id: false` on the metricTables subdoc, existing documents persisted
 * before the schema fix may still carry a stray `_id` value that
 * Mongoose serialises alongside the legitimate kind keys. Filtering at
 * the response boundary keeps the agent-facing payload free of
 * implementation-detail keys.
 *
 * Accepts both plain objects and Mongoose subdocuments — we look up
 * each allowed kind via property access rather than enumerating keys,
 * because Mongoose subdoc instances expose field values through getters
 * (not as own enumerable properties).
 */
export function sanitizeMetricTables(
  metricTables: Record<string, unknown> | undefined | null,
): Record<string, string> | undefined {
  if (!metricTables) return undefined;
  const source = metricTables as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const kind of ALLOWED_METRIC_TABLE_KINDS) {
    const value = source[kind];
    if (typeof value === 'string' && value.length > 0) {
      out[kind] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
