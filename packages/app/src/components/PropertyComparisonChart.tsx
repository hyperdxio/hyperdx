import { memo } from 'react';
import { withErrorBoundary } from 'react-error-boundary';
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Text } from '@mantine/core';

import {
  getChartColorError,
  getChartColorSuccess,
  truncateMiddle,
} from '@/utils';

import { mergeValueStatisticsMaps } from './deltaChartUtils';

import styles from '../../styles/HDXLineChart.module.scss';

// Layout constants for dynamic grid calculation.
// CHART_WIDTH is the minimum chart width used to determine how many columns fit; actual rendered
// width expands to fill the container (charts use width: '100%' inside a CSS grid).
// CHART_HEIGHT must match PropertyComparisonChart's outer div height.
// CHART_GAP is used both in the column/row formula and as the CSS grid gap.
export const CHART_WIDTH = 340; // minimum column width threshold (px)
export const CHART_HEIGHT = 120; // must match PropertyComparisonChart outer div height (px)
export const CHART_GAP = 16; // px; used in grid gap and layout math
// Space reserved for the pagination row: Pagination control (~32px) + top padding (16px).
// Always reserved (even when pagination is hidden via visibility:hidden) so rows count is stable.
export const PAGINATION_HEIGHT = 48;

const HDXBarChartTooltip = withErrorBoundary(
  memo((props: any) => {
    const { active, payload, label, title } = props;
    if (active && payload && payload.length) {
      return (
        <div className={styles.chartTooltip}>
          <div className={styles.chartTooltipContent}>
            {title && (
              <Text size="xs" mb="xs">
                {title}
              </Text>
            )}
            <Text size="xs" mb="xs">
              {label.length === 0 ? <i>Empty String</i> : label}
            </Text>
            {payload
              .sort((a: any, b: any) => b.value - a.value)
              .map((p: any) => (
                <div key={p.dataKey}>
                  {p.name}: {p.value.toFixed(2)}%
                </div>
              ))}
          </div>
        </div>
      );
    }
    return null;
  }),
  {
    onError: console.error,
    fallback: (
      <div className="text-danger px-2 py-1 m-2 fs-8 font-monospace bg-danger-transparent">
        An error occurred while rendering the tooltip.
      </div>
    ),
  },
);

export function PropertyComparisonChart({
  name,
  outlierValueOccurences,
  inlierValueOccurences,
}: {
  name: string;
  outlierValueOccurences: Map<string, number>;
  inlierValueOccurences: Map<string, number>;
}) {
  const mergedValueStatistics = mergeValueStatisticsMaps(
    outlierValueOccurences,
    inlierValueOccurences,
  );

  return (
    <div style={{ width: '100%', height: 120 }}>
      <Text size="xs" ta="center" title={name}>
        {truncateMiddle(name, 32)}
      </Text>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          barGap={2}
          width={500}
          height={300}
          data={mergedValueStatistics}
          margin={{
            top: 0,
            right: 0,
            left: 0,
            bottom: 0,
          }}
        >
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace' }}
          />
          <YAxis
            tick={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
          />
          <Tooltip
            wrapperStyle={{
              zIndex: 1000,
            }}
            content={<HDXBarChartTooltip title={name} />}
            allowEscapeViewBox={{ y: true }}
          />
          <Bar
            dataKey="outlierCount"
            name="Outliers"
            fill={getChartColorError()}
            isAnimationActive={false}
          />
          <Bar
            dataKey="inlierCount"
            name="Inliers"
            fill={getChartColorSuccess()}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
