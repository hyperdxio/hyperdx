import type { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

// Limit defaults
export const DEFAULT_SEARCH_ROW_LIMIT = 200;
export const DEFAULT_QUERY_TIMEOUT = 60; // max_execution_time, seconds

export function searchChartConfigDefaults(
  team: any | undefined | null,
): Partial<ChartConfigWithDateRange> {
  return {
    limit: {
      limit: team?.searchRowLimit ?? DEFAULT_SEARCH_ROW_LIMIT,
    },
  };
}
