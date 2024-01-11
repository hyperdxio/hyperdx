import * as React from 'react';
import Drawer from 'react-modern-drawer';
import { StringParam, useQueryParam, withDefault } from 'use-query-params';
import { Box, Card, Grid, Text } from '@mantine/core';

import {
  convertDateRangeToGranularityString,
  ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
  INTEGER_NUMBER_FORMAT,
} from './ChartUtils';
import EndpointLatencyTile from './EndpointLatencyTile';
import { HDXSpanPerformanceBarChart } from './HDXListBarChart';
import HDXMultiSeriesTimeChart from './HDXMultiSeriesTimeChart';
import SlowestEventsTile from './SlowestEventsTile';
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
    withDefault(StringParam, ''),
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
      const serviceQuery = service ? `service:"${service}" ` : '';
      return `${spanNameQuery}${serviceQuery}${whereQuery} span.kind:"server"`.trim();
    },
    [endpoint, service],
  );
  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;

  if (!endpoint) {
    return null;
  }

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
                            where: scopeWhereQuery('level:"error"'),
                            groupBy: [],
                            numberFormat: ERROR_RATE_PERCENTAGE_NUMBER_FORMAT,
                          },
                          {
                            table: 'logs',
                            type: 'time',
                            aggFn: 'count',
                            field: '',
                            where: scopeWhereQuery(''),
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
                            where: scopeWhereQuery(''),
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
                <SlowestEventsTile
                  dateRange={dateRange}
                  height={CHART_HEIGHT}
                  scopeWhereQuery={scopeWhereQuery}
                  title={<Text>Slowest 10% of Transactions</Text>}
                />
              </Grid.Col>
            </Grid>
          </Box>
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
