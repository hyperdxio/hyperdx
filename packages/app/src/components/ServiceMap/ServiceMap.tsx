import { useCallback, useEffect, useMemo, useState } from 'react';
import dagre from '@dagrejs/dagre';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { TSource } from '@hyperdx/common-utils/dist/types';
import { Box, Center, Code, Loader, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Controls,
  Edge,
  EdgeChange,
  EdgeTypes,
  Node,
  NodeChange,
  Position,
  ReactFlow,
} from '@xyflow/react';

import useServiceMap, { ServiceAggregation } from '@/hooks/useServiceMap';

import { SQLPreview } from '../ChartSQLPreview';

import ServiceMapEdge, { ServiceMapEdgeData } from './ServiceMapEdge';
import ServiceMapNode, { ServiceMapNodeData } from './ServiceMapNode';

import styles from './ServiceMap.module.scss';

const nodeTypes = {
  service: ServiceMapNode,
};

const edgeTypes: EdgeTypes = {
  request: ServiceMapEdge,
};

function getGraphLayout(nodes: Node[], edges: Edge[]): Node[] {
  const NODE_SIZE = 80;

  const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: 'LR' });

  for (const node of nodes) {
    dagreGraph.setNode(node.id, { width: NODE_SIZE, height: NODE_SIZE / 2 });
  }

  for (const edge of edges) {
    dagreGraph.setEdge(edge.source, edge.target);
  }

  dagre.layout(dagreGraph);

  const newNodes: Node[] = nodes.map(node => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const newNode = {
      ...node,
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
      position: {
        x: nodeWithPosition.x - NODE_SIZE / 2,
        y: nodeWithPosition.y - NODE_SIZE / 2,
      },
    };

    return newNode;
  });

  return newNodes;
}

interface ServiceMapPresentationProps {
  services: Map<string, ServiceAggregation> | undefined;
  isLoading: boolean;
  error: Error | null;
  dateRange: [Date, Date];
  source: TSource;
}

function ServiceMapPresentation({
  services,
  isLoading,
  error,
  dateRange,
  source,
}: ServiceMapPresentationProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node>[]) =>
      setNodes(nodesSnapshot => applyNodeChanges(changes, nodesSnapshot)),
    [],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) =>
      setEdges(edgesSnapshot => applyEdgeChanges(changes, edgesSnapshot)),
    [],
  );

  const maxErrorPercentage = useMemo(() => {
    let maxError = 0;
    for (const service of services?.values() ?? []) {
      maxError = Math.max(service.incomingRequests.errorPercentage, maxError);
    }
    return maxError;
  }, [services]);

  useEffect(() => {
    const nodes: Node<ServiceMapNodeData>[] =
      Array.from(services?.values() ?? []).map((service, index) => ({
        id: service.serviceName,
        data: {
          ...service,
          dateRange,
          source,
          maxErrorPercentage,
        },
        position: { x: index * 150, y: 100 },
        type: 'service',
      })) ?? [];

    const edges: Edge<ServiceMapEdgeData>[] = Array.from(
      services?.values() ?? [],
    )
      .filter(service => service.incomingRequestsByClient.size > 0)
      .flatMap(
        ({
          serviceName,
          incomingRequestsByClient: requestCountPerClientPerStatus,
        }) =>
          Array.from(requestCountPerClientPerStatus.entries()).map(
            ([clientServiceName, { totalRequests, errorPercentage }]) => {
              return {
                id: `${serviceName}-${clientServiceName}`,
                source: clientServiceName,
                target: serviceName,
                animated: true,
                type: 'request',
                data: {
                  totalRequests,
                  errorPercentage,
                  source,
                  dateRange,
                  serviceName,
                },
              };
            },
          ),
      );

    const nodeWithLayout = getGraphLayout(nodes, edges);

    setNodes(nodeWithLayout);
    setEdges(edges);
  }, [services, dateRange, source, maxErrorPercentage]);

  if (isLoading) {
    return (
      <Center className={`${styles.graphContainer} h-100 w-100`}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (error) {
    return (
      <Box>
        <Text my="sm" size="sm">
          Error message:
        </Text>
        <Code
          block
          style={{
            whiteSpace: 'pre-wrap',
          }}
        >
          {error?.message}
        </Code>
        {error instanceof ClickHouseQueryError && (
          <Box mt="lg">
            <Text my="sm" size="sm">
              Original query:
            </Text>
            <Code
              block
              style={{
                whiteSpace: 'pre-wrap',
              }}
            >
              <SQLPreview data={error.query} formatData />
            </Code>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <div className={styles.container}>
      <ReactFlow
        style={{ backgroundColor: 'inherit' }}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        colorMode="dark"
        // TODO: Financially support react-flow if possible
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

interface ServiceMapProps {
  traceId?: string;
  traceTableSource: TSource;
  dateRange: [Date, Date];
  samplingFactor?: number;
}

export default function ServiceMap({
  traceId,
  traceTableSource,
  dateRange,
  samplingFactor = 1,
}: ServiceMapProps) {
  const {
    isLoading,
    data: services,
    error,
  } = useServiceMap({
    traceId,
    source: traceTableSource,
    dateRange,
    samplingFactor,
  });

  useEffect(() => {
    if (error) {
      notifications.show({
        title: 'Error loading service map',
        message: error.message,
        color: 'red',
      });
    }
  }, [error]);

  return (
    <ServiceMapPresentation
      services={services}
      isLoading={isLoading}
      error={error}
      dateRange={dateRange}
      source={traceTableSource}
    />
  );
}
