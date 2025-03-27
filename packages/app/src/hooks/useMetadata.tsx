import objectHash from 'object-hash';
import { ColumnMeta } from '@hyperdx/common-utils/dist/clickhouse';
import {
  Field,
  isSingleTableConnection,
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
  const tableConnections = isSingleTableConnection(_tableConnections)
    ? [_tableConnections]
    : _tableConnections;
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

      return deduplicate2dArray(fields2d);
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

export function useGetKeyValues({
  chartConfig,
  keys,
  limit,
  disableRowLimit,
}: {
  chartConfig: ChartConfigWithDateRange;
  keys: string[];
  limit?: number;
  disableRowLimit?: boolean;
}) {
  const metadata = getMetadata();
  return useQuery({
    queryKey: ['useMetadata.useGetKeyValues', { chartConfig, keys }],
    queryFn: async () => {
      return metadata.getKeyValues({
        chartConfig,
        keys: keys.slice(0, 20), // Limit to 20 keys for now, otherwise request fails (max header size)
        limit,
        disableRowLimit,
      });
    },
    staleTime: 1000 * 60 * 5, // Cache every 5 min
    enabled: !!keys.length,
    placeholderData: keepPreviousData,
  });
}

function deduplicate2dArray<T extends object>(array2d: T[][]): T[] {
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

// export functions for testing only
export const testExports =
  process.env.NODE_ENV === 'test' ? { deduplicate2dArray } : undefined;
