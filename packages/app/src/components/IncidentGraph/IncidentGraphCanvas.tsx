import { useEffect, useMemo, useState } from 'react';
import { Stack, Switch } from '@mantine/core';
import {
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';

import { getGraphLayout } from '@/components/ServiceMap/graphLayout';
import { useResolvedColorScheme } from '@/useUserPreferences';

import { toFlowElements } from './graphMapping';
import { IncidentDrawer } from './IncidentDrawer';
import { nodeTypes } from './IncidentGraphNodes';
import type { IncidentGraphResponse, KgIncident } from './types';

import styles from '@/components/ServiceMap/ServiceMap.module.scss';

function Canvas({ data }: { data: IncidentGraphResponse }) {
  const [showIncidents, setShowIncidents] = useState(true);
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const [selectedService, setSelectedService] = useState<string>();
  const [openIncident, setOpenIncident] = useState<KgIncident>();
  const colorScheme = useResolvedColorScheme();
  const { fitView } = useReactFlow();

  const { nodes, edges } = useMemo(() => {
    const flow = toFlowElements(data, {
      showIncidents,
      confirmedOnly,
      selectedService,
    });
    return { nodes: getGraphLayout(flow.nodes, flow.edges), edges: flow.edges };
  }, [data, showIncidents, confirmedOnly, selectedService]);

  // Refit only when the set of nodes changes, not on highlight.
  useEffect(() => {
    void fitView({ padding: 0.2 });
  }, [fitView, data, showIncidents, confirmedOnly]);

  return (
    <div className={styles.container}>
      <ReactFlow
        style={{ backgroundColor: 'var(--color-bg-body)' }}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        onNodeClick={(_e, node) => {
          if (node.type === 'incident') {
            setOpenIncident(
              data.incidents.find(i => `incident:${i.incidentId}` === node.id),
            );
          } else {
            setSelectedService(cur => (cur === node.id ? undefined : node.id));
          }
        }}
        onPaneClick={() => setSelectedService(undefined)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        colorMode={colorScheme}
        proOptions={{ hideAttribution: true }}
      >
        <Panel position="top-right">
          <Stack className={styles.panel} gap="xs">
            <Switch
              size="xs"
              label="Show incidents"
              checked={showIncidents}
              onChange={e => setShowIncidents(e.currentTarget.checked)}
              data-testid="incident-graph-show-incidents"
            />
            <Switch
              size="xs"
              label="Confirmed only"
              checked={confirmedOnly}
              disabled={!showIncidents}
              onChange={e => setConfirmedOnly(e.currentTarget.checked)}
              data-testid="incident-graph-confirmed-only"
            />
          </Stack>
        </Panel>
        <Controls showInteractive={false} />
      </ReactFlow>
      <IncidentDrawer
        incident={openIncident}
        onClose={() => setOpenIncident(undefined)}
      />
    </div>
  );
}

export default function IncidentGraphCanvas(props: {
  data: IncidentGraphResponse;
}) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
