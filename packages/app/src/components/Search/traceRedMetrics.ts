import {
  BuilderChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';

import {
  ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
  INTEGER_NUMBER_FORMAT,
  MS_NUMBER_FORMAT,
} from '@/ChartUtils';

export type ErrorsMode = 'rate' | 'volume';

/**
 * The RED metrics for a trace source, derived from the same base config the
 * count histogram uses so they honor the active WHERE filter and time range.
 * Kept as pure builders so the aggregations can be unit tested without
 * rendering. Only the select, display type, and number format change per chart.
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
 * Errors as a rate (avg of a 0/1 error boolean, rendered as a percent line) or
 * a volume (countIf error, rendered as bars). Returns undefined when the source
 * has no error condition.
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
          alias: 'Error rate',
          aggFn: 'avg',
          aggCondition: '',
          valueExpression: errorCondition,
        },
      ],
      displayType: DisplayType.Line,
      numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
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

/** Duration: Avg, p95, p99 over the source's millisecond duration expression. */
export function durationConfig(
  base: BuilderChartConfigWithDateRange,
  durationMsExpression: string,
): BuilderChartConfigWithDateRange {
  return {
    ...base,
    select: [
      {
        alias: 'Avg',
        aggFn: 'avg',
        aggCondition: '',
        valueExpression: durationMsExpression,
      },
      {
        alias: 'p95',
        aggFn: 'quantile',
        level: 0.95,
        aggCondition: '',
        valueExpression: durationMsExpression,
      },
      {
        alias: 'p99',
        aggFn: 'quantile',
        level: 0.99,
        aggCondition: '',
        valueExpression: durationMsExpression,
      },
    ],
    displayType: DisplayType.Line,
    numberFormat: MS_NUMBER_FORMAT,
  };
}
