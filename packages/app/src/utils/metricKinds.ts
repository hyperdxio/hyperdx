import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

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
