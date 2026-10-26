import { useMemo, useState } from 'react';
import { Center, Loader, SimpleGrid } from '@mantine/core';
import { IconAlertTriangle, IconListSearch } from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';

import { stepNodes } from './incidentFlow';
import IncidentFocusCanvas from './IncidentFocusCanvas';
import { IncidentList } from './IncidentList';
import { IncidentSteps } from './IncidentSteps';
import { IncidentHeader, IncidentSummary } from './IncidentSummary';
import type { KgAction, KgEdge, KgIncident } from './types';
import { useIncidentDetail } from './useIncidentGraph';

import styles from './IncidentGraph.module.scss';

const emptyStyle = { flex: 1, margin: 'var(--mantine-spacing-sm)' };

function IncidentFocus({
  incidentId,
  topology,
}: {
  incidentId: string;
  topology: KgEdge[];
}) {
  const { data, isLoading, error } = useIncidentDetail(incidentId);
  const [activeStep, setActiveStep] = useState<KgAction>();
  const highlighted = useMemo(
    () =>
      activeStep && data
        ? stepNodes(activeStep.args, data.nodes)
        : new Set<string>(),
    [activeStep, data],
  );

  if (isLoading) {
    return (
      <Center style={{ flex: 1 }}>
        <Loader />
      </Center>
    );
  }
  if (error || !data) {
    return (
      <EmptyState
        style={emptyStyle}
        icon={<IconAlertTriangle size={32} />}
        title="Could not load the incident"
        description={error?.message}
      />
    );
  }
  return (
    <div className={styles.detail}>
      <IncidentHeader incident={data.incident} />
      <div className={styles.pathCanvas}>
        <IncidentFocusCanvas
          detail={data}
          highlighted={highlighted}
          topology={topology}
        />
      </div>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
        <IncidentSummary incident={data.incident} />
        <IncidentSteps
          actions={data.actions}
          activeSeq={activeStep?.seq}
          onSelect={a =>
            setActiveStep(cur => (cur?.seq === a.seq ? undefined : a))
          }
        />
      </SimpleGrid>
    </div>
  );
}

export function IncidentsView({
  incidents,
  topology,
}: {
  incidents: KgIncident[];
  topology: KgEdge[];
}) {
  const [selectedId, setSelectedId] = useState(incidents[0]?.incidentId);

  if (incidents.length === 0) {
    return (
      <EmptyState
        style={emptyStyle}
        icon={<IconListSearch size={32} />}
        title="No incidents yet"
        description="Incidents appear here once an agent opens one with the knowledge graph tools."
      />
    );
  }
  return (
    <div className={styles.incidentsView}>
      <IncidentList
        incidents={incidents}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      {selectedId && (
        // Keyed so the highlighted step resets with the incident.
        <IncidentFocus
          key={selectedId}
          incidentId={selectedId}
          topology={topology}
        />
      )}
    </div>
  );
}
