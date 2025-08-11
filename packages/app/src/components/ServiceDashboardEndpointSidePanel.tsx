import { useCallback, useMemo } from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import Drawer from 'react-modern-drawer';
import type { Filter } from '@hyperdx/common-utils/dist/types';
import { Grid, Group, Text } from '@mantine/core';

import {
  ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
  INTEGER_NUMBER_FORMAT,
} from '@/ChartUtils';
import { ChartBox } from '@/components/ChartBox';
import { DBTimeChart } from '@/components/DBTimeChart';
import { DrawerBody, DrawerHeader } from '@/components/DrawerUtils';
import ServiceDashboardEndpointPerformanceChart from '@/components/ServiceDashboardEndpointPerformanceChart';
import SlowestEventsTile from '@/components/ServiceDashboardSlowestEventsTile';
import { useJsonColumns } from '@/hooks/useMetadata';
import { getExpressions } from '@/serviceDashboard';
import { EndpointLatencyChart } from '@/ServicesDashboardPage';
import { useSource } from '@/source';
import { useZIndex, ZIndexContext } from '@/zIndex';

import 'react-modern-drawer/dist/index.css';
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
  const { data: jsonColumns = [] } = useJsonColumns({
    databaseName: source?.from?.databaseName || '',
    tableName: source?.from?.tableName || '',
    connectionId: source?.connection || '',
  });
  const expressions = getExpressions(source, jsonColumns);

  const [endpoint, setEndpoint] = useQueryState('endpoint', parseAsString);
  const onClose = useCallback(() => {
    setEndpoint(null);
  }, [setEndpoint]);

  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;

  const endpointFilters = useMemo(() => {
    const filters: Filter[] = [
      {
        type: 'sql',
        condition: `${expressions.spanName} = '${endpoint}' AND ${expressions.isSpanKindServer}`,
      },
    ];
    if (service) {
      filters.push({
        type: 'sql',
        condition: `${expressions.service} = '${service}'`,
      });
    }
    return filters;
  }, [endpoint, service, expressions]);

  if (!endpoint || !source) {
    return null;
  }

  return (
    <Drawer
      duration={0}
      open
      onClose={onClose}
      direction="right"
      size={'80vw'}
      zIndex={drawerZIndex}
    >
      <ZIndexContext.Provider value={drawerZIndex}>
        <div className={styles.panel}>
          <DrawerHeader
            header={
              <>
                Details for {endpoint}
                {service && (
                  <Text component="span" c="gray" fz="xs">
                    <i className="bi bi-hdd ms-3 me-1" />
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
                    <Text size="sm" c="gray.4">
                      Request Error Rate
                    </Text>
                  </Group>
                  {source && (
                    <DBTimeChart
                      config={{
                        ...source,
                        where: '',
                        whereLanguage: 'sql',
                        select: [
                          {
                            valueExpression: `countIf(${expressions.isError}) / count()`,
                            alias: 'Error Rate %',
                          },
                        ],
                        numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
                        filters: [
                          ...endpointFilters,
                          {
                            type: 'sql',
                            condition: `${expressions.httpScheme} = 'http'`,
                          },
                        ],
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
                    <Text size="sm" c="gray.4">
                      Request Throughput
                    </Text>
                  </Group>
                  {source && (
                    <DBTimeChart
                      config={{
                        ...source,
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
                <SlowestEventsTile
                  title="Slowest 10% of Transactions"
                  source={source}
                  dateRange={searchedTimeRange}
                  extraFilters={endpointFilters}
                />
              </Grid.Col>
            </Grid>
          </DrawerBody>
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
