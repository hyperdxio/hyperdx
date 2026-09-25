import { useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { isReducibleRangeQuery } from '@hyperdx/common-utils/dist/core/promql';
import {
  isBuilderChartConfig,
  isPromqlChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  BackgroundChart,
  ChartConfigWithDateRange,
  ChartPaletteToken,
  DisplayType,
  resolveChartPaletteToken,
} from '@hyperdx/common-utils/dist/types';

import {
  convertToPromqlNumberChartConfig,
  convertToTimeChartConfig,
  formatResponseForTimeChart,
  shouldFillNullsWithZero,
  useTimeChartSettings,
} from '@/ChartUtils';
import {
  getMinGranularitySeconds,
  useQueriedChartConfig,
} from '@/hooks/useChartConfig';
import { useSource } from '@/source';
import { getColorFromCSSToken } from '@/utils';

import { Sparkline, type SparklinePoint } from './Sparkline';

// Trend hue used when neither the background override nor the tile's static
// `color` is set, so a sparkline is always visible once enabled.
const DEFAULT_BACKGROUND_TOKEN: ChartPaletteToken = 'chart-blue';

/**
 * Flatten the time-chart formatter's `graphResults` into sparkline points.
 * Number tiles are single-series, so a single value series is read by key.
 * Non-finite values and missing keys are skipped. Exported for unit testing.
 */
export function sparklinePointsFromGraphResults(
  graphResults: Array<Record<string, number | undefined>>,
  timestampKey: string | undefined,
  valueKey: string | undefined,
): SparklinePoint[] {
  if (!timestampKey || !valueKey) return [];
  const points: SparklinePoint[] = [];
  for (const row of graphResults) {
    const x = row[timestampKey];
    const y = row[valueKey];
    if (
      typeof x === 'number' &&
      Number.isFinite(x) &&
      typeof y === 'number' &&
      Number.isFinite(y)
    ) {
      points.push({ x, y });
    }
  }
  return points;
}

/**
 * Derive the sparkline's query config from the given number tile's config.
 */
export function buildSparklineQueryConfig(
  config: ChartConfigWithDateRange,
): ChartConfigWithDateRange {
  // A PromQL tile shares the same (range) query as the number chart, without a reducer.
  // This ensures that the sparkline can re-use the same react-query cache entry.
  if (isPromqlChartConfig(config)) {
    return convertToPromqlNumberChartConfig(config, { withReducer: false });
  }

  // Display-only fields are dropped to avoid refetching identical time-series
  // data on every purely visual edit.
  const {
    backgroundChart: _backgroundChart,
    color: _color,
    colorRules: _colorRules,
    numberFormat: _numberFormat,
    ...rest
  } = config;
  const timeConfig: ChartConfigWithDateRange = {
    ...rest,
    displayType: DisplayType.Line,
    granularity: config.granularity ?? 'auto',
  };
  // `groupBy` exists only on builder configs, so drop it under the guard.
  if (isBuilderChartConfig(timeConfig)) {
    delete timeConfig.groupBy;
  }
  return convertToTimeChartConfig(timeConfig);
}

function NumberTileBackgroundChartInner({
  config,
  backgroundChart,
  queryKeyPrefix,
  enabled,
}: {
  config: ChartConfigWithDateRange;
  backgroundChart: BackgroundChart;
  queryKeyPrefix?: string;
  enabled?: boolean;
}) {
  // useTimeChartSettings/convertToTimeChartConfig below resolve 'auto', so
  // the minimum has to be applied before that happens.
  const { data: source } = useSource({ id: config.source });
  const minGranularitySeconds = getMinGranularitySeconds(source);

  const queriedConfig = useMemo(
    () =>
      buildSparklineQueryConfig(
        isPromqlChartConfig(config)
          ? config
          : { ...config, minGranularitySeconds },
      ),
    [config, minGranularitySeconds],
  );

  const { dateRange, granularity, fillNulls } =
    useTimeChartSettings(queriedConfig);

  const { data } = useQueriedChartConfig(queriedConfig, {
    placeholderData: prev => prev,
    enabled,
    // A PromQL tile shares the cache entry its value is served from, so it has
    // to leave the key to the hook. A builder tile derives a query of its
    // own, and namespaces its own key.
    ...(isPromqlChartConfig(config)
      ? { queryKeyPrefix }
      : {
          queryKey: [
            ...(queryKeyPrefix ? [queryKeyPrefix] : []),
            'number-tile-background',
            queriedConfig,
          ],
        }),
  });

  const points = useMemo(() => {
    if (data == null) return [];
    try {
      const { graphResults, timestampColumn, lineData } =
        formatResponseForTimeChart({
          currentPeriodResponse: data,
          dateRange,
          granularity,
          generateEmptyBuckets: shouldFillNullsWithZero(fillNulls),
          source,
        });
      return sparklinePointsFromGraphResults(
        graphResults,
        timestampColumn?.name,
        lineData[0]?.dataKey,
      );
    } catch {
      // No timestamp / value column (e.g. a query that cannot be bucketed):
      // render nothing rather than surfacing an error behind the value.
      return [];
    }
  }, [data, dateRange, granularity, fillNulls, source]);

  // A single point has no trend to draw; wait for at least two buckets.
  if (points.length < 2) return null;

  const color = getColorFromCSSToken(
    backgroundChart.color ??
      resolveChartPaletteToken(config.color) ??
      DEFAULT_BACKGROUND_TOKEN,
  );

  return (
    <div
      aria-hidden
      data-testid="number-tile-background-chart"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <Sparkline points={points} type={backgroundChart.type} color={color} />
    </div>
  );
}

/**
 * Faint line / area sparkline drawn behind a number tile's value. Returns
 * null for configs that don't support bucketed queries. Wrapped in an
 * error boundary so a sparkline failure never blanks the tile's value.
 */
export default function NumberTileBackgroundChart({
  config,
  backgroundChart,
  queryKeyPrefix,
  enabled = true,
}: {
  config: ChartConfigWithDateRange;
  backgroundChart: BackgroundChart;
  queryKeyPrefix?: string;
  enabled?: boolean;
}) {
  const canBucketQuery =
    isBuilderChartConfig(config) ||
    (isPromqlChartConfig(config) && isReducibleRangeQuery(config));
  if (!canBucketQuery) return null;
  return (
    <ErrorBoundary fallback={<span />}>
      <NumberTileBackgroundChartInner
        config={config}
        backgroundChart={backgroundChart}
        queryKeyPrefix={queryKeyPrefix}
        enabled={enabled}
      />
    </ErrorBoundary>
  );
}
