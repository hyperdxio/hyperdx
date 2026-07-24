import { z } from 'zod';

import { QUERYABLE_METRIC_KINDS } from '@/mcp/tools/sources/metricKinds';
import type { McpErrorResult } from '@/mcp/utils/errors';
import { mcpUserError } from '@/mcp/utils/errors';

// ─── Shared description fragments ────────────────────────────────────────────

const WHERE_DESCRIPTION =
  'Row filter.\n\n' +
  'FIRST: pick a language (whereLanguage):\n' +
  '  Lucene (default): Column:value          e.g. level:error\n' +
  '  Lucene map attrs: Column.key:value      e.g. SpanAttributes.http.method:GET\n' +
  "  SQL:              Column = 'value'       e.g. StatusCode = 500\n" +
  "  SQL map attrs:    SpanAttributes['key'] = 'value'\n\n" +
  'MAP ATTRIBUTES:\n' +
  '  Lucene uses DOT notation:    SpanAttributes.http.method:GET\n' +
  "  SQL uses BRACKET notation:   SpanAttributes['http.method'] = 'GET'\n\n" +
  "WRONG: SpanAttributes['key']:value   (Lucene cannot parse bracket syntax)\n" +
  'WRONG: level = "error"               (SQL syntax with whereLanguage:"lucene")\n\n' +
  'SUBSTRING TRAP: Lucene field:value matches ANY row containing "value" as a substring, not exact equality.\n' +
  '  SpanKind:Server matches "Server", "ServerStreaming", "InternalServer", etc.\n' +
  "  For exact match, use SQL: SpanKind = 'Server'";

const WHERE_LANGUAGE_DESCRIPTION =
  'Query language for the "where" filter. Default: lucene.\n' +
  'IMPORTANT: the syntax in "where" MUST match "whereLanguage".\n' +
  '  Lucene (default): Column:value, Column.mapKey:value, Column:>100\n' +
  "  SQL:              Column = 'value', SpanAttributes['key'] = 'value'\n\n" +
  'Lucene supports comparisons (>= > < <=), wildcards (field:val*), ranges ([1 TO 5]), ' +
  'and map attributes via dot notation. Use "sql" for IN(...) lists, complex expressions, or function calls.\n' +
  'IMPORTANT: Lucene field:value is a SUBSTRING match (ilike), not exact equality. ' +
  'field:val* is prefix-within-substring, not a true prefix match. ' +
  "For exact matching or reliable wildcards, use SQL: WHERE field = 'value' or WHERE field LIKE 'val%'.\n\n" +
  'Common mistake: writing Column:value (Lucene) but setting whereLanguage to "sql". ' +
  'If your filter uses colon syntax, leave whereLanguage as "lucene" (the default).';

// ─── Shared Zod schemas ──────────────────────────────────────────────────────

/**
 * Aggregation function names exposed to MCP tool callers.
 * This is the single source of truth — used by both the Zod input schema
 * (mcpAggFnSchema) and the orderBy resolver in table.ts (AGG_FN_NAMES Set).
 */
export const MCP_AGG_FN_OPTIONS = [
  'avg',
  'count',
  'count_distinct',
  'last_value',
  'max',
  'min',
  'quantile',
  'sum',
  'none',
  // 'increase' is only valid for Sum (counter) metrics. The renderer
  // computes the per-bucket counter increase with reset-handling; the
  // bare aggFn string maps to that behavior, not a SQL function.
  'increase',
] as const;

const mcpAggFnSchema = z
  .enum(MCP_AGG_FN_OPTIONS)
  .describe(
    'Aggregation function:\n' +
      '  count – count matching rows (no valueExpression needed)\n' +
      '  sum / avg / min / max – aggregate a numeric column (valueExpression required)\n' +
      '  count_distinct – unique value count (valueExpression required)\n' +
      '  quantile – percentile; also set level (valueExpression required)\n' +
      '  last_value – most recent value of a column\n' +
      '  none – pass a raw expression through unchanged\n' +
      '  increase – METRIC-ONLY (Sum/counter): per-bucket counter increase, ' +
      'reset-aware. Requires metricType:"sum" and metricName.',
  );

/**
 * Metric type values exposed to MCP tool callers. Restricted to the kinds the
 * renderer can translate today; summary is intentionally excluded. See
 * `../sources/metricKinds` for the shared
 * source-of-truth constant used by every metric-aware tool.
 */
