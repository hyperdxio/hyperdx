import { type ReactNode, useMemo } from 'react';
import {
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
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
import { getMinGranularitySeconds } from '@/hooks/useChartConfig';
import {
  type LocalChartKind,
  useLocalChartQuery,
  useTimeChartQuery,
} from '@/hooks/useLocalChartQuery';
import { useSource } from '@/source';
import { ChartQueryResult } from '@/types';
import { formatNumber, getColorProps } from '@/utils';

import {
  BarThumbnail,
  COMPACT_NUMBER,
  NumberThumbnail,
  PieThumbnail,
  TableThumbnail,
  TimeSeriesThumbnail,
} from './ChartTypeThumbnails';

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

function useCategoricalPreview(config: ChartConfigWithDateRange) {
  const data = useLocalPreview(config, 'categorical');
  return useMemo(() => {
    if (!data) return [];
    try {
      return formatResponseForCategoricalChart(
        data,
        getColorProps,
        !(isBuilderChartConfig(config) && hasNonEmptyOrderBy(config.orderBy)),
      );
    } catch {
      return [];
    }
  }, [data, config]);
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

  const chart = useMemo(() => {
    if (!data?.isComplete) return undefined;
    try {
      const { graphResults, timestampColumn, lineData } =
        formatResponseForTimeChart({
          currentPeriodResponse: data,
          dateRange,
          granularity,
          generateEmptyBuckets: shouldFillNullsWithZero(fillNulls),
          source,
          maxSeries: MAX_LINES,
        });
      if (graphResults.length < 2) return undefined;
      return {
        graphResults,
        lineData: lineData.slice(0, MAX_LINES),
        timestampKey: timestampColumn?.name,
      };
    } catch {
      return undefined;
    }
  }, [data, dateRange, granularity, fillNulls, source]);

  if (!chart) return fallback;

  return (
    <TimeSeriesThumbnail
      {...chart}
      dateRange={dateRange}
      granularity={granularity}
    />
  );
}

export function TablePreview({ config, fallback }: ChartTypePreviewProps) {
  const data = useLocalPreview(config, 'table');
  const table = useMemo(() => {
    const rows = data?.data.slice(0, MAX_TABLE_ROWS) ?? [];
    if (!data?.meta || rows.length === 0) return undefined;
    const numeric = new Set(
      filterColumnMetaByType(data.meta, [JSDataType.Number])?.map(c => c.name),
    );
    const columns = data.meta.map(({ name }) => ({
      id: name,
      dataKey: name,
      displayName: name,
      numberFormat: numeric.has(name) ? COMPACT_NUMBER : undefined,
    }));
    return { rows, columns };
  }, [data]);

  if (!table) return fallback;

  return <TableThumbnail rows={table.rows} columns={table.columns} />;
}

export function NumberPreview({ config, fallback }: ChartTypePreviewProps) {
  const data = useLocalPreview(config, 'number');
  const column = data?.meta?.[0]?.name;
  const value = column != null ? Number(data?.data[0]?.[column]) : Number.NaN;
  if (!Number.isFinite(value)) return fallback;

  return <NumberThumbnail value={formatNumber(value, COMPACT_NUMBER)} />;
}

export function BarPreview({ config, fallback }: ChartTypePreviewProps) {
  const categories = useCategoricalPreview(config);
  const bars = useMemo(() => categories.slice(0, MAX_BARS), [categories]);
  if (!bars.some(bar => bar.value > 0)) return fallback;

  return <BarThumbnail data={bars} />;
}

export function PiePreview({ config, fallback }: ChartTypePreviewProps) {
  const categories = useCategoricalPreview(config);
  const slices = useMemo(
    () => categories.filter(slice => slice.value > 0),
    [categories],
  );
  if (slices.length === 0) return fallback;

  return <PieThumbnail data={slices} />;
}
