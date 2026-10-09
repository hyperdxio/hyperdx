import { useEffect, useMemo, useRef, useState } from 'react';
import objectHash from 'object-hash';
import {
  ColumnMeta,
  ColumnMetaType,
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  Field,
  MetricNames,
  TableConnection,
  TableMetadata,
} from '@hyperdx/common-utils/dist/core/metadata';
import {
  FilterState,
  serializeFilterState,
} from '@hyperdx/common-utils/dist/filters';
import {
  BuilderChartConfigWithDateRange,
  isLogSource,
  isTraceSource,
} from '@hyperdx/common-utils/dist/types';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  UseQueryOptions,
} from '@tanstack/react-query';

import api from '@/api';
import { IS_LOCAL_MODE } from '@/config';
import { LOCAL_STORE_CONNECTIONS_KEY } from '@/connection';
import { DEFAULT_FILTER_KEYS_FETCH_LIMIT } from '@/defaults';
import { useStreamingQuery } from '@/hooks/useStreamingQuery';
import { getMetadata } from '@/metadata';
import { useSource, useSources } from '@/source';
import { toArray } from '@/utils';

export type Facet = { key: string; value: string[] };

// Hook to get metadata with proper settings applied
export function useMetadataWithSettings() {
  const [metadata, setMetadata] = useState(getMetadata());
  const { data: me } = api.useMe();
  const settingsAppliedRef = useRef(false);
  const queryClient = useQueryClient();

  // Create a listener that triggers when connections are updated in local mode
  useEffect(() => {
    const isBrowser =
      typeof window !== 'undefined' && typeof window.document !== 'undefined';
    if (!isBrowser || !IS_LOCAL_MODE) return;

    const createNewMetadata = (event: StorageEvent) => {
      if (event.key === LOCAL_STORE_CONNECTIONS_KEY && event.newValue) {
        // Create a new metadata instance with a new ClickHouse client,
        // since the existing one will not have connection / auth info.
        setMetadata(getMetadata());
        settingsAppliedRef.current = false;
        // Clear react-query cache so that metadata is refetched with
        // the new connection info, and error states are cleared.
        queryClient.resetQueries();
      }
    };

    window.addEventListener('storage', createNewMetadata);
    return () => {
      window.removeEventListener('storage', createNewMetadata);
    };
  }, [queryClient]);

  useEffect(() => {
    if (me?.team?.metadataMaxRowsToRead && !settingsAppliedRef.current) {
      metadata.setClickHouseSettings({
        max_rows_to_read: String(me.team.metadataMaxRowsToRead),
      });
      settingsAppliedRef.current = true;
    }
  }, [me?.team?.metadataMaxRowsToRead, metadata]);

  return metadata;
}

export function useColumns(
  {
    databaseName,
    tableName,
    connectionId,
  }: {
    databaseName: string;
    tableName: string;
    connectionId: string;
  },
  options?: Partial<UseQueryOptions<ColumnMeta[]>>,
) {
  const metadata = useMetadataWithSettings();
  return useQuery<ColumnMeta[]>({
    queryKey: [
      'useMetadata.useColumns',
      { connectionId, databaseName, tableName },
    ],
    queryFn: async () => {
      return metadata.getColumns({
        databaseName,
        tableName,
        connectionId,
      });
    },
    enabled: !!databaseName && !!tableName && !!connectionId,
    ...options,
  });
}

// Derives a map of DateTime/Date column name → ClickHouse type.
export function useDateTimeColumns(
  columns: ColumnMetaType[] | undefined,
): Map<string, string> {
  return useMemo(
    () =>
      new Map(
        filterColumnMetaByType(columns ?? [], [JSDataType.Date])?.map(
          c => [c.name, c.type] as const,
        ),
      ),
    [columns],
  );
}