const mcpMetricTypeSchema = z
  .enum(QUERYABLE_METRIC_KINDS)
  .describe(
    'METRIC SOURCES ONLY. OTel metric kind. Required (along with metricName) ' +
      'when querying a metric source — discover via clickstack_describe_source ' +
      'or clickstack_describe_metric.\n' +
      '  gauge – instantaneous values (CPU, memory, queue depth). Use last_value/avg/min/max; set isDelta:true for Prometheus-style delta over the bucket.\n' +
      '  sum – cumulative or delta counters (request counts, bytes processed). Use aggFn:"increase" for counter increase, or sum/avg on the computed rate.\n' +
      '  histogram – bucketed distributions (request duration). Use aggFn:"quantile" with level for percentiles, or aggFn:"count" for total bucket count.\n' +
      '  exponential histogram – exponential-bucket distributions. Use aggFn:"quantile" with level for percentiles, or aggFn:"count" for total bucket count.\n' +
      'NOTE: summary is not supported by the query renderer.',
  );

/**
 * Shared cross-field validation issues for MCP select items. Returns the
 * list of Zod issues a `.superRefine` callback should emit. Kept as a pure
 * function so both `mcpSelectItemSchema` (query tools) and
 * `mcpTileSelectItemSchema` (dashboard tile tools) can call it inline
 * without widening Zod's output type inference.
 *
 * Constraints enforced:
 *   - metricType + metricName must be set together
 *   - aggFn:"increase" is Sum-only
 *   - histogram metrics only support quantile (with level) or count
 *   - isDelta is Gauge-only
 *   - level still requires aggFn:"quantile"
 *   - valueExpression is required for non-count aggFns UNLESS metricType is
 *     set (defaults to "Value" for metric sources)
 *
 * Note: summary is not in the input enum, so it is rejected by the field
 * schema before reaching this function.
 */
export function getMetricSelectIssues(data: {
  aggFn?: string;
  metricType?: string;
  metricName?: string;
  isDelta?: boolean;
  level?: number;
  valueExpression?: string;
}): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];

  // metricType ↔ metricName must be set together
  if (data.metricType && !data.metricName) {
    issues.push({
      path: ['metricName'],
      message:
        'metricName is required when metricType is set. Discover metric names ' +
        'via clickstack_list_metrics or clickstack_describe_source.',
    });
  }
  if (data.metricName && !data.metricType) {
    issues.push({
      path: ['metricType'],
      message:
        'metricType is required when metricName is set. Use one of: gauge, sum, histogram, exponential histogram.',
    });
  }

  // increase is Sum-only
  if (data.aggFn === 'increase' && data.metricType !== 'sum') {
    issues.push({
      path: ['aggFn'],
      message:
        'aggFn "increase" is only valid for sum (counter) metrics. ' +
        'Set metricType:"sum" and metricName, or pick a different aggFn.',
    });
  }

  // Histogram kinds support only quantile (+ level) or count today
  if (
    data.metricType === 'histogram' ||
    data.metricType === 'exponential histogram'
  ) {
    const kindLabel =
      data.metricType === 'histogram' ? 'Histogram' : 'Exponential histogram';
    if (data.aggFn !== 'quantile' && data.aggFn !== 'count') {
      issues.push({
        path: ['aggFn'],
        message: `${kindLabel} metrics only support aggFn "quantile" (with level) or "count" today.`,
      });
    }
    if (data.aggFn === 'quantile' && data.level == null) {
      issues.push({
        path: ['level'],
        message:
          `level is required when aggFn is "quantile" on an ${data.metricType} metric. ` +
          'Use 0.5, 0.9, 0.95, or 0.99.',
      });
    }
  }

  // isDelta is Gauge-only
  if (data.isDelta && data.metricType !== 'gauge') {
    issues.push({
      path: ['isDelta'],
      message: 'isDelta is only valid for gauge metrics (metricType:"gauge").',
    });
  }

  // level requires aggFn:"quantile"
  if (data.level != null && data.aggFn !== 'quantile') {
    issues.push({
      path: ['level'],
      message: 'level is only valid with aggFn:"quantile".',
    });
  }

  // valueExpression rules:
  //   - "count" never takes a valueExpression (existing rule)
  //   - non-count aggFns require valueExpression UNLESS metricType is set
  //     (metric sources default valueExpression to "Value" in the helper)
  if (data.valueExpression && data.aggFn === 'count') {
    issues.push({
      path: ['valueExpression'],
      message: 'valueExpression cannot be used with aggFn:"count".',
    });
  } else if (
    !data.valueExpression &&
    data.aggFn !== 'count' &&
    !data.metricType
  ) {
    issues.push({
      path: ['valueExpression'],
      message:
        'valueExpression is required for non-count aggregation functions ' +
        '(or set metricType to query a metric source, which defaults valueExpression to "Value").',
    });
  }

  return issues;
}

