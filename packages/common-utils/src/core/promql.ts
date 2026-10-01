import {
  convertDateRangeToGranularityString,
  convertGranularityToSeconds,
  isTimeSeriesDisplayType,
} from '@/core/utils';
import type { MacroSuggestion } from '@/macros';
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
}): boolean =>
  config.displayType === DisplayType.Number ||
  config.displayType === DisplayType.Table;

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

/** A HyperDX granularity ("5 minute") as a Prometheus step, in seconds. */
const promqlStepSeconds = (
  granularity: string | undefined,
  dateRange?: [Date, Date],
): number => {
  const resolved =
    (!granularity || granularity === 'auto') && dateRange
      ? convertDateRangeToGranularityString(dateRange)
      : granularity;
  if (!resolved || resolved === 'auto') return 60;
  // convertGranularityToSeconds returns 0 for units it doesn't recognize.
  return convertGranularityToSeconds(resolved as SQLInterval) || 60;
};

/** A HyperDX granularity ("5 minute") as a Prometheus step ("300s"). */
export const promqlStep = (
  granularity: string | undefined,
  dateRange?: [Date, Date],
): string => `${promqlStepSeconds(granularity, dateRange)}s`;

/**
 * HyperDX doesn't know a PromQL source's scrape interval, so `$__rate_interval`
 * assumes Prometheus' default.
 *
 * TODO (HDX-5512): Use the PromQL source's minGranularitySeconds setting instead.
 */
const PROMQL_DEFAULT_SCRAPE_INTERVAL_SECONDS = 15;

/** What the PromQL macros are computed from, for a chart's granularity and time range. */
export type PromqlMacroInputs = {
  intervalSeconds: number;
  rangeSeconds: number;
};

export type PromqlMacro = MacroSuggestion & {
  expand: (inputs: PromqlMacroInputs) => string;
};

export const PROMQL_MACROS = [
  {
    name: 'interval',
    minArgs: 0,
    maxArgs: 0,
    description:
      'The step between points in the chart, as a duration such as 60s. Use it as a range, e.g. avg_over_time(metric[$__interval]).',
    expand: ({ intervalSeconds }) => `${intervalSeconds}s`,
  },
  {
    name: 'range',
    minArgs: 0,
    maxArgs: 0,
    description:
      'The length of the selected time range, as a duration such as 3600s. e.g. increase(metric[$__range]).',
    expand: ({ rangeSeconds }) => `${rangeSeconds}s`,
  },
  {
    name: 'rate_interval',
    minArgs: 0,
    maxArgs: 0,
    description: `A safe range for rate() and increase(): the larger of $__interval + ${PROMQL_DEFAULT_SCRAPE_INTERVAL_SECONDS}s and ${4 * PROMQL_DEFAULT_SCRAPE_INTERVAL_SECONDS}s, assuming a ${PROMQL_DEFAULT_SCRAPE_INTERVAL_SECONDS}s scrape interval. e.g. rate(metric[$__rate_interval]).`,
    expand: ({ intervalSeconds }) =>
      `${Math.max(
        intervalSeconds + PROMQL_DEFAULT_SCRAPE_INTERVAL_SECONDS,
        4 * PROMQL_DEFAULT_SCRAPE_INTERVAL_SECONDS,
      )}s`,
  },
] as const satisfies readonly PromqlMacro[];

export type PromqlMacroName = (typeof PROMQL_MACROS)[number]['name'];

export const PROMQL_MACRO_NAMES = PROMQL_MACROS.map(({ name }) => name);

export const isPromqlMacroName = (name: string): name is PromqlMacroName =>
  (PROMQL_MACRO_NAMES as readonly string[]).includes(name);

export function getPromqlMacroInputs(
  granularity: string | undefined,
  dateRange: [Date, Date],
): PromqlMacroInputs {
  const [start, end] = dateRange;
  return {
    intervalSeconds: promqlStepSeconds(granularity, dateRange),
    rangeSeconds: Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 1000),
    ),
  };
}

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
