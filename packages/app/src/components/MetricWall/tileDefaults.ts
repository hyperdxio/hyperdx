import { escapeSqlString } from '@hyperdx/common-utils/dist/core/utils';
import {
  AggregateFunction,
  BuilderChartConfigWithDateRange,
  DisplayType,
  Filter,
  MetricsDataType,
  TMetricSource,
} from '@hyperdx/common-utils/dist/types';

export type TileAgg = {
  id: string;
  label: string;
  aggFn: AggregateFunction;
  level?: number;
};

const GAUGE_AGGS: TileAgg[] = [
  { id: 'avg', label: 'avg', aggFn: 'avg' },
  { id: 'min', label: 'min', aggFn: 'min' },
  { id: 'max', label: 'max', aggFn: 'max' },
  { id: 'last', label: 'last', aggFn: 'last_value' },
];

const SUM_AGGS: TileAgg[] = [
  { id: 'increase', label: 'increase', aggFn: 'increase' },
  { id: 'sum', label: 'sum', aggFn: 'sum' },
];

// Histograms only aggregate as quantiles or a count.
const HISTOGRAM_AGGS: TileAgg[] = [
  { id: 'p95', label: 'p95', aggFn: 'quantile', level: 0.95 },
  { id: 'p50', label: 'p50', aggFn: 'quantile', level: 0.5 },
  { id: 'p99', label: 'p99', aggFn: 'quantile', level: 0.99 },
  { id: 'count', label: 'count', aggFn: 'count' },
];

/** The aggregations a tile of this kind offers, the default first. */
export function tileAggOptions(type: MetricsDataType): TileAgg[] {
  switch (type) {
    case MetricsDataType.Sum:
      return SUM_AGGS;
    case MetricsDataType.Histogram:
    case MetricsDataType.ExponentialHistogram:
      return HISTOGRAM_AGGS;
    default:
      return GAUGE_AGGS;
  }
}

export function defaultTileAgg(type: MetricsDataType): TileAgg {
  return tileAggOptions(type)[0];
}

/** Resolve an agg id for this kind, falling back to the kind's default. */
export function resolveTileAgg(
  type: MetricsDataType,
  aggId: string | undefined,
): TileAgg {
  return tileAggOptions(type).find(a => a.id === aggId) ?? defaultTileAgg(type);
}

export type MetricFilterClause = { key: string; value: string };

function quoteSql(value: string): string {
  return `'${escapeSqlString(value)}'`;
}

/**
 * An attribute match that works whether the key lives on the resource or the
 * data point, since the wall does not ask the reader to know which.
 */
export function attributeClauseSql({ key, value }: MetricFilterClause) {
  const k = quoteSql(key);
  const v = quoteSql(value);
  return `(ResourceAttributes[${k}] = ${v} OR Attributes[${k}] = ${v})`;
}

/** Split-by expression for a key, from either attribute map. */
export function attributeGroupBySql(key: string): string {
  const k = quoteSql(key);
  return `if(ResourceAttributes[${k}] != '', ResourceAttributes[${k}], Attributes[${k}])`;
}

export function buildTileConfig({
  source,
  metricName,
  metricType,
  agg,
  filters,
  searchFilters = [],
  dateRange,
  groupBy,
}: {
  source: TMetricSource;
  metricName: string;
  metricType: MetricsDataType;
  agg: TileAgg;
  filters: MetricFilterClause[];
  /** The page's own search box and pills, which narrow every tile too. */
  searchFilters?: Filter[];
  dateRange: [Date, Date];
  groupBy?: string;
}): BuilderChartConfigWithDateRange {
  return {
    source: source.id,
    connection: source.connection,
    from: { databaseName: source.from.databaseName, tableName: '' },
    metricTables: source.metricTables,
    timestampValueExpression: source.timestampValueExpression,
    where: filters.map(attributeClauseSql).join(' AND '),
    whereLanguage: 'sql',
    filters: searchFilters,
    select: [
      {
        aggFn: agg.aggFn,
        ...(agg.level != null ? { level: agg.level } : {}),
        aggCondition: '',
        aggConditionLanguage: 'sql',
        valueExpression: 'Value',
        metricName,
        metricType,
      },
    ],
    ...(groupBy ? { groupBy: attributeGroupBySql(groupBy) } : {}),
    granularity: 'auto',
    dateRange,
    displayType: DisplayType.Line,
    dateRangeEndInclusive: true,
  };
}
