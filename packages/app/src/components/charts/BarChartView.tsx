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

import { ChartTooltipContainer, ChartTooltipItem } from './ChartTooltip';
import type { CategoricalChartDatum } from './PieChartView';

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

export function BarChartView({
  data,
  numberFormat,
  minimal = false,
  className,
  'data-testid': testId,
}: {
  data: CategoricalChartDatum[];
  numberFormat?: NumberFormat;
  /** Drops the axes and tooltip, for thumbnail-sized previews. */
  minimal?: boolean;
  /** Applied to the chart itself, e.g. `effect-pulse` while refreshing. */
  className?: string;
  'data-testid'?: string;
}) {
  // Both axis allocations are character budgets at the default tick font, so
  // they scale with it rather than clipping the labels.
  const { base: axisTickFontSize, scale: contentFontScale } =
    useContentFontSize();
  const barLabelAxisHeight = Math.round(
    BAR_LABEL_AXIS_HEIGHT * contentFontScale,
  );
  const yAxisWidth = Math.round(Y_AXIS_WIDTH * contentFontScale);

  return (
    <Flex
      data-testid={testId}
      align="center"
      justify="center"
      h="100%"
      style={{ flexGrow: 1, overflow: 'hidden' }}
    >
      <ResponsiveContainer height="100%" width="100%" className={className}>
        <BarChart data={data}>
          <XAxis
            hide={minimal}
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
            hide={minimal}
            width={yAxisWidth}
            minTickGap={25}
            tickFormatter={(value: number) =>
              numberFormat
                ? formatNumber(value, numberFormat)
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
          <Bar dataKey="value" isAnimationActive={!minimal}>
            {data.map(entry => (
              <Cell key={entry.label} fill={entry.color} stroke="none" />
            ))}
          </Bar>
          {!minimal && (
            <Tooltip
              content={<BarChartTooltip numberFormat={numberFormat} />}
              cursor={{ fill: 'transparent' }}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </Flex>
  );
}
