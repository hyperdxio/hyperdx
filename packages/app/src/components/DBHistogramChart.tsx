import { useMemo, useRef } from 'react';
import Link from 'next/link';
import { useHotkeys } from 'react-hotkeys-hook';
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CategoricalChartState } from 'recharts/types/chart/types';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { Box, Code, Text } from '@mantine/core';

import { buildMVDateRangeIndicator } from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSource } from '@/source';
import { omit } from '@/utils';

import ChartContainer from './charts/ChartContainer';
import MVOptimizationIndicator from './MaterializedViews/MVOptimizationIndicator';
import { SQLPreview } from './ChartSQLPreview';

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

  const barChartRef = useRef<any>(null);
  const activeBar = useRef<CategoricalChartState | undefined>(undefined);

  useHotkeys(['esc'], () => {
    activeBar.current = undefined;
  });

  // Complete hack
  // See: https://github.com/recharts/recharts/issues/1231#issuecomment-1237958802
  const setChartActive = (payload: {
    activeCoordinate?: { x: number; y: number };
    activeLabel: any;
    activePayload?: any[];
  }) => {
    if (barChartRef.current == null) return;

    if (activeBar.current == null) {
      // @ts-ignore
      return barChartRef.current.setState({
        isTooltipActive: false,
      });
    }

    // @ts-ignore
    barChartRef.current.setState({
      isTooltipActive: true,
      activeCoordinate: payload.activeCoordinate,
      activeLabel: payload.activeLabel,
      activePayload: payload.activePayload,
    });
  };

  return (
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart
        width={500}
        height={300}
        data={data}
        className="user-select-none cursor-crosshair"
        ref={barChartRef}
        onMouseMove={() => {
          if (activeBar.current == null) return;

          setChartActive({
            activeCoordinate: activeBar.current.activeCoordinate,
            activeLabel: activeBar.current.activeLabel,
            activePayload: activeBar.current.activePayload,
          });
        }}
        onMouseLeave={() => {
          activeBar.current = undefined;
        }}
        onClick={click => {
          activeBar.current = click;

          if (click != null) {
            setChartActive({
              activeCoordinate: activeBar.current.activeCoordinate,
              activeLabel: activeBar.current.activeLabel,
              activePayload: activeBar.current.activePayload,
            });
          }
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
          content={
            <HDXHistogramChartTooltip generateSearchUrl={generateSearchUrl} />
          }
          active
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
  onSettled,
  queryKeyPrefix,
  enabled,
  title,
  toolbarPrefix,
  toolbarSuffix,
  showMVOptimizationIndicator = true,
}: {
  config: ChartConfigWithDateRange;
  onSettled?: () => void;
  queryKeyPrefix?: string;
  enabled?: boolean;
  title?: React.ReactNode;
  toolbarPrefix?: React.ReactNode[];
  toolbarSuffix?: React.ReactNode[];
  showMVOptimizationIndicator?: boolean;
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
        <div className="h-100 w-100 align-items-center justify-content-center text-muted">
          <Text ta="center" size="sm" mt="sm">
            Error loading chart, please check your query or try again later.
          </Text>
          <Box mt="sm">
            <Text my="sm" size="sm" ta="center">
              Error Message:
            </Text>
            <Code
              block
              style={{
                whiteSpace: 'pre-wrap',
              }}
            >
              {error.message}
            </Code>
            {error instanceof ClickHouseQueryError && (
              <>
                <Text my="sm" size="sm" ta="center">
                  Sent Query:
                </Text>
                <SQLPreview data={error?.query} />
              </>
            )}
          </Box>
        </div>
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
