import { useMemo } from 'react';
import {
  ResolvedPromqlLabelFilterMatch,
  resolvePromqlLabelFilterMatch,
} from '@hyperdx/common-utils/dist/filters';
import {
  ChartVariable,
  isPromqlSource,
  PromqlLabelDashboardFilter,
} from '@hyperdx/common-utils/dist/types';
import {
  useQueries,
  useQueryClient,
  UseQueryResult,
} from '@tanstack/react-query';

import { prometheusApi } from '@/api';
import { useSources } from '@/source';
import { mapKeyBy } from '@/utils';

type LabelValuesCall = {
  filterId: string;
  connectionId: string;
  database?: string;
  table?: string;
  label: string;
  match?: string;
};

const SOURCE_ERROR =
  'This filter points at a source that no longer exists, or is not a PromQL source.';

export function usePromqlLabelFilterValues({
  filters,
  dateRange,
  variables,
}: {
  filters: PromqlLabelDashboardFilter[];
  dateRange: [Date, Date];
  /** The dashboard's variables and their current selections, if any */
  variables?: ChartVariable[];
}) {
  const { data: sources, isLoading: isLoadingSources } = useSources();
  const sourcesById = useMemo(() => mapKeyBy(sources ?? [], 'id'), [sources]);

  // Round the date range, since the API accepts whole seconds
  const startSec = Math.floor(dateRange[0].getTime() / 1000);
  const endSec = Math.ceil(dateRange[1].getTime() / 1000);

  // A filter's selector may reference the dashboard's variables. Expand them
  // here so react-query keys on the resolved selector rather than the template.
  const resolvedByFilterId = useMemo(() => {
    const byId = new Map<string, ResolvedPromqlLabelFilterMatch>();
    for (const filter of filters) {
      byId.set(filter.id, resolvePromqlLabelFilterMatch(filter, variables));
    }
    return byId;
  }, [filters, variables]);

  const { calls, unresolvedFilterIds } = useMemo(() => {
    const resolved: LabelValuesCall[] = [];
    const unresolved: string[] = [];

    for (const filter of filters) {
      const source = sourcesById.get(filter.source);
      if (!source || !isPromqlSource(source)) {
        // While sources are still loading every filter looks unresolved; hold
        // off on calling that an error until the list has actually arrived.
        if (!isLoadingSources) unresolved.push(filter.id);
        continue;
      }
      // An unexpanded `$var` left in the selector is certain to be rejected
      // upstream, and the expansion failure is the better message, so don't call
      const resolvedMatch = resolvedByFilterId.get(filter.id);
      if (resolvedMatch?.error) continue;
      resolved.push({
        filterId: filter.id,
        connectionId: source.connection,
        database: source.from.databaseName,
        table: source.from.tableName,
        label: filter.label,
        match: resolvedMatch?.match,
      });
    }

    return { calls: resolved, unresolvedFilterIds: unresolved };
  }, [filters, sourcesById, isLoadingSources, resolvedByFilterId]);

  const queryClient = useQueryClient();

  const results: UseQueryResult<string[]>[] = useQueries({
    queries: calls.map(call => {
      // Everything but the time bounds, so a range change can reuse the last
      // values as placeholders instead of blanking the dropdown.
      const queryKeyPrefix = [
        'dashboard-filter-promql-label-values',
        call.connectionId,
        call.database,
        call.table,
        call.label,
        call.match,
      ];
      return {
        queryKey: [...queryKeyPrefix, startSec, endSec],
        placeholderData: () => {
          const cached = queryClient
            .getQueriesData<string[]>({ queryKey: queryKeyPrefix })
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
        staleTime: 1000 * 60 * 5,
        queryFn: async (): Promise<string[]> => {
          const resp = await prometheusApi.labelValues({
            label: call.label,
            connectionId: call.connectionId,
            database: call.database,
            table: call.table,
            start: startSec,
            end: endSec,
            match: call.match,
          });
          if (resp.status === 'error') {
            throw new Error(resp.error ?? 'Label values query failed');
          }
          return resp.data ?? [];
        },
      };
    }),
  });

  return useMemo(() => {
    const data = new Map<string, { values: string[]; isLoading: boolean }>();
    const erroredFilterIds = new Set<string>();
    const filterErrorMessages = new Map<string, string>();

    results.forEach((result, index) => {
      const call = calls[index];
      if (!call) return;
      data.set(call.filterId, {
        values: result.data ?? [],
        isLoading: result.isLoading,
      });
      if (result.isError) {
        erroredFilterIds.add(call.filterId);
        if (result.error instanceof Error) {
          filterErrorMessages.set(call.filterId, result.error.message);
        }
      }
    });

    for (const filterId of unresolvedFilterIds) {
      data.set(filterId, { values: [], isLoading: false });
      erroredFilterIds.add(filterId);
      filterErrorMessages.set(filterId, SOURCE_ERROR);
    }

    for (const [filterId, resolved] of resolvedByFilterId) {
      if (!resolved.error) continue;
      data.set(filterId, { values: [], isLoading: false });
      erroredFilterIds.add(filterId);
      filterErrorMessages.set(filterId, resolved.error);
    }

    return {
      data,
      erroredFilterIds,
      filterErrorMessages,
      isLoading: isLoadingSources || results.some(r => r.isLoading),
      isFetching: isLoadingSources || results.some(r => r.isFetching),
      isError: erroredFilterIds.size > 0,
    };
  }, [
    results,
    calls,
    unresolvedFilterIds,
    isLoadingSources,
    resolvedByFilterId,
  ]);
}
