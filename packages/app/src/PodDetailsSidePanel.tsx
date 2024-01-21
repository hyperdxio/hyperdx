import * as React from 'react';
import Link from 'next/link';
import Drawer from 'react-modern-drawer';
import { StringParam, useQueryParam, withDefault } from 'use-query-params';
import {
  Anchor,
  Box,
  Card,
  Flex,
  Grid,
  ScrollArea,
  SegmentedControl,
  Text,
} from '@mantine/core';

import { DrawerBody, DrawerHeader } from './components/DrawerUtils';
import { KubeTimeline } from './components/KubeComponents';
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
  const { data } = api.useLogBatch({
    q: `k8s.pod.name:"${podName}"`,
    limit: 1,
    startDate: dateRange[0] ?? new Date(),
    endDate: dateRange[1] ?? new Date(),
    extraFields: [
      'k8s.node.name',
      'k8s.pod.name',
      'k8s.pod.uid',
      'k8s.namespace.name',
      'k8s.deployment.name',
    ],
    order: 'desc',
  });

  const properties = data?.pages?.[0]?.data?.[0] || {};

  // If all properties are empty, don't show the panel
  if (Object.values(properties).every(v => !v)) {
    return null;
  }

  return (
    <Grid.Col span={12}>
      <div className="p-2 gap-2 d-flex flex-wrap">
        <PodDetailsProperty label="Node" value={properties['k8s.node.name']} />
        <PodDetailsProperty label="Pod" value={properties['k8s.pod.name']} />
        <PodDetailsProperty label="Pod UID" value={properties['k8s.pod.uid']} />
        <PodDetailsProperty
          label="Namespace"
          value={properties['k8s.namespace.name']}
        />
        <PodDetailsProperty
          label="Deployment"
          value={properties['k8s.deployment.name']}
        />
      </div>
    </Grid.Col>
  );
};

function PodLogs({
  where,
  dateRange,
}: {
  where: string;
  dateRange: [Date, Date];
}) {
  const [resultType, setResultType] = React.useState<'all' | 'error'>('all');

  const _where = where + (resultType === 'error' ? ' level:err' : '');

  return (
    <Card p="md">
      <Card.Section p="md" py="xs" withBorder>
        <Flex justify="space-between" align="center">
          Latest Pod Logs & Spans
          <Flex gap="xs" align="center">
            <SegmentedControl
              size="xs"
              value={resultType}
              onChange={(value: string) => {
                if (value === 'all' || value === 'error') {
                  setResultType(value);
                }
              }}
              data={[
                { label: 'All', value: 'all' },
                { label: 'Errors', value: 'error' },
              ]}
            />
            <Link href={`/search?q=${encodeURIComponent(_where)}`} passHref>
              <Anchor size="xs" color="dimmed">
                Search <i className="bi bi-box-arrow-up-right"></i>
              </Anchor>
            </Link>
          </Flex>
        </Flex>
      </Card.Section>
      <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
        <LogTableWithSidePanel
          config={{
            dateRange,
            where: _where,
            columns: ['k8s.container.name'],
          }}
          isLive={false}
          isUTC={false}
          setIsUTC={() => {}}
          onPropertySearchClick={() => {}}
          columnNameMap={{
            'k8s.container.name': 'Container',
          }}
        />
      </Card.Section>
    </Card>
  );
}

export default function PodDetailsSidePanel() {
  const [podName, setPodName] = useQueryParam(
    'podName',
    withDefault(StringParam, ''),
    {
      updateType: 'replaceIn',
    },
  );

  // If we're in a nested side panel, we need to use a higher z-index
  // TODO: This is a hack
  const [nodeName] = useQueryParam('nodeName', StringParam);
  const [namespaceName] = useQueryParam('namespaceName', StringParam);
  const isNested = !!nodeName || !!namespaceName;
  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10 + (isNested ? 100 : 0);

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

  const handleClose = React.useCallback(() => {
    setPodName(undefined);
  }, [setPodName]);

  if (!podName) {
    return null;
  }

  return (
    <Drawer
      enableOverlay
      overlayOpacity={0.1}
      duration={0}
      open={!!podName}
      onClose={handleClose}
      direction="right"
      size={isNested ? '70vw' : '80vw'}
      zIndex={drawerZIndex}
    >
      <ZIndexContext.Provider value={drawerZIndex}>
        <div className={styles.panel}>
          <DrawerHeader
            header={`Details for ${podName}`}
            onClose={handleClose}
          />
          <DrawerBody>
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
                    Latest Pod Events
                  </Card.Section>
                  <Card.Section>
                    <ScrollArea
                      viewportProps={{
                        style: { maxHeight: CHART_HEIGHT },
                      }}
                    >
                      <Box p="md" py="sm">
                        <KubeTimeline q={`k8s.pod.name:"${podName}"`} />
                      </Box>
                    </ScrollArea>
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={12}>
                <PodLogs where={where} dateRange={dateRange} />
              </Grid.Col>
            </Grid>
          </DrawerBody>
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
