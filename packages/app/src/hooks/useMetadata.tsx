import { ColumnMeta } from '@hyperdx/common-utils/dist/clickhouse';
import {
  Field,
  isTableConnection,
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
  const tableConnections = isTableConnection(_tableConnections)
    ? [_tableConnections]
    : _tableConnections;
  return useQuery<Field[]>({
    queryKey: [
      'useMetadata.useAllFields',
      ...tableConnections.map(tc => ({ ...tc })),
    ],
    queryFn: async () => {
      const metadata = getMetadata();
      const fields2d = await Promise.all(
        tableConnections.map(tc => metadata.getAllFields(tc)),
      );

      // skip deduplication if not possible
      if (fields2d.length === 1) return fields2d[0];

      // deduplicate common fields
      const fields = [];
      const set = new Set<string>();
      for (const _fields of fields2d) {
        for (const field of _fields) {
          const key = `${field.path.join('.')}_${field.jsType?.toString()}`;
          if (set.has(key)) continue;
          set.add(key);
          fields.push(field);
        }
      }

      return fields;
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
