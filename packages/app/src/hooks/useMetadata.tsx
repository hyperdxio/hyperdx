import { useEffect, useRef, useState } from 'react';
import objectHash from 'object-hash';
import {
  Field,
  TableConnection,
  TableMetadata,
} from '@berg/common-utils/dist/core/metadata';
import { BuilderChartConfigWithDateRange } from '@berg/common-utils/dist/types';
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  UseQueryOptions,
} from '@tanstack/react-query';

import api from '@/api';
import {
  ColumnMeta,
  filterColumnMetaByType,
  JSDataType,
} from '@/clickhouse-types';
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
  options?: Partial<UseQueryOptions<Field[]>>,
) {
  const metadata = useMetadataWithSettings();
  const { data: me, isFetched } = api.useMe();
  return useQuery<Field[]>({
    queryKey: [
      'useMetadata.useMultipleAllFields',
      ...tableConnections.map(tc => ({ ...tc })),
    ],
    queryFn: async () => {
      const team = me?.team;
      if (team?.fieldMetadataDisabled) {
        return [];
      }

      const promiseResults = await Promise.allSettled(
        tableConnections.map(tc => metadata.getAllFields(tc)),
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
    ...options,
  });
}

export function useAllFields(
  tableConnection: TableConnection | undefined,
  options?: Partial<UseQueryOptions<Field[]>>,
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
  return useQuery<TableMetadata | null>({
    queryKey: ['useMetadata.useTableMetadata', { databaseName, tableName }],
    queryFn: async () => {
      // Berg has no ClickHouse system.tables; on Athena the underlying call
      // resolves to undefined. React Query 5 rejects undefined results
      // ("Query data cannot be undefined"), retries the queryFn, and the
      // resulting error churn re-renders consumers in a tight loop. Coerce
      // to null so consumers see a stable "no metadata" value.
      const result = await metadata.getTableMetadata({
        databaseName,
        tableName,
        connectionId,
      });
      return result ?? null;
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
    // The keyValues query is a best-effort facet-population scan; on
    // Athena/Iceberg it can fail (e.g. byte-array overflow when a wide
    // varchar like `payload` slips into the keys list). Retrying a 15+ s
    // query four times serially blocks the row side panel from settling.
    // Fail fast and let the caller render an empty facet section.
    retry: false,
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
