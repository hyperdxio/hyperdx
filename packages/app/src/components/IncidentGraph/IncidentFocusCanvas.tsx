import { useEffect, useMemo } from 'react';
import { Badge } from '@clickhouse/click-ui';
import {
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';

import { getGraphLayout } from '@/components/ServiceMap/graphLayout';
import { useResolvedColorScheme } from '@/useUserPreferences';

import { PATH_SOURCE_LABEL, toIncidentFlow } from './incidentFlow';
import { nodeTypes } from './IncidentGraphNodes';
import type { IncidentDetail, KgEdge } from './types';

import styles from '@/components/ServiceMap/ServiceMap.module.scss';

// Room between columns for the traffic label on each path edge.
const RANK_SEP = 240;

type Props = {
  detail: IncidentDetail;
  highlighted: ReadonlySet<string>;
  topology: KgEdge[];
};

const FIT = { padding: 0.25, maxZoom: 1.5 };

function Canvas({ detail, highlighted, topology }: Props) {
  const colorScheme = useResolvedColorScheme();
  const { fitView } = useReactFlow();

  const { nodes, edges, source } = useMemo(() => {
    const flow = toIncidentFlow(detail, highlighted, topology);
    return {
      ...flow,
      nodes: getGraphLayout(flow.nodes, flow.edges, RANK_SEP),
    };
  }, [detail, highlighted, topology]);

  // Refit when the incident changes, not when a step highlights a node.
  useEffect(() => {
    void fitView(FIT);
  }, [fitView, detail]);

  return (
    <div className={styles.container}>
      <ReactFlow
        style={{ backgroundColor: 'var(--color-bg-body)' }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        fitView
        fitViewOptions={FIT}
        maxZoom={2}
        colorMode={colorScheme}
        proOptions={{ hideAttribution: true }}
      >
        <Panel position="top-right">
          <Badge
            text={PATH_SOURCE_LABEL[source]}
            state={source === 'resolve' ? 'info' : 'neutral'}
            data-testid="incident-path-source"
          />
        </Panel>
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export default function IncidentFocusCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
