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

/** SQL condition that marks a span as an error, or undefined when the source
 * has no status-code expression to test (blank/whitespace counts as none, so a
 * misconfigured source drops the Errors tile rather than emitting
 * `lower(   ) = 'error'`). Mirrors the service dashboard's
 * `lower(StatusCode) = 'error'` definition. */
export function errorConditionSql(
  statusCodeExpression: string | undefined,
): string | undefined {
  const expr = statusCodeExpression?.trim();
  return expr ? `lower(${expr}) = 'error'` : undefined;
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
  const errorCondition = errorConditionSql(groupBy);
  if (!groupBy || errorCondition == null) {
    return undefined;
  }
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
          // auto-scaled y-axis) and clamp to 100%, since an error rate cannot
          // exceed 1 by definition.
          alias: 'Error rate',
          valueExpression: `least(if(${TOTAL_SPANS_ALIAS} > 0, ${ERROR_SPANS_ALIAS} / ${TOTAL_SPANS_ALIAS}, 0), 1)`,
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
