import { useCallback, useMemo } from 'react';
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  useQueryStates,
} from 'nuqs';
import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

import { SavedChartConfigWithSelectArray } from '@/components/ChartEditor/types';
import { parseAsJsonEncoded } from '@/utils/queryParsers';

import { type ExploreFormula, parseExploreFormulas } from './exploreFormulas';
import type { SearchView } from './searchViews';

const LEGACY_AGG_FNS = new Set<string>([
  'count',
  'count_distinct',
  'sum',
  'avg',
  'min',
  'max',
  'p50',
  'p90',
  'p95',
  'p99',
]);

/**
 * Translate a UI agg-fn (which includes percentile shorthands like `p95`)
 * into the `select[]` shape understood by the chart config renderer. The
 * percentile options map onto `{ aggFn: 'quantile', level }`.
 */
export function aggFnToSelectFields(
  aggFn: string,
): { aggFn: string } | { aggFn: 'quantile'; level: number } {
  if (['p50', 'p90', 'p95', 'p99'].includes(aggFn)) {
    return {
      aggFn: 'quantile',
      level: Number.parseFloat(aggFn.replace('p', '0.')),
    };
  }
  return { aggFn };
}

const DEFAULT_AGG_LIMIT = 20;

export type AggSortField = 'value' | 'name';
type AggSortDirection = 'asc' | 'desc';
type TimeseriesChartType = 'line' | 'bar';

export type ExploreSeries = SavedChartConfigWithSelectArray['select'][number];

const DEFAULT_EXPLORE_SERIES: ExploreSeries = {
  aggFn: 'count',
  aggCondition: '',
  aggConditionLanguage: 'lucene',
  valueExpression: '',
};

export interface SearchAggConfig {
  series: ExploreSeries[];
  groupBy: string;
  limit: number;
  sort: AggSortField;
  sortDir: AggSortDirection;
  /** Line vs. bar for the Time series view. */
  chartType: TimeseriesChartType;
  formulas: ExploreFormula[];
  /** When formulas exist: show operand series in the chart. Default on. */
  showOperandSeries: boolean;
}

export function createEmptyExploreSeries(
  language: 'sql' | 'lucene' = 'lucene',
): ExploreSeries {
  return {
    aggFn: 'count',
    aggCondition: '',
    aggConditionLanguage: language,
    valueExpression: '',
  };
}

/** True when every series on a metric source has a metric name to query. */
export function exploreSeriesHaveMetricNames(series: ExploreSeries[]): boolean {
  return series.length > 0 && series.every(s => Boolean(s.metricName));
}

export function canAddExploreSeries(
  view: SearchView,
  seriesCount: number,
  hasFormulas = false,
): boolean {
  if (view === 'pie' || view === 'bar') return false;
  // Number is capped at 2 series unless a formula needs extra operands
  // (e.g. A / (A + B + C)), matching Chart Explorer.
  if (view === 'number' && !hasFormulas) return seriesCount < 2;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** Parse the `series` URL param into chart `select[]` items, or null if invalid. */
export function parseExploreSeries(value: unknown): ExploreSeries[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    return null;
  }
  const series: ExploreSeries[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const aggFn =
      typeof item.aggFn === 'string' && item.aggFn.length > 0
        ? item.aggFn
        : 'count';
    const valueExpression =
      typeof item.valueExpression === 'string' ? item.valueExpression : '';
    const aggCondition =
      typeof item.aggCondition === 'string' ? item.aggCondition : '';
    const aggConditionLanguage =
      item.aggConditionLanguage === 'sql' ? 'sql' : 'lucene';
    const alias = optionalString(item.alias);
    const metricName = optionalString(item.metricName);
    const metricType = optionalString(item.metricType);
    const color = optionalString(item.color);
    const isDelta = optionalBoolean(item.isDelta);

    if (aggFn === 'quantile') {
      series.push({
        aggFn: 'quantile',
        level: typeof item.level === 'number' ? item.level : 0.95,
        valueExpression,
        aggCondition,
        aggConditionLanguage,
        ...(alias != null ? { alias } : {}),
        ...(metricName != null ? { metricName } : {}),
        ...(metricType != null
          ? { metricType: metricType as MetricsDataType }
          : {}),
        ...(color != null ? { color: color as ExploreSeries['color'] } : {}),
        ...(isDelta != null ? { isDelta } : {}),
      });
      continue;
    }

    series.push({
      aggFn,
      valueExpression,
      aggCondition,
      aggConditionLanguage,
      ...(typeof item.level === 'number' ? { level: item.level } : {}),
      ...(alias != null ? { alias } : {}),
      ...(metricName != null ? { metricName } : {}),
      ...(metricType != null
        ? { metricType: metricType as MetricsDataType }
        : {}),
      ...(color != null ? { color: color as ExploreSeries['color'] } : {}),
      ...(isDelta != null ? { isDelta } : {}),
    } as ExploreSeries);
  }
  return series;
}

