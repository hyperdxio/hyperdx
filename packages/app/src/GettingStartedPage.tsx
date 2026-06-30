import { useMemo, useState } from 'react';
import Head from 'next/head';
import { Box } from '@mantine/core';

import { ConnectClickHousePanel } from '@/components/GettingStarted/ConnectClickHousePanel';
import { CreateSourcesPanel } from '@/components/GettingStarted/CreateSourcesPanel';
import { ExploreTelemetryPanel } from '@/components/GettingStarted/ExploreTelemetryPanel';
import { SendTelemetryPanel } from '@/components/GettingStarted/SendTelemetryPanel';
import {
  OnboardingAccordion,
  type OnboardingStep,
  type OnboardingStepStatus,
} from '@/components/OnboardingAccordion/OnboardingAccordion';
import { PageLayout } from '@/components/PageLayout';
import { HDX_COLLECTOR_URL } from '@/config';
import { useConnections } from '@/connection';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useSources } from '@/source';

import { useBrandDisplayName } from './theme/ThemeProvider';
import api from './api';
import { withAppNav } from './layout';

function statusFor(complete: boolean, active: boolean): OnboardingStepStatus {
  if (complete) return 'complete';
  if (active) return 'active';
  return 'upcoming';
}

function GettingStartedPage() {
  const brandName = useBrandDisplayName();
  const { data: team } = api.useTeam();
  const { data: connections } = useConnections();
  const { data: sources } = useSources();

  const [manualOpen, setManualOpen] = useState<string | null | undefined>(
    undefined,
  );

  const hasConnections = (connections?.length ?? 0) > 0;
  const hasSources = (sources?.length ?? 0) > 0;

  const firstConnection = connections?.[0];
  const firstConnectionSources = useMemo(
    () => sources?.filter(source => source.connection === firstConnection?.id),
    [sources, firstConnection],
  );

  const sourceRowsConfig = useMemo(
    () => ({
      select: 'sum(total_rows) as total_rows',
      from: {
        databaseName: 'system',
        tableName: 'tables',
      },
      where: '',
      filtersLogicalOperator: 'OR' as const,
      filters: (firstConnectionSources ?? []).map(source => ({
        type: 'sql' as const,
        condition: `table = '${source.from.tableName}' AND database = '${source.from.databaseName}'`,
      })),
      connection: firstConnection?.id ?? '',
    }),
    [firstConnectionSources, firstConnection],
  );

  const {
    data: sourceRowsData,
    refetch: refetchRows,
    isFetching: isCheckingTelemetry,
  } = useQueriedChartConfig(sourceRowsConfig, {
    enabled: !!firstConnection?.id && hasSources,
  });
  const hasData = (sourceRowsData?.data?.[0]?.total_rows ?? 0) > 0;

  const steps: OnboardingStep[] = useMemo(() => {
    const connectComplete = hasConnections;
    const sourcesComplete = hasSources;
    const telemetryComplete = hasData;

    const connectActive = !connectComplete;
    const sourcesActive = connectComplete && !sourcesComplete;
    const telemetryActive = sourcesComplete && !telemetryComplete;
    const exploreActive = telemetryComplete;

    return [
      {
        id: 'connect',
        title: 'Connect to ClickHouse',
        collapsible: true,
        status: statusFor(connectComplete, connectActive),
        description:
          'Point HyperDX at the ClickHouse server that stores your telemetry.',
        children: <ConnectClickHousePanel active={connectActive} />,
      },
      {
        id: 'sources',
        title: 'Create data sources',
        collapsible: true,
        status: statusFor(sourcesComplete, sourcesActive),
        description:
          'Tell HyperDX which tables hold your logs, traces, and metrics.',
        children: <CreateSourcesPanel />,
      },
      {
        id: 'send-telemetry',
        title: 'Send telemetry',
        collapsible: true,
        status: statusFor(telemetryComplete, telemetryActive),
        description:
          'Point your OpenTelemetry collector or SDK at this endpoint.',
        children: (
          <SendTelemetryPanel
            endpoint={HDX_COLLECTOR_URL}
            apiKey={team?.apiKey ?? ''}
            onCheckTelemetry={() => refetchRows()}
            isChecking={isCheckingTelemetry}
          />
        ),
      },
      {
        id: 'explore-telemetry',
        title: 'Explore your telemetry',
        status: statusFor(false, exploreActive),
        description:
          'Search, visualize, and dashboard your logs, traces, and metrics — or jump into a prebuilt view to start investigating.',
        children: <ExploreTelemetryPanel />,
      },
    ];
  }, [
    hasConnections,
    hasSources,
    hasData,
    team?.apiKey,
    refetchRows,
    isCheckingTelemetry,
  ]);

  const firstActiveStep = useMemo(
    () => steps.find(step => step.status === 'active')?.id ?? null,
    [steps],
  );
  const openStep = manualOpen !== undefined ? manualOpen : firstActiveStep;

  return (
    <>
      <Head>
        <title>Getting Started — {brandName}</title>
      </Head>
      <PageLayout
        data-testid="getting-started-page"
        title="Get started"
        content={
          <Box maw={920} mx="auto" px="md" py="xl" w="100%">
            <OnboardingAccordion
              title={`Welcome to ${brandName}`}
              description="Follow these steps to connect ClickHouse, send your telemetry, and start exploring."
              steps={steps}
              openStep={openStep}
              onOpenStepChange={setManualOpen}
            />
          </Box>
        }
      />
    </>
  );
}

GettingStartedPage.getLayout = withAppNav;

export default GettingStartedPage;
