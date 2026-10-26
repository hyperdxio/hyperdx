import { memo, useMemo } from 'react';
import { ResponsiveContainer, Tooltip, Treemap } from 'recharts';

import type { NumberFormat } from '@/types';
import { truncateMiddle } from '@/utils';

import {
  CategoricalChartProps,
  useCategoricalChart,
} from './charts/CategoricalChart';
import ChartContainer from './charts/ChartContainer';
import ChartErrorState from './charts/ChartErrorState';
import { ChartTooltipContainer, ChartTooltipItem } from './charts/ChartTooltip';

type TreemapDatum = {
  name: string;
  size: number;
  color: string;
};

const TreemapChartTooltip = memo(
  ({
    active,
    payload,
    numberFormat,
  }: {
    active?: boolean;
    payload?: { payload: TreemapDatum }[];
    numberFormat?: NumberFormat;
  }) => {
    if (!active || !payload?.length) return null;
    const datum = payload[0].payload;
    return (
      <ChartTooltipContainer>
        <ChartTooltipItem
          color={datum.color}
          name={datum.name}
          value={datum.size}
          numberFormat={numberFormat}
          indicator="none"
        />
      </ChartTooltipContainer>
    );
  },
);

// Recharts calls this for every node; it receives the geometry plus our datum
// fields (color/name/size) spread from the data array.
function TreemapCell({
  x,
  y,
  width,
  height,
  name,
  color,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  color?: string;
}) {
  if (x == null || y == null || width == null || height == null) return null;
  const showLabel = width > 48 && height > 22;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{
          fill: color ?? 'var(--mantine-color-dark-4)',
          stroke: 'var(--mantine-color-body)',
          strokeWidth: 2,
        }}
      />
      {showLabel && name ? (
        <text
          x={x + 6}
          y={y + 16}
          fill="#fff"
          fontSize={11}
          style={{ pointerEvents: 'none' }}
        >
          {truncateMiddle(name, Math.floor(width / 7))}
        </text>
      ) : null}
    </g>
  );
}

export const DBTreemapChart = (props: CategoricalChartProps) => {
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

  const treemapData = useMemo<TreemapDatum[]>(
    () =>
      chartData.map(entry => ({
        name: entry.label,
        size: entry.value,
        color: entry.color,
      })),
    [chartData],
  );

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
        <ResponsiveContainer
          height="100%"
          width="100%"
          className={isLoading ? 'effect-pulse' : ''}
        >
          <Treemap
            data={treemapData}
            dataKey="size"
            nameKey="name"
            isAnimationActive={false}
            content={<TreemapCell />}
          >
            <Tooltip
              content={
                <TreemapChartTooltip numberFormat={resolvedNumberFormat} />
              }
            />
          </Treemap>
        </ResponsiveContainer>
      )}
    </ChartContainer>
  );
};
