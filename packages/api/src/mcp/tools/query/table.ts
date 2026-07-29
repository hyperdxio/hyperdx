import { z } from 'zod';

import type { ToolRegistrar } from '@/mcp/tools/types';
import { mcpUserError } from '@/mcp/utils/errors';

import {
  annotateIncreaseTopNHint,
  buildTile,
  mergeWhereIntoSelectItems,
  parseTimeRange,
  runConfigTile,
} from './helpers';
import {
  applyMetricSelectDefaults,
  endTimeSchema,
  groupBySchema,
  MCP_AGG_FN_OPTIONS,
  McpSelectItem,
  mcpSelectItemSchema,
  orderBySchema,
  sourceIdSchema,
  startTimeSchema,
  validateMetricSelectItems,
  whereLanguageSchema,
  whereSchema,
} from './schemas';

// ─── Schema ──────────────────────────────────────────────────────────────────

const tableSchema = z.object({
  sourceId: sourceIdSchema,
  select: z
    .array(mcpSelectItemSchema)
    .min(1)
    .max(10)
    .describe(
      'Metrics to compute. Each item defines one aggregation column. ' +
        'For "number" shape, provide exactly 1 item. ' +
        'Example: [{ aggFn: "count" }, { aggFn: "avg", valueExpression: "Duration" }]',
    ),
  shape: z
    .enum(['table', 'number', 'pie', 'bar'])
    .optional()
    .default('table')
    .describe(
      'Output shape: "table" (grouped rows, default), "number" (single scalar), ' +
        '"pie" (pie chart), or "bar" (categorical bar chart). ' +
        'If "number", "pie", or "bar" is set with select.length > 1, it is auto-upgraded to "table". ' +
        'groupBy is ignored when shape is "number".',
    ),
  where: whereSchema.describe(
    'Row filter applied to ALL select items. ' +
      'This scopes the entire query — use it to restrict by service, severity, etc. ' +
      'Each select item can also have its own per-metric "where" for cohort comparisons. ' +
      'When both are set, they are ANDed together.\n\n' +
      'Lucene example: "ServiceName:frontend"\n' +
      'SQL example: "ServiceName = \'frontend\'"',
  ),
  whereLanguage: whereLanguageSchema,
  groupBy: groupBySchema,
  orderBy: orderBySchema,
  startTime: startTimeSchema,
  endTime: endTimeSchema,
});

// ─── orderBy resolution ──────────────────────────────────────────────────────

/** Aggregation function names that ClickHouse cannot resolve as bare identifiers in ORDER BY.
 *  Excluded:
 *  - 'none' passes a raw expression through unchanged and has no synthesizable form.
 *  - 'increase' is a metric-only renderer marker that compiles to a multi-CTE
 *    sum(Rate) pipeline — there is no standalone SQL function to synthesize.
 *    The renderer auto-aliases the resulting column; agents should orderBy by alias. */
const AGG_FN_NAMES: ReadonlySet<string> = new Set(
  MCP_AGG_FN_OPTIONS.filter(fn => fn !== 'none' && fn !== 'increase'),
);

/** A bare ClickHouse identifier: a letter or underscore followed by word chars.
 *  Anything outside this shape (spaces, punctuation, leading digit) must be
 *  quoted to be valid in ORDER BY. */
const BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Strip one layer of surrounding double-quote or backtick quoting, if present. */
function stripIdentifierQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith('`') && trimmed.endsWith('`')))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Quote an alias for use in ORDER BY when it is not a bare identifier.
 * Aliases are emitted into SELECT as `AS "alias"`, so we mirror that with
 * double-quote identifier quoting (escaping embedded double quotes). Bare
 * identifiers are returned unquoted to keep the common case readable.
 */
function quoteAliasForOrderBy(alias: string): string {
  if (BARE_IDENTIFIER.test(alias)) {
    return alias;
  }
  return `"${alias.replace(/"/g, '""')}"`;
}

/**
 * Resolve an orderBy value that matches a bare aggregation function name
 * (e.g. "count") to something ClickHouse can resolve in ORDER BY.
 *
 * The model frequently writes `orderBy: "count"`, which generates
 * `ORDER BY count ASC` in ClickHouse — but ClickHouse can't resolve bare
 * `count` since it's a function, not a column. We fix this by finding
 * the select item whose aggFn matches and using its alias, or synthesizing
 * the ClickHouse expression (e.g. `count()`) when no alias is set.
 *
 * Resolution order:
 *   1. If orderBy matches a select item's alias → emit the canonical alias,
 *      quoting it when it is not a bare identifier (e.g. `"P95 Latency"`)
 *   2. If orderBy matches an aggFn name → use that item's alias if set
 *      (quoted as needed), otherwise synthesize the ClickHouse expression
 *      (e.g. `count()`)
 *   3. Otherwise → pass through unchanged
 */
