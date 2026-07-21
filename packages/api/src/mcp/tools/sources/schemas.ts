import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { z } from 'zod';

import { sanitizeMetricTables } from './metricKinds';

// ---------------------------------------------------------------------------
// MCP-compatible flat Zod schema for clickstack_save_source.
//
// The canonical SourceSchemaNoId is a z.discriminatedUnion (plus refinements on
// nested pieces like metricTables), which the MCP SDK's normalizeObjectSchema()
// cannot serialize. We expose a single flat z.object() with every kind-specific
// field optional, then re-validate the assembled input at runtime against the
// real SourceSchemaNoId (via SourceSchemaNoId.safeParse in saveSource.ts) so
// per-kind required fields and refinements stay in exactly one place.
// ---------------------------------------------------------------------------

// Declared as plain string literals (not SourceKind enum members) so z.enum(...)
// narrows correctly at the MCP SDK callback boundary — referencing the enum
// directly pessimises Zod's inference to `unknown` across the surrounding
// optional fields (see mcp/tools/sources/metricKinds.ts for the same pattern).
// The compile-time assertion below keeps the literals in sync with SourceKind
// so a new kind cannot be added in only one place.
const SOURCE_KINDS = ['log', 'trace', 'session', 'metric', 'promql'] as const;
const _assertSourceKindsMatchEnum: readonly (typeof SOURCE_KINDS)[number][] = [
  SourceKind.Log,
  SourceKind.Trace,
  SourceKind.Session,
  SourceKind.Metric,
  SourceKind.Promql,
];
void _assertSourceKindsMatchEnum;

// Advanced/optional nested config. These mirror the canonical schemas in
// common-utils (MaterializedViewConfigurationSchema, MetadataMaterializedViews-
// Schema, HighlightedAttributeExpressionsSchema, UseTextIndexSchema). They are
// modeled loosely here (the canonical SourceSchemaNoId.safeParse in saveSource
// does the strict validation) but are present so advanced source config
// round-trips faithfully through clickstack_describe_source -> save_source.
// Granularity fields use the internal "<n> <unit>" form (e.g. "5 minute").
const highlightedAttributeExpressionsSchema = z.array(
  z.object({
    sqlExpression: z.string(),
    luceneExpression: z.string().optional(),
    alias: z.string().optional(),
  }),
);

const aggregatedColumnSchema = z.object({
  sourceColumn: z.string().optional(),
  aggFn: z.string(),
  mvColumn: z.string(),
});

const materializedViewsSchema = z.array(
  z.object({
    databaseName: z.string(),
    tableName: z.string(),
    dimensionColumns: z.string(),
    minGranularity: z.string(),
    minDate: z.string().nullish(),
    timestampColumn: z.string(),
    aggregatedColumns: z.array(aggregatedColumnSchema),
  }),
);

const metadataMaterializedViewsSchema = z.object({
  keyRollupTable: z.string().nullish(),
  kvRollupTable: z.string(),
  granularity: z.string(),
});

const metricTablesSchema = z
  .object({
    gauge: z.string().optional(),
    histogram: z.string().optional(),
    sum: z.string().optional(),
    summary: z.string().optional(),
    'exponential histogram': z.string().optional(),
  })
  .describe(
    'Metric source only. Map of OTel metric kind -> ClickHouse table name. ' +
      'At least one entry is required for metric sources.',
  );

