import {
  convertDateRangeToGranularityString,
  convertGranularityToSeconds,
  isTimeSeriesDisplayType,
} from '@/core/utils';
import {
  DisplayType,
  PromqlExpressionList,
  PromqlQueryType,
  PromqlReducer,
  PromqlSeries,
  SQLInterval,
} from '@/types';

/**
 * The expressions a PromQL config plots, normalizing the bare-string shape
 * tiles were saved with before multi-expression support.
 */
export function getPromqlSeries(config: {
  promqlExpression?: PromqlExpressionList;
}): PromqlSeries[] {
  const { promqlExpression } = config;
  if (promqlExpression == null) return [];
  return typeof promqlExpression === 'string'
    ? [{ expression: promqlExpression }]
    : promqlExpression;
}

/**
 * The expressions a PromQL config actually queries. Blank rows are skipped so
 * an unfinished one the editor is still holding never reaches Prometheus. Only
 * time series charts plot several result sets.
 */
export function getQueriedPromqlSeries(config: {
  promqlExpression?: PromqlExpressionList;
  displayType?: DisplayType;
}): PromqlSeries[] {
  const series = getPromqlSeries(config);
  const queried = isTimeSeriesDisplayType(config.displayType)
    ? series
    : series.slice(0, 1);
  return queried.filter(({ expression }) => expression.trim());
}

/** Whether a display type can evaluate an expression using query instead of query_range */
export const displayTypeSupportsInstantQuery = (config: {
  displayType?: DisplayType;
}): boolean => config.displayType === DisplayType.Number;

/** Whether a display type collapses a range query to one value per series using a client-side reducer. */
export const displayTypeSupportsReducer = (config: {
  displayType?: DisplayType;
}): boolean => config.displayType === DisplayType.Number;

/** The reducer applied when none is chosen. */
export const DEFAULT_PROMQL_REDUCER = PromqlReducer.LastNotNull;

/** How an expression is evaluated when it never chose. */
export const DEFAULT_PROMQL_QUERY_TYPE: PromqlQueryType = 'range';

/** How an expression is evaluated. Range by default, unless instant is specified. */
export const promqlSeriesQueryType = (series: PromqlSeries): PromqlQueryType =>
  series.queryType ?? DEFAULT_PROMQL_QUERY_TYPE;

/** Aggregate a series' samples according to the specified reducer. */
export function reducePromqlSamples(
  samples: number[],
  reducer: PromqlReducer = DEFAULT_PROMQL_REDUCER,
): number | undefined {
  // Non-finite samples are skipped. Prometheus reports a gap or a
  // division-by-zero as NaN, and averaging or summing those poisons the result.
  // Returns undefined when no usable sample is left, which the caller treats as
  // the series having no value rather than as a zero.
  const usable = samples.filter(sample => Number.isFinite(sample));
  if (usable.length === 0) return undefined;

  switch (reducer) {
    case PromqlReducer.Min:
      return usable.reduce((min, n) => (n < min ? n : min));
    case PromqlReducer.Max:
      return usable.reduce((max, n) => (n > max ? n : max));
    case PromqlReducer.Mean:
      return usable.reduce((sum, n) => sum + n, 0) / usable.length;
    case PromqlReducer.Sum:
      return usable.reduce((sum, n) => sum + n, 0);
    case PromqlReducer.Count:
      return usable.length;
    case PromqlReducer.LastNotNull:
      return usable[usable.length - 1];
  }
}

/** A HyperDX granularity ("5 minute") as a Prometheus step ("300s"). */
export const promqlStep = (
  granularity: string | undefined,
  dateRange?: [Date, Date],
): string => {
  const resolved =
    (!granularity || granularity === 'auto') && dateRange
      ? convertDateRangeToGranularityString(dateRange)
      : granularity;
  if (!resolved || resolved === 'auto') return '60s';
  // convertGranularityToSeconds returns 0 for units it doesn't recognize.
  return `${convertGranularityToSeconds(resolved as SQLInterval) || 60}s`;
};

/**
 * Whether any expression this config queries is evaluated over a range, and so
 * reads the tile's granularity (step).
 */
export const isRangeQuery = (config: {
  promqlExpression?: PromqlExpressionList;
  displayType?: DisplayType;
}): boolean =>
  getQueriedPromqlSeries(config).some(
    series => promqlSeriesQueryType(series) === 'range',
  );

/**
 * Whether this config's range buckets can be collapsed to one value per series by
 * a client-side reducer, rather than plotted.
 */
export const isReducibleRangeQuery = (config: {
  promqlExpression?: PromqlExpressionList;
  displayType?: DisplayType;
}): boolean => displayTypeSupportsReducer(config) && isRangeQuery(config);

/** Whether the config specifies a reducer. */
export const appliesPromqlReducer = (config: {
  promqlExpression?: PromqlExpressionList;
  displayType?: DisplayType;
}): boolean =>
  isReducibleRangeQuery(config) &&
  getQueriedPromqlSeries(config)[0]?.reducer != null;
