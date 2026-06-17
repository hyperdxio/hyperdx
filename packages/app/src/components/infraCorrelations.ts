import {
  K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
  K8S_FILESYSTEM_NUMBER_FORMAT,
  K8S_MEM_NUMBER_FORMAT,
} from '@/ChartUtils';
import { NumberFormat } from '@/types';

// One metric chart inside an infrastructure correlation group. The rendered
// metric field is `${fieldPrefix}${field} - Gauge` (see DBInfraPanel), so
// `field` is the metric name without the resource prefix or the type suffix.
export type InfraChartSpec = {
  readonly title: string;
  // data-testid for the chart card; the e2e suite selects on these.
  readonly cardTestId: string;
  readonly field: string;
  readonly numberFormat: NumberFormat;
};

// A declarative infrastructure correlation group. `detectAttribute` decides
// whether the group (and the Infrastructure tab) appears for an opened row;
// `correlateAttribute` is the resource attribute the metrics are filtered by.
// They match for Kubernetes today but are kept separate so resource types that
// detect on one attribute and correlate on another can be added as data rather
// than new code paths.
export type InfraCorrelation = {
  readonly title: string;
  readonly detectAttribute: string;
  readonly correlateAttribute: string;
  // Metric field prefix, e.g. "k8s.pod.".
  readonly fieldPrefix: string;
  readonly charts: readonly InfraChartSpec[];
  // Optional Kubernetes event timeline (Log sources only).
  readonly timeline?: {
    readonly queryAttribute: string;
  };
};

// Pod and Node render the same three charts; only the field prefix and the
// correlate filter differ, so the specs are shared.
const K8S_CHART_SPECS: readonly InfraChartSpec[] = [
  {
    title: 'CPU Usage (%)',
    cardTestId: 'cpu-usage-card',
    field: 'cpu.utilization',
    numberFormat: K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
  },
  {
    title: 'Memory Used',
    cardTestId: 'memory-usage-card',
    field: 'memory.usage',
    numberFormat: K8S_MEM_NUMBER_FORMAT,
  },
  {
    title: 'Disk Available',
    cardTestId: 'disk-usage-card',
    field: 'filesystem.available',
    numberFormat: K8S_FILESYSTEM_NUMBER_FORMAT,
  },
];

// Built-in correlation groups. Array order is the render order in the
// Infrastructure panel (Pod, then Node), matching the prior hardcoding.
export const INFRA_CORRELATIONS: readonly InfraCorrelation[] = [
  {
    title: 'Pod',
    detectAttribute: 'k8s.pod.uid',
    correlateAttribute: 'k8s.pod.uid',
    fieldPrefix: 'k8s.pod.',
    charts: K8S_CHART_SPECS,
    timeline: { queryAttribute: 'k8s.pod.uid' },
  },
  {
    title: 'Node',
    detectAttribute: 'k8s.node.name',
    correlateAttribute: 'k8s.node.name',
    fieldPrefix: 'k8s.node.',
    charts: K8S_CHART_SPECS,
  },
];

// Returns the built-in correlation groups whose detect attribute is present
// (non-null) on the given resource attributes. This is the single source of
// truth for both the Infrastructure tab gate (rowHasK8sContext) and the panel
// renderer (DBInfraPanel), so the gate and the render never drift apart.
export function getActiveInfraCorrelations(
  resourceAttributes: Record<string, unknown> | null | undefined,
): readonly InfraCorrelation[] {
  if (!resourceAttributes) {
    return [];
  }
  return INFRA_CORRELATIONS.filter(
    correlation => resourceAttributes[correlation.detectAttribute] != null,
  );
}
