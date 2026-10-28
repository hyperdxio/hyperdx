import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import { sanitizeMetricTables } from './metricKinds';

// Flat z.object re-validated at runtime against SourceSchemaNoId: the MCP SDK
// can't serialize that discriminated union, so every kind-specific field is
// optional here and the per-kind rules are enforced by safeParse in saveSource.
//
// String literals (not SourceKind members) so z.enum narrows at the MCP SDK
// boundary; the assertion keeps them in sync with the enum.
const SOURCE_KINDS = ['log', 'trace', 'session', 'metric', 'promql'] as const;
const _assertSourceKindsMatchEnum: readonly (typeof SOURCE_KINDS)[number][] = [
  SourceKind.Log,
  SourceKind.Trace,
  SourceKind.Session,
  SourceKind.Metric,
  SourceKind.Promql,
];
void _assertSourceKindsMatchEnum;

// Advanced nested config, modeled loosely (SourceSchemaNoId does the strict
// validation) so it round-trips through describe_source -> save_source.
// Granularity fields use the internal "<n> <unit>" form (e.g. "5 minute").
const highlightedAttributeExpressionsSchema = z.array(
  z.object({
    sqlExpression: z
      .string()
      .describe(
        "ClickHouse SQL expression for the attribute, e.g. ResourceAttributes['http.host'].",
      ),
    luceneExpression: z
      .string()
      .optional()
      .describe(
        'Lucene version of sqlExpression, e.g. ResourceAttributes.http.host. ' +
          'When set, it is used when searching for this attribute value.',
      ),
    alias: z
      .string()
      .optional()
      .describe('Display name for the attribute (rendered as AS <alias>).'),
  }),
);

const aggregatedColumnSchema = z.object({
  sourceColumn: z
    .string()
    .optional()
    .describe(
      'Column in the source table that the view aggregates. Required unless aggFn is "count".',
    ),
  aggFn: z
    .string()
    .describe(
      'Aggregate function the view applies to sourceColumn, e.g. count, sum, avg, min, max, quantile, histogram.',
    ),
  mvColumn: z
    .string()
    .describe(
      'Column in the materialized view that holds the aggregated value.',
    ),
});

const materializedViewsSchema = z.array(
  z.object({
    databaseName: z
      .string()
      .describe('ClickHouse database containing the materialized view table.'),
    tableName: z
      .string()
      .describe('ClickHouse table the materialized view writes to.'),
    dimensionColumns: z
      .string()
      .describe(
        'Comma-separated columns that are not pre-aggregated and can be used ' +
          'for filtering and grouping, e.g. "ServiceName, StatusCode".',
      ),
    minGranularity: z
      .string()
      .describe(
        'Time bucket size of the view\'s timestamp column, as "<n> <unit>" ' +
          'with unit second, minute, hour, or day, e.g. "1 minute".',
      ),
    minDate: z
      .string()
      .nullish()
      .describe(
        'ISO 8601 datetime of the earliest data in the view. Omit or null to ' +
          'assume the view covers every date the source table has data for.',
      ),
    timestampColumn: z
      .string()
      .describe('Timestamp column in the materialized view table.'),
    aggregatedColumns: z
      .array(aggregatedColumnSchema)
      .describe(
        'Columns the view pre-aggregates. At least one entry is required.',
      ),
  }),
);

const metadataMaterializedViewsSchema = z.object({
  keyRollupTable: z
    .string()
    .nullish()
    .describe(
      'Deprecated. Key rollup table used for field discovery; kvRollupTable is used when unset.',
    ),
  kvRollupTable: z
    .string()
    .describe(
      "Key-value rollup table in the source's database, used for field discovery " +
        'and value autocomplete, e.g. "otel_logs_kv_rollup_15m".',
    ),
  granularity: z
    .string()
    .describe(
      'Time bucket size of the rollup tables, as "<n> <unit>" with unit ' +
        'second, minute, hour, or day, e.g. "15 minute".',
    ),
});

