import * as React from 'react';
import Link from 'next/link';
import Drawer from 'react-modern-drawer';
import { StringParam, useQueryParam, withDefault } from 'use-query-params';
import { TSource } from '@hyperdx/common-utils/dist/types';
import {
  Anchor,
  Badge,
  Card,
  Flex,
  Grid,
  SegmentedControl,
  Text,
} from '@mantine/core';

import api from '@/api';
import {
  convertDateRangeToGranularityString,
  K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
  K8S_MEM_NUMBER_FORMAT,
} from '@/ChartUtils';
import { DrawerBody, DrawerHeader } from '@/components/DrawerUtils';
import HDXMultiSeriesTimeChart from '@/HDXMultiSeriesTimeChart';
import { InfraPodsStatusTable } from '@/KubernetesDashboardPage';
import { LogTableWithSidePanel } from '@/LogTableWithSidePanel';
import { parseTimeQuery, useTimeQuery } from '@/timeQuery';
import { formatUptime } from '@/utils';
import { useZIndex, ZIndexContext } from '@/zIndex';

import styles from '../styles/LogSidePanel.module.scss';

const CHART_HEIGHT = 300;
const defaultTimeRange = parseTimeQuery('Past 1h', false);

const PodDetailsProperty = React.memo(
  ({ label, value }: { label: string; value?: React.ReactNode }) => {
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

const NodeDetails = ({
  name,
  dateRange,
}: {
  name: string;
  dateRange: [Date, Date];
}) => {
  const where = `k8s.node.name:"${name}"`;
  const groupBy = ['k8s.node.name'];

  const { data } = api.useMultiSeriesChart({
    series: [
      {
        table: 'metrics',
        field: 'k8s.node.condition_ready - Gauge',
        type: 'table',
        aggFn: 'last_value',
        where,
        groupBy,
      },
      {
        table: 'metrics',
        field: 'k8s.node.uptime - Sum',
        type: 'table',
        aggFn: 'last_value',
        where,
        groupBy,
      },
    ],
    endDate: dateRange[1] ?? new Date(),
    startDate: dateRange[0] ?? new Date(),
    seriesReturnType: 'column',
  });

  const properties = React.useMemo(() => {
    const series: Record<string, any> = data?.data?.[0] || {};
    return {
      ready: series['series_0.data'],
      uptime: series['series_1.data'],
    };
  }, [data?.data]);

  return (
    <Grid.Col span={12}>
      <div className="p-2 gap-2 d-flex flex-wrap">
        <PodDetailsProperty label="Node" value={name} />
        {properties.ready !== undefined && (
          <PodDetailsProperty
            label="Status"
            value={
              properties.ready === 1 ? (
                <Badge
                  variant="light"
                  color="green"
                  fw="normal"
                  tt="none"
                  size="md"
                >
                  Ready
                </Badge>
              ) : (
                <Badge
                  variant="light"
                  color="red"
                  fw="normal"
                  tt="none"
                  size="md"
                >
                  Not Ready
                </Badge>
              )
            }
          />
        )}
        {properties.uptime && (
          <PodDetailsProperty
            label="Uptime"
            value={formatUptime(properties.uptime)}
          />
        )}
      </div>
    </Grid.Col>
  );
};

function NodeLogs({
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
          Latest Node Logs & Spans
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
            <Link
              href={`/search?q=${encodeURIComponent(_where)}`}
              passHref
              legacyBehavior
            >
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
          }}
          isLive={false}
        />
      </Card.Section>
    </Card>
  );
}

export default function NodeDetailsSidePanel({
  metricSource,
}: {
  metricSource: TSource;
}) {
  const [nodeName, setNodeName] = useQueryParam(
    'nodeName',
    withDefault(StringParam, ''),
    {
      updateType: 'replaceIn',
    },
  );

  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;

  const where = React.useMemo(() => {
    return `k8s.node.name:"${nodeName}"`;
  }, [nodeName]);

  const { searchedTimeRange: dateRange } = useTimeQuery({
    defaultValue: 'Past 1h',
    defaultTimeRange: [
      defaultTimeRange?.[0]?.getTime() ?? -1,
      defaultTimeRange?.[1]?.getTime() ?? -1,
    ],
  });

  const handleClose = React.useCallback(() => {
    setNodeName(undefined);
  }, [setNodeName]);

  if (!nodeName) {
    return null;
  }

  return (
    <Drawer
      enableOverlay
      overlayOpacity={0.1}
      duration={0}
      open={!!nodeName}
      onClose={handleClose}
      direction="right"
      size={'80vw'}
      zIndex={drawerZIndex}
    >
      <ZIndexContext.Provider value={drawerZIndex}>
        <div className={styles.panel}>
          <DrawerHeader
            header={`Details for ${nodeName}`}
            onClose={handleClose}
          />
          <DrawerBody>
            <Grid>
              <NodeDetails name={nodeName} dateRange={dateRange} />
              <Grid.Col span={6}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    CPU Usage by Pod
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <HDXMultiSeriesTimeChart
                      config={{
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
                      }}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={6}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    Memory Usage by Pod
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <HDXMultiSeriesTimeChart
                      config={{
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
                      }}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={12}>
                {metricSource && (
                  <InfraPodsStatusTable
                    metricSource={metricSource}
                    dateRange={dateRange}
                    where={where}
                  />
                )}
              </Grid.Col>
              <Grid.Col span={12}>
                <NodeLogs where={where} dateRange={dateRange} />
              </Grid.Col>
            </Grid>
          </DrawerBody>
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