export const mcpSelectItemSchema = z.object({
  aggFn: mcpAggFnSchema,
  valueExpression: z
    .string()
    .optional()
    .describe(
      'ClickHouse SQL expression to aggregate. Required for every aggFn except "count". ' +
        'Top-level columns are PascalCase (Duration, StatusCode); ' +
        "map attributes use bracket syntax: SpanAttributes['key'], ResourceAttributes['key']. " +
        'Any ClickHouse expression is allowed — common useful forms: ' +
        '"Duration / 1e6" (ns→ms), ' +
        '"toFloat64OrZero(SpanAttributes[\'response.size_bytes\'])" (cast attribute), ' +
        '"if(StatusCode = \'STATUS_CODE_ERROR\', 1, 0)" (boolean→numeric for ratios).\n\n' +
        'METRIC SOURCES: optional — defaults to "Value" (the metric value column) when ' +
        'metricType/metricName are set. Set explicitly only if you want to transform the ' +
        'metric value (e.g. "Value / 1e6").',
    ),
  where: z
    .string()
    .optional()
    .default('')
    .describe(
      'Conditional aggregation filter — restricts which rows are included in THIS metric ' +
        '(combined with the top-level time/where filter via AND). ' +
        'Compiles to <aggFn>If(...): e.g. quantile + where=Timestamp<X → quantileIf(0.99)(Duration, Timestamp<X). ' +
        'Use this to compute before/after deltas or per-segment metrics in a single query: ' +
        'set where: "Timestamp < \'2026-05-09T23:40:00Z\'" on one item and ' +
        '"Timestamp >= \'2026-05-09T23:40:00Z\'" on another to get baseline-vs-anomaly p99 ' +
        'in one round trip — much faster than re-running the same query with a different time range. ' +
        'Examples (lucene): "level:error", "service.name:api AND http.status_code:>=500". ' +
        'Set whereLanguage:"sql" for raw SQL conditions like ' +
        "\"SpanAttributes['http.method'] = 'POST'\" or \"Timestamp < '2026-05-09 23:40:00'\".",
    ),
  whereLanguage: z
    .enum(['lucene', 'sql'])
    .optional()
    .default('lucene')
    .describe(
      'Query language for the per-item conditional filter. ' +
        'Use "sql" when comparing to literal timestamps or arbitrary attribute expressions. ' +
        'Default: lucene',
    ),
  alias: z
    .string()
    .optional()
    .describe(
      'Display label for this series — used in chart legends, table column headers, CSV exports, and onClick templates. ' +
        'Always set a short, human-readable alias (e.g. "Requests", "P95 Latency", "Error Rate"). ' +
        'Without an alias the UI shows the raw ClickHouse expression (e.g. count(), quantile(0.95)(Duration)) which is hard to read.',
    ),
  level: z
    .union([z.literal(0.5), z.literal(0.9), z.literal(0.95), z.literal(0.99)])
    .optional()
    .describe(
      'Percentile level. Required when aggFn is "quantile" on a histogram or exponential histogram metric, ' +
        'optional otherwise. ' +
        'Allowed values: 0.5, 0.9, 0.95, 0.99',
    ),
  metricType: mcpMetricTypeSchema
    .optional()
    .describe(
      'METRIC SOURCES ONLY. OTel metric kind: gauge, sum, histogram, or exponential histogram. ' +
        'Required (with metricName) when sourceId is a metric source. ' +
        'Discover via clickstack_describe_source (sample) or clickstack_describe_metric.',
    ),
  metricName: z
    .string()
    .optional()
    .describe(
      'METRIC SOURCES ONLY. OTel metric name (e.g. "system.cpu.utilization", ' +
        '"http.server.request.duration"). Required when metricType is set. ' +
        'Discover via clickstack_list_metrics or clickstack_describe_source.',
    ),
  isDelta: z
    .boolean()
    .optional()
    .describe(
      'METRIC SOURCES ONLY (gauge metrics). When true, computes the Prometheus-style ' +
        'delta over each bucket: (argMax(Value) - argMin(Value)) * bucketSecs / timeDiff. ' +
        'Use for cumulative gauges where you want to chart growth per bucket. Default false.',
    ),
});
// NOTE: cross-field validation (metric rules + level + valueExpression) is
// applied imperatively in the timeseries / table tool handlers via
// `validateMetricSelectItems`. We intentionally skip `.superRefine` here
// because Zod 3.x widens optional-field types post-refine, which breaks
// strict-typed downstream consumers like `mergeWhereIntoSelectItems` and
// `resolveOrderBy`. The dashboard tile schema, whose consumers don't trip
// on the widening, keeps its own `.superRefine`.

