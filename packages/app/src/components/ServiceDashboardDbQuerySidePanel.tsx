import { useCallback, useMemo } from 'react';
import { parseAsString, useQueryState } from 'nuqs';
import Drawer from 'react-modern-drawer';
import { Filter } from '@hyperdx/common-utils/dist/renderChartConfig';
import { Grid, Group, Text } from '@mantine/core';

import { INTEGER_NUMBER_FORMAT, MS_NUMBER_FORMAT } from '@/ChartUtils';
import { ChartBox } from '@/components/ChartBox';
import { DBTimeChart } from '@/components/DBTimeChart';
import { DrawerBody, DrawerHeader } from '@/components/DrawerUtils';
import SlowestEventsTile from '@/components/ServiceDashboardSlowestEventsTile';
import { getExpressions } from '@/serviceDashboard';
import { useSource } from '@/source';
import { useZIndex, ZIndexContext } from '@/zIndex';

import 'react-modern-drawer/dist/index.css';
import styles from '@/../styles/LogSidePanel.module.scss';

export default function ServiceDashboardDbQuerySidePanel({
  sourceId,
  service,
  searchedTimeRange,
}: {
  sourceId?: string;
  service?: string;
  searchedTimeRange: [Date, Date];
}) {
  const { data: source } = useSource({ id: sourceId });
  const expressions = getExpressions(source);

  const [dbQuery, setDbQuery] = useQueryState('dbquery', parseAsString);
  const onClose = useCallback(() => {
    setDbQuery(null);
  }, [setDbQuery]);

  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;

  const dbQueryFilters = useMemo(() => {
    const filters: Filter[] = [
      {
        type: 'sql',
        condition: `${expressions.dbStatement} IN ('${dbQuery}')`,
      },
    ];
    if (service) {
      filters.push({
        type: 'sql',
        condition: `${expressions.service} IN ('${service}')`,
      });
    }
    return filters;
  }, [dbQuery, expressions, service]);

  if (!dbQuery) {
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
                Details for {dbQuery}
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
                      Total Query Time
                    </Text>
                  </Group>
                  {source && (
                    <DBTimeChart
                      sourceId={sourceId}
                      config={{
                        ...source,
                        where: '',
                        whereLanguage: 'sql',
                        select: [
                          {
                            aggFn: 'sum' as const,
                            valueExpression: expressions.durationInMillis,
                            alias: 'Total Query Time',
                            aggCondition: '',
                          },
                        ],
                        numberFormat: MS_NUMBER_FORMAT,
                        filters: dbQueryFilters,
                        dateRange: searchedTimeRange,
                      }}
                    />
                  )}
                </ChartBox>
              </Grid.Col>
              <Grid.Col span={6}>
                <ChartBox style={{ height: 350 }}>
                  <Group justify="space-between" align="center" mb="sm">
                    <Text size="sm" c="gray.4">
                      Query Throughput
                    </Text>
                  </Group>
                  {source && (
                    <DBTimeChart
                      sourceId={sourceId}
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
                        filters: dbQueryFilters,
                        dateRange: searchedTimeRange,
                      }}
                    />
                  )}
                </ChartBox>
              </Grid.Col>
              <Grid.Col span={12}>
                {source && (
                  <SlowestEventsTile
                    title="Slowest 10% of Queries"
                    source={source}
                    dateRange={searchedTimeRange}
                    extraFilters={dbQueryFilters}
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
