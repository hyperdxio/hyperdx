import * as React from 'react';
import Link from 'next/link';
import Drawer from 'react-modern-drawer';
import { StringParam, useQueryParam, withDefault } from 'use-query-params';
import { TSource } from '@hyperdx/common-utils/dist/types';
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

import {
  convertDateRangeToGranularityString,
  convertV1ChartConfigToV2,
  K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
  K8S_MEM_NUMBER_FORMAT,
} from '@/ChartUtils';
import { DBSqlRowTable } from '@/components/DBRowTable';
import { DBTimeChart } from '@/components/DBTimeChart';
import { DrawerBody, DrawerHeader } from '@/components/DrawerUtils';
import { KubeTimeline, useV2LogBatch } from '@/components/KubeComponents';
import { parseTimeQuery, useTimeQuery } from '@/timeQuery';
import { useZIndex, ZIndexContext } from '@/zIndex';

import { getEventBody } from './source';

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
  logSource,
}: {
  podName: string;
  dateRange: [Date, Date];
  logSource: TSource;
}) => {
  const { data } = useV2LogBatch<{
    'k8s.node.name': string;
    'k8s.pod.name': string;
    'k8s.pod.uid': string;
    'k8s.namespace.name': string;
    'k8s.deployment.name': string;
  }>({
    where: `${logSource.resourceAttributesExpression}.k8s.pod.name:"${podName}"`,
    whereLanguage: 'lucene',
    limit: 1,
    dateRange,
    logSource,
    order: 'desc',
    extraSelects: [
      {
        valueExpression: `${logSource.resourceAttributesExpression}['k8s.node.name']`,
        alias: 'k8s.node.name',
      },
      {
        valueExpression: `${logSource.resourceAttributesExpression}['k8s.pod.name']`,
        alias: 'k8s.pod.name',
      },
      {
        valueExpression: `${logSource.resourceAttributesExpression}['k8s.pod.uid']`,
        alias: 'k8s.pod.uid',
      },
      {
        valueExpression: `${logSource.resourceAttributesExpression}['k8s.namespace.name']`,
        alias: 'k8s.namespace.name',
      },
      {
        valueExpression: `${logSource.resourceAttributesExpression}['k8s.deployment.name']`,
        alias: 'k8s.deployment.name',
      },
    ],
  });

  if (data?.data?.[0] == null) {
    return null;
  }

  const properties = data.data[0] ?? {};

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
  dateRange,
  logSource,
  where,
}: {
  dateRange: [Date, Date];
  logSource: TSource;
  where: string;
}) {
  const [resultType, setResultType] = React.useState<'all' | 'error'>('all');

  const _where = where + (resultType === 'error' ? ' Severity:err' : '');

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
            {/* 
              <Link
                href={`/search?q=${encodeURIComponent(_where)}`}
                passHref
                legacyBehavior
              >
                <Anchor size="xs" color="dimmed">
                  Search <i className="bi bi-box-arrow-up-right"></i>
                </Anchor>
              </Link> 
              */}
          </Flex>
        </Flex>
      </Card.Section>
      <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
        <DBSqlRowTable
          config={{
            ...logSource,
            where: _where,
            whereLanguage: 'lucene',
            select: [
              {
                valueExpression: logSource.timestampValueExpression,
                alias: 'Timestamp',
              },
              {
                valueExpression: logSource.severityTextExpression,
                alias: 'Severity',
              },
              {
                valueExpression: logSource.serviceNameExpression,
                alias: 'Service',
              },
              {
                valueExpression: `${logSource.resourceAttributesExpression}['k8s.container.name']`,
                alias: 'Container',
              },
              {
                valueExpression: getEventBody(logSource),
                alias: 'Message',
              },
            ],
            orderBy: [
              {
                valueExpression: logSource.timestampValueExpression,
                ordering: 'DESC',
              },
            ],
            limit: { limit: 200, offset: 0 },
            dateRange,
          }}
          onRowExpandClick={() => {}}
          highlightedLineId={undefined}
          isLive={false}
          queryKeyPrefix="k8s-dashboard-pod-logs"
          onScroll={() => {}}
        />
      </Card.Section>
    </Card>
  );
}

export default function PodDetailsSidePanel({
  logSource,
  metricSource,
}: {
  logSource: TSource;
  metricSource: TSource;
}) {
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
    return `${metricSource?.resourceAttributesExpression}.k8s.pod.name:"${podName}"`;
  }, [podName, metricSource]);

  const { searchedTimeRange: dateRange } = useTimeQuery({
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
              <PodDetails
                podName={podName}
                dateRange={dateRange}
                logSource={logSource}
              />
              <Grid.Col span={6}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    CPU Usage
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <DBTimeChart
                      config={convertV1ChartConfigToV2(
                        {
                          dateRange,
                          granularity: convertDateRangeToGranularityString(
                            dateRange,
                            60,
                          ),
                          seriesReturnType: 'column',
                          series: [
                            {
                              type: 'time',
                              groupBy: ['k8s.pod.name'],
                              where,
                              table: 'metrics',
                              aggFn: 'avg',
                              field: 'k8s.pod.cpu.utilization - Gauge',
                              numberFormat: K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
                            },
                          ],
                        },
                        {
                          metric: metricSource,
                        },
                      )}
                      showDisplaySwitcher={false}
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
                    <DBTimeChart
                      config={convertV1ChartConfigToV2(
                        {
                          dateRange,
                          granularity: convertDateRangeToGranularityString(
                            dateRange,
                            60,
                          ),
                          seriesReturnType: 'column',
                          series: [
                            {
                              type: 'time',
                              groupBy: ['k8s.pod.name'],
                              where,
                              table: 'metrics',
                              aggFn: 'avg',
                              field: 'k8s.pod.memory.usage - Gauge',
                              numberFormat: K8S_MEM_NUMBER_FORMAT,
                            },
                          ],
                        },
                        {
                          metric: metricSource,
                        },
                      )}
                      showDisplaySwitcher={false}
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
                        <KubeTimeline
                          logSource={logSource}
                          q={`\`k8s.pod.name\`:"${podName}"`}
                          dateRange={dateRange}
                        />
                      </Box>
                    </ScrollArea>
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={12}>
                <PodLogs
                  logSource={logSource}
                  where={where}
                  dateRange={dateRange}
                />
              </Grid.Col>
            </Grid>
          </DrawerBody>
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
