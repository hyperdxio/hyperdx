import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

/**
 * Metric kinds the query renderer can chart, in the order they are listed to
 * the user. `summary` is not one of them.
 *
 * A readonly tuple rather than an array so `QueryableMetricKind` is a union of
 * exactly these four: anything keyed by that type stops compiling when a kind
 * is added here, which is what forces the per-kind queries behind it to be
 * wired up rather than silently skipped.
 */
export const QUERYABLE_KINDS = [
  MetricsDataType.Gauge,
  MetricsDataType.Sum,
  MetricsDataType.Histogram,
  MetricsDataType.ExponentialHistogram,
] as const;

export type QueryableMetricKind = (typeof QUERYABLE_KINDS)[number];

/**
 * Display labels for OTel metric kinds. Single source of truth so the metric
 * explorer's tree, its detail pane, and the chart editor's inline attribute
 * panel all name a kind the same way.
 */
export const METRIC_KIND_LABELS: Record<MetricsDataType, string> = {
  [MetricsDataType.Gauge]: 'Gauge',
  [MetricsDataType.Sum]: 'Sum',
  [MetricsDataType.Histogram]: 'Histogram',
  [MetricsDataType.ExponentialHistogram]: 'Exp. histogram',
  [MetricsDataType.Summary]: 'Summary',
};

/**
 * Label for a metric kind that may arrive as a loose string (form state stores
 * `metricType` as a plain string in places). Falls back to the raw value so an
 * unrecognised kind is still shown rather than silently blanked.
 */
export function metricKindLabel(metricType: string | undefined): string {
  if (!metricType) return '';
  // Index through a widened view of the map rather than asserting the input is
  // a MetricsDataType, which it may not be.
  const labels: Record<string, string | undefined> = METRIC_KIND_LABELS;
  return labels[metricType.toLowerCase()] ?? metricType;
}
