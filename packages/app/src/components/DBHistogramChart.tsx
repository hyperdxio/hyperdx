import { memo, useEffect, useMemo, useState } from 'react';
import { omit } from 'lodash';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Text } from '@mantine/core';

import { buildMVDateRangeIndicator, INTEGER_NUMBER_FORMAT } from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSource } from '@/source';
import { getColorFromCSSToken } from '@/utils';

import ChartContainer from './charts/ChartContainer';
import ChartErrorState, {
  ChartErrorStateVariant,
} from './charts/ChartErrorState';
import { ChartTooltipContainer, ChartTooltipItem } from './charts/ChartTooltip';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';

/** First categorical series hue (`chart-blue`). Exported for unit tests. */
export const HISTOGRAM_BAR_COLOR = getColorFromCSSToken('chart-blue');

/**
 * Normalize a chart click's `activeIndex` to a real, in-range bar index.
 * Returns the integer index for a number or non-empty numeric string, or
 * `undefined` for anything that resolves to no bar (null/''/negative/
 * fractional/NaN) so the caller can clear the pin instead of pinning bar 0.
 * Exported for unit testing.
 */
export function resolvePinnedBarIndex(
  raw: number | string | null | undefined,
): number | undefined {
  const idx =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : NaN;
  return Number.isInteger(idx) && idx >= 0 ? idx : undefined;
}

function HistogramChart({ graphResults }: { graphResults: any[] }) {
  const data = useMemo(() => {
    return (
      graphResults?.map((result: any) => {
        return {
          lower: result[0],
          upper: result[1],
          height: result[2],
        };
      }) ?? []
    );
  }, [graphResults]);

  // Index of the bar whose tooltip is "pinned" open by a click. When set, the
  // tooltip is forced active on that bar via the controlled `active` +
  // `defaultIndex` props below; `undefined` lets the tooltip follow hover.
  const [pinnedIndex, setPinnedIndex] = useState<number | undefined>(undefined);

  useHotkeys(['esc'], () => {
    setPinnedIndex(undefined);
  });

  // The pin is a positional index, so clear it whenever the buckets change
  // (e.g. a background refetch) — otherwise the pin would silently repoint to
  // whatever bucket now occupies that index and show the wrong time range.
  useEffect(() => {
    setPinnedIndex(undefined);
  }, [data]);

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart
        width={500}
        height={300}
        data={data}
        className="user-select-none cursor-crosshair"
        onClick={state => {
          // Toggle the pinned tooltip on the clicked bar (click the same bar
          // again to unpin). A click that resolves to no bar clears the pin.
          const idx = resolvePinnedBarIndex(state?.activeIndex);
          if (idx == null) {
            setPinnedIndex(undefined);
            return;
          }
          setPinnedIndex(prev => (prev === idx ? undefined : idx));
        }}
      >
        <XAxis
          dataKey={'lower'}
          domain={
            data.length > 1
              ? [data[0].lower, data[data.length - 1].upper]
              : undefined
          }
          interval="preserveStartEnd"
          type="category"
          tickFormatter={(value: number) =>
            new Intl.NumberFormat('en-US', {
              notation: 'compact',
              compactDisplay: 'short',
            }).format(value)
          }
          // minTickGap={50}
          tick={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}
        />
        <YAxis
          width={35}
          minTickGap={25}
          tickFormatter={(value: number) =>
            new Intl.NumberFormat('en-US', {
              notation: 'compact',
              compactDisplay: 'short',
            }).format(value)
          }
          tick={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace' }}
        />
        <Tooltip
          // Remount when the pinned bar changes so `defaultIndex` re-seeds on a
          // fresh instance rather than relying on it being reactive after mount.
          key={pinnedIndex ?? 'hover'}
          content={<HistogramChartTooltip />}
          // When a bar is pinned, lock the tooltip to that bar: `trigger:
          // 'click'` makes the tooltip ignore hover (which would otherwise let
          // the tooltip drift to whatever bar the cursor grazes), and
          // `defaultIndex` fixes it on the pinned bar. When nothing is pinned,
          // Recharts controls the tooltip on hover as usual.
          {...(pinnedIndex != null
            ? { active: true, defaultIndex: pinnedIndex, trigger: 'click' }
            : {})}
        />
        <Bar dataKey="height" stackId="a" fill={HISTOGRAM_BAR_COLOR} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export const HistogramChartTooltip = memo(
  ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: {
      name?: string;
      value: number;
      color?: string;
      payload: { lower: number; upper: number; height: number };
    }[];
  }) => {
    if (!active || !payload?.length) {
      return null;
    }

    const bucket = payload[0].payload;
    const lower = bucket.lower.toFixed(5);
    const upper = bucket.upper.toFixed(5);

    return (
      <ChartTooltipContainer
        header={
          <span>
            Bucket: {lower} - {upper}
          </span>
        }
        footer={
          <Text size="xs" c="dimmed">
            Click to pin tooltip • Approx value via SPDT algorithm
          </Text>
        }
      >
        {payload.map((p, index) => (
          <ChartTooltipItem
            key={p.name ?? index}
            color={p.color ?? HISTOGRAM_BAR_COLOR}
            name="Number of events"
            value={p.value}
            numberFormat={INTEGER_NUMBER_FORMAT}
            indicator="square"
          />
        ))}
      </ChartTooltipContainer>
    );
  },
);

