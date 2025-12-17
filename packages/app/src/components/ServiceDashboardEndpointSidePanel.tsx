import { useCallback, useMemo } from 'react';
import { pick } from 'lodash';
import { parseAsString, useQueryState } from 'nuqs';
import type { Filter } from '@hyperdx/common-utils/dist/types';
import { Drawer, Grid, Group, Text } from '@mantine/core';
import { IconServer } from '@tabler/icons-react';

import {
  ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
  INTEGER_NUMBER_FORMAT,
} from '@/ChartUtils';
import { ChartBox } from '@/components/ChartBox';
import { DBTimeChart } from '@/components/DBTimeChart';
import { DrawerBody, DrawerHeader } from '@/components/DrawerUtils';
import ServiceDashboardEndpointPerformanceChart from '@/components/ServiceDashboardEndpointPerformanceChart';
import SlowestEventsTile from '@/components/ServiceDashboardSlowestEventsTile';
import { useServiceDashboardExpressions } from '@/serviceDashboard';
import { EndpointLatencyChart } from '@/ServicesDashboardPage';
import { useSource } from '@/source';
import { useZIndex, ZIndexContext } from '@/zIndex';

import styles from '@/../styles/LogSidePanel.module.scss';

export default function ServiceDashboardEndpointSidePanel({
  sourceId,
  service,
  searchedTimeRange,
}: {
  sourceId?: string;
  service?: string;
  searchedTimeRange: [Date, Date];
}) {
  const { data: source } = useSource({ id: sourceId });
  const { expressions } = useServiceDashboardExpressions({ source });

  const [endpoint, setEndpoint] = useQueryState('endpoint', parseAsString);
  const onClose = useCallback(() => {
    setEndpoint(null);
  }, [setEndpoint]);

  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;

  const endpointFilters = useMemo(() => {
    if (!expressions) return [];

    const filters: Filter[] = [
      {
        type: 'sql',
        condition: `${expressions.spanName} IN ('${endpoint}') AND ${expressions.isSpanKindServer}`,
      },
    ];
    if (service) {
      filters.push({
        type: 'sql',
        condition: `${expressions.service} IN ('${service}')`,
      });
    }
    return filters;
  }, [endpoint, service, expressions]);

  if (!endpoint || !source) {
    return null;
  }

  return (
    <Drawer
      opened
      onClose={onClose}
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
        <div className={styles.panel}>
          <DrawerHeader
            header={
              <>
                Details for {endpoint}
                {service && (
                  <Text component="span" c="gray" fz="xs">
                    <IconServer size={14} className="ms-3 me-1" />
                    {service}
                  </Text>
                )}
              </>
            }
            onClose={onClose}
          />
          <DrawerBody>
            <Grid grow={false} w="100%" maw="100%" overflow="hidden">
              <Grid.Col span={6}>
                <ChartBox style={{ height: 350 }}>
                  <Group justify="space-between" align="center" mb="sm">
                    <Text size="sm">Request Error Rate</Text>
                  </Group>
                  {source && expressions && (
                    <DBTimeChart
                      sourceId={source.id}
                      hiddenSeries={['total_count', 'error_count']}
                      config={{
                        ...pick(source, [
                          'timestampValueExpression',
                          'connection',
                          'from',
                        ]),
                        where: '',
                        whereLanguage: 'sql',
                        select: [
                          // Separate the aggregations from the conversion to rate so that AggregatingMergeTree MVs can be used
                          {
                            valueExpression: '',
                            aggFn: 'count',
                            alias: 'error_count',
                            aggCondition: expressions.isError,
                            aggConditionLanguage: 'sql',
                          },
                          {
                            valueExpression: '',
                            aggFn: 'count',
                            alias: 'total_count',
                          },
                          {
                            valueExpression: `error_count / total_count`,
                            alias: 'Error Rate %',
                          },
                        ],
                        numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
                        filters: endpointFilters,
                        dateRange: searchedTimeRange,
                      }}
                      showDisplaySwitcher={false}
                    />
                  )}
                </ChartBox>
              </Grid.Col>
              <Grid.Col span={6}>
                <ChartBox style={{ height: 350 }}>
                  <Group justify="space-between" align="center" mb="sm">
                    <Text size="sm">Request Throughput</Text>
                  </Group>
                  {source && expressions && (
                    <DBTimeChart
                      sourceId={source.id}
                      config={{
                        ...pick(source, [
                          'timestampValueExpression',
                          'connection',
                          'from',
                        ]),
                        where: '',
                        whereLanguage: 'sql',
                        select: [
                          {
                            aggFn: 'count' as const,
                            valueExpression: 'value',
                            alias: 'Requests',
                            aggCondition: '',
                            aggConditionLanguage: 'sql',
                          },
                        ],
                        numberFormat: {
                          ...INTEGER_NUMBER_FORMAT,
                          unit: 'requests',
                        },
                        filters: endpointFilters,
                        dateRange: searchedTimeRange,
                      }}
                    />
                  )}
                </ChartBox>
              </Grid.Col>
              <Grid.Col span={6}>
                <ServiceDashboardEndpointPerformanceChart
                  source={source}
                  dateRange={searchedTimeRange}
                  service={service}
                  endpoint={endpoint}
                />
              </Grid.Col>
              <Grid.Col span={6}>
                <EndpointLatencyChart
                  source={source}
                  dateRange={searchedTimeRange}
                  extraFilters={endpointFilters}
                />
              </Grid.Col>
              <Grid.Col span={12}>
                {/* Ensure expressions exists to ensure that endpointFilters has set */}
                {expressions && (
                  <SlowestEventsTile
                    title="Slowest 5% of Transactions"
                    source={source}
                    dateRange={searchedTimeRange}
                    extraFilters={endpointFilters}
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
