import { createContext } from 'react';

import type { ServiceMapMetric } from './utils';

export type ServiceMapMetricMax = Record<ServiceMapMetric, number>;

/**
 * Provides the currently selected coloring metric and the graph-wide max for
 * each metric to the custom node components. Passing this via context (rather
 * than baking it into each node's `data`) lets the user switch metrics and
 * recolor the graph without rebuilding node objects or re-running the dagre
 * layout, so manual node positions and zoom are preserved.
 */
export const ServiceMapMetricContext = createContext<{
  metric: ServiceMapMetric;
  metricMax: ServiceMapMetricMax;
}>({
  metric: 'errorRate',
  metricMax: { errorRate: 0, latency: 0, throughput: 0 },
});
