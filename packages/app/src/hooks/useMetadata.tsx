import objectHash from 'object-hash';
import { ColumnMeta } from '@hyperdx/common-utils/dist/clickhouse';
import {
  Field,
  TableConnection,
  TableMetadata,
} from '@hyperdx/common-utils/dist/metadata';
import {
  ChartConfigWithDateRange,
  KeyValue,
} from '@hyperdx/common-utils/dist/types';
import {
  keepPreviousData,
  QueryFunctionContext,
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

type UseGetKeyValuesData = KeyValue<string, string[]>[];
type StreamedValue = KeyValue<string, string | string[]>;
function addToResult(
  existingItems: UseGetKeyValuesData,
  newItems: StreamedValue[],
) {
  const items = structuredClone(existingItems);
  for (const item of newItems) {
    let foundItem = items.find(
      (v: KeyValue<string, string[]>) => v.key === item.key,
    );
    if (!foundItem) {
      foundItem = { key: item.key, value: [] };
      items.push(foundItem);
    }
    if (Array.isArray(item.value)) {
      foundItem.value.push(...item.value);
    } else {
      foundItem.value.push(item.value);
    }
  }
  return items;
}

export function useGetKeyValues(
  {
    chartConfigs,
    keys,
    limit,
    disableRowLimit,
    stream,
  }: {
    chartConfigs: ChartConfigWithDateRange | ChartConfigWithDateRange[];
    keys: string[];
    limit?: number;
    disableRowLimit?: boolean;
    stream?: boolean;
  },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  const metadata = getMetadata();
  const chartConfigsArr = toArray(chartConfigs);

  async function* generatorFunnel(
    iterators: AsyncGenerator<KeyValue[], void, unknown>[],
  ) {
    const pending = new Set(iterators);
    while (pending.size > 0) {
      const promises = Array.from(pending).map(async (iterator, index) => {
        try {
          const result = await iterator.next();
          return { iterator, result, index };
        } catch (error) {
          pending.delete(iterator);
          throw error;
        }
      });

      const { iterator, result } = await Promise.race(promises);

      if (result.done) {
        pending.delete(iterator);
      } else {
        yield result.value;
      }
    }
  }

  // inspired by @tanstack/react-query's experimental streamedQuery
  function streamedQuery(
    queryFn: (context: QueryFunctionContext) => AsyncGenerator<StreamedValue[]>,
  ) {
    return async (context: QueryFunctionContext) => {
      const query = context.client
        .getQueryCache()
        .find({ queryKey: context.queryKey, exact: true });
      if (query) {
        query.setState({
          status: 'pending',
          data: void 0,
          error: null,
          fetchStatus: 'fetching',
        });
      }
      const dispatchInterval = 100; // ms
      let result: any[] = [];
      let pendingData: UseGetKeyValuesData = [];
      let timeout: ReturnType<typeof setTimeout> | null = null;
      for await (const chunk of queryFn(context)) {
        if (context.signal.aborted) {
          break;
        }
        pendingData = addToResult(pendingData, chunk);
        if (!timeout) {
          timeout = setTimeout(() => {
            context.client.setQueryData(context.queryKey, (prev: any) => {
              result = addToResult(prev ?? [], pendingData);
              return result;
            });
            pendingData = [];
            timeout = null;
          }, dispatchInterval);
        }
      }
      // wait until the previous timeout is done
      await new Promise(resolve => setTimeout(resolve, dispatchInterval));
      if (!context.signal.aborted) {
        context.client.setQueryData(context.queryKey, result);
      }
      return context.client.getQueryData(context.queryKey);
    };
  }

  const queryFn = async (context: QueryFunctionContext) => {
    if (stream) {
      const queryFn = streamedQuery(() =>
        generatorFunnel(
          chartConfigsArr.map(chartConfig =>
            metadata
              .getKeyValues({
                chartConfig,
                keys: keys.slice(0, 20), // Limit to 20 keys for now, otherwise request fails (max header size)
                limit,
                disableRowLimit,
              })
              .stream(),
          ),
        ),
      );
      return queryFn(context);
    } else {
      return (
        await Promise.all(
          chartConfigsArr.map(chartConfig =>
            metadata
              .getKeyValues({
                chartConfig,
                keys: keys.slice(0, 20), // Limit to 20 keys for now, otherwise request fails (max header size)
                limit,
                disableRowLimit,
              })
              .json(),
          ),
        )
      ).flatMap(v => v);
    }
  };

  return useQuery<UseGetKeyValuesData>({
    queryKey: [
      'useMetadata.useGetKeyValues',
      ...chartConfigsArr.map(cc => ({ ...cc })),
      ...keys,
      disableRowLimit,
    ],
    queryFn,
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