/**
 * Resolves the Date/DateTime columns from two sources, with the live
 * query result taking precedence.
 *
 * - **Table schema** (`schemaColumns`): every column on the table, available
 *   before any query runs — but blind to SELECT aliases and computed
 *   expressions, which don't exist on the table.
 * - **Query result** (fed via the returned `onResolvedColumnsChange`): the
 *   resolved type of every column the current query actually returns, including
 *   aliases (`Timestamp AS time`) and expressions (`toDate(Timestamp)`). These
 *   are exactly the cells a user can click to filter on, so they win.
 */
export function useResolvedDateTimeColumns(
  schemaColumns: ColumnMetaType[] | undefined,
): {
  dateTimeColumns: Map<string, string>;
  onResolvedColumnsChange: (meta: ColumnMetaType[]) => void;
} {
  const schemaDateTimeColumns = useDateTimeColumns(schemaColumns);

  const [resultColumns, setResultColumns] = useState<ColumnMetaType[]>([]);
  const resultDateTimeColumns = useDateTimeColumns(resultColumns);

  const dateTimeColumns = useMemo(() => {
    const merged = new Map(schemaDateTimeColumns);

    // The query result is authoritative for the columns it returns. A column
    // can be a date on the table yet non-date as displayed (e.g.
    // `toString(Timestamp) AS Timestamp`); drop any such column so its string
    // value isn't wrongly date-wrapped.
    for (const { name } of resultColumns) {
      if (!resultDateTimeColumns.has(name)) merged.delete(name);
    }
    // Add or override the columns the query reports as dates — this is what
    // brings in aliases and computed expressions absent from the schema.
    for (const [name, type] of resultDateTimeColumns) merged.set(name, type);

    return merged;
  }, [schemaDateTimeColumns, resultDateTimeColumns, resultColumns]);

  return { dateTimeColumns, onResolvedColumnsChange: setResultColumns };
}

export function useJsonColumns(
  tableConnection: TableConnection | undefined,
  options?: Partial<UseQueryOptions<string[]>>,
) {
  const metadata = useMetadataWithSettings();
  return useQuery<string[]>({
    queryKey: ['useMetadata.useJsonColumns', tableConnection],
    queryFn: async () => {
      if (!tableConnection) return [];
      const columns = await metadata.getColumns(tableConnection);
      return (
        filterColumnMetaByType(columns, [JSDataType.JSON])?.map(
          column => column.name,
        ) ?? []
      );
    },
    enabled:
      tableConnection &&
      !!tableConnection.databaseName &&
      !!tableConnection.tableName &&
      !!tableConnection.connectionId,
    ...options,
  });
}

// Mirrors `useJsonColumns` for Map-typed columns. Used by `mergePath`
// callers (notably `DBSearchPageFilters`) so numeric-looking sub-keys on a
// Map render as `Map['key']` instead of the illegal array `Map[N+1]`.
// HDX-4369.
export function useMapColumns(
  tableConnection: TableConnection | undefined,
  options?: Partial<UseQueryOptions<string[]>>,
) {
  const metadata = useMetadataWithSettings();
  return useQuery<string[]>({
    queryKey: ['useMetadata.useMapColumns', tableConnection],
    queryFn: async () => {
      if (!tableConnection) return [];
      const columns = await metadata.getColumns(tableConnection);
      return (
        filterColumnMetaByType(columns, [JSDataType.Map])?.map(
          column => column.name,
        ) ?? []
      );
    },
    enabled:
      tableConnection &&
      !!tableConnection.databaseName &&
      !!tableConnection.tableName &&
      !!tableConnection.connectionId,
    ...options,
  });
}

