import { useEffect, useMemo } from 'react';
import {
  ClickHouseQueryError,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/types';
import {
  QueryFunction,
  useInfiniteQuery,
  UseInfiniteQueryOptions,
} from '@tanstack/react-query';

import { useClickhouseClient } from '@/clickhouse';
import { IS_MTVIEWS_ENABLED } from '@/config';
import { buildMTViewSelectQuery } from '@/hdxMTViews';
import { getMetadata } from '@/metadata';

interface AdditionalUseQueriedChartConfigOptions {
  onError?: (error: Error | ClickHouseQueryError) => void;
}

type TimeWindow = {
  startTime: Date;
  endTime: Date;
  index: number;
};

type TPageParam = number;

type TQueryFnData = Pick<ResponseJSON<any>, 'data' | 'meta' | 'rows'> & {
  window: TimeWindow | undefined;
};

type TData = {
  pages: TQueryFnData[];
  pageParams: TPageParam[];
};

type TQueryKey = readonly [string, ChartConfigWithOptDateRange];

type TMeta = {
  clickhouseClient: ClickhouseClient;
};

const flattenData = (data: TData | undefined): TQueryFnData | undefined => {
  if (data == undefined || data.pages.length === 0) {
    return undefined;
  }

  return {
    data: data.pages.flatMap(page => page.data),
    meta: data.pages[0].meta,
    rows: data.pages.reduce((sum, page) => sum + (page.rows ?? 0), 0),
    window: data.pages[data.pages.length - 1].window,
  };
};

const getTimeWindows = (
  config: ChartConfigWithOptDateRange,
): TimeWindow[] | undefined => {
  if (!config.dateRange) return [];

  const [startDate, endDate] = config.dateRange;
  return [
    {
      startTime: new Date(startDate),
      endTime: new Date(
        startDate.getTime() + (endDate.getTime() - startDate.getTime()) / 2,
      ),
      index: 0,
    },
    {
      startTime: new Date(
        startDate.getTime() + (endDate.getTime() - startDate.getTime()) / 2 + 1,
      ),
      endTime: new Date(endDate),
      index: 1,
    },
  ];
};

const getNextPageParam = (
  lastPage: TQueryFnData | null,
  config: ChartConfigWithOptDateRange,
): TPageParam | undefined => {
  if (!lastPage) {
    return undefined;
  }

  const windows = getTimeWindows(config);
  if (
    !windows ||
    lastPage.window === undefined ||
    lastPage.window.index >= windows.length - 1
  ) {
    return undefined;
  }

  return lastPage.window.index + 1;
};

const queryFn: QueryFunction<TQueryFnData, TQueryKey, TPageParam> = async ({
  pageParam,
  signal,
  meta,
  queryKey,
}) => {
  const { clickhouseClient } = meta as TMeta;
  const [, config] = queryKey;

  const windowedConfig = {
    ...config,
  };

  const windows = getTimeWindows(config);
  if (windows && windows[pageParam]) {
    const window = windows[pageParam];
    windowedConfig.dateRange = [window.startTime, window.endTime];
  }

  let query = null;
  if (IS_MTVIEWS_ENABLED) {
    const { dataTableDDL, mtViewDDL, renderMTViewConfig } =
      await buildMTViewSelectQuery(windowedConfig);
    // TODO: show the DDLs in the UI so users can run commands manually
    // eslint-disable-next-line no-console
    console.log('dataTableDDL:', dataTableDDL);
    // eslint-disable-next-line no-console
    console.log('mtViewDDL:', mtViewDDL);
    query = await renderMTViewConfig();
  }

  const result = await clickhouseClient.queryChartConfig({
    config: windowedConfig,
    metadata: getMetadata(),
    opts: {
      abort_signal: signal,
    },
  });

  return {
    ...result,
    window: windows ? windows[pageParam] : undefined,
  };
};

export function usePaginatedQueriedChartConfig(
  config: ChartConfigWithOptDateRange,
  options: Partial<
    UseInfiniteQueryOptions<
      TQueryFnData,
      ClickHouseQueryError | Error,
      TData,
      TQueryFnData,
      TQueryKey,
      TPageParam
    >
  > &
    AdditionalUseQueriedChartConfigOptions,
) {
  const clickhouseClient = useClickhouseClient();

  const paginatedQuery = useInfiniteQuery<
    TQueryFnData,
    ClickHouseQueryError | Error,
    TData,
    TQueryKey,
    TPageParam
  >({
    queryKey: ['', config],
    queryFn,
    initialPageParam: 0,
    getNextPageParam: lastPage => {
      return getNextPageParam(lastPage, config);
    },
    refetchOnWindowFocus: false,
    retry: 1, // How does this work with infinite queries / pagination?
    meta: {
      clickhouseClient,
    },
    ...options,
  });

  const { data, isError, error, hasNextPage, isFetching, fetchNextPage } =
    paginatedQuery;
  if (isError && options?.onError) {
    options.onError(error);
  }

  useEffect(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage]);

  const flattenedData = useMemo(() => flattenData(data), [data]);

  return {
    ...paginatedQuery,
    data: flattenedData,
  };
}

// TODO: Can we always search backwards or do we need to support forwards too?
// TODO: Check if this is impacted by timezones or DST changes
// TODO: What happens if date range is not provided?
// TODO: See if we can combine this with the useOffsetPaginatedQuery stuff
// TODO: How does live mode affect this?
// TODO: Can we remove the IS_MTVIEWS_ENABLED stuff?
