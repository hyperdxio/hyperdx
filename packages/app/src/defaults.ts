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

/**
 * Resolve the effective client-side render cap from a tile's `seriesLimit`
 * (see SharedChartSettingsSchema): null/undefined → the default cap, 0 →
 * unlimited (Infinity), a positive N → N.
 */
export function resolveRenderedSeriesCap(
  seriesLimit: number | null | undefined,
): number {
  if (seriesLimit == null) {
    return MAX_RENDERED_TIME_CHART_SERIES;
  }
  if (seriesLimit <= 0) {
    return Number.POSITIVE_INFINITY;
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
