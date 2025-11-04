import { TSource } from '@hyperdx/common-utils/dist/types';
import { Text } from '@mantine/core';
import { Handle, Node, NodeProps, NodeToolbar, Position } from '@xyflow/react';

import { ServiceAggregation } from '@/hooks/useServiceMap';

import ServiceMapTooltip from './ServiceMapTooltip';
import { getNodeColors } from './utils';

import styles from './ServiceMap.module.scss';

export type ServiceMapNodeData = ServiceAggregation & {
  dateRange: [Date, Date];
  source: TSource;
  maxErrorPercentage: number;
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
    },
    source,
    dateRange,
    maxErrorPercentage,
  } = data;

  const { backgroundColor, borderColor } = getNodeColors(
    errorPercentage,
    maxErrorPercentage,
    props.selected,
  );

  return (
    <>
      <NodeToolbar position={Position.Top} align="center">
        <ServiceMapTooltip
          errorPercentage={errorPercentage}
          totalRequests={totalIncomingRequestCount}
          source={source}
          dateRange={dateRange}
          serviceName={serviceName}
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
