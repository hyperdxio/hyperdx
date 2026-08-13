import { isRawSqlChartConfig } from '@hyperdx/common-utils/dist/guards';
import type {
  BuilderChartConfigWithDateRange,
  ChartConfigWithOptDateRange,
} from '@hyperdx/common-utils/dist/types';

// Limit defaults
export const DEFAULT_SEARCH_ROW_LIMIT = 200;
export const DEFAULT_QUERY_TIMEOUT = 60; // max_execution_time, seconds
export const DEFAULT_FILTER_KEYS_FETCH_LIMIT = 100;
export const DEFAULT_SERIES_LIMIT = 100;

// Default ceiling on distinct series the time-chart transform materializes,
// across all config types, when a tile has no explicit `seriesLimit`.
// High-cardinality group-bys (esp. raw SQL) can return tens of thousands of
// series; without this cap the client holds them all in memory while only
// DEFAULT_SERIES_LIMIT are drawn. Series beyond the effective cap are dropped
// (lowest peak first) and surfaced via a hidden-series notice. Override
// per-tile via the Display Settings "Series Limit" control.
export const MAX_RENDERED_TIME_CHART_SERIES = 250;

// Upper bound on rows the pinned tooltip renders once "load all series" is
// active. The tooltip body scrolls, but each row mounts several Mantine
// Tooltips (Search/Copy/Focus), so we don't render the full materialized set
// (up to MAX_LOADABLE_TIME_CHART_SERIES) — that could mount thousands of
// popovers and hang the tab. This ceiling is far above the 20-row preview
// (MAX_TOOLTIP_ROWS) and the drawn-line cap (HARD_LINES_LIMIT = 100), so "load
// all" reveals a meaningfully larger, scrollable list; series beyond it remain
// summarized in the tooltip's "+N more" line.
export const MAX_EXPANDED_TOOLTIP_ROWS = 500;

// Hard ceiling for the "load all series" escape hatch. Clicking the
// hidden-series notice (or the pinned tooltip's "+N more") opts into rendering
// beyond the default cap, but we still bound materialization so a runaway
// high-cardinality raw-SQL result (tens of thousands of series) can't exhaust
// browser memory / hang the tab. 5000 is a generous ceiling far above both the
// default materialize cap (MAX_RENDERED_TIME_CHART_SERIES) and the draw cap
// (HARD_LINES_LIMIT); drawn lines remain bounded by HARD_LINES_LIMIT regardless.
export const MAX_LOADABLE_TIME_CHART_SERIES = 5000;

// Soft ceiling on rows a single dashboard-tile query returns — a last-line
// guard against a high-cardinality query streaming hundreds of thousands of
// rows into the browser. Bounds what is *transferred*, unlike the series/draw
// caps which bound what is *rendered*. Enforced by the ClickHouse settings in
// resolveResultRowLimitSettings; overflow is surfaced via didResultOverflow.
export const DEFAULT_MAX_TILE_RESULT_ROWS = 5000;

export interface ResultRowLimitSettings {
  /** `clickhouse_settings` to merge into the query request. */
  settings: Record<string, string>;
  /** True when the cardinality/memory guard (`max_rows_to_group_by`) applied. */
  cardinalityCapApplied: boolean;
}

// Clauses ClickHouse allows AFTER an outer `LIMIT` (SETTINGS/FORMAT), plus a
// trailing `;`, single-line comment, and block comment. Stripped from the end
// (repeatedly) before the LIMIT test so a query like
// `... LIMIT 50 SETTINGS max_threads=4` or `... LIMIT 50 /* note */` still
// counts as having an outer LIMIT (missing it would wrongly enable the group-by
// cap and corrupt the top-N). SETTINGS uses `[\s\S]+` (not `.+`) so a clause
// wrapped onto multiple lines is still fully consumed.
const TRAILING_CLAUSE_RE =
  /(?:\s+settings\s+[\s\S]+|\s+format\s+\w+|\s*;|\s*--[^\n]*|\s*\/\*[\s\S]*?\*\/)+\s*$/i;
// Outer `LIMIT` at the end (after trailing clauses are stripped):
// `LIMIT n [,m] [OFFSET n] [WITH TIES]` or `LIMIT n BY col…`. Anchored to
// end-of-string, so a LIMIT inside a subquery/CTE is not matched. Conservative:
// a miss only falls back to the safe result-row cap.
const OUTER_LIMIT_RE =
  /\blimit\s+\d+(?:\s*,\s*\d+)?(?:\s+offset\s+\d+)?(?:\s+with\s+ties)?\s*$/i;
