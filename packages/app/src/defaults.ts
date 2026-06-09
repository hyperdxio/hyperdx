import type { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

// Limit defaults
export const DEFAULT_SEARCH_ROW_LIMIT = 200;
export const DEFAULT_QUERY_TIMEOUT = 60; // max_execution_time, seconds
export const DEFAULT_FILTER_KEYS_FETCH_LIMIT = 20;
export const DEFAULT_FILTER_KEYS_FETCH_LIMIT_WITH_MVS = 100;
// Max group-by series fetched per time chart (top-N query cap). Matches the
// render-time line cap (HARD_LINES_LIMIT) so we never fetch series that can't
// be drawn. Overridable per team via the `seriesLimit` setting.
export const DEFAULT_SERIES_LIMIT = 60;

export function searchChartConfigDefaults(
  team: any | undefined | null,
): Partial<BuilderChartConfigWithDateRange> {
  return {
    limit: {
      limit: team?.searchRowLimit ?? DEFAULT_SEARCH_ROW_LIMIT,
    },
  };
}