/** @internal Exported for testing only. */
export function resolveOrderBy(
  orderBy: string | undefined,
  selectItems: {
    aggFn: string;
    alias?: string;
    valueExpression?: string;
    level?: number;
  }[],
): string | undefined {
  if (!orderBy) return undefined;

  // Strip an optional trailing ASC/DESC so we can resolve the identifier,
  // then re-append the direction after resolution.
  const dirMatch = orderBy.match(/^(.+?)\s+(ASC|DESC)\s*$/i);
  const identifier = dirMatch ? dirMatch[1] : orderBy;
  const direction = dirMatch ? ` ${dirMatch[2].toUpperCase()}` : '';

  // Agents may pass the alias already quoted (per the orderBy docs) or bare.
  // Strip any surrounding quotes before matching so both forms resolve, then
  // re-quote on output based on the canonical alias.
  const lower = stripIdentifierQuotes(identifier).toLowerCase();

  // Already matches an alias? Return the canonical alias case so
  // ClickHouse's case-sensitive identifier resolution works correctly.
  // Multi-word / special-character aliases are quoted so the emitted
  // ORDER BY is valid SQL even when the agent passed the alias unquoted.
  const aliasMatch = selectItems.find(
    s => s.alias && s.alias.toLowerCase() === lower,
  );
  if (aliasMatch && aliasMatch.alias) {
    return `${quoteAliasForOrderBy(aliasMatch.alias)}${direction}`;
  }

  // Matches an aggFn name? Resolve to that item's alias or synthesize.
  if (AGG_FN_NAMES.has(lower)) {
    const match = selectItems.find(s => s.aggFn.toLowerCase() === lower);
    if (match) {
      // Prefer the explicit alias if set
      if (match.alias) {
        return `${quoteAliasForOrderBy(match.alias)}${direction}`;
      }

      // Synthesize the ClickHouse expression so ORDER BY works
      if (match.aggFn === 'count') return `count()${direction}`;
      // count_distinct compiles to count(DISTINCT expr) in ClickHouse,
      // not count_distinct(expr) which is not a valid function.
      if (match.aggFn === 'count_distinct' && match.valueExpression) {
        return `count(DISTINCT ${match.valueExpression})${direction}`;
      }
      if (
        match.aggFn === 'quantile' &&
        match.level != null &&
        match.valueExpression
      ) {
        return `quantile(${match.level})(${match.valueExpression})${direction}`;
      }
      // Skip synthesis for quantile without level — let it pass through
      // rather than generating invalid SQL like quantile(Duration)
      if (match.aggFn === 'quantile') {
        return orderBy;
      }
      if (match.valueExpression) {
        return `${match.aggFn}(${match.valueExpression})${direction}`;
      }
    }
  }

  return orderBy;
}

// ─── Tool registration ───────────────────────────────────────────────────────

export function registerTable({ context, registerTool }: ToolRegistrar) {
  const { teamId } = context;

  registerTool(
    'clickstack_table',
    {
      title: 'Aggregation Table',
      description:
        'Compute aggregated metrics as a table, single number, pie chart, or bar chart. ' +
        'Use this for grouped aggregations, top-N queries, single-value KPIs, ' +
        'or proportional breakdowns.\n\n' +
        'Requires sourceId — call clickstack_list_sources then clickstack_describe_source first.\n\n' +
        'Use the top-level "where" to scope the entire query (e.g. filter by service). ' +
        'Each select item can also have its own "where" for per-metric cohort ' +
        'comparisons (compiles to <aggFn>If(...)). Both can be used together.\n\n' +
        'Column naming: top-level columns are PascalCase (Duration, StatusCode). ' +
        "Map attributes use bracket syntax: SpanAttributes['http.method']. " +
        'Map attributes work in groupBy and valueExpression, including ' +
        "toFloat64OrZero(SpanAttributes['key']).\n\n" +
        'Shape auto-upgrade: if shape is "number", "pie", or "bar" but select has >1 item, ' +
        'it is transparently upgraded to "table".\n\n' +
        '── METRIC SOURCES ──\n' +
        'When sourceId is a metric source, each select item MUST set ' +
        'metricType ("gauge"|"sum"|"histogram"|"exponential histogram") and metricName (the OTel metric name). ' +
        'valueExpression defaults to "Value" — set it explicitly only to transform the value.\n' +
        'Discovery: clickstack_describe_source returns a per-kind metric-name sample; ' +
        'clickstack_list_metrics paginates the full catalog; clickstack_describe_metric ' +
        'returns attribute keys + sampled values for a single metric.\n' +
        'Per kind: gauge uses last_value/avg/min/max; sum uses aggFn:"increase" for counter increase ' +
        '(top-N capped at 20 groups when combined with groupBy), or sum/avg on the rate; ' +
        'histogram and exponential histogram use aggFn:"quantile" + level for percentiles, or aggFn:"count" for total bucket count.\n' +
        'summary metrics are not supported by the query renderer.',
      inputSchema: tableSchema,
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

      // Auto-upgrade shape when select has multiple items but shape is
      // single-value (number/pie/bar). This is the #1 Zod error class from agents.
      let displayType: 'table' | 'number' | 'pie' | 'bar' = input.shape;
      if (
        (displayType === 'number' ||
          displayType === 'pie' ||
          displayType === 'bar') &&
        select.length > 1
      ) {
        displayType = 'table';
      }

      // Inject top-level where into each select item so it becomes part
      // of the aggCondition for every metric. Table/line/number/pie/bar display
      // types don't have a chart-level where — filtering is per-select-item.
      const { items: selectItems, warnings: mergeWarnings } =
        mergeWhereIntoSelectItems(select, input.where, input.whereLanguage);

      const tile = buildTile('MCP Table', 12, 4, {
        displayType,
        sourceId: input.sourceId,
        select: selectItems,
        groupBy: displayType === 'number' ? undefined : input.groupBy,
        orderBy: resolveOrderBy(input.orderBy, selectItems),
      });

      const result = await runConfigTile(
        teamId.toString(),
        tile,
        startDate,
        endDate,
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

      return result;
    },
  );
}
