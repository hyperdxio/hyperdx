import type { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

// Limit defaults
export const DEFAULT_SEARCH_ROW_LIMIT = 200;

export function searchChartConfigDefaults(
  team: any,
): Partial<ChartConfigWithDateRange> {
  return {
    limit: {
      limit: team?.searchRowLimit ?? DEFAULT_SEARCH_ROW_LIMIT,
    },
  };
}
