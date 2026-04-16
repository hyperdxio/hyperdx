import { useEffect, useRef, useState } from 'react';
import objectHash from 'object-hash';
import {
  ColumnMeta,
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  Field,
  TableConnection,
  TableMetadata,
} from '@hyperdx/common-utils/dist/core/metadata';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
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
import { getMetadata } from '@/metadata';
import { useSource, useSources } from '@/source';
import { toArray } from '@/utils';

// Hook to get metadata with proper settings applied
export function useMetadataWithSettings() {
  const [metadata, setMetadata] = useState(getMetadata());
  const { data: me } = api.useMe();
  const settingsApplied = useRef(false);
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
        settingsApplied.current = false;
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
    if (me?.team?.metadataMaxRowsToRead && !settingsApplied.current) {
      metadata.setClickHouseSettings({
        max_rows_to_read: String(me.team.metadataMaxRowsToRead),
      });
      settingsApplied.current = true;
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
    queryKey: ['useMetadata.useColumns', { databaseName, tableName }],
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

export function useMultipleAllFields(
  tableConnections: TableConnection[],
  options?: Partial<UseQueryOptions<Field[]>> & {
    dateRange?: [Date, Date];
  },
) {
  const metadata = useMetadataWithSettings();
  const { data: me, isFetched } = api.useMe();
  const { dateRange, ...queryOptions } = options ?? {};
  return useQuery<Field[]>({
    queryKey: [
      'useMetadata.useMultipleAllFields',
      ...tableConnections.map(tc => ({ ...tc })),
      dateRange?.[0]?.getTime(),
      dateRange?.[1]?.getTime(),
    ],
    queryFn: async () => {
      const team = me?.team;
      if (team?.fieldMetadataDisabled) {
        return [];
      }

      const promiseResults = await Promise.allSettled(
        tableConnections.map(tc => metadata.getAllFields({ ...tc, dateRange })),
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

      // skip deduplication if not needed
      if (fields2d.length === 1) return fields2d[0];

      return deduplicate2dArray<Field>(fields2d);
    },
    enabled:
      tableConnections.length > 0 &&
      tableConnections.every(
        tc => !!tc.databaseName && !!tc.tableName && !!tc.connectionId,
      ) &&
      isFetched,
    ...queryOptions,
  });
}

/**
 * Resolves a field to the (ColumnIdentifier, Key) pair for querying the rollup table.
 * Map fields: ColumnIdentifier = column name (e.g. 'ResourceAttributes'), Key = map key
 * Native fields: ColumnIdentifier = 'NativeColumn', Key = column name (e.g. 'ServiceName')
 *
 * Only returns a result when the table connection has metadataMVs configured.
 */
function fieldToRollupParams(
  field: Field | null,
  tableConnection: TableConnection | undefined,
): { columnIdentifier: string; key: string } | null {
  if (!field || !tableConnection?.metadataMVs) return null;

  if (field.path.length >= 2) {
    const [column, mapKey] = field.path;
    return { columnIdentifier: column, key: mapKey };
  } else if (field.path.length === 1) {
    return { columnIdentifier: 'NativeColumn', key: field.path[0] };
  }

  return null;
}

/**
 * Debounced hook that fetches values for a specific field from rollup tables.
 * Works for both map keys (e.g. "ResourceAttributes.http.method") and
 * native columns (e.g. "ServiceName").
 */
export function useCompleteKeyValues({
  tableConnection,
  searchField,
  dateRange,
}: {
  tableConnection: TableConnection | undefined;
  searchField: Field | null;
  dateRange: [Date, Date];
}) {
  const metadata = useMetadataWithSettings();

  // Debounce: only query after the field stabilizes for 300ms
  const [debouncedField, setDebouncedField] = useState<Field | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedField(searchField), 300);
    return () => clearTimeout(timer);
  }, [searchField]);

  const rollupParams = fieldToRollupParams(debouncedField, tableConnection);

  return useQuery<string[]>({
    queryKey: [
      'useCompleteKeyValues',
      tableConnection?.databaseName,
      tableConnection?.tableName,
      tableConnection?.connectionId,
      rollupParams?.columnIdentifier,
      rollupParams?.key,
      dateRange[0].getTime(),
      dateRange[1].getTime(),
    ],
    queryFn: async ({ signal }) => {
      if (!tableConnection || !rollupParams || !debouncedField) return [];

      // Try rollup first
      const rollupValues = await metadata.getCompleteKeyValues({
        databaseName: tableConnection.databaseName,
        tableName: tableConnection.tableName,
        column: rollupParams.columnIdentifier,
        key: rollupParams.key,
        connectionId: tableConnection.connectionId,
        metadataMVs: tableConnection.metadataMVs,
        dateRange,
        signal,
      });

      if (rollupValues.length > 0) return rollupValues;

      // Fall back to main table scan
      if (rollupParams.columnIdentifier !== 'NativeColumn') {
        // Map column: use getMapValues
        return metadata.getMapValues({
          databaseName: tableConnection.databaseName,
          tableName: tableConnection.tableName,
          column: rollupParams.columnIdentifier,
          key: rollupParams.key,
          connectionId: tableConnection.connectionId,
        });
      } else {
        // Native column: use getMapValues without a key (queries column directly)
        return metadata.getMapValues({
          databaseName: tableConnection.databaseName,
          tableName: tableConnection.tableName,
          column: debouncedField.path[0],
          connectionId: tableConnection.connectionId,
        });
      }
    },
    staleTime: 1000 * 60 * 5,
    enabled: !!rollupParams,
  });
}

export function useAllFields(
  tableConnection: TableConnection | undefined,
  options?: Partial<UseQueryOptions<Field[]>> & {
    dateRange?: [Date, Date];
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
    queryKey: ['useMetadata.useTableMetadata', { databaseName, tableName }],
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

export function useMultipleGetKeyValues(
  {
    chartConfigs,
    keys,
    limit,
    disableRowLimit,
  }: {
    chartConfigs:
      | BuilderChartConfigWithDateRange
      | BuilderChartConfigWithDateRange[];
    keys: string[];
    limit?: number;
    disableRowLimit?: boolean;
  },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  const metadata = useMetadataWithSettings();
  const chartConfigsArr = toArray(chartConfigs);

  const { enabled = true } = options || {};
  const { data: me, isLoading: isLoadingMe } = api.useMe();
  const { data: sources, isLoading: isLoadingSources } = useSources();

  const maxKeys =
    me?.team?.filterKeysFetchLimit ?? DEFAULT_FILTER_KEYS_FETCH_LIMIT;

  const query = useQuery<{ key: string; value: string[] }[]>({
    queryKey: [
      'useMetadata.useGetKeyValues',
      ...chartConfigsArr.map(cc => ({ ...cc })),
      ...keys,
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
    limit,
    disableRowLimit,
  }: {
    chartConfig?: BuilderChartConfigWithDateRange;
    keys: string[];
    limit?: number;
    disableRowLimit?: boolean;
  },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  return useMultipleGetKeyValues(
    {
      chartConfigs: chartConfig ? [chartConfig] : [],
      keys,
      limit,
      disableRowLimit,
    },
    options,
  );
}

export function deduplicateArray<T extends object>(array: T[]): T[] {
  return deduplicate2dArray([array]);
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
