import {
  createEmptyExploreSeries,
  ExploreSeries,
  SearchAggConfig,
} from '@/components/Search/SearchAggControls';

import {
  attributeClauseSql,
  attributeGroupBySql,
  MetricFilterClause,
  TileAgg,
} from './tileDefaults';
import type { WallMetric } from './useMetricWallCatalog';

export type EditAsChartRequest = {
  metric: WallMetric;
  agg: TileAgg;
  filters: MetricFilterClause[];
  splitBy?: string;
};

/**
 * Carry a drilled-down tile into the chart editor as the same query: one
 * series with the tile's aggregation and scope, split the same way.
 */
export function aggConfigFromWall({
  metric,
  agg,
  filters,
  splitBy,
}: EditAsChartRequest): Pick<SearchAggConfig, 'series' | 'groupBy'> {
  const series: ExploreSeries = {
    ...createEmptyExploreSeries(),
    aggFn: agg.aggFn,
    ...(agg.level != null ? { level: agg.level } : {}),
    aggCondition: filters.map(attributeClauseSql).join(' AND '),
    aggConditionLanguage: 'sql',
    valueExpression: 'Value',
    metricName: metric.name,
    metricType: metric.type,
  };
  return {
    series: [series],
    groupBy: splitBy ? attributeGroupBySql(splitBy) : '',
  };
}
