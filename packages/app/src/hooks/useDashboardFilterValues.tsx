import { useMemo } from 'react';
import { pick } from 'lodash';
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
import { getMetricTableName, mapKeyBy } from '@/utils';

import { useMetadataWithSettings } from './useMetadata';

const filterToKey = (filter: DashboardFilter) =>
  filter.sourceMetricType
    ? `${filter.source}~${filter.sourceMetricType}`
    : `${filter.source}`;

const filterFromKey = (key: string) => {
  const [sourceId, metricType] = key.split('~');
  return {
    sourceId,
    metricType,
  };
};

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

  const filtersBySourceIdAndMetric = useMemo(() => {
    const filtersBySourceIdAndMetric = new Map<string, DashboardFilter[]>();
    for (const filter of filters) {
      const key = filterToKey(filter);
      if (!filtersBySourceIdAndMetric.has(key)) {
        filtersBySourceIdAndMetric.set(key, [filter]);
      } else {
        filtersBySourceIdAndMetric.get(key)!.push(filter);
      }
    }
    return filtersBySourceIdAndMetric;
  }, [filters]);

  const results: UseQueryResult<GetKeyValueCall<ChartConfigWithDateRange>[]>[] =
    useQueries({
      queries: Array.from(filtersBySourceIdAndMetric.entries())
        .filter(([key]) =>
          sources?.some(s => s.id === filterFromKey(key).sourceId),
        )
        .map(([key, filters]) => {
          const { sourceId, metricType } = filterFromKey(key);
          const source = sources!.find(s => s.id === sourceId)!;
          const keys = filters.map(f => f.expression);
          const tableName = getMetricTableName(source, metricType) ?? '';

          const chartConfig: ChartConfigWithDateRange = {
            ...pick(source, ['timestampValueExpression', 'connection']),
            from: {
              databaseName: source.from.databaseName,
              tableName,
            },
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
              metricType,
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

  const { data: sources, isLoading: isSourcesLoading } = useSources();
  const sourcesLookup = useMemo(() => mapKeyBy(sources ?? [], 'id'), [sources]);

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

      const source = sourcesLookup.get(chartConfig.source);

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
        enabled: !isLoadingOptimizedCalls && !isSourcesLoading,
        staleTime: 1000 * 60 * 5, // Cache every 5 min
        queryFn: async ({ signal }) =>
          metadata.getKeyValues({
            chartConfig,
            keys,
            limit: 10000,
            disableRowLimit: true,
            signal,
            source,
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
