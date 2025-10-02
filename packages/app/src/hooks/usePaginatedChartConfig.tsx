import {
  ClickHouseQueryError,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/types';
import {
  experimental_streamedQuery as streamedQuery,
  useQuery,
  UseQueryOptions,
} from '@tanstack/react-query';

import { toStartOfInterval } from '@/ChartUtils';
import { useClickhouseClient } from '@/clickhouse';
import { IS_MTVIEWS_ENABLED } from '@/config';
import { buildMTViewSelectQuery } from '@/hdxMTViews';
import { getMetadata } from '@/metadata';
import { generateTimeWindowsDescending } from '@/utils/searchWindows';

interface AdditionalUseQueriedChartConfigOptions {
  onError?: (error: Error | ClickHouseQueryError) => void;
}

type TimeWindow = {
  dateRange: [Date, Date];
  dateRangeEndInclusive?: boolean;
};

type TQueryFnData = Pick<ResponseJSON<any>, 'data' | 'meta' | 'rows'> & {};

export const getGranularityAlignedTimeWindows = (
  config: Pick<
    ChartConfigWithOptDateRange,
    'dateRange' | 'granularity' | 'dateRangeEndInclusive'
  >,
  windowDurationsSeconds?: number[],
): TimeWindow[] | [undefined] => {
  // Granularity is required for pagination, otherwise we could break other group-bys
  // Date range is required for pagination, otherwise we'd have infinite pages, or some unbounded page(s).
  if (!config.dateRange || !config.granularity) return [undefined];

  const [startDate, endDate] = config.dateRange;
  const granularity = config.granularity;
  const windowsUnaligned = generateTimeWindowsDescending(
    startDate,
    endDate,
    windowDurationsSeconds,
  );

  const windows = [];
  for (const [index, window] of windowsUnaligned.entries()) {
    // Align windows to chart buckets
    const alignedStart =
      index === windowsUnaligned.length - 1
        ? window.startTime
        : toStartOfInterval(window.startTime, granularity);
    const alignedEnd =
      index === 0 ? endDate : toStartOfInterval(window.endTime, granularity);

    // Skip windows that are covered by the previous window after it was aligned
    if (
      !windows.length ||
      alignedStart < windows[windows.length - 1].dateRange[0]
    ) {
      windows.push({
        dateRange: [alignedStart, alignedEnd] as [Date, Date],
        // Ensure that windows don't overlap by making all but the first (most recent) exclusive
        dateRangeEndInclusive:
          index === 0 ? config.dateRangeEndInclusive : false,
      });
    }
  }

  return windows;
};

async function* fetchDataInChunks(
  config: ChartConfigWithOptDateRange,
  clickhouseClient: ClickhouseClient,
  signal: AbortSignal,
) {
  const windows = getGranularityAlignedTimeWindows(config);

  let query = null;
  if (IS_MTVIEWS_ENABLED) {
    const { dataTableDDL, mtViewDDL, renderMTViewConfig } =
      await buildMTViewSelectQuery(config);
    // TODO: show the DDLs in the UI so users can run commands manually
    // eslint-disable-next-line no-console
    console.log('dataTableDDL:', dataTableDDL);
    // eslint-disable-next-line no-console
    console.log('mtViewDDL:', mtViewDDL);
    query = await renderMTViewConfig();
  }

  for (const window of windows) {
    const windowedConfig = {
      ...config,
      ...(window ?? {}),
    };

    const result = await clickhouseClient.queryChartConfig({
      config: windowedConfig,
      metadata: getMetadata(),
      opts: {
        abort_signal: signal,
      },
    });

    yield result;
  }
}

export function usePaginatedQueriedChartConfig(
  config: ChartConfigWithOptDateRange,
  options?: Partial<UseQueryOptions<ResponseJSON<any>>> &
    AdditionalUseQueriedChartConfigOptions,
) {
  const clickhouseClient = useClickhouseClient();

  const query = useQuery<TQueryFnData, ClickHouseQueryError | Error>({
    queryKey: ['', config],
    queryFn: streamedQuery({
      streamFn: context =>
        fetchDataInChunks(config, clickhouseClient, context.signal),
      reducer: (acc, chunk) => {
        return {
          data: [...(acc?.data || []), ...(chunk.data || [])],
          meta: chunk.meta,
          rows: (acc?.rows || 0) + (chunk.rows || 0),
        };
      },
      initialValue: { data: [], meta: [], rows: 0 } as TQueryFnData,
    }),
    retry: 1,
    refetchOnWindowFocus: false,
    ...options,
  });

  if (query.isError && options?.onError) {
    options.onError(query.error);
  }
  return query;
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
