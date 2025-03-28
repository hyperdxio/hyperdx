import * as React from 'react';
import Link from 'next/link';
import Drawer from 'react-modern-drawer';
import { StringParam, useQueryParam, withDefault } from 'use-query-params';
import { tcFromSource } from '@hyperdx/common-utils/dist/metadata';
import {
  SearchConditionLanguage,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  Anchor,
  Badge,
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
import { InfraPodsStatusTable } from '@/KubernetesDashboardPage';
import { getEventBody } from '@/source';
import { parseTimeQuery, useTimeQuery } from '@/timeQuery';
import { formatUptime } from '@/utils';
import { useZIndex, ZIndexContext } from '@/zIndex';

import { useQueriedChartConfig } from './hooks/useChartConfig';
import { useGetKeyValues, useTableMetadata } from './hooks/useMetadata';

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
  metricSource,
}: {
  name: string;
  dateRange: [Date, Date];
  metricSource: TSource;
}) => {
  const where = `${metricSource.resourceAttributesExpression}.k8s.node.name:"${name}"`;
  const groupBy = ['k8s.node.name'];

  const { data, isError, isLoading } = useQueriedChartConfig(
    convertV1ChartConfigToV2(
      {
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
            aggFn: undefined,
            where,
            groupBy,
          },
        ],
        dateRange,
        seriesReturnType: 'column',
      },
      {
        metric: metricSource,
      },
    ),
  );

  const properties = React.useMemo(() => {
    if (!data) {
      return {};
    }

    return {
      ready: data.data?.[0]?.['last_value(k8s.node.condition_ready)'],
      uptime: data.data?.[0]?.['undefined(k8s.node.uptime)'],
    };
  }, [data]);

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
                valueExpression: `${logSource.severityTextExpression}`,
                alias: 'Severity',
              },
              {
                valueExpression: `${logSource.serviceNameExpression}`,
                alias: 'Service',
              },
              {
                valueExpression: `${getEventBody(logSource)}`,
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
          queryKeyPrefix="k8s-dashboard-node-logs"
          onScroll={() => {}}
        />
      </Card.Section>
    </Card>
  );
}

export default function NodeDetailsSidePanel({
  metricSource,
  logSource,
}: {
  metricSource: TSource;
  logSource: TSource;
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

  const metricsWhere = React.useMemo(() => {
    return `${metricSource?.resourceAttributesExpression}.k8s.node.name:"${nodeName}"`;
  }, [nodeName, metricSource]);

  const { searchedTimeRange: dateRange } = useTimeQuery({
    defaultValue: 'Past 1h',
    defaultTimeRange: [
      defaultTimeRange?.[0]?.getTime() ?? -1,
      defaultTimeRange?.[1]?.getTime() ?? -1,
    ],
  });

  const { data: logsTableMetadata } = useTableMetadata(tcFromSource(logSource));

  let doesPrimaryOrSortingKeysContainServiceExpression = false;

  if (
    logSource?.serviceNameExpression &&
    (logsTableMetadata?.primary_key || logsTableMetadata?.sorting_key)
  ) {
    if (
      logsTableMetadata.primary_key &&
      logsTableMetadata.primary_key.includes(logSource.serviceNameExpression)
    ) {
      doesPrimaryOrSortingKeysContainServiceExpression = true;
    } else if (
      logsTableMetadata.sorting_key &&
      logsTableMetadata.sorting_key.includes(logSource.serviceNameExpression)
    ) {
      doesPrimaryOrSortingKeysContainServiceExpression = true;
    }
  }

  const { data: logServiceNames } = useGetKeyValues(
    {
      chartConfig: {
        from: logSource.from,
        where: `${logSource?.resourceAttributesExpression}.k8s.node.name:"${nodeName}"`,
        whereLanguage: 'lucene',
        select: '',
        timestampValueExpression: logSource.timestampValueExpression ?? '',
        connection: logSource.connection,
        dateRange,
      },
      keys: [logSource.serviceNameExpression ?? ''],
      limit: 10,
      disableRowLimit: false,
    },
    {
      enabled:
        !!nodeName &&
        !!logSource.serviceNameExpression &&
        doesPrimaryOrSortingKeysContainServiceExpression,
    },
  );

  // HACK: craft where clause for logs given the ServiceName is part of the primary key
  const logsWhere = React.useMemo(() => {
    const _where = `${logSource?.resourceAttributesExpression}.k8s.node.name:"${nodeName}"`;
    if (
      Array.isArray(logServiceNames?.[0].value) &&
      doesPrimaryOrSortingKeysContainServiceExpression
    ) {
      const _svs: string[] = logServiceNames[0].value;
      const _key = logServiceNames[0].key;
      return `(${_svs
        .map(sv => `${_key}:"${sv}"`)
        .join(' OR ')}) AND ${_where}`;
    }
    return _where;
  }, [
    nodeName,
    logSource,
    doesPrimaryOrSortingKeysContainServiceExpression,
    logServiceNames,
  ]);

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
              <NodeDetails
                name={nodeName}
                dateRange={dateRange}
                metricSource={metricSource}
              />
              <Grid.Col span={6}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    CPU Usage by Pod
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
                              where: metricsWhere,
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
                              where: metricsWhere,
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
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={12}>
                {metricSource && (
                  <InfraPodsStatusTable
                    metricSource={metricSource}
                    dateRange={dateRange}
                    where={metricsWhere}
                  />
                )}
              </Grid.Col>
              <Grid.Col span={12}>
                {logSource && (
                  <NodeLogs
                    where={logsWhere}
                    dateRange={dateRange}
                    logSource={logSource}
                  />
                )}
              </Grid.Col>
            </Grid>
          </DrawerBody>
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