const metricTablesSchema = z
  .object({
    gauge: z
      .string()
      .optional()
      .describe('Table containing gauge metrics data.'),
    histogram: z
      .string()
      .optional()
      .describe('Table containing histogram metrics data.'),
    sum: z.string().optional().describe('Table containing sum metrics data.'),
    summary: z
      .string()
      .optional()
      .describe(
        'Table containing summary metrics data. Summary metrics cannot be ' +
          'queried with clickstack_timeseries / clickstack_table; use clickstack_sql.',
      ),
    'exponential histogram': z
      .string()
      .optional()
      .describe('Table containing exponential histogram metrics data.'),
  })
  .describe(
    'Metric source only. Map of OTel metric kind to the ClickHouse table (in ' +
      'databaseName) holding that kind. At least one entry is required for ' +
      'metric sources.',
  );

export const mcpSaveSourceSchema = z.object({
  // ── Update selector ──
  id: z
    .string()
    .optional()
    .describe(
      'ID of the source to update, from clickstack_list_sources. Omit to create a new source.',
    ),

  // ── Always required (base) ──
  kind: z
    .enum(SOURCE_KINDS)
    .describe(
      'Type of telemetry the table holds. Determines which other fields are ' +
        'required; see the tool description.',
    ),
  name: z.string().min(1).describe('Display name shown in source selectors.'),
  connection: z
    .string()
    .min(1)
    .describe(
      'Connection ID this source reads from. Get IDs from clickstack_list_sources.',
    ),
  databaseName: z
    .string()
    .min(1)
    .describe(
      'ClickHouse database containing the table (stored as from.databaseName). ' +
        'For promql sources, use a placeholder such as "prometheus".',
    ),
  tableName: z
    .string()
    .describe(
      'ClickHouse table name (maps to from.tableName). Required for all kinds ' +
        'except metric (where it may be empty) and promql (use a placeholder).',
    ),
  timestampValueExpression: z
    .string()
    .min(1)
    .describe(
      'DateTime column or expression used for time filtering, ideally part of ' +
        "the table's primary key (e.g. Timestamp; TimeUnix for OTel metrics). " +
        'For trace sources it marks the start of the span.',
    ),

  // ── Common optional ──
  section: z
    .string()
    .optional()
    .describe(
      'Grouping label for source selectors; sources with the same section are ' +
        'listed together, e.g. "Billing".',
    ),
  displayedTimestampValueExpression: z
    .string()
    .optional()
    .describe(
      'Log and trace sources. DateTime column used to display and order search results.',
    ),
  serviceNameExpression: z
    .string()
    .optional()
    .describe(
      'Log, trace, and metric sources. Expression for the service name, e.g. ServiceName.',
    ),
  resourceAttributesExpression: z
    .string()
    .optional()
    .describe(
      'Map column or expression holding resource attributes, e.g. ' +
        'ResourceAttributes. Required for metric sources.',
    ),
  eventAttributesExpression: z
    .string()
    .optional()
    .describe(
      'Log and trace sources. Map column holding event-level attributes, e.g. ' +
        'LogAttributes for logs or SpanAttributes for traces.',
    ),
  implicitColumnExpression: z
    .string()
    .optional()
    .describe(
      'Log and trace sources. Column searched by full-text Lucene terms that ' +
        'name no field, typically the log body (Body) or SpanName.',
    ),
  knownColumnsListExpression: z
    .string()
    .optional()
    .describe(
      'Log and trace sources. For Distributed tables whose target tables have ' +
        'different column sets: comma-separated column names present in all ' +
        'targets, used instead of SELECT * when fetching full rows. Column ' +
        'names only, no expressions or aliases. Omit to select all columns.',
    ),
  orderByExpression: z
    .string()
    .optional()
    .describe(
      'Log and trace sources. ORDER BY expression overriding the default ' +
        'search ordering, e.g. "Timestamp DESC". Omit to use the auto-detected default.',
    ),
  useTextIndexForImplicitColumn: z
    .enum(['auto', 'enabled', 'disabled'])
    .optional()
    .describe(
      'Log and trace sources. Whether Lucene searches on the implicit column ' +
        'use hasAllTokens(). "auto" (used when unset) detects a covering text ' +
        'index at query time; "enabled" always uses hasAllTokens(), useful for ' +
        'Merge engine tables; "disabled" falls back to hasToken().',
    ),

  // ── Log / Trace ──
  defaultTableSelectExpression: z
    .string()
    .optional()
    .describe(
      'Comma-separated columns shown in search results by default, e.g. ' +
        '"Timestamp, ServiceName, Body". Required for log and trace sources.',
    ),
  bodyExpression: z
    .string()
    .optional()
    .describe('Log sources. Expression for the log message body, e.g. Body.'),
  severityTextExpression: z
    .string()
    .optional()
    .describe(
      'Log sources. Expression for the log level / severity text, e.g. SeverityText.',
    ),
  severityNumberExpression: z
    .string()
    .optional()
    .describe(
      'Log sources. Expression for the numeric OpenTelemetry SeverityNumber ' +
        '(1-24), e.g. SeverityNumber. Omit if the table has no such column.',
    ),
  eventNameExpression: z
    .string()
    .optional()
    .describe(
      'Log sources. Expression for the OpenTelemetry log EventName, e.g. ' +
        'EventName. Omit if the table has no such column.',
    ),

  // ── Trace (required for trace kind) ──
  durationExpression: z
    .string()
    .optional()
    .describe(
      'Trace sources (required). Expression for span duration, e.g. Duration. ' +
        'Its unit is set by durationPrecision.',
    ),
  durationPrecision: z
    .number()
    .min(0)
    .max(9)
    .optional()
    .describe(
      'Trace sources. Number of decimal digits of a second in durationExpression ' +
        'values: 0 seconds, 3 milliseconds, 6 microseconds, 9 nanoseconds ' +
        '(OTel Duration is nanoseconds). Defaults to 3 when omitted.',
    ),
  traceIdExpression: z
    .string()
    .optional()
    .describe(
      'Expression for the trace ID, e.g. TraceId. Required for trace sources; ' +
        'on log sources it correlates logs with traces.',
    ),
  spanIdExpression: z
    .string()
    .optional()
    .describe(
      'Expression for the span ID, e.g. SpanId. Required for trace sources; ' +
        'on log sources it correlates logs with spans.',
    ),
  parentSpanIdExpression: z
    .string()
    .optional()
    .describe(
      'Trace sources (required). Expression for the parent span ID, e.g. ParentSpanId.',
    ),
  spanNameExpression: z
    .string()
    .optional()
    .describe(
      'Trace sources (required). Expression for the span name, e.g. SpanName.',
    ),
  spanKindExpression: z
    .string()
    .optional()
    .describe(
      'Trace sources (required). Expression for the span kind (client, server, internal, ...), e.g. SpanKind.',
    ),
  statusCodeExpression: z
    .string()
    .optional()
    .describe(
      'Trace sources. Expression for the span status code, e.g. StatusCode.',
    ),
  statusMessageExpression: z
    .string()
    .optional()
    .describe(
      'Trace sources. Expression for the span status message, e.g. StatusMessage.',
    ),
  sampleRateExpression: z
    .string()
    .optional()
    .describe(
      'Trace sources. Column or expression for the upstream sampling weight ' +
        '(1/N). When set, count, avg, sum, and quantile aggregations are ' +
        'corrected for sampling (percentiles become approximate). Omit if spans ' +
        'are not sampled.',
    ),
  spanEventsValueExpression: z
    .string()
    .optional()
    .describe(
      'Trace sources. Expression for span events, e.g. Events. Expected type: ' +
        'Nested(Timestamp DateTime64(9), Name LowCardinality(String), ' +
        'Attributes Map(LowCardinality(String), String)).',
    ),

  // ── Highlighted attribute expressions (advanced) ──
  highlightedTraceAttributeExpressions: highlightedAttributeExpressionsSchema
    .optional()
    .describe(
      'Log and trace sources. Trace-level attributes displayed in the trace ' +
        'view for the selected trace.',
    ),
  highlightedRowAttributeExpressions: highlightedAttributeExpressionsSchema
    .optional()
    .describe(
      'Log and trace sources. Row-level attributes displayed in the row side ' +
        'panel for the selected row.',
    ),

  // ── Correlated source IDs ──
  logSourceId: z
    .string()
    .optional()
    .describe(
      'Trace and metric sources. ID of the log source holding logs related to ' +
        'this data. Get IDs from clickstack_list_sources.',
    ),
  traceSourceId: z
    .string()
    .optional()
    .describe(
      'ID of the trace source holding traces related to this data, used to ' +
        'link rows to their traces. Required for session sources; optional ' +
        'for log sources. Get IDs from clickstack_list_sources.',
    ),
  metricSourceId: z
    .string()
    .optional()
    .describe(
      'Log and trace sources. ID of the metric source holding related ' +
        'metrics. Get IDs from clickstack_list_sources.',
    ),
  sessionSourceId: z
    .string()
    .optional()
    .describe(
      'Trace sources. ID of the session source holding related session ' +
        'replays. Get IDs from clickstack_list_sources.',
    ),

  // ── Metric ──
  metricTables: metricTablesSchema.optional(),
  minAutoGranularity: z
    .string()
    .optional()
    .describe(
      'Metric and promql sources. Floor for auto granularity on charts, as ' +
        '"<n> <unit>" with unit second, minute, hour, or day, e.g. "1 minute". ' +
        'Set it to the scrape/report interval to avoid sparse charts on short ' +
        'time ranges; explicit chart granularities are unaffected. PromQL ' +
        'sources also use it as the scrape interval for $__rate_interval. Omit ' +
        'for no minimum.',
    ),

  // ── Materialized views (advanced; granularities use "<n> <unit>" form) ──
  materializedViews: materializedViewsSchema
    .optional()
    .describe(
      'Log and trace sources. Pre-aggregated materialized views used to speed ' +
        'up aggregation queries.',
    ),
  metadataMaterializedViews: metadataMaterializedViewsSchema
    .optional()
    .describe(
      'Log and trace sources. Rollup tables used for fast field discovery and ' +
        'value autocomplete in filters and search suggestions.',
    ),
});