export function useMultipleAllFields(
  tableConnections: TableConnection[],
  options?: Partial<UseQueryOptions<Field[]>> & {
    dateRange?: [Date, Date];
    timestampValueExpression?: string;
    // Return only fields present in EVERY table connection instead of the
    // union. Use for a shared expression (e.g. a chart-level Group By over
    // multiple series) that must be valid against all of them — the union
    // would offer fields that exist in one table but not another.
    intersect?: boolean;
  },
) {
  const metadata = useMetadataWithSettings();
  const { data: me, isFetched } = api.useMe();
  const {
    dateRange,
    timestampValueExpression,
    intersect,
    enabled: enabledOption = true,
    ...queryOptions
  } = options ?? {};
  return useQuery<Field[]>({
    queryKey: [
      'useMetadata.useMultipleAllFields',
      ...tableConnections.map(tc => ({ ...tc })),
      dateRange ? [dateRange[0].getTime(), dateRange[1].getTime()] : undefined,
      timestampValueExpression,
      intersect ?? false,
    ],
    queryFn: async () => {
      const team = me?.team;
      if (team?.fieldMetadataDisabled) {
        return [];
      }

      const promiseResults = await Promise.allSettled(
        tableConnections.map(tc =>
          metadata.getAllFields({
            ...tc,
            dateRange,
            timestampValueExpression:
              timestampValueExpression ?? tc.timestampValueExpression,
          }),
        ),
      );

      const fields2d: Field[][] = promiseResults.map(result => {
        if (result.status === 'rejected') {
          console.warn(
            'Failed to fetch fields for table connection',
            result.reason,
          );
          return [];
        }
        return result.value;
      });

      // skip set logic if not needed
      if (fields2d.length === 1) return fields2d[0];

      return intersect
        ? intersect2dArray<Field>(fields2d)
        : deduplicate2dArray<Field>(fields2d);
    },
    ...queryOptions,
    enabled:
      enabledOption &&
      tableConnections.length > 0 &&
      tableConnections.every(
        tc => !!tc.databaseName && !!tc.tableName && !!tc.connectionId,
      ) &&
      isFetched,
  });
}

export function useAllFields(
  tableConnection: TableConnection | undefined,
  options?: Partial<UseQueryOptions<Field[]>> & {
    dateRange?: [Date, Date];
    timestampValueExpression?: string;
  },
) {
  return useMultipleAllFields(
    tableConnection ? [tableConnection] : [],
    options,
  );
}

export function useTableMetadata(
  {
    databaseName,
    tableName,
    connectionId,
  }: {
    databaseName: string;
    tableName: string;
    connectionId: string;
  },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  const metadata = useMetadataWithSettings();
  return useQuery<TableMetadata | undefined>({
    queryKey: [
      'useMetadata.useTableMetadata',
      { connectionId, databaseName, tableName },
    ],
    queryFn: async () => {
      return await metadata.getTableMetadata({
        databaseName,
        tableName,
        connectionId,
      });
    },
    staleTime: 1000 * 60 * 5, // Cache every 5 min
    enabled: !!databaseName && !!tableName && !!connectionId,
    ...options,
  });
}

/** How many keys a filter values query reads, per the team's setting. */
export function useFilterKeysFetchLimit() {
  const { data: me } = api.useMe();
  return me?.team?.filterKeysFetchLimit ?? DEFAULT_FILTER_KEYS_FETCH_LIMIT;
}

export function useMultipleGetKeyValues(
  {
    chartConfigs,
    keys,
    keyConditions,
    limit,
    disableRowLimit,
  }: {
    chartConfigs:
      | BuilderChartConfigWithDateRange
      | BuilderChartConfigWithDateRange[];
    keys: string[];
    /** Per-key constraints for faceted value lookups. */
    keyConditions?: (FilterState | undefined)[];
    limit?: number;
    disableRowLimit?: boolean;
  },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  const metadata = useMetadataWithSettings();
  const chartConfigsArr = toArray(chartConfigs);

  const { enabled = true } = options || {};
  const { isLoading: isLoadingMe } = api.useMe();
  const { data: sources, isLoading: isLoadingSources } = useSources();
  const maxKeys = useFilterKeysFetchLimit();

  const query = useQuery<Facet[]>({
    queryKey: [
      'useMetadata.useGetKeyValues',
      ...chartConfigsArr.map(cc => ({ ...cc })),
      ...keys,
      // Serialized: react-query hashes keys with JSON.stringify, which would
      // flatten every distinct Set selection to `{}`.
      keyConditions?.map(c => c && serializeFilterState(c)),
      disableRowLimit,
      maxKeys,
    ],
    queryFn: async ({ signal }) => {
      return (
        await Promise.all(
          chartConfigsArr.map(chartConfig => {
            const source = chartConfig.source
              ? sources?.find(s => s.id === chartConfig.source)
              : undefined;
            return metadata.getKeyValuesWithMVs({
              chartConfig,
              keys: keys.slice(0, maxKeys),
              keyConditions: keyConditions?.slice(0, maxKeys),
              limit,
              disableRowLimit,
              source,
              signal,
            });
          }),
        )
      ).flatMap(v => v);
    },
    staleTime: 1000 * 60 * 5, // Cache every 5 min
    placeholderData: keepPreviousData,
    ...options,
    enabled: !!enabled && !!keys.length && !isLoadingSources && !isLoadingMe,
  });

  return {
    ...query,
    isLoading: query.isLoading || isLoadingSources,
  };
}

