import { useMemo } from 'react';
import { pick } from 'lodash';
import {
  GetKeyValueCall,
  optimizeGetKeyValuesCalls,
} from '@hyperdx/common-utils/dist/core/materializedViews';
import {
  BuilderChartConfigWithDateRange,
  DashboardFilter,
  isLogSource,
  isTraceSource,
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

type FilterSourceKey = {
  sourceId: string;
  metricType?: string;
  where: string;
  whereLanguage: 'sql' | 'lucene' | 'promql';
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
  const clickhouseClient = useClickhouseClient();
  const metadata = useMetadataWithSettings();
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
        const tableName = getMetricTableName(source, metricType) ?? '';

        const chartConfig: BuilderChartConfigWithDateRange = {
          ...pick(source, ['timestampValueExpression', 'connection']),
          from: {
            databaseName: source.from.databaseName,
            tableName,
          },
          implicitColumnExpression:
            isTraceSource(source) || isLogSource(source)
              ? source.implicitColumnExpression
              : undefined,
          // Logs-only body fallback for bare-text Lucene search.
          bodyExpression: isLogSource(source)
            ? source.bodyExpression
            : undefined,
          useTextIndexForImplicitColumn:
            isTraceSource(source) || isLogSource(source)
              ? source.useTextIndexForImplicitColumn
              : undefined,
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
          staleTime: 1000 * 60 * 5, // Cache every 5 min
          queryFn: async ({ signal }) => {
            const calls = await optimizeGetKeyValuesCalls({
              chartConfig,
              source,
              clickhouseClient,
              metadata,
              keys: keyExpressions,
              signal,
            });
            // Enrich each call with the filter IDs that correspond to each key expression
            return calls.map(call => ({
              ...call,
              filterIds: call.keys.map(expression =>
                filtersInGroup
                  .filter(f => f.expression === expression)
                  .map(f => f.id),
              ),
            }));
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
  //
  // We iterate over the *requested* keys (not just the returned rows) so that a
  // filter whose query returned no rows — or failed outright — still gets an
  // entry (with empty `values`). Without this, such filters would be missing
  // from the map entirely, and any consumer that derives "is still loading"
  // from the entry's absence would leave the control stuck disabled forever.
  // Failed filter IDs are tracked separately so callers can surface a warning
  // while keeping the control interactive.
  const { data: flattenedData, erroredFilterIds } = useMemo(() => {
    const map = new Map<string, { values: string[]; isLoading: boolean }>();
    const errored = new Set<string>();
    results.forEach((result, resultIndex) => {
      const call = calls[resultIndex];
      if (!call) return;
      const { isLoading, isError, data = [] } = result;
      const valuesByExpression = new Map<string, string[]>(
        data.map(({ key, value }) => [key, value.map(v => v.toString())]),
      );
      call.keys.forEach((expression, keyIndex) => {
        const filterIds = call.filterIds?.[keyIndex] ?? [];
        const values = valuesByExpression.get(expression) ?? [];
        for (const filterId of filterIds) {
          map.set(filterId, { values, isLoading });
          if (isError) {
            errored.add(filterId);
          }
        }
      });
    });
    return { data: map, erroredFilterIds: errored };
  }, [results, calls]);

  return {
    data: flattenedData,
    /** Filter IDs whose key-values query failed. */
    erroredFilterIds,
    isLoading: isLoadingOptimizedCalls || results.every(r => r.isLoading),
    isFetching: isFetchingOptimizedCalls || results.some(r => r.isFetching),
    isError: results.some(r => r.isError),
  };
}
