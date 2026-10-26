import { type ReactNode, useMemo } from 'react';
import { hasNonEmptyOrderBy } from '@hyperdx/common-utils/dist/core/utils';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';

import {
  convertToSharedTimeChartConfig,
  formatResponseForCategoricalChart,
  formatResponseForTimeChart,
  shouldFillNullsWithZero,
  useTimeChartSettings,
} from '@/ChartUtils';
import { sparklinePointsFromGraphResults } from '@/components/NumberTileBackgroundChart';
import { getMinGranularitySeconds } from '@/hooks/useChartConfig';
import {
  type LocalChartKind,
  useLocalChartQuery,
  useTimeChartQuery,
} from '@/hooks/useLocalChartQuery';
import { useSource } from '@/source';
import { ChartQueryResult } from '@/types';
import { getColorProps } from '@/utils';

import classes from './ChartTypeSelector.module.scss';

// The previews draw the tile's own result once the time chart query behind it
// is cached, re-aggregated in chdb. They never query ClickHouse, and show the
// static `fallback` until there is something to draw.
export type ChartTypePreviewProps = {
  config: ChartConfigWithDateRange;
  fallback: ReactNode;
};

const MAX_LINES = 3;
const MAX_BARS = 8;
const MAX_TABLE_ROWS = 3;

const compactNumber = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

function formatValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? compactNumber.format(number) : '';
}

function useLocalPreview(
  config: ChartConfigWithDateRange,
  kind: LocalChartKind,
): ChartQueryResult | undefined {
  const { active, data } = useLocalChartQuery(config, {
    kind,
    // As the charts themselves pass it, so a preview shares their transform
    orderBy:
      kind !== 'number' && isBuilderChartConfig(config)
        ? config.orderBy
        : undefined,
    cacheOnly: true,
  });
  return active ? data : undefined;
}

function useCategoricalPreview(
  config: ChartConfigWithDateRange,
  kind: LocalChartKind,
) {
  const data = useLocalPreview(config, kind);
  return useMemo(() => {
    if (!data) return [];
    try {
      // A table keeps its own row order, as do charts with an ORDER BY
      const keepOrder =
        kind === 'table' ||
        (isBuilderChartConfig(config) && hasNonEmptyOrderBy(config.orderBy));
      return formatResponseForCategoricalChart(data, getColorProps, !keepOrder);
    } catch {
      return [];
    }
  }, [data, kind, config]);
}

export function TimeSeriesPreview({ config, fallback }: ChartTypePreviewProps) {
  const { data: source } = useSource({ id: config.source });
  const timeConfig = useMemo(
    () =>
      convertToSharedTimeChartConfig({
        ...config,
        minGranularitySeconds: getMinGranularitySeconds(source),
      }),
    [config, source],
  );
  const { dateRange, granularity, fillNulls } =
    useTimeChartSettings(timeConfig);
  const { data } = useTimeChartQuery(timeConfig, { enabled: false });

  const lines = useMemo(() => {
    if (!data?.isComplete) return [];
    try {
      const { graphResults, timestampColumn, lineData } =
        formatResponseForTimeChart({
          currentPeriodResponse: data,
          dateRange,
          granularity,
          generateEmptyBuckets: shouldFillNullsWithZero(fillNulls),
          source,
        });
      return lineData.slice(0, MAX_LINES).map(line => ({
        key: line.dataKey,
        color: line.color,
        points: sparklinePointsFromGraphResults(
          graphResults,
          timestampColumn?.name,
          line.dataKey,
        ),
      }));
    } catch {
      return [];
    }
  }, [data, dateRange, granularity, fillNulls, source]);

  const all = lines.flatMap(line => line.points);
  if (all.length < 2) return fallback;

  const minX = Math.min(...all.map(p => p.x));
  const spanX = Math.max(...all.map(p => p.x)) - minX || 1;
  const minY = Math.min(0, ...all.map(p => p.y));
  const spanY = Math.max(...all.map(p => p.y)) - minY || 1;

  return (
    <svg
      className={classes.timeSeries}
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
    >
      {lines.map(line => (
        <polyline
          key={line.key}
          points={line.points
            .map(
              p =>
                `${((p.x - minX) / spanX) * 100},${38 - ((p.y - minY) / spanY) * 36}`,
            )
            .join(' ')}
          stroke={line.color}
        />
      ))}
    </svg>
  );
}

export function TablePreview({ config, fallback }: ChartTypePreviewProps) {
  const rows = useCategoricalPreview(config, 'table').slice(0, MAX_TABLE_ROWS);
  if (rows.length === 0) return fallback;

  return (
    <div className={classes.miniTable}>
      {rows.map(({ label, value }) => (
        <div key={label} className={classes.miniTableRow}>
          <span className={classes.miniTableLabel}>{label}</span>
          <span>{formatValue(value)}</span>
        </div>
      ))}
    </div>
  );
}

export function NumberPreview({ config, fallback }: ChartTypePreviewProps) {
  const data = useLocalPreview(config, 'number');
  const column = data?.meta?.[0]?.name;
  const value = column != null ? formatValue(data?.data[0]?.[column]) : '';
  if (!value) return fallback;

  return <div className={classes.number}>{value}</div>;
}

export function BarPreview({ config, fallback }: ChartTypePreviewProps) {
  const bars = useCategoricalPreview(config, 'categorical').slice(0, MAX_BARS);
  const max = Math.max(...bars.map(bar => bar.value));
  if (bars.length === 0 || !(max > 0)) return fallback;

  return (
    <div className={classes.bars}>
      {bars.map(bar => (
        <div
          key={bar.label}
          className={classes.bar}
          style={{
            height: Math.max((bar.value / max) * 48, 2),
            backgroundColor: bar.color,
          }}
        />
      ))}
    </div>
  );
}

export function PiePreview({ config, fallback }: ChartTypePreviewProps) {
  const slices = useCategoricalPreview(config, 'categorical').filter(
    slice => slice.value > 0,
  );
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (!(total > 0)) return fallback;

  const stops: string[] = [];
  let start = 0;
  for (const slice of slices) {
    const end = start + (slice.value / total) * 360;
    stops.push(`${slice.color} ${start}deg ${end}deg`);
    start = end;
  }

  return (
    <div
      className={classes.pie}
      style={{ background: `conic-gradient(${stops.join(', ')})` }}
    />
  );
}
