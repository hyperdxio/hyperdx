// ================================
// NOTE:
// This file should only hold functions that relate to the clickhouse client
// not specific querying/functionality logic
// please move app-specific functions elsewhere in the app
// ================================

import type { ResponseJSON } from '@clickhouse/client';
import {
  chSql,
  ClickhouseClient,
  ColumnMeta,
} from '@hyperdx/common-utils/dist/clickhouse';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import { IS_LOCAL_MODE } from '@/config';
import { getLocalConnections } from '@/connection';

const PROXY_CLICKHOUSE_HOST = '/api/clickhouse-proxy';

export const getClickhouseClient = () => {
  if (IS_LOCAL_MODE) {
    const localConnections = getLocalConnections();
    if (localConnections.length === 0) {
      console.warn('No local connection found');
      return new ClickhouseClient({
        host: '',
        username: '',
        password: '',
      });
    }
    return new ClickhouseClient({
      host: localConnections[0].host,
      username: localConnections[0].username,
      password: localConnections[0].password,
    });
  }
  return new ClickhouseClient({
    host: PROXY_CLICKHOUSE_HOST,
  });
};

export function useDatabasesDirect(
  { connectionId }: { connectionId: string },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  const clickhouseClient = getClickhouseClient();
  return useQuery<ResponseJSON<ColumnMeta>, Error>({
    queryKey: [`direct_datasources/databases`, connectionId],
    queryFn: async () => {
      const json = await clickhouseClient
        .query({
          query: 'SHOW DATABASES',
          connectionId,
        })
        .then(res => res.json());

      return json;
    },
    staleTime: 1000 * 60 * 5, // Cache every 5 min
    ...options,
  });
}

export function useTablesDirect(
  { database, connectionId }: { database: string; connectionId: string },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  const clickhouseClient = getClickhouseClient();
  return useQuery<ResponseJSON<ColumnMeta>, Error>({
    queryKey: [`direct_datasources/databases/${database}/tables`],
    queryFn: async () => {
      const paramSql = chSql`SHOW TABLES FROM ${{ Identifier: database }}`;
      const json = await clickhouseClient
        .query({
          query: paramSql.sql,
          query_params: paramSql.params,
          connectionId,
        })
        .then(res => res.json());

      return json;
    },
    staleTime: 1000 * 60 * 5, // Cache every 5 min
    ...options,
  });
}
