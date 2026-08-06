import {
  BuilderChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';

import { INTEGER_NUMBER_FORMAT } from '@/ChartUtils';
import type { NumberFormat } from '@/types';

export type ErrorsMode = 'rate' | 'volume';

// One decimal so sub-1% rates read (e.g. 0.4%) instead of rounding to 0%,
// while the axis still auto-scales to the data.
export const ERROR_RATE_FORMAT: NumberFormat = {
  output: 'percent',
  mantissa: 1,
};

/**
 * Helper series that back the error-rate ratio; hidden from the chart so only
 * the computed rate shows. Aggregating count and countIf separately (instead of
 * avg over a status boolean) lets AggregatingMergeTree materialized views
 * satisfy the query.
 */
export const ERROR_RATE_HELPER_SERIES = ['total_spans', 'error_spans'];

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

/** SQL condition that marks a span as an error, or undefined when the source
 * has no status-code expression to test. Mirrors the service dashboard's
 * `lower(StatusCode) = 'error'` definition. */
export function errorConditionSql(
  statusCodeExpression: string | undefined,
): string | undefined {
  return statusCodeExpression
    ? `lower(${statusCodeExpression}) = 'error'`
    : undefined;
}

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
 * Errors as a rate or a volume. Rate is `countIf(error) / count()`: the two
 * counts are aggregated separately (MV-friendly) and divided in a
 * post-aggregation column, with the helper counts hidden via
 * ERROR_RATE_HELPER_SERIES. Volume is `countIf(error)` as bars. Returns
 * undefined when the source has no error condition.
 */
export function errorsConfig(
  base: BuilderChartConfigWithDateRange,
  errorCondition: string | undefined,
  mode: ErrorsMode,
): BuilderChartConfigWithDateRange | undefined {
  if (errorCondition == null) {
    return undefined;
  }
  if (mode === 'rate') {
    return {
      ...base,
      select: [
        {
          alias: 'total_spans',
          aggFn: 'count',
          aggCondition: '',
          valueExpression: '',
        },
        {
          alias: 'error_spans',
          aggFn: 'count',
          aggCondition: errorCondition,
          aggConditionLanguage: 'sql',
          valueExpression: '',
        },
        {
          // Guard the empty-bucket 0/0 (which becomes NaN and breaks the
          // auto-scaled y-axis) and clamp to 100%, since an error rate cannot
          // exceed 1 by definition.
          alias: 'Error rate',
          valueExpression:
            'least(if(total_spans > 0, error_spans / total_spans, 0), 1)',
        },
      ],
      displayType: DisplayType.Line,
      numberFormat: ERROR_RATE_FORMAT,
    };
  }
  return {
    ...base,
    select: [
      {
        alias: 'Errors',
        aggFn: 'count',
        aggCondition: errorCondition,
        aggConditionLanguage: 'sql',
        valueExpression: '',
      },
    ],
    displayType: DisplayType.StackedBar,
    numberFormat: INTEGER_NUMBER_FORMAT,
  };
}

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
        alias: 'Avg',
        aggFn: 'avg',
        aggCondition: '',
        valueExpression: durationExpression,
      },
      {
        alias: 'p95',
        aggFn: 'quantile',
        level: 0.95,
        aggCondition: '',
        valueExpression: durationExpression,
      },
      {
        alias: 'p99',
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