export type McpSaveSourceInput = z.infer<typeof mcpSaveSourceSchema>;

/**
 * Assemble the flat MCP input into the SourceSchemaNoId shape: nest from.*,
 * drop the update selector `id`, and strip undefined keys so they don't collide
 * with the discriminated union's per-kind expectations.
 */
export function buildSourceInput(
  input: McpSaveSourceInput,
): Record<string, unknown> {
  const { id: _id, databaseName, tableName, ...rest } = input;

  const defined = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  );

  return {
    ...defined,
    from: { databaseName, tableName },
  };
}

// Drop the Mongoose-injected `_id` from a nested subdocument so it doesn't leak
// into the config or get re-submitted to save_source.
function stripMongooseId(value: unknown): unknown {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const { _id, ...rest } = value as Record<string, unknown>;
  void _id;
  return rest;
}

/**
 * Inverse of buildSourceInput: produce the flat clickstack_save_source shape
 * from a stored source so describe_source can emit a round-trippable `config`
 * (clone / read-modify-write). Keys come from mcpSaveSourceSchema, so there is
 * no hand-maintained list to keep in sync.
 */
export function extractSourceConfig(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const from = (source.from ?? {}) as {
    databaseName?: string;
    tableName?: string;
  };

  // Most keys are a same-named copy; these have a different read shape
  // (id from _id, connection ObjectId -> string, from.* nested) or need their
  // stray Mongoose `_id` stripped from nested subdocs.
  const resolve = (key: string): unknown => {
    switch (key) {
      case 'id':
        return source._id?.toString();
      case 'connection':
        return source.connection?.toString();
      case 'databaseName':
        return from.databaseName;
      case 'tableName':
        return from.tableName;
      case 'metricTables':
        return sanitizeMetricTables(
          source.metricTables as Record<string, unknown> | undefined,
        );
      case 'metadataMaterializedViews':
        return stripMongooseId(source.metadataMaterializedViews);
      case 'materializedViews':
        return Array.isArray(source.materializedViews)
          ? source.materializedViews.map(stripMongooseId)
          : source.materializedViews;
      default:
        return source[key];
    }
  };

  // Omit unset fields (they map to "not provided"), but keep an empty-string
  // tableName — a valid, round-trippable value for metric sources.
  const keep = (key: string, value: unknown): boolean => {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string' && value.length === 0)
      return key === 'tableName';
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  };

  return Object.fromEntries(
    Object.keys(mcpSaveSourceSchema.shape)
      .map(key => [key, resolve(key)] as const)
      .filter(([key, value]) => keep(key, value)),
  );
}