export function useGetValuesDistribution(
  {
    chartConfig,
    key,
    limit,
  }: {
    chartConfig: BuilderChartConfigWithDateRange;
    key: string;
    limit: number;
  },
  options?: Omit<UseQueryOptions<Map<string, number>, Error>, 'queryKey'>,
) {
  const metadata = useMetadataWithSettings();
  const { data: source, isLoading: isLoadingSource } = useSource({
    id: chartConfig.source,
  });

  return useQuery<Map<string, number>>({
    queryKey: ['useMetadata.useGetValuesDistribution', chartConfig, key],
    queryFn: async () => {
      return await metadata.getValuesDistribution({
        chartConfig,
        key,
        limit,
        source,
      });
    },
    staleTime: Infinity,
    enabled: !!key && !isLoadingSource,
    placeholderData: keepPreviousData,
    retry: false,
    ...options,
  });
}

export function useGetKeyValues(
  {
    chartConfig,
    keys,
    keyConditions,
    limit,
    disableRowLimit,
  }: {
    chartConfig?: BuilderChartConfigWithDateRange;
    keys: string[];
    /** Per-key constraints for faceted value lookups (groupUniqArrayIf). */
    keyConditions?: (FilterState | undefined)[];
    limit?: number;
    disableRowLimit?: boolean;
  },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  return useMultipleGetKeyValues(
    {
      chartConfigs: chartConfig ? [chartConfig] : [],
      keys,
      keyConditions,
      limit,
      disableRowLimit,
    },
    options,
  );
}

const facetKey = (facet: Facet) => facet.key;

/**
 * Values for each key across the whole date range, ignoring the search
 * filters. `Metadata.getAllKeyValues` routes each key to a text index, the
 * metadata materialized views, or a raw table scan; each of those queries'
 * values show up as soon as it lands, rather than after the slowest one.
 *
 * Facets arrive in whatever order the queries finish. While a new date range
 * streams, the previous range's values stay in place until replaced.
 */
export function useAllKeyValues(
  {
    chartConfig,
    keys,
    limit = 20,
  }: {
    chartConfig: BuilderChartConfigWithDateRange;
    keys: string[];
    /** Values per key. */
    limit?: number;
  },
  { enabled = true }: { enabled?: boolean } = {},
) {
  const metadata = useMetadataWithSettings();
  const { isLoading: isLoadingMe } = api.useMe();
  const { data: sources, isLoading: isLoadingSources } = useSources();
  const maxKeys = useFilterKeysFetchLimit();
  const keysToFetch = useMemo(() => keys.slice(0, maxKeys), [keys, maxKeys]);

  const source = chartConfig.source
    ? sources?.find(s => s.id === chartConfig.source)
    : undefined;
  const metadataMVs =
    source && (isLogSource(source) || isTraceSource(source))
      ? source.metadataMaterializedViews
      : undefined;

  const {
    connection: connectionId,
    from: { databaseName, tableName },
    dateRange,
    timestampValueExpression,
  } = chartConfig;

  const streamed = useStreamingQuery<Facet>({
    queryKey: [
      'useMetadata.useAllKeyValues',
      connectionId,
      databaseName,
      tableName,
      timestampValueExpression,
      dateRange[0].getTime(),
      dateRange[1].getTime(),
      metadataMVs,
      limit,
      keysToFetch,
    ],
    // Not memoized: read when the query runs, not hashed into its key.
    streamFactory: async function* ({ signal }) {
      for await (const keyValues of metadata.streamAllKeyValues({
        databaseName,
        tableName,
        connectionId,
        keyExpressions: keysToFetch,
        maxValuesPerKey: limit,
        metadataMVs,
        dateRange,
        timestampValueExpression,
        signal,
      })) {
        yield keyValues.map(({ key, value }) => ({
          key,
          value: value.map(val => val.toString()),
        }));
      }
    },
    enabled:
      enabled && keysToFetch.length > 0 && !isLoadingSources && !isLoadingMe,
    itemKey: facetKey,
  });

  return {
    data: streamed.data,
    error: streamed.error,
    isError: streamed.isError,
    isFetching: streamed.isStreaming,
    // Only until the first values land; the stream then fills in.
    isLoading: (!streamed.data && streamed.isStreaming) || isLoadingSources,
  };
}