export const mcpSaveSourceSchema = z.object({
  // ── Update selector ──
  id: z
    .string()
    .optional()
    .describe(
      'Source ID. Omit to create a new source, provide to update an existing one.',
    ),

  // ── Always required (base) ──
  kind: z
    .enum(SOURCE_KINDS)
    .describe('Source kind. Determines which fields are required.'),
  name: z.string().min(1).describe('Human-friendly source name.'),
  connection: z
    .string()
    .min(1)
    .describe(
      'Connection ID this source reads from. Get IDs from clickstack_list_sources.',
    ),
  databaseName: z
    .string()
    .min(1)
    .describe('ClickHouse database name (maps to from.databaseName).'),
  tableName: z
    .string()
    .describe(
      'ClickHouse table name (maps to from.tableName). Required for all kinds ' +
        'except metric (where it may be empty) and promql (use a placeholder).',
    ),
  timestampValueExpression: z
    .string()
    .min(1)
    .describe('Expression/column used as the primary timestamp.'),

  // ── Common optional ──
  section: z.string().optional().describe('Optional grouping section label.'),
  displayedTimestampValueExpression: z.string().optional(),
  serviceNameExpression: z.string().optional(),
  resourceAttributesExpression: z
    .string()
    .optional()
    .describe('Required for metric sources; optional for others.'),
  eventAttributesExpression: z.string().optional(),
  implicitColumnExpression: z.string().optional(),
  knownColumnsListExpression: z.string().optional(),
  orderByExpression: z.string().optional(),
  useTextIndexForImplicitColumn: z
    .enum(['auto', 'enabled', 'disabled'])
    .optional()
    .describe('Whether to use the text index for the implicit column.'),

  // ── Log / Trace ──
  defaultTableSelectExpression: z
    .string()
    .optional()
    .describe('Default columns to select. Required for log and trace sources.'),
  bodyExpression: z.string().optional().describe('Log body expression.'),
  severityTextExpression: z.string().optional(),

  // ── Trace (required for trace kind) ──
  durationExpression: z.string().optional(),
  durationPrecision: z
    .number()
    .min(0)
    .max(9)
    .optional()
    .describe('Trace duration precision (0-9). Defaults to 3.'),
  traceIdExpression: z.string().optional(),
  spanIdExpression: z.string().optional(),
  parentSpanIdExpression: z.string().optional(),
  spanNameExpression: z.string().optional(),
  spanKindExpression: z.string().optional(),
  statusCodeExpression: z.string().optional(),
  statusMessageExpression: z.string().optional(),
  sampleRateExpression: z.string().optional(),
  spanEventsValueExpression: z.string().optional(),

  // ── Highlighted attribute expressions (advanced) ──
  highlightedTraceAttributeExpressions:
    highlightedAttributeExpressionsSchema.optional(),
  highlightedRowAttributeExpressions:
    highlightedAttributeExpressionsSchema.optional(),

  // ── Correlated source IDs ──
  logSourceId: z.string().optional(),
  traceSourceId: z
    .string()
    .optional()
    .describe('Correlated trace source ID. Required for session sources.'),
  metricSourceId: z.string().optional(),
  sessionSourceId: z.string().optional(),

  // ── Metric ──
  metricTables: metricTablesSchema.optional(),

  // ── Materialized views (advanced; granularities use "<n> <unit>" form) ──
  materializedViews: materializedViewsSchema.optional(),
  metadataMaterializedViews: metadataMaterializedViewsSchema.optional(),
});

export type McpSaveSourceInput = z.infer<typeof mcpSaveSourceSchema>;

/**
 * Assemble the flat MCP input into the shape expected by SourceSchemaNoId
 * (nesting from.databaseName/from.tableName, dropping the update selector `id`
 * and any undefined keys). Kind-specific field validation is deferred to
 * SourceSchemaNoId.safeParse in the handler.
 */
export function buildSourceInput(
  input: McpSaveSourceInput,
): Record<string, unknown> {
  const {
    id: _id,
    databaseName,
    tableName,
    // remaining keys (incl. kind) pass through to the discriminated union
    ...rest
  } = input;

  // Strip undefined so optional fields don't collide with the discriminated
  // union's per-kind expectations, then nest the from.* fields.
  const defined = Object.fromEntries(
    Object.entries(rest).filter(([, value]) => value !== undefined),
  );

  return {
    ...defined,
    from: { databaseName, tableName },
  };
}

// Drop the Mongoose-injected `_id` from a nested subdocument so it never leaks
// into the agent-facing config or gets re-submitted to save_source.
function stripMongooseId(value: unknown): unknown {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  const { _id, ...rest } = value as Record<string, unknown>;
  void _id;
  return rest;
}

/**
 * Produce the exact flat shape that clickstack_save_source accepts from a
 * stored source document — the inverse of buildSourceInput. This is what makes
 * a faithful clone / read-modify-write possible: clickstack_describe_source
 * embeds it so an agent can read a source's full config back and pass it
 * (optionally tweaked) straight into clickstack_save_source. Correlation IDs
 * (logSourceId etc.) — previously invisible to the read tools — are included.
 *
 * The accepted fields come straight from mcpSaveSourceSchema, so there is no
 * hand-maintained field list to keep in sync. Every save-schema key is copied
 * from the source document by the same name, except three whose read shape
 * differs: `id` (from _id), `connection` (ObjectId -> string), and
 * databaseName/tableName (nested under `from`). `metricTables` is sanitized to
 * drop any stray Mongoose `_id`.
 */
export function extractSourceConfig(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const from = (source.from ?? {}) as {
    databaseName?: string;
    tableName?: string;
  };

  // Resolve each save-schema key to its value on the source document. The three
  // keys whose read shape differs from the flat write shape are mapped
  // explicitly; everything else is a same-named copy. Nested materialized-view
  // objects carry a stray Mongoose `_id` (like metricTables) that must not leak
  // into the agent-facing / re-submittable config.
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

  // Omit unset fields so they map to "not provided" on the write side.
  // tableName is kept even when empty ('') — a valid value for metric sources
  // that must round-trip. Empty arrays are dropped (an empty
  // materializedViews / highlighted list is "not configured").
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
