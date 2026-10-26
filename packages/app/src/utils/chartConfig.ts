import { getPromqlSeries } from '@hyperdx/common-utils/dist/core/promql';
import { isPromqlChartConfig } from '@hyperdx/common-utils/dist/guards';
import { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/types';

/**
 * A config without the fields that only shape the cached response on the
 * client, for use as a cache key: changing one should not trigger a requery.
 */
export function stripClientSideConfigFields(
  config: ChartConfigWithOptDateRange,
): ChartConfigWithOptDateRange {
  const {
    transformSql: _transformSql,
    filterSql: _filterSql,
    ...queryConfig
  } = config;
  if (!isPromqlChartConfig(queryConfig)) return queryConfig;
  return {
    ...queryConfig,
    promqlExpression: getPromqlSeries(queryConfig).map(
      ({ reducer: _reducer, ...series }) => series,
    ),
  };
}
