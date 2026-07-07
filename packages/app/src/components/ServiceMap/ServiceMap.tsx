import { useCallback, useEffect, useMemo, useState } from 'react';
import dagre from '@dagrejs/dagre';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { TTraceSource } from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Center,
  Code,
  Loader,
  SegmentedControl,
  Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  EdgeChange,
  EdgeTypes,
  Node,
  NodeChange,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';

import { SQLPreview } from '@/components/ChartSQLPreview';
import useServiceMap, { ServiceAggregation } from '@/hooks/useServiceMap';
import { useResolvedColorScheme } from '@/useUserPreferences';

import ServiceMapEdge, { ServiceMapEdgeData } from './ServiceMapEdge';
import ServiceMapLegend from './ServiceMapLegend';
import {
  ServiceMapMetricContext,
  ServiceMapMetricMax,
} from './ServiceMapMetricContext';
import ServiceMapNode, { ServiceMapNodeData } from './ServiceMapNode';
import {
  getServiceMetricValue,
  SERVICE_MAP_METRIC_LABEL,
  SERVICE_MAP_METRICS,
  ServiceMapMetric,
} from './utils';

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
  source: TTraceSource;
  isSingleTrace?: boolean;
  onFocusService?: (serviceName: string) => void;
}

function ServiceMapPresentation({
  services,
  isLoading,
  error,
  dateRange,
  source,
  isSingleTrace,
  onFocusService,
}: ServiceMapPresentationProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const { fitView } = useReactFlow();
  const colorScheme = useResolvedColorScheme();
  const [metric, setMetric] = useState<ServiceMapMetric>('errorRate');

  // Fit the data to the viewport whenever input service information changes
  useEffect(() => {
    fitView();
  }, [fitView, services]);

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

  // Graph-wide max for each metric, used to normalize per-node color intensity
  // (and to size nodes by throughput). Recomputed only when the data changes,
  // never when the user switches the coloring metric.
  const metricMax = useMemo<ServiceMapMetricMax>(() => {
    const max: ServiceMapMetricMax = {
      errorRate: 0,
      latency: 0,
      throughput: 0,
    };
    for (const service of services?.values() ?? []) {
      for (const m of SERVICE_MAP_METRICS) {
        max[m] = Math.max(max[m], getServiceMetricValue(service, m));
      }
    }
    return max;
  }, [services]);

  // Latency coloring is only meaningful when the source exposes duration data;
  // otherwise every node reports 0 and the option is disabled.
  const hasLatencyData = metricMax.latency > 0;

  useEffect(() => {
    const nodes: Node<ServiceMapNodeData>[] =
      Array.from(services?.values() ?? []).map((service, index) => ({
        id: service.serviceName,
        data: {
          ...service,
          dateRange,
          source,
          maxThroughput: metricMax.throughput,
          isSingleTrace,
          onFocusService,
        },
        position: { x: index * 150, y: 100 },
        type: 'service',
      })) ?? [];

    const edges: Edge<ServiceMapEdgeData>[] = Array.from(
      services?.values() ?? [],
    )
      .filter(service => service.incomingRequestsByClient.size > 0)
      .flatMap(({ serviceName, incomingRequestsByClient: requestsByClient }) =>
        Array.from(requestsByClient.entries()).map(
          ([
            clientServiceName,
            { totalRequests, errorPercentage, p50, p95, p99, hasLatency },
          ]) => {
            return {
              id: `${serviceName}-${clientServiceName}`,
              source: clientServiceName,
              target: serviceName,
              animated: true,
              type: 'request',
              data: {
                totalRequests,
                errorPercentage,
                p50,
                p95,
                p99,
                hasLatency,
                source,
                dateRange,
                serviceName,
                isSingleTrace,
              },
            };
          },
        ),
      );

    const nodeWithLayout = getGraphLayout(nodes, edges);

    setNodes(nodeWithLayout);
    setEdges(edges);
  }, [
    services,
    dateRange,
    source,
    metricMax.throughput,
    isSingleTrace,
    onFocusService,
  ]);

  if (isLoading) {
    return (
      <Center className={`${styles.graphContainer} h-100 w-100`}>
        <Loader size="lg" />
      </Center>
    );
  }

  if (services && services.size === 0) {
    return (
      <Center className="w-100 h-100">
        <Text size="sm" c="gray.5">
          No services found. The Service Map shows links between services with
          related Client- and Server-kind spans.
        </Text>
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
      <ServiceMapMetricContext.Provider value={{ metric, metricMax }}>
        <ReactFlow
          style={{ backgroundColor: 'inherit' }}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          colorMode={colorScheme}
          // TODO: Financially support react-flow if possible
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.5}
            color="var(--color-border-emphasis)"
          />
          <Panel position="top-right">
            <div className={styles.panel}>
              <SegmentedControl
                size="xs"
                value={metric}
                onChange={value => setMetric(value as ServiceMapMetric)}
                data={SERVICE_MAP_METRICS.map(m => ({
                  value: m,
                  label: SERVICE_MAP_METRIC_LABEL[m],
                  disabled: m === 'latency' && !hasLatencyData,
                }))}
                data-testid="service-map-metric-toggle"
              />
              <ServiceMapLegend
                metric={metric}
                metricMax={metricMax}
                source={source}
                dateRange={dateRange}
                isSingleTrace={isSingleTrace}
              />
            </div>
          </Panel>
          <Controls showInteractive={false} />
        </ReactFlow>
      </ServiceMapMetricContext.Provider>
    </div>
  );
}

interface ServiceMapProps {
  traceId?: string;
  traceTableSource: TTraceSource;
  dateRange: [Date, Date];
  samplingFactor?: number;
  isSingleTrace?: boolean;
  where?: string;
  whereLanguage?: 'sql' | 'lucene';
  serviceNames?: string[];
  // Called when a node is clicked, e.g. to drive the service filter to focus
  // on that service and its immediate dependencies.
  onFocusService?: (serviceName: string) => void;
}

export default function ServiceMap({
  traceId,
  traceTableSource,
  dateRange,
  samplingFactor = 1,
  isSingleTrace,
  where,
  whereLanguage,
  serviceNames,
  onFocusService,
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
    where,
    whereLanguage,
    serviceNames,
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
    <ReactFlowProvider>
      <ServiceMapPresentation
        services={services}
        isLoading={isLoading}
        error={error}
        dateRange={dateRange}
        source={traceTableSource}
        isSingleTrace={isSingleTrace}
        onFocusService={onFocusService}
      />
    </ReactFlowProvider>
  );
}
