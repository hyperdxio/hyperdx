import * as React from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { convertDateRangeToGranularityString } from '@hyperdx/common-utils/dist/core/utils';
import { TSource } from '@hyperdx/common-utils/dist/types';
import {
  Badge,
  Card,
  Drawer,
  Flex,
  Grid,
  SegmentedControl,
  Text,
} from '@mantine/core';

import {
  convertV1ChartConfigToV2,
  K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
  K8S_MEM_NUMBER_FORMAT,
} from '@/ChartUtils';
import { DBTimeChart } from '@/components/DBTimeChart';
import { DrawerBody, DrawerHeader } from '@/components/DrawerUtils';
import { InfraPodsStatusTable } from '@/KubernetesDashboardPage';
import { getEventBody } from '@/source';
import { parseTimeQuery, useTimeQuery } from '@/timeQuery';
import { formatUptime } from '@/utils';
import { useZIndex, ZIndexContext } from '@/zIndex';

import DBSqlRowTableWithSideBar from './components/DBSqlRowTableWithSidebar';
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
        <Text size="xs" color="gray">
          {label}
        </Text>
        <Text size="sm">{value}</Text>
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
      <Card.Section p="md" py="xs">
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
                  Search <IconExternalLink size={12} style={{ display: 'inline' }} />
                </Anchor>
              </Link> 
              */}
          </Flex>
        </Flex>
      </Card.Section>
      <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
        <DBSqlRowTableWithSideBar
          sourceId={logSource.id}
          isNestedPanel
          breadcrumbPath={[{ label: 'Node Details' }]}
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
          isLive={false}
          queryKeyPrefix="k8s-dashboard-node-logs"
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
  const [nodeName, setNodeName] = useQueryState(
    'nodeName',
    parseAsString.withDefault(''),
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
        source: logSource.id,
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
      logServiceNames &&
      logServiceNames[0].value.length > 0 &&
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
    setNodeName(null);
  }, [setNodeName]);

  if (!nodeName) {
    return null;
  }

  return (
    <Drawer
      opened={!!nodeName}
      onClose={handleClose}
      position="right"
      size="80vw"
      withCloseButton={false}
      zIndex={drawerZIndex}
      styles={{
        body: {
          padding: 0,
        },
      }}
    >
      <ZIndexContext.Provider value={drawerZIndex}>
        <div className={styles.panel} data-testid="k8s-node-details-panel">
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
                <Card p="md" data-testid="nodes-details-cpu-usage-chart">
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <DBTimeChart
                      title="CPU Usage by Pod"
                      config={convertV1ChartConfigToV2(
                        {
                          dateRange,
                          granularity:
                            convertDateRangeToGranularityString(dateRange),
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
              <Grid.Col span={6} data-testid="nodes-details-memory-usage-chart">
                <Card p="md">
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <DBTimeChart
                      title="Memory Usage by Pod"
                      config={convertV1ChartConfigToV2(
                        {
                          dateRange,
                          granularity:
                            convertDateRangeToGranularityString(dateRange),
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
