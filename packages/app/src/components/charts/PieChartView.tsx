import { memo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Box, Flex, ScrollArea, Text } from '@mantine/core';

import type { NumberFormat } from '@/types';
import { formatNumber, truncateMiddle } from '@/utils';

import { ChartTooltipContainer, ChartTooltipItem } from './ChartTooltip';

export type CategoricalChartDatum = {
  label: string;
  value: number;
  color: string;
};

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
    data: CategoricalChartDatum[];
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

export function PieChartView({
  data,
  numberFormat,
  minimal = false,
  className,
  'data-testid': testId,
}: {
  data: CategoricalChartDatum[];
  numberFormat?: NumberFormat;
  /** Drops the legend and tooltip, for thumbnail-sized previews. */
  minimal?: boolean;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <Flex
      data-testid={testId}
      align="center"
      justify="center"
      h="100%"
      style={{ flexGrow: 1, overflow: 'hidden' }}
      className={className}
    >
      <ResponsiveContainer height="100%" width="100%">
        <PieChart>
          <Pie
            cx="50%"
            cy="50%"
            data={data}
            dataKey="value"
            fill="#8884d8"
            nameKey="label"
            isAnimationActive={!minimal}
          >
            {data.map(entry => (
              <Cell key={entry.label} fill={entry.color} stroke="none" />
            ))}
          </Pie>
          {!minimal && (
            <Tooltip
              content={<PieChartTooltip numberFormat={numberFormat} />}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
      {!minimal && <PieChartLegend data={data} numberFormat={numberFormat} />}
    </Flex>
  );
}
