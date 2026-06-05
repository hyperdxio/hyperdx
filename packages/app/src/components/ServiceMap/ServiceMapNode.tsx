import { TTraceSource } from '@hyperdx/common-utils/dist/types';
import { Text } from '@mantine/core';
import { Handle, Node, NodeProps, NodeToolbar, Position } from '@xyflow/react';

import { ServiceAggregation } from '@/hooks/useServiceMap';

import ServiceMapTooltip from './ServiceMapTooltip';
import { deriveDisplayMetrics, getNodeColors, getNodeSize } from './utils';

import styles from './ServiceMap.module.scss';

export type ServiceMapNodeData = ServiceAggregation & {
  dateRange: [Date, Date];
  source: TTraceSource;
  maxErrorPercentage: number;
  // Largest total throughput (incoming + outgoing) across all nodes, used to
  // scale node size.
  maxThroughput: number;
  isSingleTrace?: boolean;
  // When provided, the node's tooltip offers a "Focus" action for this service.
  onFocusService?: (serviceName: string) => void;
};

export default function ServiceMapNode(
  props: NodeProps<Node<ServiceMapNodeData, 'service'>>,
) {
  const { data } = props;
  const {
    serviceName,
    incomingRequests: {
      totalRequests: totalIncomingRequestCount,
      errorPercentage,
      p50,
      p95,
      p99,
      hasLatency,
    },
    outgoingRequests,
    source,
    dateRange,
    maxErrorPercentage,
    maxThroughput,
    isSingleTrace,
    onFocusService,
  } = data;

  const { backgroundColor, borderColor } = getNodeColors(
    errorPercentage,
    maxErrorPercentage,
    props.selected,
  );

  // Fallback matches the schema default (3 = ms); in practice the field is
  // always present on a parsed source.
  const { latencyMs, requestsPerSecond } = deriveDisplayMetrics(
    {
      totalRequests: totalIncomingRequestCount,
      p50,
      p95,
      p99,
      hasLatency,
    },
    source,
    dateRange,
    isSingleTrace,
  );

  const size = getNodeSize(
    totalIncomingRequestCount + outgoingRequests,
    maxThroughput,
  );

  return (
    <>
      <NodeToolbar position={Position.Top} align="center">
        <ServiceMapTooltip
          errorPercentage={errorPercentage}
          totalRequests={totalIncomingRequestCount}
          latencyMs={latencyMs}
          requestsPerSecond={requestsPerSecond}
          source={source}
          dateRange={dateRange}
          serviceName={serviceName}
          isSingleTrace={isSingleTrace}
          onFocus={
            onFocusService && !isSingleTrace
              ? () => onFocusService(serviceName)
              : undefined
          }
        />
      </NodeToolbar>
      <div className={`${styles.serviceNode}`}>
        <div className={styles.body}>
          <div className="position-relative">
            <Handle
              type="target"
              position={Position.Left}
              style={{ visibility: 'hidden', marginLeft: 3 }}
            />
          </div>
          <div
            className={styles.circle}
            style={{
              backgroundColor,
              borderColor,
              width: size,
              height: size,
            }}
          />
          <div className="position-relative" style={{ marginLeft: -3 }}>
            <Handle
              type="source"
              position={Position.Right}
              style={{ visibility: 'hidden' }}
            />
          </div>
        </div>
        <Text size="xxs">{serviceName}</Text>
      </div>
    </>
  );
}
