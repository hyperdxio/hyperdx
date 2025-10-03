import {
  chSqlToAliasMap,
  ClickHouseQueryError,
  parameterizedQueryToSql,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import { format } from '@hyperdx/common-utils/dist/sqlFormatter';
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

export function useQueriedChartConfig(
  config: ChartConfigWithOptDateRange,
  options?: Partial<UseQueryOptions<ResponseJSON<any>>> &
    AdditionalUseQueriedChartConfigOptions,
) {
  const clickhouseClient = useClickhouseClient();

  const query = useQuery<TQueryFnData, ClickHouseQueryError | Error>({
    queryKey: [config],
    queryFn: streamedQuery({
      streamFn: context =>
        fetchDataInChunks(config, clickhouseClient, context.signal),
      /**
       * This mode ensures that data remains in the cache until the next full streamed result is available.
       * By default, the cache would be cleared before new data starts arriving, which results in the query briefly
       * going back into the loading/pending state when multiple observers are sharing the query result resulting
       * in flickering or render loops.
       */
      refetchMode: 'replace',
      initialValue: { data: [], meta: [], rows: 0 } as TQueryFnData,
      reducer: (acc, chunk) => {
        return {
          data: [...(acc?.data || []), ...(chunk.data || [])],
          meta: chunk.meta,
          rows: (acc?.rows || 0) + (chunk.rows || 0),
        };
      },
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
// TODO: Check if this is impacted by timezones or DST changes --> Everything UTC? Should be fine.
// TODO: See if we can combine this with the useOffsetPaginatedQuery stuff
// TODO: How does live mode affect this?
// TODO: Can we remove the IS_MTVIEWS_ENABLED stuff?
// TODO: How is caching working?
// Test that this works as expected with no pagination in place (eg. no granularity or no date range)

export function useRenderedSqlChartConfig(
  config: ChartConfigWithOptDateRange,
  options?: UseQueryOptions<string>,
) {
  return useQuery<string>({
    queryKey: ['renderedSql', config],
    queryFn: async () => {
      const query = await renderChartConfig(config, getMetadata());
      return format(parameterizedQueryToSql(query));
    },
    ...options,
  });
}

export function useAliasMapFromChartConfig(
  config: ChartConfigWithOptDateRange | undefined,
  options?: UseQueryOptions<Record<string, string>>,
) {
  return useQuery<Record<string, string>>({
    queryKey: ['aliasMap', config],
    queryFn: async () => {
      if (config == null) {
        return {};
      }

      const query = await renderChartConfig(config, getMetadata());

      const aliasMap = chSqlToAliasMap(query);

      return aliasMap;
    },
    enabled: config != null,
    ...options,
  });
}
