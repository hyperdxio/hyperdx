import { useCallback, useMemo } from 'react';
import { pick } from 'lodash';
import { parseAsString, useQueryState } from 'nuqs';
import { DisplayType, type Filter } from '@hyperdx/common-utils/dist/types';
import { Drawer, Grid, Text } from '@mantine/core';
import { IconServer } from '@tabler/icons-react';

import { INTEGER_NUMBER_FORMAT, MS_NUMBER_FORMAT } from '@/ChartUtils';
import { ChartBox } from '@/components/ChartBox';
import { DBTimeChart } from '@/components/DBTimeChart';
import { DrawerBody, DrawerHeader } from '@/components/DrawerUtils';
import SlowestEventsTile from '@/components/ServiceDashboardSlowestEventsTile';
import { useServiceDashboardExpressions } from '@/serviceDashboard';
import { useSource } from '@/source';
import { useZIndex, ZIndexContext } from '@/zIndex';

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
  const { expressions } = useServiceDashboardExpressions({ source });

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
        condition: `${expressions?.dbStatement} IN ('${dbQuery}')`,
      },
    ];
    if (service) {
      filters.push({
        type: 'sql',
        condition: `${expressions?.service} IN ('${service}')`,
      });
    }
    return filters;
  }, [dbQuery, expressions, service]);

  if (!dbQuery) {
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
                Details for {dbQuery}
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
                  {source && expressions && (
                    <DBTimeChart
                      title="Total Query Time"
                      sourceId={sourceId}
                      hiddenSeries={['total_duration_ns']}
                      config={{
                        source: source.id,
                        ...pick(source, [
                          'timestampValueExpression',
                          'connection',
                          'from',
                        ]),
                        where: '',
                        whereLanguage: 'sql',
                        select: [
                          // Separate the aggregations from the conversion to ms so that AggregatingMergeTree MVs can be used
                          {
                            aggFn: 'sum',
                            valueExpression: expressions.duration,
                            alias: 'total_duration_ns',
                            aggCondition: '',
                          },
                          {
                            valueExpression: `total_duration_ns / ${expressions.durationDivisorForMillis}`,
                            alias: 'Total Query Time',
                          },
                        ],
                        displayType: DisplayType.Line,
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
                  {source && expressions && (
                    <DBTimeChart
                      title="Query Throughput"
                      sourceId={sourceId}
                      config={{
                        source: source.id,
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
                        displayType: DisplayType.Line,
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
                    title="Slowest 5% of Queries"
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
