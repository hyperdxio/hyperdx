import { useEffect, useRef } from 'react';
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
} from '@hyperdx/common-utils/dist/metadata';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import {
  keepPreviousData,
  useQuery,
  UseQueryOptions,
} from '@tanstack/react-query';

import api from '@/api';
import { getMetadata } from '@/metadata';
import { toArray } from '@/utils';

// Hook to get metadata with proper settings applied
// TODO: replace all getMetadata calls with useMetadataWithSettings
export function useMetadataWithSettings() {
  const metadata = getMetadata();
  const { data: me } = api.useMe();
  const settingsApplied = useRef(false);

  useEffect(() => {
    if (me?.team?.metadataMaxRowsToRead && !settingsApplied.current) {
      metadata.setClickHouseSettings({
        max_rows_to_read: me.team.metadataMaxRowsToRead,
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

export function useMultipleGetKeyValues(
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
  const metadata = useMetadataWithSettings();
  const chartConfigsArr = toArray(chartConfigs);
  return useQuery<{ key: string; value: string[] }[]>({
    queryKey: [
      'useMetadata.useGetKeyValues',
      ...chartConfigsArr.map(cc => ({ ...cc })),
      ...keys,
      disableRowLimit,
    ],
    queryFn: async () => {
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
    enabled: !!keys.length,
    placeholderData: keepPreviousData,
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
    chartConfig?: ChartConfigWithDateRange;
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