/**
 * List metric names for one metrics table, ordered and matched server-side.
 *
 * Prefer this over `useGetKeyValues({ keys: ['MetricName'] })`, which samples an
 * arbitrary subset via `groupUniqArray` and can silently omit metrics on
 * high-cardinality sources.
 */
export function useGetMetricNames(
  {
    databaseName,
    tableName,
    connectionId,
    dateRange,
    timestampValueExpression,
    namePattern,
  }: {
    databaseName: string;
    tableName: string;
    connectionId: string;
    dateRange: [Date, Date];
    timestampValueExpression: string;
    namePattern?: string;
  },
  options?: Partial<UseQueryOptions<MetricNames>>,
) {
  const metadata = useMetadataWithSettings();
  return useQuery<MetricNames>({
    queryKey: [
      'useMetadata.useGetMetricNames',
      {
        databaseName,
        tableName,
        connectionId,
        dateRange,
        timestampValueExpression,
        namePattern,
      },
    ],
    queryFn: async ({ signal }) =>
      metadata.getMetricNames({
        databaseName,
        tableName,
        connectionId,
        dateRange,
        timestampValueExpression,
        namePattern,
        signal,
      }),
    // An empty table name means the source has no table for this metric kind.
    enabled:
      !!databaseName &&
      !!tableName &&
      !!connectionId &&
      !!timestampValueExpression,
    placeholderData: keepPreviousData,
    // Four of these run per debounced keystroke, each an unbounded aggregation
    // capped only by execution time. Retrying would turn one slow pattern into
    // sixteen such scans, and refetching on focus would re-run them all — the
    // replaced MetadataCache path served repeats from memory, so without these
    // this would be busier than what it replaced.
    retry: false,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    ...options,
  });
}

export function deduplicate2dArray<T extends object>(array2d: T[][]): T[] {
  // deduplicate common fields
  const array: T[] = [];
  const set = new Set<string>();
  for (const _array of array2d) {
    for (const elem of _array) {
      const key = objectHash.sha1(elem);
      if (set.has(key)) continue;
      set.add(key);
      array.push(elem);
    }
  }
  return array;
}

// Keep only elements present in every sub-array (set intersection). A rejected
// fetch yields an empty sub-array, which correctly collapses the result to
// empty — fail closed rather than offer a field that isn't in every table.
export function intersect2dArray<T extends object>(array2d: T[][]): T[] {
  if (array2d.length === 0) return [];
  const counts = new Map<string, { elem: T; n: number }>();
  for (const _array of array2d) {
    const seenInArray = new Set<string>();
    for (const elem of _array) {
      const key = objectHash.sha1(elem);
      if (seenInArray.has(key)) continue; // dedupe within a table first
      seenInArray.add(key);
      const entry = counts.get(key);
      if (entry) entry.n += 1;
      else counts.set(key, { elem, n: 1 });
    }
  }
  return Array.from(counts.values())
    .filter(({ n }) => n === array2d.length)
    .map(({ elem }) => elem);
}
