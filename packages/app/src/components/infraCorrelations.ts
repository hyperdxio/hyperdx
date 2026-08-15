import { MetricsDataType } from '@hyperdx/common-utils/dist/types';

import {
  GPU_UTILIZATION_NUMBER_FORMAT,
  K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
  K8S_FILESYSTEM_NUMBER_FORMAT,
  K8S_MEM_NUMBER_FORMAT,
} from '@/ChartUtils';
import { NumberFormat } from '@/types';

// One metric chart inside an infrastructure correlation group. The queried
// metric name is `${fieldPrefix}${field}` (see DBInfraPanel), so `field` is
// the metric name without the resource prefix.
export type InfraChartSpec = {
  readonly title: string;
  // data-testid for the chart card; the e2e suite selects on these.
  readonly cardTestId: string;
  readonly field: string;
  readonly numberFormat: NumberFormat;
  // Per-chart Lucene WHERE condition ANDed with the correlation filter.
  readonly where?: string;
  // Per-chart groupBy SQL expressions (passed through as raw SQL).
  readonly groupBy?: readonly string[];
  // Defaults to Gauge.
  readonly metricType?: MetricsDataType;
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
  // When true, charts in this group are individually gated on metric existence.
  // The entire group is hidden if none of its metrics are available.
  readonly requiresMetricAvailability?: boolean;
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

// GroupBy expression that labels each series with the GPU device identity.
// Concatenates hw.id with hw.name or hw.model when available.
const GPU_GROUP_BY_EXPR =
  `concat(Attributes['hw.id'], ` +
  `if(Attributes['hw.name'] != '', concat(' ', Attributes['hw.name']), ` +
  `if(Attributes['hw.model'] != '', concat(' ', Attributes['hw.model']), '')))`;

const GPU_CHART_SPECS: readonly InfraChartSpec[] = [
  {
    title: 'GPU utilization',
    cardTestId: 'gpu-utilization-card',
    field: 'utilization',
    numberFormat: GPU_UTILIZATION_NUMBER_FORMAT,
    where: 'hw.gpu.task:"general" OR NOT hw.gpu.task:*',
    groupBy: [GPU_GROUP_BY_EXPR],
  },
  {
    title: 'GPU memory utilization',
    cardTestId: 'gpu-memory-utilization-card',
    field: 'memory.utilization',
    numberFormat: GPU_UTILIZATION_NUMBER_FORMAT,
    groupBy: [GPU_GROUP_BY_EXPR],
  },
];

// Built-in correlation groups. Array order is the render order in the
// Infrastructure panel (Pod, then Node, then GPU).
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
  {
    title: 'GPU',
    detectAttribute: 'k8s.node.name',
    correlateAttribute: 'k8s.node.name',
    fieldPrefix: 'hw.gpu.',
    charts: GPU_CHART_SPECS,
    requiresMetricAvailability: true,
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
