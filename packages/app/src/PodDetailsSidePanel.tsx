import * as React from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import { tcFromSource } from '@hyperdx/common-utils/dist/core/metadata';
import { convertDateRangeToGranularityString } from '@hyperdx/common-utils/dist/core/utils';
import { TSource } from '@hyperdx/common-utils/dist/types';
import {
  Box,
  Card,
  Drawer,
  Flex,
  Grid,
  ScrollArea,
  SegmentedControl,
  Text,
} from '@mantine/core';

import {
  convertV1ChartConfigToV2,
  K8S_CPU_PERCENTAGE_NUMBER_FORMAT,
  K8S_MEM_NUMBER_FORMAT,
} from '@/ChartUtils';
import DBRowSidePanel from '@/components/DBRowSidePanel';
import { DBTimeChart } from '@/components/DBTimeChart';
import { DrawerBody, DrawerHeader } from '@/components/DrawerUtils';
import { KubeTimeline, useV2LogBatch } from '@/components/KubeComponents';
import { RowWhereResult, WithClause } from '@/hooks/useRowWhere';
import { parseTimeQuery, useTimeQuery } from '@/timeQuery';
import { useZIndex, ZIndexContext } from '@/zIndex';

import DBSqlRowTableWithSideBar from './components/DBSqlRowTableWithSidebar';
import { useGetKeyValues, useTableMetadata } from './hooks/useMetadata';
import { getEventBody } from './source';

import styles from '../styles/LogSidePanel.module.scss';

const CHART_HEIGHT = 300;
const defaultTimeRange = parseTimeQuery('Past 1h', false);

const PodDetailsProperty = React.memo(
  ({ label, value }: { label: string; value?: string }) => {
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

const PodDetails = ({
  dateRange,
  logSource,
  podName,
}: {
  dateRange: [Date, Date];
  logSource: TSource;
  podName: string;
}) => {
  const { data: logsData } = useV2LogBatch<{
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

  if (logsData?.data?.[0] == null) {
    return null;
  }

  const properties = logsData.data[0] ?? {};

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
  rowId,
  onRowClick,
}: {
  dateRange: [Date, Date];
  logSource: TSource;
  where: string;
  rowId: string | null;
  onRowClick: (rowWhere: RowWhereResult) => void;
}) {
  const [resultType, setResultType] = React.useState<'all' | 'error'>('all');

  const _where = where + (resultType === 'error' ? ' Severity:err' : '');

  // Create a properly typed config object for DBSqlRowTable
  const tableConfig = React.useMemo(() => {
    return {
      from: logSource.from,
      where: _where,
      whereLanguage: 'lucene' as const,
      timestampValueExpression: logSource.timestampValueExpression,
      implicitColumnExpression: logSource.implicitColumnExpression,
      connection: logSource.connection,
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
          valueExpression: `${logSource.resourceAttributesExpression}['k8s.container.name']`,
          alias: 'Container',
        },
        {
          valueExpression: `${getEventBody(logSource)}`,
          alias: 'Message',
        },
      ],
      orderBy: `${logSource.timestampValueExpression} DESC`,
      limit: { limit: 200, offset: 0 },
      dateRange,
    };
  }, [_where, dateRange, logSource]);

  return (
    <Card p="md">
      <Card.Section p="md" py="xs">
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
          </Flex>
        </Flex>
      </Card.Section>
      <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
        <DBSqlRowTableWithSideBar
          sourceId={logSource.id}
          config={tableConfig}
          isLive={false}
          isNestedPanel
          breadcrumbPath={[{ label: 'Pods' }]}
          queryKeyPrefix="k8s-dashboard-pod-logs"
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
  const [podName, setPodName] = useQueryState(
    'podName',
    parseAsString.withDefault(''),
  );

  const [rowId, setRowId] = React.useState<string | null>(null);
  const [aliasWith, setAliasWith] = React.useState<WithClause[]>([]);
  const handleRowClick = React.useCallback((rowWhere: RowWhereResult) => {
    setRowId(rowWhere.where);
    setAliasWith(rowWhere.aliasWith);
  }, []);
  const handleCloseRowSidePanel = React.useCallback(() => {
    setRowId(null);
  }, []);

  // If we're in a nested side panel, we need to use a higher z-index
  // TODO: This is a hack
  const [nodeName] = useQueryState('nodeName');
  const [namespaceName] = useQueryState('namespaceName');
  const isNested = !!nodeName || !!namespaceName;
  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10 + (isNested ? 100 : 0);

  const metricsWhere = React.useMemo(() => {
    return `${metricSource?.resourceAttributesExpression}.k8s.pod.name:"${podName}"`;
  }, [podName, metricSource]);

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
        where: `${logSource?.resourceAttributesExpression}.k8s.pod.name:"${podName}"`,
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
        !!podName &&
        !!logSource.serviceNameExpression &&
        doesPrimaryOrSortingKeysContainServiceExpression,
    },
  );

  // HACK: craft where clause for logs given the ServiceName is part of the primary key
  const logsWhere = React.useMemo(() => {
    const _where = `${logSource?.resourceAttributesExpression}.k8s.pod.name:"${podName}"`;
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
    logSource,
    doesPrimaryOrSortingKeysContainServiceExpression,
    logServiceNames,
    podName,
  ]);

  const handleClose = React.useCallback(() => {
    if (rowId) {
      // If we're in a nested side panel, don't close the drawer
      return;
    }
    setPodName(null);
  }, [rowId, setPodName]);

  if (!podName) {
    return null;
  }

  return (
    <Drawer
      opened={!!podName}
      onClose={handleClose}
      position="right"
      size={isNested ? '70vw' : '80vw'}
      withCloseButton={false}
      zIndex={drawerZIndex}
      styles={{
        body: {
          padding: 0,
          height: '100vh',
        },
      }}
    >
      <ZIndexContext.Provider value={drawerZIndex}>
        <div className={styles.panel} data-testid="k8s-pod-details-panel">
          <DrawerHeader
            header={`Details for ${podName}`}
            onClose={handleClose}
          />
          <DrawerBody>
            <Grid>
              <PodDetails
                dateRange={dateRange}
                logSource={logSource}
                podName={podName}
              />
              <Grid.Col span={6}>
                <Card p="md" data-testid="pod-details-cpu-usage-chart">
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
                      showDisplaySwitcher={false}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={6}>
                <Card p="md" data-testid="pod-details-memory-usage-chart">
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <DBTimeChart
                      title="Memory Usage"
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
                      showDisplaySwitcher={false}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={12}>
                <Card p="md">
                  <Card.Section p="md" py="xs">
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
                  where={logsWhere}
                  dateRange={dateRange}
                  rowId={rowId}
                  onRowClick={handleRowClick}
                />
              </Grid.Col>
            </Grid>
          </DrawerBody>
          {rowId && (
            <DBRowSidePanel
              source={logSource}
              rowId={rowId}
              aliasWith={aliasWith}
              onClose={handleCloseRowSidePanel}
              isNestedPanel={true}
            />
          )}
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
