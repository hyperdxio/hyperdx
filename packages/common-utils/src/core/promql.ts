import {
  convertGranularityToSeconds,
  isTimeSeriesDisplayType,
} from '@/core/utils';
import {
  DisplayType,
  PromqlExpressionList,
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

/** A HyperDX granularity ("5 minute") as a Prometheus step ("300s"). */
export const promqlStep = (granularity: string | undefined): string => {
  if (!granularity || granularity === 'auto') return '60s';
  // convertGranularityToSeconds returns 0 for units it doesn't recognize.
  return `${convertGranularityToSeconds(granularity as SQLInterval) || 60}s`;
};
