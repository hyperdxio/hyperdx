import { useMemo } from 'react';
import { pick } from 'lodash';
import {
  GetKeyValueCall,
  optimizeFacetedKeyValuesConfig,
  optimizeGetKeyValuesCalls,
} from '@hyperdx/common-utils/dist/core/materializedViews';
import {
  FilterState,
  filtersToQuery,
} from '@hyperdx/common-utils/dist/filters';
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

type EnrichedCall = GetKeyValueCall<BuilderChartConfigWithDateRange> & {
  /** filterIds[i] = array of filter IDs whose values come from keys[i] */
  filterIds: string[][];
  /** Per-key SQL predicate for faceted lookups, aligned with `keys`. */
  keyConditions?: (string | undefined)[];
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
  // CURRENT selections of its sibling filters. For every filter, build a SQL
  // predicate from the selections of the OTHER filters that target the same
  // source + metric type (so the constrained columns exist in the queried
  // table), EXCLUDING the filter's own expression (otherwise a multi-select
  // would collapse to only its already-selected values). Expressing it as a
  // per-key predicate lets all of a source's filters resolve in one
  // `groupUniqArrayIf` scan instead of one query per filter.
  const conditionByFilterId = useMemo(() => {
    const byId = new Map<string, string | undefined>();
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
      const predicates = filtersToQuery(prunedState, {
        stringifyKeys: false,
        // filtersToQuery only emits `sql` filters (which carry `condition`); the
        // `in` guard narrows away the `sql_ast` member of the Filter union.
      }).flatMap(f => ('condition' in f ? [f.condition] : []));
      byId.set(
        filter.id,
        predicates.length
          ? predicates.map(c => `(${c})`).join(' AND ')
          : undefined,
      );
    }
    return byId;
  }, [filters, filterValues]);

  // Group filters by (source, metricType, where, whereLanguage). Every filter in
  // a group is resolved together: an unconstrained group goes through the MV
  // optimizer (one batched, rollup-eligible query); a constrained group runs a
  // single faceted `groupUniqArrayIf` scan carrying a per-key condition.
  const filtersByGroupKey = useMemo(() => {
    const byGroupKey = new Map<string, DashboardFilter[]>();
    for (const filter of filters) {
      const key = filterToKey(filter);
      const existing = byGroupKey.get(key);
      if (existing) {
        existing.push(filter);
      } else {
        byGroupKey.set(key, [filter]);
      }
    }
    return byGroupKey;
  }, [filters]);

  const results: UseQueryResult<EnrichedCall[]>[] = useQueries({
    queries: Array.from(filtersByGroupKey.values())
      .filter(filtersInGroup =>
        sources?.some(s => s.id === filtersInGroup[0].source),
      )
      .map(filtersInGroup => {
        const representative = filtersInGroup[0];
        const sourceId = representative.source;
        const metricType = representative.sourceMetricType;
        const where = representative.where ?? '';
        const whereLanguage = representative.whereLanguage ?? 'sql';
        const source = sources!.find(s => s.id === sourceId)!;
        const keyExpressions = filtersInGroup.map(f => f.expression);
        const keyConditions = filtersInGroup.map(f =>
          conditionByFilterId.get(f.id),
        );
        const isFaceted = keyConditions.some(c => c != null);
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

        const filterIdsForKeys = (keys: string[]) =>
          keys.map(expression =>
            filtersInGroup
              .filter(f => f.expression === expression)
              .map(f => f.id),
          );

        return {
          queryKey: [
            'dashboard-filters-key-value-calls',
            sourceId,
            metricType,
            dateRange,
            keyExpressions,
            where,
            whereLanguage,
            keyConditions,
          ],
          enabled: !isLoadingSources,
          staleTime: 1000 * 60 * 5, // Cache every 5 min
          queryFn: async ({ signal }): Promise<EnrichedCall[]> => {
            // Constrained: resolve every key in one faceted scan
            // (groupUniqArrayIf). A per-key condition can't be split across
            // single-key MVs, but it can run against one MV whose dimensions
            // cover every filter column (else the raw table).
            if (isFaceted) {
              const facetedConfig = await optimizeFacetedKeyValuesConfig({
                chartConfig,
                keys: keyExpressions,
                keyConditions,
                source,
                clickhouseClient,
                metadata,
                signal,
              });
              return [
                {
                  chartConfig: facetedConfig,
                  keys: keyExpressions,
                  keyConditions,
                  filterIds: filterIdsForKeys(keyExpressions),
                },
              ];
            }
            // Unconstrained: let the MV optimizer batch / route to rollups.
            const calls = await optimizeGetKeyValuesCalls({
              chartConfig,
              source,
              clickhouseClient,
              metadata,
              keys: keyExpressions,
              signal,
            });
            return calls.map(call => ({
              ...call,
              filterIds: filterIdsForKeys(call.keys),
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
    queries: calls.map(({ chartConfig, keys, keyConditions }) => {
      // Construct a query key prefix which will allow us to use placeholder data from the previous query for the same keys
      const queryKeyPrefix = [
        'dashboard-filter-key-values',
        chartConfig.from,
        keys,
      ];

      const source = sourcesLookup.get(chartConfig.source);

      return {
        queryKey: [...queryKeyPrefix, chartConfig, keyConditions],
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
            keyConditions,
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
