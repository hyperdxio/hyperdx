import dynamic from 'next/dynamic';
import Head from 'next/head';
import { Center, Loader, Tabs } from '@mantine/core';
import {
  IconAlertTriangle,
  IconGraph,
  IconTopologyStar3,
} from '@tabler/icons-react';

import EmptyState from '@/components/EmptyState';
import { PageLayout } from '@/components/PageLayout';
import { withAppNav } from '@/layout';
import { usePageTitle } from '@/theme/ThemeProvider';

import IncidentGraphCanvas from './IncidentGraphCanvas';
import { IncidentsView } from './IncidentsView';
import type { IncidentGraphResponse } from './types';
import { useIncidentGraph } from './useIncidentGraph';

const emptyStyle = { flex: 1, margin: 'var(--mantine-spacing-sm)' };
const panelStyle = { display: 'flex', flex: 1, minHeight: 0 };

function Overview({ data }: { data: IncidentGraphResponse }) {
  if (data.nodes.length === 0) {
    return (
      <EmptyState
        style={emptyStyle}
        icon={<IconTopologyStar3 size={32} />}
        title="No topology yet"
        description="The topology is built from your traces the next time an agent uses a knowledge graph tool."
      />
    );
  }
  return <IncidentGraphCanvas data={data} />;
}

function IncidentGraphContent() {
  const { data, isLoading, error } = useIncidentGraph();

  if (isLoading) {
    return (
      <Center style={{ flex: 1 }}>
        <Loader size="lg" />
      </Center>
    );
  }
  if (error?.status === 404) {
    return (
      <EmptyState
        style={emptyStyle}
        icon={<IconGraph size={32} />}
        title="Knowledge graph is off"
        description="Turn on the knowledge graph for this team to see the incident graph."
      />
    );
  }
  if (error || !data) {
    return (
      <EmptyState
        style={emptyStyle}
        icon={<IconAlertTriangle size={32} />}
        title="Could not load the incident graph"
        description={error?.message}
      />
    );
  }
  return (
    <Tabs
      defaultValue="incidents"
      keepMounted={false}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      }}
    >
      <Tabs.List px="sm">
        <Tabs.Tab value="incidents" data-testid="incident-graph-tab-incidents">
          Incidents
        </Tabs.Tab>
        <Tabs.Tab value="overview" data-testid="incident-graph-tab-overview">
          Overview
        </Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="incidents" style={panelStyle}>
        <IncidentsView incidents={data.incidents} topology={data.edges} />
      </Tabs.Panel>
      <Tabs.Panel value="overview" style={panelStyle}>
        <Overview data={data} />
      </Tabs.Panel>
    </Tabs>
  );
}

function IncidentGraphPage() {
  const title = usePageTitle('Incident graph');
  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <PageLayout
        data-testid="incident-graph-page"
        fillViewport
        content={<IncidentGraphContent />}
      />
    </>
  );
}

const IncidentGraphPageDynamic = dynamic(async () => IncidentGraphPage, {
  ssr: false,
});

// @ts-expect-error next/dynamic component type does not include the getLayout static
IncidentGraphPageDynamic.getLayout = withAppNav;

export default IncidentGraphPageDynamic;
