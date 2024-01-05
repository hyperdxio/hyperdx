import * as React from 'react';
import { Box, Button, Card, Flex } from '@mantine/core';

import {
  convertDateRangeToGranularityString,
  MS_NUMBER_FORMAT,
} from './ChartUtils';
import HDXHistogramChart from './HDXHistogramChart';
import HDXMultiSeriesLineChart from './HDXMultiSeriesTimeChart';
import { Histogram } from './SVGIcons';

export default function EndpointLatencyTile({
  height = 300,
  dateRange,
  scopeWhereQuery = (where: string) => where,
}: {
  height?: number;
  dateRange: [Date, Date];
  scopeWhereQuery?: (where: string) => string;
}) {
  const [chartType, setChartType] = React.useState<'line' | 'histogram'>(
    'line',
  );

  return (
    <Card p="md">
      <Card.Section p="md" py="xs" withBorder>
        <Flex justify="space-between">
          <span>Request Latency</span>
          <Box>
            <Button.Group>
              <Button
                variant="subtle"
                color={chartType === 'line' ? 'green' : 'dark.2'}
                size="xs"
                title="Line Chart"
                onClick={() => setChartType('line')}
              >
                <i className="bi bi-graph-up" />
              </Button>

              <Button
                variant="subtle"
                color={chartType === 'histogram' ? 'green' : 'dark.2'}
                size="xs"
                title="Histogram"
                onClick={() => setChartType('histogram')}
              >
                <Histogram width={12} color="currentColor" />
              </Button>
            </Button.Group>
          </Box>
        </Flex>
      </Card.Section>
      <Card.Section p="md" py="sm" h={height}>
        {chartType === 'line' ? (
          <HDXMultiSeriesLineChart
            config={{
              dateRange,
              granularity: convertDateRangeToGranularityString(dateRange, 60),
              series: [
                {
                  displayName: '95th Percentile',
                  table: 'logs',
                  type: 'time',
                  aggFn: 'p95',
                  field: 'duration',
                  where: scopeWhereQuery('span.kind:"server"'),
                  groupBy: [],
                  numberFormat: MS_NUMBER_FORMAT,
                },
                {
                  displayName: 'Median',
                  table: 'logs',
                  type: 'time',
                  aggFn: 'p50',
                  field: 'duration',
                  where: scopeWhereQuery('span.kind:"server"'),
                  groupBy: [],
                },
                {
                  displayName: 'Average',
                  table: 'logs',
                  type: 'time',
                  aggFn: 'avg',
                  field: 'duration',
                  where: scopeWhereQuery('span.kind:"server"'),
                  groupBy: [],
                },
              ],
              seriesReturnType: 'column',
            }}
          />
        ) : (
          <HDXHistogramChart
            config={{
              table: 'logs',
              field: 'duration',
              where: scopeWhereQuery('span.kind:"server"'),
              dateRange,
            }}
          />
        )}
      </Card.Section>
    </Card>
  );
}