/** Turn the old `agg` / `aggExpr` / `metric` URL scalars into one series. */
export function migrateLegacyAggToSeries(params: {
  agg?: string | null;
  aggExpr?: string | null;
  metric?: string | null;
  metricType?: string | null;
}): ExploreSeries {
  const agg =
    params.agg && LEGACY_AGG_FNS.has(params.agg) ? params.agg : 'count';
  const selectFields = aggFnToSelectFields(agg);
  const isMetric = Boolean(params.metric);
  return {
    ...selectFields,
    aggCondition: '',
    aggConditionLanguage: 'lucene',
    valueExpression: isMetric ? 'Value' : (params.aggExpr ?? ''),
    ...(isMetric
      ? {
          metricName: params.metric ?? undefined,
          metricType: (params.metricType || MetricsDataType.Gauge) as
            | MetricsDataType
            | undefined,
        }
      : {}),
  } as ExploreSeries;
}

function hasLegacyAggParams(state: {
  agg: string | null;
  aggExpr: string | null;
  metric: string | null;
  metricType: string | null;
}): boolean {
  return (
    (state.agg != null && state.agg.length > 0) ||
    (state.aggExpr != null && state.aggExpr.length > 0) ||
    (state.metric != null && state.metric.length > 0) ||
    (state.metricType != null && state.metricType.length > 0)
  );
}

/** URL-backed aggregation config for Explore chart views. */
export function useSearchAggConfig(): [
  SearchAggConfig,
  (patch: Partial<SearchAggConfig>) => void,
] {
  const [state, setState] = useQueryStates({
    series: parseAsJsonEncoded(parseExploreSeries),
    formulas: parseAsJsonEncoded(parseExploreFormulas),
    showOperandSeries: parseAsBoolean.withDefault(true),
    agg: parseAsString,
    aggExpr: parseAsString,
    metric: parseAsString,
    metricType: parseAsString,
    groupBy: parseAsString.withDefault(''),
    limit: parseAsInteger.withDefault(DEFAULT_AGG_LIMIT),
    sort: parseAsString.withDefault('value'),
    sortDir: parseAsString.withDefault('desc'),
    ts: parseAsString.withDefault('bar'),
  });

  const {
    series: seriesParam,
    formulas: formulasParam,
    showOperandSeries,
    agg,
    aggExpr,
    metric,
    metricType,
    groupBy,
    limit,
    sort,
    sortDir,
    ts,
  } = state;

  const series = useMemo<ExploreSeries[]>(() => {
    if (seriesParam != null && seriesParam.length > 0) {
      return seriesParam;
    }
    if (hasLegacyAggParams({ agg, aggExpr, metric, metricType })) {
      return [migrateLegacyAggToSeries({ agg, aggExpr, metric, metricType })];
    }
    return [DEFAULT_EXPLORE_SERIES];
  }, [seriesParam, agg, aggExpr, metric, metricType]);

  const formulas = useMemo<ExploreFormula[]>(
    () => formulasParam ?? [],
    [formulasParam],
  );

  const config = useMemo<SearchAggConfig>(
    () => ({
      series,
      groupBy,
      limit,
      sort: sort as AggSortField,
      sortDir: sortDir as AggSortDirection,
      chartType: ts as TimeseriesChartType,
      formulas,
      showOperandSeries,
    }),
    [series, groupBy, limit, sort, sortDir, ts, formulas, showOperandSeries],
  );

  const setConfig = useCallback(
    (patch: Partial<SearchAggConfig>) => {
      setState({
        ...(patch.series != null
          ? {
              series: patch.series,
              // Drop the pre-series URL scalars so a migrated link doesn't
              // fight the new `series` param on the next load.
              agg: null,
              aggExpr: null,
              metric: null,
              metricType: null,
            }
          : {}),
        ...(patch.formulas != null
          ? {
              formulas: patch.formulas.length > 0 ? patch.formulas : null,
            }
          : {}),
        ...(patch.showOperandSeries != null
          ? { showOperandSeries: patch.showOperandSeries }
          : {}),
        ...(patch.groupBy != null ? { groupBy: patch.groupBy } : {}),
        ...(patch.limit != null ? { limit: patch.limit } : {}),
        ...(patch.sort != null ? { sort: patch.sort } : {}),
        ...(patch.sortDir != null ? { sortDir: patch.sortDir } : {}),
        ...(patch.chartType != null ? { ts: patch.chartType } : {}),
      });
    },
    [setState],
  );

  return [config, setConfig];
}

export { DEFAULT_AGG_LIMIT };
