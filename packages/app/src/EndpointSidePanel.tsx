import * as React from 'react';
import Drawer from 'react-modern-drawer';
import { StringParam, useQueryParam, withDefault } from 'use-query-params';
import { Box, Card, Flex, Grid, Text } from '@mantine/core';

import api from './api';
import {
  convertDateRangeToGranularityString,
  ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
  INTEGER_NUMBER_FORMAT,
} from './ChartUtils';
import EndpointLatencyTile from './EndpointLatencyTile';
import { HDXSpanPerformanceBarChart } from './HDXListBarChart';
import HDXMultiSeriesTimeChart from './HDXMultiSeriesTimeChart';
import { LogTableWithSidePanel } from './LogTableWithSidePanel';
import { parseTimeQuery, useTimeQuery } from './timeQuery';
import { useZIndex, ZIndexContext } from './zIndex';

import styles from '../styles/LogSidePanel.module.scss';

const defaultTimeRange = parseTimeQuery('Past 1h', false);

const CHART_HEIGHT = 300;

export default function EndpointSidePanel() {
  const [service] = useQueryParam('service', withDefault(StringParam, ''), {
    updateType: 'replaceIn',
  });

  const [endpoint, setEndpoint] = useQueryParam(
    'endpoint',
    withDefault(StringParam, ''), // TODO: CHANGE
    { updateType: 'replaceIn' },
  );

  const { searchedTimeRange: dateRange } = useTimeQuery({
    isUTC: false,
    defaultValue: 'Past 1h',
    defaultTimeRange: [
      defaultTimeRange?.[0]?.getTime() ?? -1,
      defaultTimeRange?.[1]?.getTime() ?? -1,
    ],
  });

  const scopeWhereQuery = React.useCallback(
    (where: string) => {
      const spanNameQuery = endpoint ? `span_name:"${endpoint}" ` : '';
      const whereQuery = where ? `(${where})` : '';
      return `${spanNameQuery}${whereQuery}`;
    },
    [endpoint],
  );
  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;

  return (
    <Drawer
      enableOverlay
      overlayOpacity={0.1}
      duration={0}
      open={!!endpoint}
      onClose={() => {
        setEndpoint(undefined);
      }}
      direction="right"
      size={'80vw'}
      zIndex={drawerZIndex}
    >
      <ZIndexContext.Provider value={drawerZIndex}>
        <div className={styles.panel}>
          <Box p="md">
            <Text size="md">Details for {endpoint}</Text>
          </Box>
          <Box className="w-100 overflow-auto" px="sm">
            <Grid>
              <Grid.Col span={6}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    Request Error Rate
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <HDXMultiSeriesTimeChart
                      config={{
                        dateRange,
                        granularity: convertDateRangeToGranularityString(
                          dateRange,
                          60,
                        ),
                        series: [
                          {
                            displayName: 'Error Rate %',
                            table: 'logs',
                            type: 'time',
                            aggFn: 'count',
                            where: scopeWhereQuery(
                              'span.kind:"server" level:"error"',
                            ),
                            groupBy: [],
                            numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
                          },
                          {
                            table: 'logs',
                            type: 'time',
                            aggFn: 'count',
                            field: '',
                            where: scopeWhereQuery('span.kind:"server"'),
                            groupBy: [],
                            numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
                          },
                        ],
                        seriesReturnType: 'ratio',
                      }}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={6}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    Request Throughput
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <HDXMultiSeriesTimeChart
                      config={{
                        dateRange,
                        granularity: convertDateRangeToGranularityString(
                          dateRange,
                          60,
                        ),
                        series: [
                          {
                            displayName: 'Requests',
                            table: 'logs',
                            type: 'time',
                            aggFn: 'count',
                            where: scopeWhereQuery('span.kind:"server"'),
                            groupBy: [],
                            numberFormat: {
                              ...INTEGER_NUMBER_FORMAT,
                              unit: 'requests',
                            },
                          },
                        ],
                        seriesReturnType: 'column',
                      }}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={6}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    20 Top Most Time Consuming Operations
                  </Card.Section>
                  <Card.Section p="md" py="sm" h={CHART_HEIGHT}>
                    <HDXSpanPerformanceBarChart
                      config={{
                        spanName: endpoint,
                        dateRange,
                        parentSpanWhere: scopeWhereQuery(''),
                        childrenSpanWhere: service
                          ? `service:"${service}"`
                          : '',
                      }}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={6}>
                <EndpointLatencyTile
                  dateRange={dateRange}
                  height={CHART_HEIGHT}
                />
              </Grid.Col>
              <Grid.Col span={12}>
                <SlowestTransactionsTile
                  dateRange={dateRange}
                  height={CHART_HEIGHT}
                  scopeWhereQuery={scopeWhereQuery}
                />
              </Grid.Col>
            </Grid>
          </Box>
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}

function SlowestTransactionsTile({
  dateRange,
  height,
  scopeWhereQuery,
}: {
  dateRange: [Date, Date];
  height: number;
  scopeWhereQuery: (where: string) => string;
}) {
  const { data, isError, isLoading } = api.useMultiSeriesChart({
    series: [
      {
        type: 'table',
        aggFn: 'p95',
        field: 'duration',
        groupBy: [],
        table: 'logs',
        where: scopeWhereQuery(''),
      },
    ],
    endDate: dateRange[1] ?? new Date(),
    startDate: dateRange[0] ?? new Date(),
    seriesReturnType: 'column',
  });

  const p95 = data?.data?.[0]?.['series_0.data'];

  const roundedP95 = Math.round(p95 ?? 0);

  return (
    <Card p="md">
      <Card.Section p="md" py="xs" withBorder>
        <Flex justify="space-between">
          <Text>Slowest 10% of Transactions</Text>
          <Text size="xs" c="dark.2">
            (Slower than {roundedP95}ms)
          </Text>
        </Flex>
      </Card.Section>
      <Card.Section p="md" py="sm" h={height}>
        {isLoading ? (
          <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
            Calculating Slow Transactions...
          </div>
        ) : isError || p95 == null ? (
          <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
            Error Calculating Slow Transactions
          </div>
        ) : (
          <LogTableWithSidePanel
            config={{
              dateRange,
              where: scopeWhereQuery(
                `span.kind:"server" duration:>${roundedP95}`,
              ),
              columns: ['duration'],
            }}
            isLive={false}
            isUTC={false}
            setIsUTC={() => {}}
            onPropertySearchClick={() => {}}
          />
        )}
      </Card.Section>
    </Card>
  );
}
