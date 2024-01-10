import * as React from 'react';
import Drawer from 'react-modern-drawer';
import { StringParam, useQueryParam, withDefault } from 'use-query-params';
import { Box, Card, Grid, Text } from '@mantine/core';

import api from './api';
import {
  convertDateRangeToGranularityString,
  K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
  K8S_MEM_NUMBER_FORMAT,
} from './ChartUtils';
import HDXLineChart from './HDXLineChart';
import { LogTableWithSidePanel } from './LogTableWithSidePanel';
import { parseTimeQuery, useTimeQuery } from './timeQuery';
import { useZIndex, ZIndexContext } from './zIndex';

import styles from '../styles/LogSidePanel.module.scss';

const CHART_HEIGHT = 300;
const defaultTimeRange = parseTimeQuery('Past 1h', false);

const PodDetailsProperty = React.memo(
  ({ label, value }: { label: string; value?: string }) => {
    if (!value) return null;
    return (
      <div className="pe-4">
        <Text size="xs" color="gray.6">
          {label}
        </Text>
        <Text size="sm" color="gray.3">
          {value}
        </Text>
      </div>
    );
  },
);

const PodDetails = ({
  podName,
  dateRange,
}: {
  podName: string;
  dateRange: [Date, Date];
}) => {
  const { data } = api.useMultiSeriesChart({
    series: [
      {
        table: 'logs',
        type: 'table',
        aggFn: 'count',
        where: `k8s.pod.name:"${podName}"`,
        groupBy: [
          'k8s.node.name',
          'k8s.pod.name',
          'k8s.pod.uid',
          'k8s.namespace.name',
          'k8s.deployment.name',
        ],
      },
    ],
    endDate: dateRange[1] ?? new Date(),
    startDate: dateRange[0] ?? new Date(),
    seriesReturnType: 'column',
  });

  const properties = React.useMemo(() => {
    const groups = data?.data?.[0]?.group ?? [];
    const [node, pod, podUID, namespace, deployment] = groups;
    return {
      node,
      pod,
      podUID,
      namespace,
      deployment,
    };
  }, [data]);

  if (Object.values(properties).every(v => !v)) {
    return null;
  }

  return (
    <Grid.Col span={12}>
      <div className="p-2 gap-2 d-flex flex-wrap">
        <PodDetailsProperty label="Node" value={properties?.node} />
        <PodDetailsProperty label="Pod" value={properties?.pod} />
        <PodDetailsProperty label="Pod UID" value={properties?.podUID} />
        <PodDetailsProperty label="Namespace" value={properties?.namespace} />
        <PodDetailsProperty label="Deployment" value={properties?.deployment} />
      </div>
    </Grid.Col>
  );
};

export default function PodDetailsSidePanel() {
  const [podName, setPodName] = useQueryParam(
    'podName',
    withDefault(StringParam, ''),
    {
      updateType: 'replaceIn',
    },
  );

  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;

  const where = React.useMemo(() => {
    return `k8s.pod.name:"${podName}"`;
  }, [podName]);

  const { searchedTimeRange: dateRange } = useTimeQuery({
    isUTC: false,
    defaultValue: 'Past 1h',
    defaultTimeRange: [
      defaultTimeRange?.[0]?.getTime() ?? -1,
      defaultTimeRange?.[1]?.getTime() ?? -1,
    ],
  });

  return (
    <Drawer
      enableOverlay
      overlayOpacity={0.1}
      duration={0}
      open={!!podName}
      onClose={() => {
        setPodName(undefined);
      }}
      direction="right"
      size={'80vw'}
      zIndex={drawerZIndex}
    >
      <ZIndexContext.Provider value={drawerZIndex}>
        <div className={styles.panel}>
          <Box p="md">
            <Text size="md">Details for {podName}</Text>
          </Box>
          <Box className="w-100 overflow-auto" px="sm">
            <Grid>
              <PodDetails podName={podName} dateRange={dateRange} />
              <Grid.Col span={6}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    CPU Usage
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <HDXLineChart
                      config={{
                        dateRange,
                        granularity: convertDateRangeToGranularityString(
                          dateRange,
                          60,
                        ),
                        groupBy: 'k8s.pod.name',
                        where,
                        table: 'metrics',
                        aggFn: 'avg',
                        field: 'k8s.pod.cpu.utilization - Gauge',
                        numberFormat: K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
                      }}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={6}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    Memory Usage
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <HDXLineChart
                      config={{
                        dateRange,
                        granularity: convertDateRangeToGranularityString(
                          dateRange,
                          60,
                        ),
                        groupBy: 'k8s.pod.name',
                        where,
                        table: 'metrics',
                        aggFn: 'avg',
                        field: 'k8s.pod.memory.usage - Gauge',
                        numberFormat: K8S_MEM_NUMBER_FORMAT,
                      }}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={12}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    Latest Kubernetes Events
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <LogTableWithSidePanel
                      config={{
                        dateRange,
                        where: where + ' k8s.resource.name:"events"',
                      }}
                      isLive={false}
                      isUTC={false}
                      setIsUTC={() => {}}
                      onPropertySearchClick={() => {}}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
            </Grid>
          </Box>
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
