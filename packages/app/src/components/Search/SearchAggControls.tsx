import { useCallback, useMemo } from 'react';
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryStates,
} from 'nuqs';
import { Granularity } from '@hyperdx/common-utils/dist/core/utils';
import {
  Filter,
  MetricsDataType,
  NumberFormat,
  NumberFormatSchema,
} from '@hyperdx/common-utils/dist/types';

import { ChartEditorSeries } from '@/components/ChartEditor/types';
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

export type ExploreSeries = ChartEditorSeries;

/**
 * A series' effective WHERE: whatever is still typed in its field, ANDed with
 * the clauses that have been promoted into pills. Each clause is parenthesised
 * so an OR-set pill (`x IN (...)`) cannot swallow the ones beside it.
 */
export function seriesAggCondition(series: ExploreSeries): string {
  const clauses = [
    series.aggCondition,
    ...(series.filters ?? []).map(f => ('condition' in f ? f.condition : '')),
  ]
    .map(clause => clause?.trim())
    .filter((clause): clause is string => Boolean(clause));

  return clauses.length > 1
    ? clauses.map(clause => `(${clause})`).join(' AND ')
    : (clauses[0] ?? '');
}

const DEFAULT_EXPLORE_SERIES: ExploreSeries = {
  aggFn: 'count',
  aggCondition: '',
  aggConditionLanguage: 'sql',
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
  granularity: Granularity | 'auto';
  alignDateRangeToGranularity: boolean;
  fillNulls: 0 | false;
  compareToPreviousPeriod: boolean;
  fitYAxisToData: boolean;
  numberFormat?: NumberFormat;
}

/**
 * Always SQL: these controls are Explore-only, and Explore authors WHERE
 * clauses in SQL. Taking the language from the cross-page stored preference
 * meant switching the Search page to Lucene silently changed what a new
 * Explore series expected you to type.
 */
export function createEmptyExploreSeries(): ExploreSeries {
  return {
    aggFn: 'count',
    aggCondition: '',
    aggConditionLanguage: 'sql',
    valueExpression: '',
  };
}

/** True when every series on a metric source has a metric name to query. */
export function exploreSeriesHaveMetricNames(series: ExploreSeries[]): boolean {
  return series.length > 0 && series.every(s => Boolean(s.metricName));
}

/**
 * True when every series has the column its aggregation needs.
 *
 * `count` is the only aggregation that takes no argument; the rest reduce over
 * an expression. Explore commits a series edit the moment it is made, so a
 * half-built series reaches the query layer as an empty expression and renders
 * to `toString()` with no argument — a ClickHouse arity error that never
 * mentions the column the user has yet to pick.
 *
 * Metric sources are exempt and shouldn't be passed here: they always reduce
 * over `Value`, and the field is hidden for them.
 */
export function exploreSeriesHaveValueExpressions(
  series: ExploreSeries[],
): boolean {
  return series.every(
    s => s.aggFn === 'count' || Boolean(s.valueExpression?.trim()),
  );
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

/**
 * A series' promoted pills. Anything malformed drops the whole list rather
 * than half of it: a partially applied filter set silently widens the query.
 */
function parseSeriesFilters(value: unknown): Filter[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    return undefined;
  }
  const filters: Filter[] = [];
  for (const item of value) {
    if (!isRecord(item)) return undefined;
    if (item.type !== 'sql' && item.type !== 'lucene') return undefined;
    if (typeof item.condition !== 'string') return undefined;
    filters.push({ type: item.type, condition: item.condition });
  }
  return filters;
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
    // Lucene only when a link says so outright, so old shared URLs still
    // render; anything unset is SQL, which is what Explore now authors.
    const aggConditionLanguage =
      item.aggConditionLanguage === 'lucene' ? 'lucene' : 'sql';
    const alias = optionalString(item.alias);
    const metricName = optionalString(item.metricName);
    const metricType = optionalString(item.metricType);
    const color = optionalString(item.color);
    const isDelta = optionalBoolean(item.isDelta);
    const filters = parseSeriesFilters(item.filters);

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
        ...(filters != null ? { filters } : {}),
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
      ...(filters != null ? { filters } : {}),
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
    // The legacy params carried no condition, so there is no old syntax to
    // preserve here and the series may as well start where Explore does.
    aggCondition: '',
    aggConditionLanguage: 'sql',
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
    granularity: parseAsStringEnum<Granularity | 'auto'>([
      'auto',
      ...Object.values(Granularity),
    ]).withDefault('auto'),
    alignIntervals: parseAsBoolean.withDefault(false),
    fillNulls: parseAsBoolean.withDefault(true),
    comparePrevious: parseAsBoolean.withDefault(false),
    fitYAxis: parseAsBoolean.withDefault(false),
    numberFormat: parseAsJsonEncoded(NumberFormatSchema.parse),
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
    granularity,
    alignIntervals,
    fillNulls,
    comparePrevious,
    fitYAxis,
    numberFormat,
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
      granularity,
      alignDateRangeToGranularity: alignIntervals,
      fillNulls: fillNulls ? 0 : false,
      compareToPreviousPeriod: comparePrevious,
      fitYAxisToData: fitYAxis,
      numberFormat: numberFormat ?? undefined,
    }),
    [
      series,
      groupBy,
      limit,
      sort,
      sortDir,
      ts,
      formulas,
      showOperandSeries,
      granularity,
      alignIntervals,
      fillNulls,
      comparePrevious,
      fitYAxis,
      numberFormat,
    ],
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
        ...(patch.granularity != null
          ? { granularity: patch.granularity }
          : {}),
        ...(patch.alignDateRangeToGranularity != null
          ? { alignIntervals: patch.alignDateRangeToGranularity }
          : {}),
        ...(patch.fillNulls != null
          ? { fillNulls: patch.fillNulls !== false }
          : {}),
        ...(patch.compareToPreviousPeriod != null
          ? { comparePrevious: patch.compareToPreviousPeriod }
          : {}),
        ...(patch.fitYAxisToData != null
          ? { fitYAxis: patch.fitYAxisToData }
          : {}),
        ...('numberFormat' in patch
          ? { numberFormat: patch.numberFormat ?? null }
          : {}),
      });
    },
    [setState],
  );

  return [config, setConfig];
}

export { DEFAULT_AGG_LIMIT };
