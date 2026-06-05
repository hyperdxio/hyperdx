import { useMemo } from 'react';
import { pick } from 'lodash';
import {
  GetKeyValueCall,
  optimizeGetKeyValuesCalls,
} from '@hyperdx/common-utils/dist/core/materializedViews';
import {
  FilterState,
  filtersToQuery,
} from '@hyperdx/common-utils/dist/filters';
import {
  BuilderChartConfigWithDateRange,
  DashboardFilter,
  Filter,
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

type EnrichedCall = GetKeyValueCall<BuilderChartConfigWithDateRange> & {
  /** filterIds[i] = array of filter IDs whose values come from keys[i] */
  filterIds: string[][];
};

function useOptimizedKeyValuesCalls({
  filters,
  dateRange,
  filterValues,
}: {
  filters: DashboardFilter[];
  dateRange: [Date, Date];
  filterValues: FilterState;
}) {
  const clickhouseClient = useClickhouseClient();
  const metadata = useMetadataWithSettings();
  const { data: sources, isLoading: isLoadingSources } = useSources();

  // Faceted filtering: each filter's selectable values are narrowed by the
  // CURRENT selections of its sibling filters. For every filter, build the
  // constraint from the selections of the OTHER filters that target the same
  // source + metric type (so the constrained columns are guaranteed to exist in
  // the queried table), excluding the filter's own expression (otherwise a
  // multi-select would collapse to only its already-selected values).
  const constraintsByFilterId = useMemo(() => {
    const byId = new Map<string, Filter[]>();
    for (const filter of filters) {
      const prunedState: FilterState = {};
      for (const sibling of filters) {
        if (
          sibling.source !== filter.source ||
          sibling.sourceMetricType !== filter.sourceMetricType ||
          // Exclude-self: FilterState is keyed by expression, so a sibling that
          // shares this filter's expression carries this filter's own selection.
          sibling.expression === filter.expression
        ) {
          continue;
        }
        const selection = filterValues[sibling.expression];
        if (
          selection &&
          (selection.included.size > 0 ||
            selection.excluded.size > 0 ||
            selection.range != null)
        ) {
          prunedState[sibling.expression] = selection;
        }
      }
      byId.set(
        filter.id,
        filtersToQuery(prunedState, { stringifyKeys: false }),
      );
    }
    return byId;
  }, [filters, filterValues]);

  // Group filters by (source, metricType, where, whereLanguage) AND their
  // effective constraint signature, so each group can be tested for MV
  // compatibility separately. Filters with an identical constraint set — in
  // particular every currently-unselected filter of a source — stay batched in a
  // single key-values query; each selected filter (which omits its own
  // expression) splits into its own query.
  const filtersByGroupKey = useMemo(() => {
    const byGroupKey = new Map<
      string,
      { filters: DashboardFilter[]; constraints: Filter[] }
    >();
    for (const filter of filters) {
      const constraints = constraintsByFilterId.get(filter.id) ?? [];
      const constraintsSig = constraints
        .map(c => JSON.stringify(c))
        .sort()
        .join('|');
      const key = `${filterToKey(filter)}::${constraintsSig}`;
      const existing = byGroupKey.get(key);
      if (existing) {
        existing.filters.push(filter);
      } else {
        byGroupKey.set(key, { filters: [filter], constraints });
      }
    }
    return byGroupKey;
  }, [filters, constraintsByFilterId]);

  const results: UseQueryResult<EnrichedCall[]>[] = useQueries({
    queries: Array.from(filtersByGroupKey.values())
      .filter(({ filters: filtersInGroup }) =>
        sources?.some(s => s.id === filtersInGroup[0].source),
      )
      .map(({ filters: filtersInGroup, constraints }) => {
        const representative = filtersInGroup[0];
        const sourceId = representative.source;
        const metricType = representative.sourceMetricType;
        const where = representative.where ?? '';
        const whereLanguage = representative.whereLanguage ?? 'sql';
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
          // Sibling-selection constraints (faceted filtering); combined with the
          // static `where` via AND inside renderChartConfig.
          filters: constraints,
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
            constraints,
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
  filterValues = {},
}: {
  filters: DashboardFilter[];
  dateRange: [Date, Date];
  filterValues?: FilterState;
}) {
  const metadata = useMetadataWithSettings();
  const {
    data: calls,
    isFetching: isFetchingOptimizedCalls,
    isLoading: isLoadingOptimizedCalls,
  } = useOptimizedKeyValuesCalls({
    filters,
    dateRange,
    filterValues,
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
