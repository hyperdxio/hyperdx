/**
 * Trino-flavored SQL helpers for chart-config emission (Berg Phase 1.2).
 *
 * `renderChartConfig.ts` consumes these helpers to assemble Trino SQL
 * fragments. Centralised so Catalog/Sample SQL builders and chart-config
 * builders agree on identifier escaping, fully-qualified table form, and
 * time-bucket emission.
 */

import { SQLInterval } from '@/types';

/** Trino identifier escaping: double quotes, doubled internally. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Trino string-literal escaping: single quotes, doubled internally. */
export function quoteStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Strip the `<account>:` prefix from a federated Glue catalog ID so the
 * remaining string can be embedded as a Trino/Athena catalog identifier.
 *
 * Glue API accepts `<account>:s3tablescatalog/<bucket>` but Athena's SQL
 * parser rejects the colon-prefixed form inside a quoted identifier.
 */
export function toAthenaCatalogName(catalogId: string): string {
  const idx = catalogId.indexOf(':');
  return idx > 0 ? catalogId.slice(idx + 1) : catalogId;
}

/**
 * Render a fully-qualified, double-quoted `catalog.database.table`
 * reference for Athena/Trino. When `catalog` is empty (CTE-style use),
 * the catalog segment is omitted; when both catalog and database are
 * empty, only the table is returned.
 */
export function fullyQualifiedTable(
  catalog: string | undefined,
  database: string | undefined,
  table: string,
): string {
  const segments: string[] = [];
  if (catalog && catalog.length > 0) {
    segments.push(quoteIdent(toAthenaCatalogName(catalog)));
  }
  if (database && database.length > 0) {
    segments.push(quoteIdent(database));
  }
  segments.push(quoteIdent(table));
  return segments.join('.');
}

const FROM_UNIXTIME_MS = (msExpr: string) =>
  `from_unixtime(CAST(${msExpr} AS DOUBLE) / 1000.0)`;

/**
 * Convert a millisecond epoch literal into a Trino `TIMESTAMP` value.
 *
 * Trino's `from_unixtime` takes seconds (float OK), so divide the ms
 * value by 1000.0. Used by both the time-window and sub-bucket helpers.
 */
export function fromUnixMs(ms: number): string {
  return FROM_UNIXTIME_MS(`${ms}`);
}

const KNOWN_BUCKET_UNITS = new Set([
  'second',
  'minute',
  'hour',
  'day',
  'week',
  'month',
  'quarter',
  'year',
]);

/** Parse a "<n> <unit>" granularity string into its numeric components. */
export function parseGranularity(granularity: SQLInterval): {
  n: number;
  unit: string;
} {
  const [num, unit] = granularity.split(/\s+/);
  const n = Number.parseInt(num, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid granularity number "${num}" in "${granularity}"`);
  }
  const lower = unit?.toLowerCase().replace(/s$/, '');
  if (!lower || !KNOWN_BUCKET_UNITS.has(lower)) {
    throw new Error(
      `Invalid granularity unit "${unit}" in "${granularity}"; expected one of ${[...KNOWN_BUCKET_UNITS].join(', ')}`,
    );
  }
  return { n, unit: lower };
}

const UNIT_SECONDS: Record<string, number> = {
  second: 1,
  minute: 60,
  hour: 60 * 60,
  day: 24 * 60 * 60,
  week: 7 * 24 * 60 * 60,
};

/**
 * Emit a Trino time-bucket expression for `column` rounded to the given
 * granularity.
 *
 * - `1 minute`, `1 hour`, etc. → `date_trunc('minute', col)` (cheap, exact).
 * - `5 minute`, `15 minute`, etc. → floor-by-N-seconds via
 *   `from_unixtime(floor(to_unixtime(col)/N)*N)` so the bucket size matches
 *   ClickHouse's old `toStartOfInterval(col, INTERVAL N <unit>)` behavior.
 *
 * `month`, `quarter`, `year` are always emitted as `date_trunc` since Trino
 * doesn't support arbitrary multiples of those units anyway; if a caller
 * passes `2 month` the unit gets truncated to a single month bucket. This is
 * a known Berg limitation noted in the Phase 1.2 spec.
 */
export function timeBucketExpr(
  column: string,
  granularity: SQLInterval,
): string {
  const { n, unit } = parseGranularity(granularity);
  if (n === 1) {
    return `date_trunc('${unit}', ${column})`;
  }
  const seconds = UNIT_SECONDS[unit];
  if (seconds == null) {
    // Trino can't express "every 2 months" cleanly; fall back to single-unit
    // truncation. Matches the spec's documented limitation.
    return `date_trunc('${unit}', ${column})`;
  }
  const totalSeconds = n * seconds;
  return `from_unixtime(floor(to_unixtime(${column}) / ${totalSeconds}) * ${totalSeconds})`;
}

/**
 * Emit a Trino `BETWEEN` time-window predicate for `[startMs, endMs]`.
 * Inclusive on both ends — callers that need exclusive boundaries should
 * compose comparison ops directly via `timeRangeBoundOps`.
 */
export function timeRangeWhere(
  column: string,
  startMs: number,
  endMs: number,
): string {
  return `${column} BETWEEN ${fromUnixMs(startMs)} AND ${fromUnixMs(endMs)}`;
}

/**
 * Map a HyperDX aggregate-fn name to its Trino-equivalent SQL fragment.
 *
 * The set is intentionally minimal — Berg does not support state-merge
 * aggregates (`*Merge`/`*State`) since there are no aggregating-merge
 * tables to read from.
 */
export function aggregateExpr(
  fn: string,
  args: { expr?: string; level?: number; distinct?: boolean },
): string {
  const { expr, level, distinct } = args;
  switch (fn) {
    case 'count':
      // Either `count()` or `count(<expr>)`. Caller decides via expr.
      return expr ? `count(${expr})` : 'count(*)';
    case 'count_distinct':
      if (!expr) {
        throw new Error('count_distinct requires an expression');
      }
      return `count(DISTINCT ${expr})`;
    case 'sum':
    case 'avg':
    case 'min':
    case 'max':
      if (!expr) {
        throw new Error(`${fn} requires an expression`);
      }
      return `${fn}(${expr})`;
    case 'quantile':
      if (!expr || level == null) {
        throw new Error('quantile requires expression and level');
      }
      return `approx_percentile(${expr}, ${level})`;
    case 'last_value':
      if (!expr) {
        throw new Error('last_value requires an expression');
      }
      return `last_value(${expr})`;
    default:
      // Fall through to the function name verbatim for things like
      // `argMax(value, ts)` that exist in both ClickHouse and Trino.
      if (distinct && expr) {
        return `${fn}(DISTINCT ${expr})`;
      }
      if (expr) {
        return `${fn}(${expr})`;
      }
      return `${fn}()`;
  }
}

/**
 * Wrap an aggregate in a CASE filter when a WHERE-style condition is set.
 * Trino lacks ClickHouse's `<fn>If(...)` shorthand; the canonical form is
 * `<fn>(... ) FILTER (WHERE <cond>)` (SQL standard) which Trino supports.
 */
export function aggregateExprIf(
  fn: string,
  args: { expr?: string; level?: number; distinct?: boolean },
  whereSql: string | undefined,
): string {
  const base = aggregateExpr(fn, args);
  if (!whereSql || !whereSql.trim()) return base;
  return `${base} FILTER (WHERE ${whereSql})`;
}
