import { useMemo } from 'react';
import {
  BuilderChartConfigWithDateRange,
  DashboardFilter,
} from '@berg/common-utils/dist/types';
import {
  useQueries,
  useQueryClient,
  UseQueryResult,
} from '@tanstack/react-query';

import { useSources } from '@/source';
import { mapKeyBy } from '@/utils';

import { useMetadataWithSettings } from './useMetadata';

type GetKeyValueCall<C> = { chartConfig: C; keys: string[] };

type FilterSourceKey = {
  sourceId: string;
  metricType?: string;
  where: string;
  whereLanguage: 'sql' | 'lucene';
};

const filterToKey = (filter: DashboardFilter): string =>
  JSON.stringify({
    sourceId: filter.source,
    metricType: filter.sourceMetricType,
    where: filter.where ?? '',
    whereLanguage: filter.whereLanguage ?? 'sql',
  } satisfies FilterSourceKey);

const filterFromKey = (key: string): FilterSourceKey =>
  JSON.parse(key) as FilterSourceKey;

type EnrichedCall = GetKeyValueCall<BuilderChartConfigWithDateRange> & {
  /** filterIds[i] = array of filter IDs whose values come from keys[i] */
  filterIds: string[][];
};

function useOptimizedKeyValuesCalls({
  filters,
  dateRange,
}: {
  filters: DashboardFilter[];
  dateRange: [Date, Date];
}) {
  const { data: sources, isLoading: isLoadingSources } = useSources();

  // Group filters by (source, metricType, where, whereLanguage) so that we can test each group for MV compatibility separately.
  const filtersByGroupKey = useMemo(() => {
    const filtersByGroupKey = new Map<string, DashboardFilter[]>();
    for (const filter of filters) {
      const key = filterToKey(filter);
      if (!filtersByGroupKey.has(key)) {
        filtersByGroupKey.set(key, [filter]);
      } else {
        filtersByGroupKey.get(key)!.push(filter);
      }
    }
    return filtersByGroupKey;
  }, [filters]);

  const results: UseQueryResult<EnrichedCall[]>[] = useQueries({
    queries: Array.from(filtersByGroupKey.entries())
      .filter(([key]) =>
        sources?.some(s => s.id === filterFromKey(key).sourceId),
      )
      .map(([key, filtersInGroup]) => {
        const { sourceId, metricType, where, whereLanguage } =
          filterFromKey(key);
        const source = sources!.find(s => s.id === sourceId)!;
        const keyExpressions = filtersInGroup.map(f => f.expression);

        const chartConfig: BuilderChartConfigWithDateRange = {
          timestampValueExpression: source.timestampColumn ?? '',
          connection: '',
          from: {
            databaseName: source.database,
            tableName: source.table,
          },
          dateRange,
          source: source.id,
          where,
          whereLanguage,
          select: '',
        };

        return {
          queryKey: [
            'dashboard-filters-key-value-calls',
            sourceId,
            metricType,
            dateRange,
            keyExpressions,
            where,
            whereLanguage,
          ],
          enabled: !isLoadingSources,
          staleTime: 1000 * 60 * 5,
          queryFn: async () => {
            // Berg has no MV optimisation; emit a single direct call.
            const calls: EnrichedCall[] = [
              {
                chartConfig,
                keys: keyExpressions,
                filterIds: keyExpressions.map(expression =>
                  filtersInGroup
                    .filter(f => f.expression === expression)
                    .map(f => f.id),
                ),
              },
            ];
            return calls;
          },
        };
      }),
  });

  return {
    data: results.map(r => r.data ?? []).flat(),
    isFetching: isLoadingSources || results.some(r => r.isFetching),
    isLoading: isLoadingSources || results.every(r => r.isLoading),
  };
}

export function useDashboardFilterValues({
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

  // Map results by filter ID instead of expression so that two filters with
  // the same expression but different sources/WHERE clauses get distinct values.
  const flattenedData = useMemo(
    () =>
      new Map(
        results.flatMap(({ isLoading, data = [] }, resultIndex) => {
          const call = calls[resultIndex];
          return data.flatMap(({ key: expression, value }) => {
            const keyIndex = call.keys.indexOf(expression);
            const filterIds = call.filterIds?.[keyIndex] ?? [];
            const entry = {
              values: value.map(v => v.toString()),
              isLoading,
            };
            return filterIds.map(
              filterId => [filterId, entry] as [string, typeof entry],
            );
          });
        }),
      ),
    [results, calls],
  );

  return {
    data: flattenedData,
    isLoading: isLoadingOptimizedCalls || results.every(r => r.isLoading),
    isFetching: isFetchingOptimizedCalls || results.some(r => r.isFetching),
    isError: results.some(r => r.isError),
  };
}
