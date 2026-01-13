import { useMemo } from 'react';
import { omit, pick } from 'lodash';
import {
  GetKeyValueCall,
  optimizeGetKeyValuesCalls,
} from '@hyperdx/common-utils/dist/core/materializedViews';
import {
  ChartConfigWithDateRange,
  DashboardFilter,
} from '@hyperdx/common-utils/dist/types';
import {
  useQueries,
  useQueryClient,
  UseQueryResult,
} from '@tanstack/react-query';

import { useClickhouseClient } from '@/clickhouse';
import { useSources } from '@/source';

import { useMetadataWithSettings } from './useMetadata';

function useOptimizedKeyValuesCalls({
  filters,
  dateRange,
}: {
  filters: DashboardFilter[];
  dateRange: [Date, Date];
}) {
  const clickhouseClient = useClickhouseClient();
  const metadata = useMetadataWithSettings();
  const { data: sources, isLoading: isLoadingSources } = useSources();

  const filtersBySourceId = useMemo(() => {
    const filtersBySourceId = new Map<string, DashboardFilter[]>();
    for (const filter of filters) {
      if (!filtersBySourceId.has(filter.source)) {
        filtersBySourceId.set(filter.source, [filter]);
      } else {
        filtersBySourceId.get(filter.source)!.push(filter);
      }
    }
    return filtersBySourceId;
  }, [filters]);

  const results: UseQueryResult<GetKeyValueCall<ChartConfigWithDateRange>[]>[] =
    useQueries({
      queries: Array.from(filtersBySourceId.entries())
        .filter(([sourceId]) => sources?.some(s => s.id === sourceId))
        .map(([sourceId, filters]) => {
          const source = sources!.find(s => s.id === sourceId)!;
          const keys = filters.map(f => f.expression);
          const chartConfig: ChartConfigWithDateRange = {
            ...pick(source, ['timestampValueExpression', 'connection', 'from']),
            dateRange,
            source: source.id,
            where: '',
            whereLanguage: 'sql',
            select: '',
          };

          return {
            queryKey: [
              'dashboard-filters-key-value-calls',
              sourceId,
              dateRange,
              keys,
            ],
            enabled: !isLoadingSources,
            staleTime: 1000 * 60 * 5, // Cache every 5 min
            queryFn: async ({ signal }) =>
              await optimizeGetKeyValuesCalls({
                chartConfig,
                source,
                clickhouseClient,
                metadata,
                keys,
                signal,
              }),
          };
        }),
    });

  return {
    data: results.map(r => r.data ?? []).flat(),
    isFetching: isLoadingSources || results.some(r => r.isFetching),
    isLoading: isLoadingSources || results.every(r => r.isLoading),
  };
}

export function useDashboardFilterKeyValues({
  filters,
  dateRange,
}: {
  filters: DashboardFilter[];
  dateRange: [Date, Date];
}) {
  const metadata = useMetadataWithSettings();
  const {
    data: calls,
    isFetching: isFetchingOptimizedCalls,
    isLoading: isLoadingOptimizedCalls,
  } = useOptimizedKeyValuesCalls({
    filters,
    dateRange,
  });

  const queryClient = useQueryClient();
  type TQueryData = { key: string; value: string[] }[];

  const results: UseQueryResult<TQueryData>[] = useQueries({
    queries: calls.map(({ chartConfig, keys }) => {
      // Construct a query key prefix which will allow us to use placeholder data from the previous query for the same keys
      const queryKeyPrefix = [
        'dashboard-filter-key-values',
        chartConfig.from,
        keys,
      ];
      return {
        queryKey: [...queryKeyPrefix, chartConfig],
        placeholderData: () => {
          // Use placeholder data from the most recently cached query with the same key prefix
          const cached = queryClient
            .getQueriesData<TQueryData>({ queryKey: queryKeyPrefix })
            .map(([key, data]) => ({ key, data }))
            .filter(({ data }) => !!data)
            .toSorted((a, b) => {
              const aTime =
                queryClient.getQueryState(a.key)?.dataUpdatedAt ?? 0;
              const bTime =
                queryClient.getQueryState(b.key)?.dataUpdatedAt ?? 0;
              return bTime - aTime;
            });
          return cached[0]?.data;
        },
        enabled: !isLoadingOptimizedCalls,
        staleTime: 1000 * 60 * 5, // Cache every 5 min
        queryFn: async ({ signal }) =>
          metadata.getKeyValues({
            chartConfig,
            keys,
            limit: 10000,
            disableRowLimit: true,
            signal,
          }),
      };
    }),
  });

  const flattenedData = useMemo(
    () =>
      new Map(
        results.flatMap(({ isLoading, data = [] }) => {
          return data.map(({ key, value }) => [
            key,
            {
              values: value,
              isLoading,
            },
          ]);
        }),
      ),
    [results],
  );

  return {
    data: flattenedData,
    isLoading: isLoadingOptimizedCalls || results.every(r => r.isLoading),
    isFetching: isFetchingOptimizedCalls || results.some(r => r.isFetching),
    isError: results.some(r => r.isError),
  };
}
