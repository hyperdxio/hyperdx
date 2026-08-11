import {
  BuilderChartConfigWithDateRange,
  ChartPaletteToken,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';

import {
  ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
  INTEGER_NUMBER_FORMAT,
} from '@/ChartUtils';
import { errorPredicateSql } from '@/source';
import type { NumberFormat } from '@/types';

export type ErrorsMode = 'rate' | 'volume';

// The app-wide error-rate percent format, but with one decimal so sub-1% rates
// read (e.g. 0.4%) instead of rounding to 0% on this tile's capped axis.
export const ERROR_RATE_FORMAT: NumberFormat = {
  ...ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
  mantissa: 1,
};

// Column aliases for the two counts that back the error-rate ratio. Declared
// once so the select, the post-aggregation ratio expression, and the
// hidden-series list below all stay in lockstep; renaming here can't silently
// unhide the helper counts.
const TOTAL_SPANS_ALIAS = 'total_spans';
const ERROR_SPANS_ALIAS = 'error_spans';

/**
 * Helper series that back the error-rate ratio; hidden from the chart so only
 * the computed rate shows. Aggregating count and countIf separately (instead of
 * avg over a status boolean) lets AggregatingMergeTree materialized views
 * satisfy the query.
 */
export const ERROR_RATE_HELPER_SERIES = [TOTAL_SPANS_ALIAS, ERROR_SPANS_ALIAS];

/**
 * The RED metrics for a trace source, derived from the same base config the
 * count histogram uses so they honor the active WHERE filter and time range.
 * Kept as pure builders so the aggregations can be unit tested without
 * rendering. Only the select, display type, and number format change per chart.
 *
 * Every aggregation is over a raw column (count, countIf, quantile/avg of the
 * duration expression) so materialized views can satisfy it; unit and ratio
 * conversion happen at the display layer or in a post-aggregation column.
 */

/** The histogram config with its status-code groupBy removed, so RED charts
 * aggregate across all matching spans rather than splitting per status. */
export function redBaseConfig(
  histogramTimeChartConfig: BuilderChartConfigWithDateRange,
): BuilderChartConfigWithDateRange {
  return { ...histogramTimeChartConfig, groupBy: undefined };
}

/** Throughput: span count per bucket. Bars (StackedBar is the only display
 * type that renders bars; a single series draws like a plain bar chart). */
export function throughputConfig(
  base: BuilderChartConfigWithDateRange,
): BuilderChartConfigWithDateRange {
  return {
    ...base,
    select: [
      { alias: 'Spans', aggFn: 'count', aggCondition: '', valueExpression: '' },
    ],
    displayType: DisplayType.StackedBar,
    numberFormat: INTEGER_NUMBER_FORMAT,
  };
}

/**
 * Errors as a rate or a volume, derived from the source's status-code
 * expression. Returns undefined when the source has no usable status
 * expression (so the caller drops the Errors tile).
 *
 * Rate is `countIf(error) / count()`: the two counts are aggregated separately
 * (MV-friendly) and divided in a post-aggregation column, with the helper
 * counts hidden via ERROR_RATE_HELPER_SERIES.
 *
 * Volume is the error span count grouped by status and restricted to the error
 * condition. Grouping keeps the histogram's drill-down: clicking the bar
 * decodes to the status value, so the results list can filter to it. The error
 * filter keeps the tile errors-only rather than reintroducing the healthy
 * spans.
 */
export function errorsConfig(
  base: BuilderChartConfigWithDateRange,
  statusCodeExpression: string | undefined,
  mode: ErrorsMode,
): BuilderChartConfigWithDateRange | undefined {
  const groupBy = statusCodeExpression?.trim();
  if (!groupBy) {
    return undefined;
  }
  const errorCondition = errorPredicateSql(groupBy);
  if (mode === 'rate') {
    return {
      ...base,
      select: [
        {
          alias: TOTAL_SPANS_ALIAS,
          aggFn: 'count',
          aggCondition: '',
          valueExpression: '',
        },
        {
          alias: ERROR_SPANS_ALIAS,
          aggFn: 'count',
          aggCondition: errorCondition,
          aggConditionLanguage: 'sql',
          valueExpression: '',
        },
        {
          // Guard the empty-bucket 0/0 (which becomes NaN and breaks the
          // auto-scaled y-axis). error_spans is a countIf over the same rows as
          // total_spans = count(), so the ratio can't exceed 1; no clamp needed.
          alias: 'Error rate',
          valueExpression: `if(${TOTAL_SPANS_ALIAS} > 0, ${ERROR_SPANS_ALIAS} / ${TOTAL_SPANS_ALIAS}, 0)`,
        },
      ],
      displayType: DisplayType.Line,
      numberFormat: ERROR_RATE_FORMAT,
    };
  }
  return {
    ...base,
    groupBy,
    select: [
      {
        alias: 'Errors',
        aggFn: 'count',
        aggCondition: '',
        valueExpression: '',
      },
    ],
    filters: [
      ...(base.filters ?? []),
      { type: 'sql' as const, condition: errorCondition },
    ],
    displayType: DisplayType.StackedBar,
    numberFormat: INTEGER_NUMBER_FORMAT,
  };
}

// Duration series aliases, declared once so durationConfig's select and the
// DURATION_SERIES_COLORS pins below key off the same strings. setLineColors
// resolves a pin by result-column name, so a rename that touched only one side
// would silently drop the pin and let that percentile fall back to the
// positional palette slot (chart-red) the pins exist to avoid, with no test or
// type failure to catch it.
const DURATION_AVG_ALIAS = 'Avg';
const DURATION_P95_ALIAS = 'p95';
const DURATION_P99_ALIAS = 'p99';

/**
 * Pin the Duration percentiles to stable, cool palette hues so latency never
 * borrows error red (or warning orange / success green), and so each percentile
 * keeps its color across sessions regardless of how the data sorts the lines.
 */
export const DURATION_SERIES_COLORS = {
  [DURATION_AVG_ALIAS]: 'chart-blue',
  [DURATION_P95_ALIAS]: 'chart-cyan',
  [DURATION_P99_ALIAS]: 'chart-purple',
} satisfies Record<string, ChartPaletteToken>;

/**
 * Duration: Avg, p95, p99 over the source's raw duration expression. Aggregating
 * the raw column (not a divided-to-ms expression) keeps it MV-friendly; the
 * caller passes a duration NumberFormat derived from the source's precision
 * (via getTraceDurationNumberFormat) so unit conversion happens at display.
 */
export function durationConfig(
  base: BuilderChartConfigWithDateRange,
  durationExpression: string,
  numberFormat: NumberFormat | undefined,
): BuilderChartConfigWithDateRange {
  return {
    ...base,
    select: [
      {
        alias: DURATION_AVG_ALIAS,
        aggFn: 'avg',
        aggCondition: '',
        valueExpression: durationExpression,
      },
      {
        alias: DURATION_P95_ALIAS,
        aggFn: 'quantile',
        level: 0.95,
        aggCondition: '',
        valueExpression: durationExpression,
      },
      {
        alias: DURATION_P99_ALIAS,
        aggFn: 'quantile',
        level: 0.99,
        aggCondition: '',
        valueExpression: durationExpression,
      },
    ],
    displayType: DisplayType.Line,
    numberFormat,
  };
}
