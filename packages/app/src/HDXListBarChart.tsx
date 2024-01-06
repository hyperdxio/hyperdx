import { memo } from 'react';
import { Box, Flex, Text } from '@mantine/core';

import api from './api';
import { Granularity } from './ChartUtils';
import type { ChartSeries, NumberFormat } from './types';
import { semanticKeyedColor } from './utils';

function ListItem({
  title,
  value,
  color,
  percent,
}: {
  title: string;
  value: string;
  color: string;
  percent: number;
}) {
  return (
    <Box>
      <Flex justify="space-between">
        <Text size="sm">{title}</Text>
        <Text size="sm">{value}</Text>
      </Flex>
      <Box pt="xs">
        <Box
          style={{
            width: `${percent}%`,
            height: 8,
            backgroundColor: color,
            borderRadius: 4,
          }}
        />
      </Box>
    </Box>
  );
}

const HDXListBarChart = memo(
  ({
    config: { series, seriesReturnType = 'column', dateRange },
  }: {
    config: {
      series: [ChartSeries];
      granularity: Granularity;
      dateRange: [Date, Date];
      seriesReturnType?: 'ratio' | 'column';
      numberFormat?: NumberFormat;
      groupColumnName?: string;
    };
    onSettled?: () => void;
  }) => {
    const { data, isError, isLoading } = api.useMultiSeriesChart({
      series,
      endDate: dateRange[1] ?? new Date(),
      startDate: dateRange[0] ?? new Date(),
      seriesReturnType,
    });

    const rows: undefined | any[] = data?.data;

    const values = (rows ?? []).map((row: any) => row['series_0.data']);
    const maxValue = Math.max(...values);
    const totalValue = values.reduce((a, b) => a + b, 0);

    return isLoading ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        Loading Chart Data...
      </div>
    ) : isError ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        Error loading chart, please try again or contact support.
      </div>
    ) : data?.data?.length === 0 ? (
      <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
        No data found within time range.
      </div>
    ) : (
      <Box className="overflow-auto" h="100%">
        {rows?.map((row: any) => {
          const value = row['series_0.data'];
          const percentOfMax = (value / maxValue) * 100;
          const percentOfTotal = (value / totalValue) * 100;
          const group = `${row.group}`;

          return (
            <Box mb="sm" key={group}>
              <ListItem
                title={group}
                value={`${percentOfTotal.toFixed(2)}%`}
                color={semanticKeyedColor(group)}
                percent={percentOfMax}
              />
            </Box>
          );
        })}
      </Box>
    );
  },
);

export default HDXListBarChart;