// `LIMIT n BY <cols>` (ClickHouse LIMIT BY) at the end — still an outer LIMIT
// that runs after ORDER BY. Anchored to end-of-string; the column list may not
// contain a `)` (which would indicate a subquery's LIMIT BY, not an outer one).
// A `LIMIT … BY … LIMIT m` shape is already caught by OUTER_LIMIT_RE via its
// trailing `LIMIT m`.
const OUTER_LIMIT_BY_RE =
  /\blimit\s+\d+(?:\s*,\s*\d+)?\s+by\s+[\w.,\s'"[\]]+$/i;

/** Whether a raw SQL string ends in an outer `LIMIT` (incl. `LIMIT … BY`). */
export function hasOuterLimit(sql: string | undefined): boolean {
  if (typeof sql !== 'string' || sql.length === 0) {
    return false;
  }
  const withoutTrailing = sql.trimEnd().replace(TRAILING_CLAUSE_RE, '');
  return (
    OUTER_LIMIT_RE.test(withoutTrailing) ||
    OUTER_LIMIT_BY_RE.test(withoutTrailing)
  );
}

/**
 * ClickHouse settings that enforce the row cap. Always applies the
 * order-preserving result-row cap (`max_result_rows` + `result_overflow_mode`).
 * Adds the cardinality/memory cap (`max_rows_to_group_by`) ONLY when the query
 * has no outer LIMIT — that cap truncates the GROUP BY before an outer
 * `ORDER BY … LIMIT`, which would silently corrupt the top-N. Uses `cap + 1`
 * headroom so a complete result of exactly `cap` rows isn't flagged. Returns
 * undefined for a non-positive/absent cap.
 */
export function resolveResultRowLimitSettings(
  cap: number | undefined,
  {
    hasOuterLimit: queryHasOuterLimit = false,
  }: { hasOuterLimit?: boolean } = {},
): ResultRowLimitSettings | undefined {
  const limit = resolveMaxResultRowsValue(cap);
  if (limit == null) {
    return undefined;
  }
  const settings: Record<string, string> = {
    max_result_rows: String(limit),
    result_overflow_mode: 'break',
  };
  const cardinalityCapApplied = !queryHasOuterLimit;
  if (cardinalityCapApplied) {
    settings.max_rows_to_group_by = String(limit);
    settings.group_by_overflow_mode = 'break';
  }
  return { settings, cardinalityCapApplied };
}

/**
 * Translate a logical row cap into the `max_result_rows` value to send to
 * ClickHouse. We request `cap + 1` so a result of exactly `cap` rows comes back
 * whole (and is NOT flagged as overflow), while anything larger trips the break
 * and returns at least `cap + 1` rows. Returns undefined for a non-positive /
 * absent cap (no limit applied).
 */
export function resolveMaxResultRowsValue(
  cap: number | undefined,
): number | undefined {
  if (cap == null || !Number.isFinite(cap) || cap <= 0) {
    return undefined;
  }
  return Math.floor(cap) + 1;
}

/**
 * Whether a tile query exceeded the row cap. Since the query runs with `cap + 1`
 * headroom, `rows > cap` is the reliable signal (a complete result of ≤ cap rows
 * comes back whole and is not flagged). We deliberately ignore
 * `rows_before_limit_at_least`: it reports the count before the query's own
 * LIMIT, so a tile ending in `... LIMIT 50` over a big aggregation would falsely
 * trip. A non-positive/absent cap disables detection.
 */
export function didResultOverflow({
  rows,
  cap,
}: {
  rows: number | undefined;
  cap: number | undefined;
}): boolean {
  if (cap == null || !Number.isFinite(cap) || cap <= 0) {
    return false;
  }
  if (typeof rows === 'number' && rows > cap) {
    return true;
  }
  return false;
}

/**
 * The row cap a dashboard tile should apply, or undefined for none. Only raw SQL
 * tiles are capped — builder tiles already bound cardinality via the series
 * limit, and builder tables page rows through useOffsetPaginatedQuery.
 */
export function resolveTileMaxResultRows(
  config: ChartConfigWithOptDateRange | undefined | null,
): number | undefined {
  return config && isRawSqlChartConfig(config)
    ? DEFAULT_MAX_TILE_RESULT_ROWS
    : undefined;
}

/**
 * Whether a chart's result overflowed the row cap, gated so the banner is
 * stable and never stale (shared by DBTimeChart and CategoricalChart):
 * `isComplete` avoids flapping mid-stream, `!isPlaceholderData` avoids a stale
 * banner lingering while a narrowed query is in flight.
 */
export function resolveDidOverflow({
  isPlaceholderData,
  isComplete,
  didOverflow,
}: {
  isPlaceholderData: boolean | undefined;
  isComplete: boolean | undefined;
  didOverflow: boolean | undefined;
}): boolean {
  if (isPlaceholderData || !isComplete) {
    return false;
  }
  return didOverflow ?? false;
}

/**
 * Resolve the effective client-side render cap from a tile's `seriesLimit`
 * (see SharedChartSettingsSchema): null/undefined → the default cap, exactly 0 →
 * unlimited (Infinity), a positive integer N → N. Anything else (NaN, negative,
 * non-integer — possible via the Mixed Mongo field or unvalidated form state)
 * falls back to the default cap so a bad value can't silently disable the guard.
 */
export function resolveRenderedSeriesCap(
  seriesLimit: number | null | undefined,
): number {
  if (seriesLimit === 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (
    seriesLimit == null ||
    !Number.isInteger(seriesLimit) ||
    seriesLimit < 0
  ) {
    return MAX_RENDERED_TIME_CHART_SERIES;
  }
  return seriesLimit;
}

export function searchChartConfigDefaults(
  team: any | undefined | null,
): Partial<BuilderChartConfigWithDateRange> {
  return {
    limit: {
      limit: team?.searchRowLimit ?? DEFAULT_SEARCH_ROW_LIMIT,
    },
  };
}
