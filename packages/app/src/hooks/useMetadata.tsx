import { ColumnMeta } from '@hyperdx/common-utils/dist/clickhouse';
import { Field, TableMetadata } from '@hyperdx/common-utils/dist/metadata';
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
  {
    databaseName,
    tableName,
    connectionId,
  }: {
    databaseName: string;
    tableName: string;
    connectionId: string;
  },
  options?: Partial<UseQueryOptions<Field[]>>,
) {
  const metadata = getMetadata();
  return useQuery<Field[]>({
    queryKey: ['useMetadata.useAllFields', { databaseName, tableName }],
    queryFn: async () => {
      return metadata.getAllFields({
        databaseName,
        tableName,
        connectionId,
      });
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
}: {
  chartConfig: ChartConfigWithDateRange;
  keys: string[];
}) {
  const metadata = getMetadata();
  return useQuery({
    queryKey: ['useMetadata.useGetKeyValues', { chartConfig, keys }],
    queryFn: async () => {
      return metadata.getKeyValues({
        chartConfig,
        keys: keys.slice(0, 20), // Limit to 20 keys for now, otherwise request fails (max header size)
      });
    },
    staleTime: 1000 * 60 * 5, // Cache every 5 min
    enabled: !!keys.length,
    placeholderData: keepPreviousData,
  });
}
