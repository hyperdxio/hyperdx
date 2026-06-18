import { useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import {
  Area,
  AreaChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  YAxis,
} from 'recharts';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  BackgroundChart,
  ChartConfigWithDateRange,
  ChartPaletteToken,
  DisplayType,
  resolveChartPaletteToken,
} from '@hyperdx/common-utils/dist/types';

import {
  convertToTimeChartConfig,
  formatResponseForTimeChart,
  shouldFillNullsWithZero,
  useTimeChartSettings,
} from '@/ChartUtils';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useSource } from '@/source';
import { getColorFromCSSToken } from '@/utils';

// Trend hue used when neither the background override nor the tile's static
// `color` is set, so a sparkline is always visible once enabled.
const DEFAULT_BACKGROUND_TOKEN: ChartPaletteToken = 'chart-blue';

// The sparkline sits behind the value, so it is intentionally low-contrast:
// a translucent stroke with a fainter area fill.
const STROKE_OPACITY = 0.5;
const STROKE_WIDTH = 2;
const AREA_FILL_OPACITY = 0.15;

// `y` is the plotted value; `x` (bucket timestamp, seconds) is retained for
// ordering and future axis use. With no `<XAxis>`, recharts spaces points by
// array order, which is already sorted by bucket.
const VALUE_KEY = 'y';

type SparklinePoint = { x: number; y: number };

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
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(y)) {
      points.push({ x, y });
    }
  }
  return points;
}

function NumberTileBackgroundChartInner({
  config,
  backgroundChart,
}: {
  config: ChartConfigWithDateRange;
  backgroundChart: BackgroundChart;
}) {
  // Number tiles strip granularity / group-by (`convertToNumberChartConfig`),
  // collapsing the query to a single value. Request a line series at the
  // tile's granularity (auto when unset) to recover the temporal trend.
  const timeConfig = useMemo<ChartConfigWithDateRange>(
    () => ({
      ...config,
      displayType: DisplayType.Line,
      granularity: config.granularity ?? 'auto',
    }),
    [config],
  );

  const { dateRange, granularity, fillNulls } =
    useTimeChartSettings(timeConfig);
  const queriedConfig = useMemo(
    () => convertToTimeChartConfig(timeConfig),
    [timeConfig],
  );

  const { data } = useQueriedChartConfig(queriedConfig, {
    placeholderData: prev => prev,
    queryKey: ['number-tile-background', queriedConfig],
  });

  const { data: source } = useSource({ id: config.source });

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

  const margin = { top: 4, right: 0, bottom: 0, left: 0 };

  // Optional reference line (e.g. a 0 budget line, an SLA, or a target).
  // A hidden YAxis gives recharts a value scale to position it on, and
  // `ifOverflow="extendDomain"` keeps the line visible when the value sits
  // outside the data range. Both are direct chart children (recharts does not
  // see them through a fragment), reused across the area / line branches.
  const refLine = backgroundChart.referenceLine;
  const refColor = refLine
    ? getColorFromCSSToken(refLine.color ?? 'chart-warning')
    : undefined;
  const yAxisEl = refLine ? <YAxis hide domain={['auto', 'auto']} /> : null;
  const refLineEl = refLine ? (
    <ReferenceLine
      y={refLine.value}
      stroke={refColor}
      strokeOpacity={STROKE_OPACITY}
      strokeDasharray="4 3"
      ifOverflow="extendDomain"
      label={
        refLine.label
          ? {
              value: refLine.label,
              position: 'insideTopRight',
              fontSize: 10,
              fill: refColor,
            }
          : undefined
      }
    />
  ) : null;

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
      <ResponsiveContainer width="100%" height="100%">
        {backgroundChart.type === 'area' ? (
          <AreaChart data={points} margin={margin}>
            {yAxisEl}
            {refLineEl}
            <Area
              type="monotone"
              dataKey={VALUE_KEY}
              stroke={color}
              strokeOpacity={STROKE_OPACITY}
              strokeWidth={STROKE_WIDTH}
              fill={color}
              fillOpacity={AREA_FILL_OPACITY}
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        ) : (
          <LineChart data={points} margin={margin}>
            {yAxisEl}
            {refLineEl}
            <Line
              type="monotone"
              dataKey={VALUE_KEY}
              stroke={color}
              strokeOpacity={STROKE_OPACITY}
              strokeWidth={STROKE_WIDTH}
              isAnimationActive={false}
              dot={false}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Faint line / area sparkline drawn behind a number tile's value. Returns
 * null for non-builder configs (raw SQL number tiles have no structured time
 * dimension to bucket) and wraps the renderer in an error boundary so a
 * sparkline failure never blanks the tile's value.
 */
export default function NumberTileBackgroundChart({
  config,
  backgroundChart,
}: {
  config: ChartConfigWithDateRange;
  backgroundChart: BackgroundChart;
}) {
  if (!isBuilderChartConfig(config)) return null;
  return (
    <ErrorBoundary fallback={<span />}>
      <NumberTileBackgroundChartInner
        config={config}
        backgroundChart={backgroundChart}
      />
    </ErrorBoundary>
  );
}
