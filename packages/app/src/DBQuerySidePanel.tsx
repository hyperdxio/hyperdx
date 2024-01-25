import * as React from 'react';
import Drawer from 'react-modern-drawer';
import { StringParam, useQueryParam, withDefault } from 'use-query-params';
import { Box, Card, Grid, Text } from '@mantine/core';

import { DrawerBody, DrawerHeader } from './components/DrawerUtils';
import {
  convertDateRangeToGranularityString,
  INTEGER_NUMBER_FORMAT,
  MS_NUMBER_FORMAT,
} from './ChartUtils';
import HDXMultiSeriesTimeChart from './HDXMultiSeriesTimeChart';
import SlowestEventsTile from './SlowestEventsTile';
import { parseTimeQuery, useTimeQuery } from './timeQuery';
import { useZIndex, ZIndexContext } from './zIndex';

import styles from '../styles/LogSidePanel.module.scss';

const defaultTimeRange = parseTimeQuery('Past 1h', false);

const CHART_HEIGHT = 300;

const DB_STATEMENT_PROPERTY = 'db.normalized_statement';

export default function DBQuerySidePanel() {
  const [service] = useQueryParam('service', withDefault(StringParam, ''), {
    updateType: 'replaceIn',
  });

  const [dbQuery, setDbQuery] = useQueryParam(
    'db_query',
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
      const spanNameQuery = dbQuery
        ? `${DB_STATEMENT_PROPERTY}:"${dbQuery.replace(/"/g, '\\"')}" `
        : '';
      const whereQuery = where ? `(${where})` : '';
      const serviceQuery = service ? `service:"${service}" ` : '';
      return `${spanNameQuery}${serviceQuery}${whereQuery}`.trim();
    },
    [dbQuery, service],
  );
  const contextZIndex = useZIndex();
  const drawerZIndex = contextZIndex + 10;

  const handleClose = React.useCallback(() => {
    setDbQuery(undefined);
  }, [setDbQuery]);

  if (!dbQuery) {
    return null;
  }

  return (
    <Drawer
      enableOverlay
      overlayOpacity={0.1}
      duration={0}
      open={!!dbQuery}
      onClose={handleClose}
      direction="right"
      size={'80vw'}
      zIndex={drawerZIndex}
    >
      <ZIndexContext.Provider value={drawerZIndex}>
        <div className={styles.panel}>
          <DrawerHeader
            header={`Details for ${dbQuery}`}
            onClose={handleClose}
          />
          <DrawerBody>
            <Grid>
              <Grid.Col span={6}>
                <Card p="md">
                  <Card.Section p="md" py="xs" withBorder>
                    Total Query Time
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
                            displayName: 'Total Query Time',
                            table: 'logs',
                            type: 'time',
                            aggFn: 'sum',
                            field: 'duration',
                            where: scopeWhereQuery(''),
                            groupBy: [],
                            numberFormat: MS_NUMBER_FORMAT,
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
                    Query Throughput
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
                            displayName: 'Queries',
                            table: 'logs',
                            type: 'time',
                            aggFn: 'count',
                            where: scopeWhereQuery(''),
                            groupBy: [],
                            numberFormat: {
                              ...INTEGER_NUMBER_FORMAT,
                              unit: 'queries',
                            },
                          },
                        ],
                        seriesReturnType: 'column',
                      }}
                    />
                  </Card.Section>
                </Card>
              </Grid.Col>
              <Grid.Col span={12}>
                <SlowestEventsTile
                  dateRange={dateRange}
                  height={CHART_HEIGHT}
                  scopeWhereQuery={scopeWhereQuery}
                  title={<Text>Slowest 10% of Queries</Text>}
                />
              </Grid.Col>
            </Grid>
          </DrawerBody>
        </div>
      </ZIndexContext.Provider>
    </Drawer>
  );
}
