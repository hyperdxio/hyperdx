import { PromqlExpressionList, PromqlSeries } from '@/types';

/**
 * The expressions a PromQL config plots, normalizing the bare-string shape
 * tiles were saved with before multi-expression support. New saves always
 * write the list, so every reader goes through here rather than narrowing the
 * union itself.
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
 * The Handlebars template an expression's series names render with: its own,
 * falling back to the chart-level default. Blank templates are treated as
 * unset so clearing one input falls through to the other.
 */
export function resolveLegendTemplate(
  series: PromqlSeries,
  config: { legendTemplate?: string },
): string | undefined {
  return (
    series.legendTemplate?.trim() || config.legendTemplate?.trim() || undefined
  );
}
