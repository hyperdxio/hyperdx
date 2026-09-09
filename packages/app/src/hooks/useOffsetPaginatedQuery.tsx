import { useMemo } from 'react';
import { omit } from 'lodash';
import ms from 'ms';
import type {
  ClickHouseProgress,
  ClickHouseSettings,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  ChSql,
  ClickHouseQueryError,
  ColumnMetaType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { supportsJSONEachRowWithProgressMeta } from '@hyperdx/common-utils/dist/core/clickhouseVersion';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  isFirstOrderByAscending,
  isTimestampExpressionInFirstOrderBy,
} from '@hyperdx/common-utils/dist/core/utils';
import {
  isBuilderChartConfig,
  isPromqlChartConfig,
  isRawSqlChartConfig,
} from '@hyperdx/common-utils/dist/guards';
import {
  ChartConfigWithOptTimestamp,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import {
  QueryClient,
  QueryFunction,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query';

import api from '@/api';
import { getClickhouseClient } from '@/clickhouse';
import { MAX_TABLE_ROWS } from '@/HDXMultiSeriesTableChart';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import {
  clearQueryProgress,
  completeChunkProgress,
  startChunkProgress,
  useQueryProgress,
  writeChunkProgress,
} from '@/hooks/useQueryProgress';
import { useSource } from '@/source';
import {
  createCompactWithNamesAndTypesParser,
  createEachRowWithProgressParser,
  StreamParser,
} from '@/utils/clickhouseStream';
import {
  DEFAULT_TIME_WINDOWS_SECONDS,
  generateTimeWindowsAscending,
  generateTimeWindowsDescending,
  ONE_MIN_WINDOW,
  TimeWindow,
} from '@/utils/searchWindows';

type TQueryKey = readonly [
  string,
  ChartConfigWithOptTimestamp,
  number | undefined,
];

function queryKeyFn(
  prefix: string,
  config: ChartConfigWithOptTimestamp,
  queryTimeout?: number,
): TQueryKey {
  return [prefix, config, queryTimeout];
}

type TPageParam = {
  windowIndex: number;
  offset: number;
};

/** One NDJSON line from a ClickHouse result stream, before decoding. */
type StreamedRow = { json: () => unknown };

type TQueryFnData = {
  data: Record<string, any>[];
  meta: ColumnMetaType[];
  chSql: ChSql;
  window: TimeWindow;
};

/** Milliseconds of the search range covered by a window. */
function windowRangeMs(window: TimeWindow): number {
  return Math.max(window.endTime.getTime() - window.startTime.getTime(), 0);
}

/** Progress chunk id for a search window. Offset pages share their window. */
function windowChunkId(windowIndex: number): string {
  return `window-${windowIndex}`;
}

/**
 * Total span of the search, and the windows earlier pages already covered.
 *
 * Pagination walks the range one window at a time, so progress for the window
 * currently in flight only describes a slice of what the UI says it is
 * searching ("across about 1 month"). Crediting the windows already finished
 * makes the bar describe the whole search instead of restarting per page.
 *
 * Ranges are keyed by chunk id so the window currently streaming — which also
 * has a placeholder page in the cache — is credited once, not twice.
 */
function coverageFromPages(
  config: ChartConfigWithOptTimestamp,
  pages: TQueryFnData[] | undefined,
): { totalRangeMs: number; completedRanges: Record<string, number> } {
  const [start, end] = config.dateRange ?? [];
  const totalRangeMs =
    start != null && end != null
      ? Math.max(end.getTime() - start.getTime(), 0)
      : 0;

  const completedRanges: Record<string, number> = {};
  for (const page of pages ?? []) {
    if (page?.window != null) {
      completedRanges[windowChunkId(page.window.windowIndex)] = windowRangeMs(
        page.window,
      );
    }
  }

  return { totalRangeMs, completedRanges };
}

type TData = {
  pages: TQueryFnData[];
  pageParams: TPageParam[];
};

type QueryMeta = {
  queryClient: QueryClient;
  hasPreviousQueries: boolean;
  windowDurationsSeconds: number[];
  metadata: Metadata;
  optimizedConfig?: ChartConfigWithOptTimestamp;
  source: TSource | undefined;
  reportProgress: boolean;
};

// Get time window from page param
function getTimeWindowFromPageParam(
  config: ChartConfigWithOptTimestamp,
  pageParam: TPageParam,
  windowDurationsSeconds: number[],
): TimeWindow {
  const [startDate, endDate] = config.dateRange;
  const windows =
    isBuilderChartConfig(config) && isFirstOrderByAscending(config.orderBy)
      ? generateTimeWindowsAscending(startDate, endDate, windowDurationsSeconds)
      : generateTimeWindowsDescending(
          startDate,
          endDate,
          windowDurationsSeconds,
        );
  const window = windows[pageParam.windowIndex];
  if (window == null) {
    throw new Error('Invalid time window for page param');
  }
  return window;
}

// Calculate next page param based on current results and window
function getNextPageParam(
  lastPage: TQueryFnData | null,
  allPages: TQueryFnData[],
  config: ChartConfigWithOptTimestamp,
  windowDurationsSeconds: number[],
): TPageParam | undefined {
  // Pagination is not supported for raw SQL or PromQL tables since they may not be ordered at all.
  if (
    lastPage == null ||
    isRawSqlChartConfig(config) ||
    isPromqlChartConfig(config)
  ) {
    return undefined;
  }

  const [startDate, endDate] = config.dateRange;
  const windows = isFirstOrderByAscending(config.orderBy)
    ? generateTimeWindowsAscending(startDate, endDate, windowDurationsSeconds)
    : generateTimeWindowsDescending(startDate, endDate, windowDurationsSeconds);
  const currentWindow = lastPage.window;

  // Calculate total results from all pages in current window
  const currentWindowPages = allPages.filter(
    p => p.window.windowIndex === currentWindow.windowIndex,
  );
  const currentWindowResults = currentWindowPages.reduce(
    (sum, page) => sum + page.data.length,
    0,
  );

  // If we have results in the current window, continue paginating within it
  if (lastPage.data.length > 0) {
    return {
      windowIndex: currentWindow.windowIndex,
      offset: currentWindowResults,
    };
  }

  // If no more results in current window, move to next window (if windowing is being used)
  const shouldUseWindowing =
    isBuilderChartConfig(config) && isTimestampExpressionInFirstOrderBy(config);
  const nextWindowIndex = currentWindow.windowIndex + 1;
  if (shouldUseWindowing && nextWindowIndex < windows.length) {
    return {
      windowIndex: nextWindowIndex,
      offset: 0,
    };
  }

  return undefined;
}

const queryFn: QueryFunction<TQueryFnData, TQueryKey, TPageParam> = async ({
  queryKey,
  pageParam,
  signal,
  meta,
}) => {
  if (meta == null) {
    throw new Error('Query missing client meta');
  }

  const {
    queryClient,
    windowDurationsSeconds,
    metadata,
    hasPreviousQueries,
    optimizedConfig,
    source,
    reportProgress,
  } = meta as QueryMeta;

  // Progress is deliberately kept across the gap between windows, so a run
  // that restarts at the first page — a refetch, or a re-search with identical
  // params — has to drop what the previous run accumulated.
  if (reportProgress && pageParam.windowIndex === 0 && pageParam.offset === 0) {
    clearQueryProgress(queryClient, queryKey);
  }

  // Only stream incrementally if this is a fresh query with no previous
  // response or if it's a paginated query
  // otherwise we'll flicker the UI with streaming data
  const isStreamingIncrementally =
    !hasPreviousQueries || pageParam.offset > 0 || pageParam.windowIndex > 0;

  const queryTimeout = queryKey[2];
  const clickhouseClient = getClickhouseClient({ queryTimeout });

  const rawConfig = queryKey[1];
  const config = optimizedConfig ?? rawConfig;

  // Get the time window for this page
  const shouldUseWindowing =
    isBuilderChartConfig(config) && isTimestampExpressionInFirstOrderBy(config);
  const timeWindow = shouldUseWindowing
    ? getTimeWindowFromPageParam(config, pageParam, windowDurationsSeconds)
    : {
        startTime: config.dateRange[0],
        endTime: config.dateRange[1],
        windowIndex: 0,
        direction: 'DESC' as const,
      };

  // Create config with windowed date range
  const windowedConfig = isBuilderChartConfig(config)
    ? {
        ...config,
        dateRange: [timeWindow.startTime, timeWindow.endTime] as [Date, Date],
        limit: {
          limit: config.limit?.limit,
          offset: pageParam.offset,
        },
      }
    : config;

  const query = await renderChartConfig(
    windowedConfig,
    metadata,
    source?.querySettings,
  );

  // Create abort signal from timeout if provided
  const abortController = queryTimeout ? new AbortController() : undefined;
  if (abortController && queryTimeout) {
    setTimeout(() => abortController.abort(), queryTimeout * 1000);
  }

  const clickHouseSettings: ClickHouseSettings = {};
  if (isRawSqlChartConfig(config)) {
    // Readonly = 2 means the query is readonly but can still specify query settings.
    clickHouseSettings.readonly = '2';

    const existingMaxResultRowsSetting = await metadata.getSetting({
      settingName: 'max_result_rows',
      connectionId: config.connection,
    });

    const maxResultRows =
      existingMaxResultRowsSetting != null &&
      Number(existingMaxResultRowsSetting) > 0
        ? Math.min(Number(existingMaxResultRowsSetting), MAX_TABLE_ROWS)
        : MAX_TABLE_ROWS;

    // result_overflow_mode=break will prevent an error when the result set exceeds max_result_rows,
    // and instead just return the first max_result_rows rows.
    clickHouseSettings.max_result_rows = String(maxResultRows);
    clickHouseSettings.result_overflow_mode = 'break';
  }

  // `JSONEachRowWithProgress` interleaves `{"progress":...}` events with the
  // rows, which is the only way to observe query progress from a browser:
  // ClickHouse stops emitting `X-ClickHouse-Progress` headers once the response
  // body starts, and `fetch` cannot surface headers incrementally anyway.
  // Requires >= 25.1 for the `meta` and `exception` events.
  const useProgressFormat =
    reportProgress &&
    supportsJSONEachRowWithProgressMeta(
      await metadata.getServerVersion({ connectionId: config.connection }),
    );

  const resultSet = useProgressFormat
    ? await clickhouseClient.query<'JSONEachRowWithProgress'>({
        query: query.sql,
        query_params: query.params,
        format: 'JSONEachRowWithProgress',
        abort_signal: abortController?.signal || signal,
        connectionId: config.connection,
        clickhouse_settings: clickHouseSettings,
      })
    : await clickhouseClient.query<'JSONCompactEachRowWithNamesAndTypes'>({
        query: query.sql,
        query_params: query.params,
        format: 'JSONCompactEachRowWithNamesAndTypes',
        abort_signal: abortController?.signal || signal,
        connectionId: config.connection,
        clickhouse_settings: clickHouseSettings,
      });

  // The two formats yield different `Row<_, Format>` types whose `json()`
  // return types do not unify into a callable signature. The parsers only need
  // each line decoded, so narrow to that shared shape.
  const stream: ReadableStream<StreamedRow[]> = resultSet.stream();

  const reader = stream.getReader();

  if (isStreamingIncrementally) {
    queryClient.setQueryData<TData>(queryKey, (oldData): TData => {
      const EMPTY_PAGE: TQueryFnData = {
        data: [],
        meta: [],
        chSql: { sql: '', params: {} },
        window: timeWindow,
      };
      if (oldData == null) {
        return {
          pages: [EMPTY_PAGE],
          pageParams: [pageParam],
        };
      }

      return {
        pages: [...oldData.pages, EMPTY_PAGE],
        pageParams: [...oldData.pageParams, pageParam],
      };
    });
  }

  let queryResultMeta: ColumnMetaType[] = [];
  // Buffer for all data rows for the current query
  const queryResultData: Record<string, unknown>[] = [];

  // Appends to the in-progress page so partial results render as they stream.
  // Called with no rows when only `meta` arrived, so the column types reach the
  // table even for an empty result set.
  function appendToStreamedPage(rowObjs: Record<string, unknown>[]) {
    if (!isStreamingIncrementally) {
      return;
    }

    queryClient.setQueryData<TData>(queryKey, oldData => {
      if (oldData == null) {
        return {
          pages: [
            {
              data: rowObjs,
              meta: queryResultMeta,
              chSql: query,
              window: timeWindow,
            },
          ],
          pageParams: [pageParam],
        };
      }

      const oldPages = oldData.pages.slice(0, -1);
      const page = oldData.pages[oldData.pages.length - 1];

      return {
        pages: [
          ...oldPages,
          {
            ...page,
            data: [...(page.data ?? []), ...rowObjs],
            meta: queryResultMeta,
            chSql: query,
            window: timeWindow,
          },
        ],
        pageParams: oldData.pageParams,
      };
    });
  }

  const handlers = {
    onMeta: (meta: ColumnMetaType[]) => {
      queryResultMeta = meta;
      appendToStreamedPage([]);
    },
    onRows: (rowObjs: Record<string, unknown>[]) => {
      queryResultData.push(...rowObjs);
      appendToStreamedPage(rowObjs);
    },
    onProgress: (progress: ClickHouseProgress) => {
      writeChunkProgress(queryClient, queryKey, {
        // Offset pages within one window refine the same slice of the range.
        chunkId: windowChunkId(timeWindow.windowIndex),
        progress,
        rangeMs: windowRangeMs(timeWindow),
      });
    },
  };

  if (useProgressFormat) {
    // Claim this window before reading, so it is not counted as already
    // covered while it waits for its first progress event.
    startChunkProgress(queryClient, queryKey, {
      chunkId: windowChunkId(timeWindow.windowIndex),
      rangeMs: windowRangeMs(timeWindow),
    });
  }

  const parseBatch: StreamParser = useProgressFormat
    ? createEachRowWithProgressParser(handlers, query.sql)
    : createCompactWithNamesAndTypesParser(handlers);

  async function read(): Promise<void> {
    const { done, value } = await reader.read();

    if (done || value == null) {
      return;
    }

    parseBatch(value.map(row => row.json()));

    return await read();
  }

  // Drops the placeholder page that incremental streaming appended.
  function deleteInProgressPage() {
    queryClient.setQueryData<TData>(queryKey, oldData => {
      if (oldData == null) {
        return;
      }

      return {
        pages: oldData.pages.slice(0, -1),
        pageParams: oldData.pageParams.slice(0, -1),
      };
    });
  }

  try {
    await read();
  } catch (e) {
    if (isStreamingIncrementally) {
      deleteInProgressPage();
    }
    throw e;
  }

  // This window is fully searched. The entry is not cleared here: pagination
  // may immediately fetch the next window, and the bar should carry on rather
  // than blink back to empty. The next run from page one clears it instead.
  if (useProgressFormat) {
    completeChunkProgress(queryClient, queryKey, {
      chunkId: windowChunkId(timeWindow.windowIndex),
      rangeMs: windowRangeMs(timeWindow),
    });
  }

  if (!isStreamingIncrementally) {
    return {
      data: queryResultData,
      meta: queryResultMeta,
      chSql: query,
      window: timeWindow,
    };
  }

  // Clear out in-progress page and return full page result from cache
  const cachedQueryData = queryClient.getQueryData<TData>(queryKey);
  if (cachedQueryData == null) {
    throw new Error('Data not found in cache');
  }
  const { pages } = cachedQueryData;
  const lastPage = pages[pages.length - 1];

  deleteInProgressPage();

  return lastPage;
};

function flattenPages(pages: TQueryFnData[]) {
  return pages.flatMap(p => p.data);
}

function flattenData(data: TData | undefined): TQueryFnData | null {
  if (data == null || data.pages.length === 0) {
    return null;
  }

  return {
    meta: data.pages[0].meta,
    data: flattenPages(data.pages),
    chSql: data.pages[0].chSql,
    window: data.pages[data.pages.length - 1].window,
  };
}

export default function useOffsetPaginatedQuery(
  config: ChartConfigWithOptTimestamp,
  {
    isLive,
    enabled = true,
    queryKeyPrefix = '',
    enableSmallFirstWindow,
    reportProgress = false,
  }: {
    isLive?: boolean;
    enabled?: boolean;
    queryKeyPrefix?: string;
    enableSmallFirstWindow?: boolean;
    /**
     * Stream the query in a format that interleaves ClickHouse progress
     * events, exposing them as `progress`. Costs a slightly larger response
     * (rows repeat their column names) and needs ClickHouse >= 25.1; on older
     * servers this is silently ignored.
     */
    reportProgress?: boolean;
  } = {},
) {
  const { data: meData, isLoading: isLoadingMe } = api.useMe();
  const key = queryKeyFn(queryKeyPrefix, config, meData?.team?.queryTimeout);
  const queryClient = useQueryClient();
  const metadata = useMetadataWithSettings();
  const matchedQueries = queryClient.getQueriesData<TData>({
    queryKey: [queryKeyPrefix, omit(config, ['dateRange'])],
  });
  // TODO: Check that the time ranges overlap
  const hasPreviousQueries =
    matchedQueries.filter(([_, data]) => data != null).length > 0;

  const windowDurationsSeconds = DEFAULT_TIME_WINDOWS_SECONDS.slice();
  if (enableSmallFirstWindow) {
    windowDurationsSeconds.unshift(ONE_MIN_WINDOW);
  }

  const builderConfig = isBuilderChartConfig(config) ? config : undefined;
  const { data: mvOptimizationData, isLoading: isLoadingMVOptimization } =
    useMVOptimizationExplanation(builderConfig, {
      enabled: !!enabled && !!builderConfig,
      placeholderData: undefined,
    });

  const { data: source, isLoading: isSourceLoading } = useSource({
    id: config.source,
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isError,
    error,
    isLoading,
  } = useInfiniteQuery<
    TQueryFnData,
    Error | ClickHouseQueryError,
    TData,
    TQueryKey,
    TPageParam
  >({
    queryKey: key,
    placeholderData: (prev: TData | undefined) => {
      // Only preserve previous query in live mode
      return isLive ? prev : undefined;
    },
    enabled:
      enabled && !isLoadingMe && !isLoadingMVOptimization && !isSourceLoading,
    initialPageParam: { windowIndex: 0, offset: 0 } as TPageParam,
    getNextPageParam: (lastPage, allPages) => {
      return getNextPageParam(
        lastPage,
        allPages,
        config,
        windowDurationsSeconds,
      );
    },
    staleTime: Infinity, // TODO: Pick a correct time
    meta: {
      queryClient,
      hasPreviousQueries,
      windowDurationsSeconds,
      metadata,
      optimizedConfig: mvOptimizationData?.optimizedConfig,
      source,
      reportProgress,
    } satisfies QueryMeta,
    queryFn,
    gcTime: isLive ? ms('30s') : ms('5m'), // more aggressive gc for live data, since it can end up holding lots of data
    retry: 1,
    refetchOnWindowFocus: false,
    maxPages: isLive ? 5 : undefined, // Limit number of pages kept in cache for live data
  });

  const flattenedData = useMemo(() => flattenData(data), [data]);

  const { totalRangeMs, completedRanges } = useMemo(
    () => coverageFromPages(config, data?.pages),
    [config, data?.pages],
  );

  const progress = useQueryProgress({
    queryKey: key,
    active: reportProgress && isFetching,
    totalRangeMs,
    completedRanges,
  });

  return {
    isError,
    error,
    data: flattenedData,
    fetchNextPage,
    hasNextPage,
    isFetching: isFetching || isLoadingMe || isLoadingMVOptimization,
    isLoading: isLoading || isLoadingMe || isLoadingMVOptimization,
    progress,
  };
}
