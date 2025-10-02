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

import { timeBucketByGranularity } from '@/ChartUtils';
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
  // Granularity is required for pagination, otherwise we could break other group-bys
  // Date range is required for pagination, otherwise we'd have infinite pages, or some unbounded page(s).
  if (!config.dateRange || !config.granularity) return undefined;

  const [startDate, endDate] = config.dateRange;
  const granularity = config.granularity; // could be 'auto'
  const chartBuckets = timeBucketByGranularity(startDate, endDate, granularity); // TODO does this handle auto?

  const chunkSize = 10;
  const windows = [];
  for (let i = chartBuckets.length; i >= 0; i -= chunkSize) {
    const endTime = chartBuckets[i] ?? endDate;
    const startTime = chartBuckets[Math.max(i - chunkSize, 0)];
    windows.push({ startTime, endTime, index: windows.length });
  }

  return windows;
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
    // Ensure that windows don't overlap by making all but the first (most recent) exclusive
    windowedConfig.dateRangeEndInclusive =
      pageParam === 0 ? config.dateRangeEndInclusive : false;
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

  // Auto-fetch next pages until all of the data is fetched
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
// TODO: What happens if date range is not provided? --> No pagination, or a default pagination?
//   - In the sidebar onboarding checklist component
//   - where else?
// TODO: See if we can combine this with the useOffsetPaginatedQuery stuff
// TODO: How does live mode affect this?
// TODO: Can we remove the IS_MTVIEWS_ENABLED stuff?
// TODO: How is caching working?
// TODO: Granularity not provided --> use any default, or is this every automatically added?
//  - In the patterns table
//  - where else?
// TODO: What if we group by something that isn't a date?
// - Probably OK if we are also grouping by time, but not OK if we aren't also grouping by time?
