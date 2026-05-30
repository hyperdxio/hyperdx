import { TTraceSource } from '@hyperdx/common-utils/dist/types';
import {
  BaseEdge,
  Edge,
  EdgeProps,
  EdgeToolbar,
  getBezierPath,
} from '@xyflow/react';

import ServiceMapTooltip from './ServiceMapTooltip';
import { getRequestsPerSecond, rawDurationToMs } from './utils';

export type ServiceMapEdgeData = {
  totalRequests: number;
  errorPercentage: number;
  // Latency percentiles (raw duration units) for this client→server call.
  p50: number;
  p95: number;
  p99: number;
  hasLatency: boolean;
  dateRange: [Date, Date];
  source: TTraceSource;
  serviceName: string;
  isSingleTrace?: boolean;
};

export default function ServiceMapEdge(
  props: EdgeProps<Edge<ServiceMapEdgeData>>,
) {
  const [edgePath, centerX, centerY] = getBezierPath(props);

  if (!props.data) {
    return null;
  }

  const {
    totalRequests,
    errorPercentage,
    p50,
    p95,
    p99,
    hasLatency,
    dateRange,
    serviceName,
    source,
    isSingleTrace,
  } = props.data;

  const precision = source.durationPrecision ?? 9;
  const latencyMs = hasLatency
    ? {
        p50: rawDurationToMs(p50, precision),
        p95: rawDurationToMs(p95, precision),
        p99: rawDurationToMs(p99, precision),
      }
    : undefined;

  const requestsPerSecond = isSingleTrace
    ? undefined
    : getRequestsPerSecond(totalRequests, dateRange);

  return (
    <>
      <BaseEdge id={props.id} path={edgePath} />
      <EdgeToolbar
        edgeId={props.id}
        x={centerX}
        y={centerY}
        isVisible={props.selected}
      >
        <ServiceMapTooltip
          totalRequests={totalRequests}
          errorPercentage={errorPercentage}
          latencyMs={latencyMs}
          requestsPerSecond={requestsPerSecond}
          source={source}
          dateRange={dateRange}
          serviceName={serviceName}
          isSingleTrace={isSingleTrace}
        />
      </EdgeToolbar>
    </>
  );
}
