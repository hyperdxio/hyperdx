import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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

import { buildMVDateRangeIndicator } from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSource } from '@/source';

import ChartContainer from './charts/ChartContainer';
import ChartErrorState, {
  ChartErrorStateVariant,
} from './charts/ChartErrorState';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';

function HistogramChart({
  graphResults,
  generateSearchUrl,
}: {
  graphResults: any[];
  generateSearchUrl?: (lower: string, upper: string) => string;
}) {
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
          // again to unpin). Coerce activeIndex to a number and ignore NaN so a
          // click that resolves to no bar never leaves a stuck pin.
          const raw = state?.activeIndex;
          const idx = typeof raw === 'number' ? raw : Number(raw);
          if (!Number.isInteger(idx)) {
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
          content={
            <HDXHistogramChartTooltip generateSearchUrl={generateSearchUrl} />
          }
          // When a bar is pinned, lock the tooltip to that bar: `trigger:
          // 'click'` makes the tooltip ignore hover (which would otherwise let
          // the tooltip drift to whatever bar the cursor grazes), and
          // `defaultIndex` fixes it on the pinned bar. When nothing is pinned,
          // Recharts controls the tooltip on hover as usual.
          {...(pinnedIndex != null
            ? { active: true, defaultIndex: pinnedIndex, trigger: 'click' }
            : {})}
        />
        <Bar dataKey="height" stackId="a" fill="#50FA7B" />
      </BarChart>
    </ResponsiveContainer>
  );
}

const HDXHistogramChartTooltip = (props: any) => {
  const { active, payload, generateSearchUrl } = props;
  if (active && payload && payload.length > 0) {
    const bucket = props.payload[0].payload;

    const lower = bucket.lower.toFixed(5);
    const upper = bucket.upper.toFixed(5);

    return (
      <div
        className="bg-muted px-3 py-2 rounded fs-8"
        style={{ pointerEvents: 'auto' }}
      >
        <div className="mb-2">
          Bucket: {lower} - {upper}
        </div>
        {payload.map((p: any) => (
          <div key={p.name} style={{ color: p.color }}>
            Number of Events: {p.value}
          </div>
        ))}
        <div className="mt-2">
          {generateSearchUrl && (
            <Link
              href={generateSearchUrl(lower, upper)}
              className="text-muted-hover cursor-pointer"
              onClick={e => e.stopPropagation()}
            >
              View Events
            </Link>
          )}
        </div>
        <div className="text-muted fs-9 mt-2">
          Click to Pin Tooltip • Approx value via SPDT algorithm
        </div>
      </div>
    );
  }
  return null;
};

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
