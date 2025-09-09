import objectHash from 'object-hash';
import {
  ClickHouseAuthenticationError,
  ColumnMeta,
  filterColumnMetaByType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import {
  Field,
  TableConnection,
  TableMetadata,
} from '@hyperdx/common-utils/dist/metadata';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import {
  keepPreviousData,
  useQueries,
  useQuery,
  UseQueryOptions,
} from '@tanstack/react-query';

import api from '@/api';
import { getMetadata } from '@/metadata';
import { useSources } from '@/source';
import { toArray } from '@/utils';

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
  return useQuery<ColumnMeta[]>({
    queryKey: ['useMetadata.useColumns', { databaseName, tableName }],
    queryFn: async () => {
      const metadata = getMetadata();
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

/**
 * Function to fetch every source, run a basic health check
 * query on the connection, and set the unauthorized state if
 * the connection throws an auth error.
 */
export function useHealthCheck() {
  const { data: sources, isLoading: sourcesLoading } = useSources();
  const metadata = getMetadata();
  // For each source, make a health check query
  const result = useQueries({
    combine(results) {
      return {
        data: results.map(result => result.data),
        isLoading: results.some(result => result.isLoading),
        error: results.find(result => result.error)?.error,
        refetch: () => {
          return results.map(result => result.refetch());
        },
      };
    },
    queries:
      sources?.map(source => ({
        queryKey: ['useHealthCheck', { source: source.id }],
        queryFn: async () => {
          const result = await metadata.getDatabaseHealth({
            connectionId: source!.connection,
          });
          const isAuthError =
            result.status === 'unhealthy' &&
            result.error instanceof ClickHouseAuthenticationError;
          return {
            id: source.id,
            name: source.name,
            isAuthError,
            ...result,
          };
        },
      })) ?? [],
  });

  return {
    results: result.data,
    isLoading: sourcesLoading || result.isLoading,
    error: result.error,
    refetch: result.refetch,
  };
}

export function useJsonColumns(
  {
    databaseName,
    tableName,
    connectionId,
  }: {
    databaseName: string;
    tableName: string;
    connectionId: string;
  },
  options?: Partial<UseQueryOptions<string[]>>,
) {
  return useQuery<string[]>({
    queryKey: ['useMetadata.useJsonColumns', { databaseName, tableName }],
    queryFn: async () => {
      const metadata = getMetadata();
      const columns = await metadata.getColumns({
        databaseName,
        tableName,
        connectionId,
      });
      return (
        filterColumnMetaByType(columns, [JSDataType.JSON])?.map(
          column => column.name,
        ) ?? []
      );
    },
    enabled: !!databaseName && !!tableName && !!connectionId,
    ...options,
  });
}

export function useAllFields(
  _tableConnections: TableConnection | TableConnection[],
  options?: Partial<UseQueryOptions<Field[]>>,
) {
  const tableConnections = Array.isArray(_tableConnections)
    ? _tableConnections
    : [_tableConnections];
  const metadata = getMetadata();
  const { data: me, isFetched } = api.useMe();
  return useQuery<Field[]>({
    queryKey: [
      'useMetadata.useAllFields',
      ...tableConnections.map(tc => ({ ...tc })),
    ],
    queryFn: async () => {
      const team = me?.team;
      if (team?.fieldMetadataDisabled) {
        return [];
      }

      // TODO: set the settings at the top level so that it doesn't have to be set for each useQuery
      if (team?.metadataMaxRowsToRead) {
        metadata.setClickHouseSettings({
          max_rows_to_read: team.metadataMaxRowsToRead,
        });
      }

      const fields2d = await Promise.all(
        tableConnections.map(tc => metadata.getAllFields(tc)),
      );

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
  const metadata = getMetadata();
  return useQuery<TableMetadata>({
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

export function useGetKeyValues(
  {
    chartConfigs,
    keys,
    limit,
    disableRowLimit,
  }: {
    chartConfigs: ChartConfigWithDateRange | ChartConfigWithDateRange[];
    keys: string[];
    limit?: number;
    disableRowLimit?: boolean;
  },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  const metadata = getMetadata();
  const chartConfigsArr = toArray(chartConfigs);
  const { data: me, isFetched } = api.useMe();
  return useQuery<{ key: string; value: string[] }[]>({
    queryKey: [
      'useMetadata.useGetKeyValues',
      ...chartConfigsArr.map(cc => ({ ...cc })),
      ...keys,
      disableRowLimit,
    ],
    queryFn: async () => {
      const team = me?.team;

      // TODO: set the settings at the top level so that it doesn't have to be set for each useQuery
      if (team?.metadataMaxRowsToRead) {
        metadata.setClickHouseSettings({
          max_rows_to_read: team.metadataMaxRowsToRead,
        });
      }
      return (
        await Promise.all(
          chartConfigsArr.map(chartConfig =>
            metadata.getKeyValues({
              chartConfig,
              keys: keys.slice(0, 20), // Limit to 20 keys for now, otherwise request fails (max header size)
              limit,
              disableRowLimit,
            }),
          ),
        )
      ).flatMap(v => v);
    },
    staleTime: 1000 * 60 * 5, // Cache every 5 min
    enabled: !!keys.length && isFetched,
    placeholderData: keepPreviousData,
    ...options,
  });
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
