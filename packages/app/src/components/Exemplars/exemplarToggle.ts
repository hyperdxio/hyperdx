import { getExemplarPromqlExpression } from '@hyperdx/common-utils/dist/core/promql';
import {
  isExemplarEligible,
  isPromqlExemplarEligible,
} from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  PromqlExpressionList,
  SourceKind,
} from '@hyperdx/common-utils/dist/types';

export type ExemplarToggleState = {
  /** Render the toggle at all: this chart's source kind can carry exemplars. */
  showExemplars: boolean;
  /**
   * Why the overlay can't be switched on as the chart is currently configured.
   * Undefined means eligible.
   */
  exemplarIneligibleReason?: string;
};

const PROMQL_INELIGIBLE =
  'Available on an expression that plots a duration, such as histogram_quantile(...).';

const METRIC_INELIGIBLE =
  'Available on a single non-ratio histogram series with no group by, aggregated to a duration (avg, min, max, last value or a quantile).';

/**
 * Whether the chart editor offers the exemplar toggle, and why it is refused.
 *
 * A marker sits at one trace's own measurement on the chart's shared axis, so
 * the eligibility rules come from common-utils — the exemplar fetch applies the
 * same two predicates, so the toggle can't promise markers the query won't
 * produce. Ineligible charts keep the toggle visible but disabled, carrying the
 * reason, rather than hiding the feature with no explanation.
 */
export function getExemplarToggleState({
  enabled,
  configType,
  sourceKind,
  promqlExpression,
  series,
  seriesReturnType,
  groupBy,
}: {
  /** Deployment feature gate (IS_EXEMPLARS_ENABLED). */
  enabled: boolean;
  configType?: 'sql' | 'builder' | 'promql';
  sourceKind?: SourceKind;
  promqlExpression?: PromqlExpressionList;
  series?: { aggFn?: string; metricType?: string }[];
  seriesReturnType?: 'ratio' | 'column';
  /** Builder group by: a SQL string or a select list, both length-bearing. */
  groupBy?: { length: number };
}): ExemplarToggleState {
  if (!enabled || configType === 'sql') {
    return { showExemplars: false };
  }
  if (configType === 'promql') {
    return {
      showExemplars: true,
      exemplarIneligibleReason: isPromqlExemplarEligible(
        getExemplarPromqlExpression(promqlExpression),
      )
        ? undefined
        : PROMQL_INELIGIBLE,
    };
  }
  if (sourceKind !== SourceKind.Metric) {
    return { showExemplars: false };
  }
  return {
    showExemplars: true,
    exemplarIneligibleReason: isExemplarEligible({
      seriesCount: series?.length ?? 0,
      seriesReturnType,
      metricType: series?.[0]?.metricType,
      aggFn: series?.[0]?.aggFn,
      hasGroupBy: (groupBy?.length ?? 0) > 0,
    })
      ? undefined
      : METRIC_INELIGIBLE,
  };
}
