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
      '  none – pass a raw expression through unchanged',
  );

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
        '"if(StatusCode = \'STATUS_CODE_ERROR\', 1, 0)" (boolean→numeric for ratios).',
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
    'Column to sort results by (builder display types only, mainly "table").',
  );
