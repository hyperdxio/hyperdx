import { TSource } from '@hyperdx/common-utils/dist/types';
import {
  BaseEdge,
  Edge,
  EdgeProps,
  EdgeToolbar,
  getBezierPath,
} from '@xyflow/react';

import ServiceMapTooltip from './ServiceMapTooltip';

export type ServiceMapEdgeData = {
  totalRequests: number;
  errorPercentage: number;
  dateRange: [Date, Date];
  source: TSource;
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
    dateRange,
    serviceName,
    source,
    isSingleTrace,
  } = props.data;

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
          source={source}
          dateRange={dateRange}
          serviceName={serviceName}
          isSingleTrace={isSingleTrace}
        />
      </EdgeToolbar>
    </>
  );
}
