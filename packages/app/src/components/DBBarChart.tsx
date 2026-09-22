import { memo } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Flex } from '@mantine/core';

import type { NumberFormat } from '@/types';
import { useContentFontSize } from '@/useUserPreferences';
import { formatNumber } from '@/utils';

import {
  CategoricalChartProps,
  useCategoricalChart,
} from './charts/CategoricalChart';
import ChartContainer from './charts/ChartContainer';
import ChartErrorState from './charts/ChartErrorState';
import { ChartTooltipContainer, ChartTooltipItem } from './charts/ChartTooltip';

const MAX_BAR_LABEL_LENGTH = 14;
const BAR_LABEL_AXIS_HEIGHT = 80; // increased height to accommodate rotated + truncated labels
const Y_AXIS_WIDTH = 40;

const truncateBarLabel = (value: string) =>
  value.length > MAX_BAR_LABEL_LENGTH
    ? `${value.slice(0, MAX_BAR_LABEL_LENGTH - 1)}…`
    : value;

const BarChartTooltip = memo(
  ({
    active,
    payload,
    numberFormat,
  }: {
    active?: boolean;
    payload?: {
      value: number;
      payload: { label: string; color: string };
    }[];
    numberFormat?: NumberFormat;
  }) => {
    if (!active || !payload?.length) return null;
    const entry = payload[0];
    return (
      <ChartTooltipContainer>
        <ChartTooltipItem
          color={entry.payload.color}
          name={entry.payload.label}
          value={entry.value}
          numberFormat={numberFormat}
          indicator="none"
        />
      </ChartTooltipContainer>
    );
  },
);

export const DBBarChart = (props: CategoricalChartProps) => {
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
  // Both axis allocations are character budgets at the default tick font, so
  // they scale with it rather than clipping the labels.
  const { base: axisTickFontSize, scale: contentFontScale } =
    useContentFontSize();
  const barLabelAxisHeight = Math.round(
    BAR_LABEL_AXIS_HEIGHT * contentFontScale,
  );
  const yAxisWidth = Math.round(Y_AXIS_WIDTH * contentFontScale);

  return (
    <ChartContainer title={props.title} toolbarItems={toolbarItems}>
      {isLoading && !data ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          Loading Chart Data...
        </div>
      ) : isError && error ? (
        <ChartErrorState error={error} variant={props.errorVariant} />
      ) : responseFormatError ? (
        <ChartErrorState
          error={responseFormatError}
          variant={props.errorVariant}
        />
      ) : data?.data.length === 0 ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          No data found within time range.
        </div>
      ) : (
        <Flex
          data-testid="bar-chart-container"
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
            <BarChart data={chartData}>
              <XAxis
                dataKey="label"
                interval={0}
                angle={-45}
                textAnchor="end"
                height={barLabelAxisHeight}
                tickFormatter={truncateBarLabel}
                tick={{
                  fontSize: axisTickFontSize,
                  fontFamily: 'IBM Plex Mono, monospace',
                }}
              />
              <YAxis
                width={yAxisWidth}
                minTickGap={25}
                tickFormatter={(value: number) =>
                  resolvedNumberFormat
                    ? formatNumber(value, resolvedNumberFormat)
                    : new Intl.NumberFormat('en-US', {
                        notation: 'compact',
                        compactDisplay: 'short',
                      }).format(value)
                }
                tick={{
                  fontSize: axisTickFontSize,
                  fontFamily: 'IBM Plex Mono, monospace',
                }}
              />
              <Bar dataKey="value">
                {chartData.map(entry => (
                  <Cell key={entry.label} fill={entry.color} stroke="none" />
                ))}
              </Bar>
              <Tooltip
                content={
                  <BarChartTooltip numberFormat={resolvedNumberFormat} />
                }
                cursor={{ fill: 'transparent' }}
              />
            </BarChart>
          </ResponsiveContainer>
        </Flex>
      )}
    </ChartContainer>
  );
};
