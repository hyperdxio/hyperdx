import { z } from 'zod';

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
  'Lucene supports comparisons (>= > < <=), wildcards (field:val*), ranges ([1 TO 5]), ' +
  'and map attributes via dot notation. Use "sql" for IN(...) lists, complex expressions, or function calls.\n' +
  'IMPORTANT: Lucene field:value is a SUBSTRING match (ilike), not exact equality. ' +
  'field:val* is prefix-within-substring, not a true prefix match. ' +
  "For exact matching or reliable wildcards, use SQL: WHERE field = 'value' or WHERE field LIKE 'val%'.";

// ─── Shared Zod schemas ──────────────────────────────────────────────────────

const mcpAggFnSchema = z
  .enum([
    'avg',
    'count',
    'count_distinct',
    'last_value',
    'max',
    'min',
    'quantile',
    'sum',
    'none',
  ])
  .describe(
    'Aggregation function:\n' +
      '  count – count matching rows (no valueExpression needed)\n' +
      '  sum / avg / min / max – aggregate a numeric column (valueExpression required)\n' +
      '  count_distinct – unique value count (valueExpression required)\n' +
      '  quantile – percentile; also set level (valueExpression required)\n' +
      '  last_value – most recent value of a column\n' +
      '  none – pass a raw expression through unchanged',
  );

export const mcpSelectItemSchema = z.object({
  aggFn: mcpAggFnSchema,
  valueExpression: z
    .string()
    .optional()
    .describe(
      'Column or expression to aggregate. Required for every aggFn except "count". ' +
        'Use PascalCase for top-level columns (e.g. "Duration", "StatusCode"). ' +
        "For span attributes use: SpanAttributes['key'] (e.g. SpanAttributes['http.method']). " +
        "For resource attributes use: ResourceAttributes['key'] (e.g. ResourceAttributes['service.name']).",
    ),
  where: z
    .string()
    .optional()
    .default('')
    .describe(
      'Per-metric row filter. Compiles to <aggFn>If(...) for multi-cohort ' +
        'aggregates in one call. ' +
        'Example: "level:error" (Lucene) or "StatusCode >= 500" (SQL)',
    ),
  whereLanguage: z
    .enum(['lucene', 'sql'])
    .optional()
    .default('lucene')
    .describe(
      "Query language for this select item's where filter. Default: lucene",
    ),
  alias: z
    .string()
    .optional()
    .describe('Display label for this series. Example: "Error rate"'),
  level: z
    .union([z.literal(0.5), z.literal(0.9), z.literal(0.95), z.literal(0.99)])
    .optional()
    .describe(
      'Percentile level. Only applicable when aggFn is "quantile". ' +
        'Allowed values: 0.5, 0.9, 0.95, 0.99',
    ),
});

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
    'Source ID (required). Call hyperdx_list_sources to find available sources.',
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
    'Column to group/split by. ' +
      'Top-level columns use PascalCase (e.g. "SpanName", "StatusCode"). ' +
      "Span attributes: SpanAttributes['key'] (e.g. SpanAttributes['http.method']). " +
      "Resource attributes: ResourceAttributes['key'] (e.g. ResourceAttributes['service.name']).",
  );

export const orderBySchema = z
  .string()
  .optional()
  .describe('Column to sort results by (mainly useful for table shape).');