export default function DBHistogramChart({
  config,
  queryKeyPrefix,
  enabled,
  title,
  toolbarPrefix,
  toolbarSuffix,
  showMVOptimizationIndicator = true,
  errorVariant,
}: {
  config: BuilderChartConfigWithDateRange;
  queryKeyPrefix?: string;
  enabled?: boolean;
  title?: React.ReactNode;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
  showMVOptimizationIndicator?: boolean;
  errorVariant?: ChartErrorStateVariant;
}) {
  const queriedConfig = omit(config, ['granularity']);
  const { data, isLoading, isError, error } = useQueriedChartConfig(
    queriedConfig,
    {
      placeholderData: (prev: any) => prev,
      queryKey: [queryKeyPrefix, queriedConfig],
      enabled,
    },
  );

  const { data: mvOptimizationData } =
    useMVOptimizationExplanation(queriedConfig);

  // Don't ask me why...
  const buckets = data?.data?.[0]?.data;

  const { data: source } = useSource({ id: config.source });

  const toolbarItemsMemo = useMemo(() => {
    const allToolbarItems = [];

    if (toolbarPrefix && toolbarPrefix.length > 0) {
      allToolbarItems.push(...toolbarPrefix);
    }

    if (source && showMVOptimizationIndicator) {
      allToolbarItems.push(
        <MVOptimizationIndicator
          key="db-histogram-chart-mv-indicator"
          config={queriedConfig}
          source={source}
          variant="icon"
        />,
      );
    }

    const dateRangeIndicator = buildMVDateRangeIndicator({
      mvOptimizationData,
      originalDateRange: queriedConfig.dateRange,
    });

    if (dateRangeIndicator) {
      allToolbarItems.push(dateRangeIndicator);
    }

    if (toolbarSuffix && toolbarSuffix.length > 0) {
      allToolbarItems.push(...toolbarSuffix);
    }

    return allToolbarItems;
  }, [
    queriedConfig,
    toolbarPrefix,
    toolbarSuffix,
    source,
    showMVOptimizationIndicator,
    mvOptimizationData,
  ]);

  return (
    <ChartContainer title={title} toolbarItems={toolbarItemsMemo}>
      {isLoading ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          Loading Chart Data...
        </div>
      ) : isError ? (
        <ChartErrorState error={error} variant={errorVariant} />
      ) : data?.data.length === 0 ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          No data found within time range.
        </div>
      ) : (
        <HistogramChart graphResults={buckets} />
      )}
    </ChartContainer>
  );
}
