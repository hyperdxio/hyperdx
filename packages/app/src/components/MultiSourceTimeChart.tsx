import { useMemo, useState } from 'react';
import {
  ColumnMetaType,
  filterColumnMetaByType,
  JSDataType,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  BuilderChartConfigWithDateRange,
  DisplayType,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { Text } from '@mantine/core';
import { keepPreviousData } from '@tanstack/react-query';

import api from '@/api';
import {
  convertToTimeChartConfig,
  formatResponseForTimeChart,
  useTimeChartSettings,
} from '@/ChartUtils';
import ChartContainer from '@/components/charts/ChartContainer';
import ChartErrorState from '@/components/charts/ChartErrorState';
import { type ActiveClickPayload, MemoChart } from '@/HDXMultiSeriesTimeChart';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import type { NumberFormat } from '@/types';

import { getMultiSourceColor } from './MultiSourceBadge';

/** Synthetic group column tagged onto each source's histogram rows. */
const SOURCE_GROUP_COLUMN = '__hdx_source';

export type MultiSourceChartSpec = {
  source: TSource;
  /** Per-source count() histogram config (canonical WHERE, no groupBy). */
  config: BuilderChartConfigWithDateRange;
};

// Placeholder for unused hook slots; never queried (enabled: false).
const STUB_CONFIG: BuilderChartConfigWithDateRange = {
  connection: '',
  from: { databaseName: '', tableName: '' },
  timestampValueExpression: '',
  select: '',
  where: '',
  whereLanguage: 'sql',
  dateRange: [new Date(0), new Date(0)],
};

function useHistogramSlot(
  spec: MultiSourceChartSpec | undefined,
  {
    enabled,
    queryKeyPrefix,
    enableParallelQueries,
    parallelizeWhenPossible,
  }: {
    enabled: boolean;
    queryKeyPrefix: string;
    enableParallelQueries?: boolean;
    parallelizeWhenPossible?: boolean;
  },
) {
  const queriedConfig = useMemo(
    () => convertToTimeChartConfig(spec?.config ?? STUB_CONFIG),
    [spec?.config],
  );

  return useQueriedChartConfig(queriedConfig, {
    // Key shape mirrors DBTimeChart/SearchTotalCountChart so TanStack can
    // de-dupe the histogram and total-count consumers of the same source.
    queryKey: [
      queryKeyPrefix,
      queriedConfig,
      'chunked',
      {
        disableQueryChunking: false,
        enableParallelQueries,
        parallelizeWhenPossible,
      },
    ],
    placeholderData: keepPreviousData,
    enableQueryChunking: true,
    enableParallelQueries: enableParallelQueries && parallelizeWhenPossible,
    enabled: enabled && spec != null,
  });
}

/**
 * Runs one count() histogram query per selected source (fixed hook slots, see
 * MAX_SEARCH_SOURCES) and merges the responses into a single response shape
 * with a synthetic source-name group column — so the standard time-chart
 * transform naturally yields one series per source.
 */
function useMultiSourceHistogram(
  specs: MultiSourceChartSpec[],
  {
    enabled = true,
    queryKeyPrefix,
    enableParallelQueries,
  }: {
    enabled?: boolean;
    queryKeyPrefix: string;
    enableParallelQueries?: boolean;
  },
) {
  const { data: me, isLoading: isLoadingMe } = api.useMe();
  const slotOpts = {
    enabled: enabled && !isLoadingMe,
    queryKeyPrefix,
    enableParallelQueries,
    parallelizeWhenPossible: me?.team?.parallelizeWhenPossible,
  };

  const slot0 = useHistogramSlot(specs[0], slotOpts);
  const slot1 = useHistogramSlot(specs[1], slotOpts);
  const slot2 = useHistogramSlot(specs[2], slotOpts);
  const slot3 = useHistogramSlot(specs[3], slotOpts);
  const slot4 = useHistogramSlot(specs[4], slotOpts);

  const slots = [slot0, slot1, slot2, slot3, slot4].slice(0, specs.length);

  const isLoading = slots.some(s => s.isLoading);
  const allFailed = slots.length > 0 && slots.every(s => s.isError);
  const anyError = slots.some(s => s.isError);
  const error = slots.find(s => s.error != null)?.error ?? undefined;
  const isComplete =
    slots.length > 0 && slots.every(s => s.isError || !!s.data?.isComplete);

  const mergedResponse: ResponseJSON<Record<string, any>> | undefined =
    useMemo(() => {
      const slotData = [
        slot0.data,
        slot1.data,
        slot2.data,
        slot3.data,
        slot4.data,
      ];
      let meta: ColumnMetaType[] | undefined;
      const data: Record<string, any>[] = [];
      for (let i = 0; i < specs.length; i++) {
        const response = slotData[i];
        if (response?.meta == null || response.meta.length === 0) continue;
        if (meta == null) {
          meta = [
            ...response.meta,
            { name: SOURCE_GROUP_COLUMN, type: 'String' },
          ];
        }
        const sourceName = specs[i].source.name;
        for (const row of response.data ?? []) {
          data.push({ ...row, [SOURCE_GROUP_COLUMN]: sourceName });
        }
      }
      return meta ? { data, meta, rows: data.length } : undefined;
    }, [slot0.data, slot1.data, slot2.data, slot3.data, slot4.data, specs]);

  return { mergedResponse, isLoading, allFailed, anyError, error, isComplete };
}

const EMPTY_NUMBER_FORMATS = new Map<string, NumberFormat>();

/**
 * The multi-source search histogram: one stacked count() series per selected
 * source, colored consistently with the results-table badges. A thin
 * counterpart to DBTimeChart — drag-to-zoom and the legend work; per-series
 * drill-down/pinned tooltips are single-source features and are omitted.
 */
export function MultiSourceTimeChart({
  specs,
  enabled = true,
  queryKeyPrefix,
  enableParallelQueries,
  onTimeRangeSelect,
  showLegend = true,
}: {
  specs: MultiSourceChartSpec[];
  enabled?: boolean;
  queryKeyPrefix: string;
  enableParallelQueries?: boolean;
  onTimeRangeSelect?: (start: Date, end: Date) => void;
  showLegend?: boolean;
}) {
  const { mergedResponse, isLoading, allFailed, error, isComplete } =
    useMultiSourceHistogram(specs, {
      enabled,
      queryKeyPrefix,
      enableParallelQueries,
    });

  const firstConfig = specs[0]?.config;
  const { dateRange, granularity } = useTimeChartSettings(
    firstConfig ?? STUB_CONFIG,
  );

  const [activeClickPayload, setActiveClickPayload] = useState<
    ActiveClickPayload | undefined
  >();

  const colorBySourceName = useMemo(
    () =>
      new Map(
        specs.map((spec, i) => [spec.source.name, getMultiSourceColor(i)]),
      ),
    [specs],
  );

  const formatted = useMemo(() => {
    if (mergedResponse == null) {
      return null;
    }
    try {
      const result = formatResponseForTimeChart({
        currentPeriodResponse: mergedResponse,
        dateRange,
        granularity,
        generateEmptyBuckets: true,
      });
      // One series per source: recolor to the shared per-source palette so
      // the histogram matches the table badges and status chips.
      for (const line of result.lineData) {
        const color = colorBySourceName.get(line.dataKey);
        if (color != null) {
          line.color = color;
        }
      }
      return result;
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [mergedResponse, dateRange, granularity, colorBySourceName]);

  if (allFailed && error) {
    return <ChartErrorState error={error} variant="inline" />;
  }

  return (
    <ChartContainer>
      {isLoading && formatted == null ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          Loading Chart Data...
        </div>
      ) : formatted == null || formatted.graphResults.length === 0 ? (
        <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted">
          No data found within time range.
        </div>
      ) : (
        <MemoChart
          dateRange={dateRange}
          displayType={DisplayType.StackedBar}
          graphResults={formatted.graphResults}
          isClickActive={activeClickPayload}
          setIsClickActive={setActiveClickPayload}
          lineData={formatted.lineData}
          isLoading={isLoading || !isComplete}
          tooltipNumberFormatsByKey={EMPTY_NUMBER_FORMATS}
          onTimeRangeSelect={onTimeRangeSelect}
          showLegend={showLegend}
          timestampKey={formatted.timestampColumn?.name}
          granularity={granularity}
          dateRangeEndInclusive={firstConfig?.dateRangeEndInclusive}
        />
      )}
    </ChartContainer>
  );
}

/**
 * Summed "N Results" across every selected source, sharing the histogram's
 * per-source queries (identical query keys) so it adds no ClickHouse load.
 */
export function MultiSourceTotalCountChart({
  specs,
  enabled = true,
  queryKeyPrefix,
  enableParallelQueries,
}: {
  specs: MultiSourceChartSpec[];
  enabled?: boolean;
  queryKeyPrefix: string;
  enableParallelQueries?: boolean;
}) {
  const { mergedResponse, isLoading, allFailed } = useMultiSourceHistogram(
    specs,
    {
      enabled,
      queryKeyPrefix,
      enableParallelQueries,
    },
  );

  const totalCount = useMemo(() => {
    if (mergedResponse == null) return undefined;
    // The count column may be renamed (e.g. via materialized views); fall back
    // to the first numeric column, mirroring SearchTotalCountChart.
    const countColumn =
      mergedResponse.meta?.find(c => c.name === 'count()')?.name ??
      filterColumnMetaByType(mergedResponse.meta ?? [], [
        JSDataType.Number,
      ])?.[0]?.name ??
      'count()';
    return mergedResponse.data.reduce(
      (sum: number, row: any) => sum + (Number.parseInt(row[countColumn]) || 0),
      0,
    );
  }, [mergedResponse]);

  return (
    <Text data-testid="search-total-count" size="xs" lh="normal">
      {isLoading && totalCount == null ? (
        <span className="effect-pulse">&middot;&middot;&middot; Results</span>
      ) : totalCount != null && !allFailed ? (
        `${totalCount.toLocaleString()} Results`
      ) : (
        '0 Results'
      )}
    </Text>
  );
}
