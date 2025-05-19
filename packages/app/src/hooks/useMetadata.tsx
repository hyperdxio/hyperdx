import objectHash from 'object-hash';
import { ColumnMeta } from '@hyperdx/common-utils/dist/clickhouse';
import {
  Field,
  TableConnection,
  TableMetadata,
} from '@hyperdx/common-utils/dist/metadata';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import {
  keepPreviousData,
  useQuery,
  UseQueryOptions,
} from '@tanstack/react-query';

import { getMetadata } from '@/metadata';
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
  return useQuery<Field[]>({
    queryKey: [
      'useMetadata.useAllFields',
      ...tableConnections.map(tc => ({ ...tc })),
    ],
    queryFn: async () => {
      const fields2d = await Promise.all(
        tableConnections.map(tc => metadata.getAllFields(tc)),
      );

      // skip deduplication if not needed
      if (fields2d.length === 1) return fields2d[0];

      return deduplicate2dArray<Field>(fields2d);
    },
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
  return useQuery<{ key: string; value: string[] }[]>({
    queryKey: [
      'useMetadata.useGetKeyValues',
      ...chartConfigsArr.map(cc => ({ ...cc })),
      ...keys,
      disableRowLimit,
    ],
    queryFn: async () =>
      (
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
      ).flatMap(v => v),
    staleTime: 1000 * 60 * 5, // Cache every 5 min
    enabled: !!keys.length,
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
