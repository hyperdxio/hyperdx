import {
  keepPreviousData,
  useQuery,
  UseQueryOptions,
} from '@tanstack/react-query';

import {
  ColumnMeta,
  ColumnMetaType,
  filterColumnMetaByType,
  JSDataType,
} from '@/clickhouse';
import { Field, metadata } from '@/metadata';
import { ChartConfigWithDateRange } from '@/renderChartConfig';

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

export function useTablePrimaryKey(
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
  return useQuery<string>({
    queryKey: ['useMetadata.useTablePrimaryKeys', { databaseName, tableName }],
    queryFn: async () => {
      return await metadata.getTablePrimaryKey({
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
