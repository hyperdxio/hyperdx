import { useMemo } from 'react';
import ms from 'ms';
import type { ResponseJSON, Row } from '@hyperdx/common-utils/dist/clickhouse';
import {
  ChSql,
  ClickHouseQueryError,
  ColumnMetaType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  isFirstOrderByAscending,
  isTimestampExpressionInFirstOrderBy,
} from '@hyperdx/common-utils/dist/core/utils';
import { ChartConfigWithOptTimestamp } from '@hyperdx/common-utils/dist/types';
import {
  QueryClient,
  QueryFunction,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query';

import api from '@/api';
import { getClickhouseClient } from '@/clickhouse';
import { getMetadata } from '@/metadata';
import { omit } from '@/utils';
import {
  generateTimeWindowsAscending,
  generateTimeWindowsDescending,
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

type TQueryFnData = {
  data: Record<string, any>[];
  meta: ColumnMetaType[];
  chSql: ChSql;
  window: TimeWindow;
};

type TData = {
  pages: TQueryFnData[];
  pageParams: TPageParam[];
};

// Get time window from page param
function getTimeWindowFromPageParam(
  config: ChartConfigWithOptTimestamp,
  pageParam: TPageParam,
): TimeWindow {
  const [startDate, endDate] = config.dateRange;
  const windows = isFirstOrderByAscending(config.orderBy)
    ? generateTimeWindowsAscending(startDate, endDate)
    : generateTimeWindowsDescending(startDate, endDate);
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
): TPageParam | undefined {
  if (lastPage == null) {
    return undefined;
  }

  const [startDate, endDate] = config.dateRange;
  const windows = isFirstOrderByAscending(config.orderBy)
    ? generateTimeWindowsAscending(startDate, endDate)
    : generateTimeWindowsDescending(startDate, endDate);
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
  const shouldUseWindowing = isTimestampExpressionInFirstOrderBy(config);
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
  const queryClient = meta.queryClient as QueryClient;
  // Only stream incrementally if this is a fresh query with no previous
  // response or if it's a paginated query
  // otherwise we'll flicker the UI with streaming data
  const isStreamingIncrementally =
    !meta.hasPreviousQueries ||
    pageParam.offset > 0 ||
    pageParam.windowIndex > 0;

  const config = queryKey[1];

  // Get the time window for this page
  const shouldUseWindowing = isTimestampExpressionInFirstOrderBy(config);
  const timeWindow = shouldUseWindowing
    ? getTimeWindowFromPageParam(config, pageParam)
    : {
        startTime: config.dateRange[0],
        endTime: config.dateRange[1],
        windowIndex: 0,
        direction: 'DESC' as const,
      };

  // Create config with windowed date range
  const windowedConfig = {
    ...config,
    dateRange: [timeWindow.startTime, timeWindow.endTime] as [Date, Date],
    limit: {
      limit: config.limit?.limit,
      offset: pageParam.offset,
    },
  };

  const query = await renderChartConfig(windowedConfig, getMetadata());

  const queryTimeout = queryKey[2];
  const clickhouseClient = getClickhouseClient();

  // Create abort signal from timeout if provided
  const abortController = queryTimeout ? new AbortController() : undefined;
  if (abortController && queryTimeout) {
    setTimeout(() => abortController.abort(), queryTimeout);
  }

  const resultSet =
    await clickhouseClient.query<'JSONCompactEachRowWithNamesAndTypes'>({
      query: query.sql,
      query_params: query.params,
      format: 'JSONCompactEachRowWithNamesAndTypes',
      abort_signal: abortController?.signal || signal,
      connectionId: config.connection,
    });

  const stream = resultSet.stream();

  const reader = stream.getReader();

  const rows: Row<unknown[], 'JSONCompactEachRowWithNamesAndTypes'>[] = [];

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

  const queryResultMeta: NonNullable<ResponseJSON['meta']> = [];
  // Buffer for all data rows for the current query
  const queryResultData: Record<string, unknown>[] = [];

  async function read(): Promise<void> {
    const { done, value } = await reader.read();

    if (done || value == null) {
      return;
    }

    // TODO: Simplify this logic for header handling and value buffering
    rows.push(...value);

    if (rows.length >= 2) {
      let dataRows = value;
      if (queryResultMeta.length === 0) {
        const names = rows[0].json<string[]>();
        const values = rows[1].json<string[]>();

        if (names.length !== values.length) {
          throw new Error(
            'Invalid JSONCompactEachRowWithNamesAndTypes header rows',
          );
        }

        for (let i = 0; i < names.length; i++) {
          queryResultMeta.push({
            name: names[i],
            type: values[i],
          });
        }

        dataRows = dataRows.slice(2);
      }

      const rowObjs: Record<string, unknown>[] = [];
      for (let i = 0; i < dataRows.length; i++) {
        const rowArr = dataRows[i].json();
        const rowObj: Record<string, unknown> = {};
        for (let j = 0; j < rowArr.length; j++) {
          rowObj[queryResultMeta[j].name] = rowArr[j];
        }

        rowObjs.push(rowObj);
        queryResultData.push(rowObj);
      }

      if (isStreamingIncrementally) {
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
    }

    return await read();
  }

  function deleteProgressCache() {
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
      deleteProgressCache();
    }
    throw e;
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

  deleteProgressCache();

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
  }: {
    isLive?: boolean;
    enabled?: boolean;
    queryKeyPrefix?: string;
  } = {},
) {
  const { data: meData } = api.useMe();
  const key = queryKeyFn(queryKeyPrefix, config, meData?.team?.queryTimeout);
  const queryClient = useQueryClient();
  const matchedQueries = queryClient.getQueriesData<TData>({
    queryKey: [queryKeyPrefix, omit(config, ['dateRange'])],
  });
  // TODO: Check that the time ranges overlap
  const hasPreviousQueries =
    matchedQueries.filter(([_, data]) => data != null).length > 0;

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
    enabled,
    initialPageParam: { windowIndex: 0, offset: 0 } as TPageParam,
    getNextPageParam: (lastPage, allPages) => {
      return getNextPageParam(lastPage, allPages, config);
    },
    staleTime: Infinity, // TODO: Pick a correct time
    meta: {
      queryClient,
      hasPreviousQueries,
    },
    queryFn,
    gcTime: isLive ? ms('30s') : ms('5m'), // more aggressive gc for live data, since it can end up holding lots of data
    retry: 1,
    refetchOnWindowFocus: false,
    maxPages: isLive ? 5 : undefined, // Limit number of pages kept in cache for live data
  });

  const flattenedData = useMemo(() => flattenData(data), [data]);

  return {
    isError,
    error,
    data: flattenedData,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isLoading,
  };
}