/**
 * Concrete shape of a parsed MCP select item. Mirrors the runtime values
 * produced by `mcpSelectItemSchema` — needed as an explicit type because
 * Zod 3.x's structural inference of `z.object({...})` callbacks (e.g. the
 * MCP SDK's tool-handler input) can widen optional-field types into
 * `unknown`. Cast `input.select` to `McpSelectItem[]` at tool boundaries.
 */
export type McpSelectItem = {
  aggFn: string;
  valueExpression?: string;
  where?: string;
  whereLanguage?: 'lucene' | 'sql';
  alias?: string;
  level?: number;
  metricType?: 'gauge' | 'sum' | 'histogram' | 'exponential histogram';
  metricName?: string;
  isDelta?: boolean;
};

/**
 * Default `valueExpression` to `"Value"` for every non-count metric-tagged
 * select item that omits it. Count must remain expressionless because the
 * external dashboard tile schema rejects value expressions on count. This
 * must be called BEFORE `buildTile`, whose schema requires an expression for
 * every other aggregation. The runtime renderer looks for `Value` on metric
 * tables, so defaulting it here matches the REST path.
 */
export function applyMetricSelectDefaults<T extends McpSelectItem>(
  items: ReadonlyArray<T>,
): T[] {
  return items.map(item =>
    item.metricType && item.aggFn !== 'count' && !item.valueExpression
      ? { ...item, valueExpression: 'Value' }
      : item,
  );
}

/**
 * Apply `getMetricSelectIssues` to every select item in a tool input.
 * Returns an error-shaped tool response when any issue is detected, or
 * `null` when all items pass. Call this from a tool handler before
 * passing items to `runConfigTile`.
 */
export function validateMetricSelectItems(
  items: ReadonlyArray<McpSelectItem>,
): McpErrorResult | null {
  const errors: string[] = [];
  items.forEach((item, idx) => {
    for (const issue of getMetricSelectIssues(item)) {
      errors.push(`select[${idx}].${issue.path.join('.')}: ${issue.message}`);
    }
  });
  if (errors.length === 0) return null;
  return mcpUserError(errors.join('\n'));
}

export const startTimeSchema = z
  .string()
  .optional()
  .describe(
    'Start of the query window as ISO 8601. Default: 15 minutes ago. ' +
      'If results are empty, try a wider range (e.g. 24 hours).',
  );

export const endTimeSchema = z
  .string()
  .optional()
  .describe('End of the query window as ISO 8601. Default: now.');

export const sourceIdSchema = z
  .string()
  .describe(
    'Source ID (required). Call clickstack_list_sources to find available sources.',
  );

export const whereSchema = z
  .string()
  .optional()
  .default('')
  .describe(WHERE_DESCRIPTION);

export const whereLanguageSchema = z
  .enum(['lucene', 'sql'])
  .optional()
  .default('lucene')
  .describe(WHERE_LANGUAGE_DESCRIPTION);

export const groupBySchema = z
  .string()
  .optional()
  .describe(
    'Column(s) or ClickHouse expression(s) to group/split by. ' +
      'Accepts a SINGLE entry or MULTIPLE entries as a comma-delimited list — ' +
      'multi-column groupBy expresses multi-dimensional breakdowns in one ' +
      'query (e.g. "ServiceName, SpanName, StatusMessage") instead of running ' +
      'one query per dimension. For "table" displayType, the result has one row ' +
      'per distinct combination of group values. ' +
      'Top-level columns use PascalCase ("SpanName", "StatusCode"). ' +
      "Map attributes: SpanAttributes['key'], ResourceAttributes['key'].\n\n" +
      'Arbitrary ClickHouse expressions are also allowed in groupBy — useful when ' +
      'you need to group by a derived column without falling back to raw SQL:\n' +
      '  - "substring(Body, 1, 80)" — group by body prefix (log pattern bucketing)\n' +
      '  - "toStartOfInterval(Timestamp, INTERVAL 5 MINUTE)" — explicit time bucketing ' +
      'in a table view, alongside another dimension (granularity only works for line/stacked_bar)\n' +
      '  - "JSONExtractString(Body, \'event\')" — parse a JSON field from the body\n' +
      "  - \"if(Duration > 1e9, 'slow', 'fast')\" — coarse boolean buckets\n" +
      'Comma splitting is bracket-aware, so multi-arg function calls work as single entries.',
  );

export const orderBySchema = z
  .string()
  .optional()
  .describe(
    'Sort results by this column. ' +
      'When ordering by an alias that contains spaces or special characters, ' +
      `wrap the alias in quotes: e.g. '"P95 Latency" DESC'.`,
  );
