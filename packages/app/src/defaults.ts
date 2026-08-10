import type { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

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

// Soft ceiling on the number of rows a single dashboard-tile query returns.
// This is a last-line defense against a pathological high-cardinality group-by
// streaming hundreds of thousands of rows into the browser — well above the
// series/draw caps, which bound what is *rendered*, whereas this bounds what is
// *transferred* (and materialized server-side).
//
// The cap is enforced by two complementary ClickHouse settings, both asked for
// with one row of HEADROOM above the logical cap (`cap + 1`, see
// `resolveResultRowLimitSetting`) so a complete result of exactly `cap` rows
// comes back whole and is NOT flagged, while a larger result trips the cap:
//   1. `max_result_rows = cap + 1` + `result_overflow_mode = 'break'` — bounds
//      the RESULT rows. Weak on its own: break only stops between result blocks,
//      so a result that fits in one block (up to ~65k rows) is returned whole.
//   2. `max_rows_to_group_by = cap + 1` + `group_by_overflow_mode = 'any'` —
//      bounds the aggregation CARDINALITY (unique GROUP BY keys). "any" keeps the
//      first N keys and folds the rest away instead of erroring. This is the
//      setting that actually protects memory for a high-cardinality group-by.
//
// IMPORTANT: both are *soft*, block-aligned caps — ClickHouse checks them only
// after each data part, so the real result can overshoot `cap + 1` by up to one
// block. They are NOT exact truncations. When a query returns more than `cap`
// rows we surface an overflow banner on the tile (see `didResultOverflow`) so
// the user knows the result was capped and the chart may be missing data.
export const DEFAULT_MAX_TILE_RESULT_ROWS = 5000;

/**
 * Translate a logical row cap into the `max_result_rows` value to send to
 * ClickHouse. We request `cap + 1` so a result of exactly `cap` rows comes back
 * whole (and is NOT flagged as overflow), while anything larger trips the break
 * and returns at least `cap + 1` rows. Returns undefined for a non-positive /
 * absent cap (no limit applied).
 */
export function resolveResultRowLimitSetting(
  cap: number | undefined,
): number | undefined {
  if (cap == null || !Number.isFinite(cap) || cap <= 0) {
    return undefined;
  }
  return Math.floor(cap) + 1;
}

/**
 * Decide whether a tile query exceeded the `max_result_rows` /
 * `result_overflow_mode = 'break'` cap.
 *
 * The query is run with one row of headroom (`max_result_rows = cap + 1`; see
 * `resolveResultRowLimitSetting`), so a complete result of ≤ cap rows returns
 * as-is and does NOT flag; only a result larger than `cap` trips the break and
 * comes back with more than `cap` rows (≥ cap + 1, possibly more since break is
 * block-aligned). Hence the sole reliable signal is `rows > cap`.
 *
 * We deliberately do NOT use `rows_before_limit_at_least`: ClickHouse only
 * populates it when the query itself has a LIMIT stage, and it then reports the
 * row count BEFORE that user LIMIT — not before our result-size break. A raw
 * SQL tile whose query ends in `... LIMIT 50` over a large aggregation returns
 * exactly 50 rows (nothing truncated by us) yet reports
 * `rows_before_limit_at_least = <pre-LIMIT group count>`, which would wrongly
 * trip the banner. `rows > cap` cannot false-positive that way because the tile
 * genuinely received ≤ cap rows.
 *
 * A non-positive/absent cap disables detection.
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
