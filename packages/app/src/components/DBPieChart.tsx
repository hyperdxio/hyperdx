import { memo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Box, Flex, ScrollArea, Text } from '@mantine/core';

import type { NumberFormat } from '@/types';
import { formatNumber, truncateMiddle } from '@/utils';

import {
  CategoricalChartProps,
  useCategoricalChart,
} from './charts/CategoricalChart';
import ChartContainer from './charts/ChartContainer';
import ChartErrorState from './charts/ChartErrorState';
import { ChartTooltipContainer, ChartTooltipItem } from './charts/ChartTooltip';

const PieChartTooltip = memo(
  ({
    active,
    payload,
    numberFormat,
  }: {
    active?: boolean;
    payload?: { name: string; value: number; payload: { color: string } }[];
    numberFormat?: NumberFormat;
  }) => {
    if (!active || !payload?.length) return null;
    const entry = payload[0];
    return (
      <ChartTooltipContainer>
        <ChartTooltipItem
          color={entry.payload.color}
          name={entry.name}
          value={entry.value}
          numberFormat={numberFormat}
          indicator="none"
        />
      </ChartTooltipContainer>
    );
  },
);

const PieChartLegend = memo(
  ({
    data,
    numberFormat,
  }: {
    data: { label: string; value: number; color: string }[];
    numberFormat?: NumberFormat;
  }) => {
    if (!data.length) return null;
    return (
      <ScrollArea
        data-testid="pie-chart-legend"
        type="auto"
        style={{ flexShrink: 0, maxWidth: '40%', alignSelf: 'stretch' }}
        px="sm"
      >
        <Flex direction="column" gap={4}>
          {data.map(entry => (
            <Flex key={entry.label} align="center" gap={6} wrap="nowrap">
              <Box
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  backgroundColor: entry.color,
                  flexShrink: 0,
                }}
              />
              <Text size="xs" c="dimmed" truncate="end" title={entry.label}>
                {truncateMiddle(entry.label, 40)}
              </Text>
              <Text
                size="xs"
                c="dimmed"
                style={{ flexShrink: 0, marginLeft: 'auto' }}
              >
                {numberFormat
                  ? formatNumber(entry.value, numberFormat)
                  : entry.value}
              </Text>
            </Flex>
          ))}
        </Flex>
      </ScrollArea>
    );
  },
);

export const DBPieChart = (props: CategoricalChartProps) => {
  const { title, errorVariant } = props;
  const {
    resolvedNumberFormat,
    toolbarItems,
    data,
    isLoading,
    isError,
    error,
    chartData,
    responseFormatError,
  } = useCategoricalChart(props);

  return (
    <ChartContainer title={title} toolbarItems={toolbarItems}>
      {isLoading && !data ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          Loading Chart Data...
        </div>
      ) : isError && error ? (
        <ChartErrorState error={error} variant={errorVariant} />
      ) : responseFormatError ? (
        <ChartErrorState error={responseFormatError} variant={errorVariant} />
      ) : data?.data.length === 0 ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          No data found within time range.
        </div>
      ) : (
        <Flex
          data-testid="pie-chart-container"
          align="center"
          justify="center"
          h="100%"
          style={{ flexGrow: 1, overflow: 'hidden' }}
        >
          <ResponsiveContainer
            height="100%"
            width="100%"
            className={isLoading ? 'effect-pulse' : ''}
          >
            <PieChart>
              <Pie
                cx="50%"
                cy="50%"
                data={chartData}
                dataKey="value"
                fill="#8884d8"
                nameKey="label"
              >
                {chartData.map(entry => (
                  <Cell key={entry.label} fill={entry.color} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                content={
                  <PieChartTooltip numberFormat={resolvedNumberFormat} />
                }
              />
            </PieChart>
          </ResponsiveContainer>
          <PieChartLegend
            data={chartData}
            numberFormat={resolvedNumberFormat}
          />
        </Flex>
      )}
    </ChartContainer>
  );
};
