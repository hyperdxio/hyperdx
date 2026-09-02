// ================================
// NOTE:
// This file should only hold functions that relate to the clickhouse client
// not specific querying/functionality logic
// please move app-specific functions elsewhere in the app
// ================================

import {
  chSql,
  ClickhouseClientOptions,
  ColumnMeta,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import { IS_LOCAL_MODE } from '@/config';
import { getLocalConnections } from '@/connection';

import api from './api';
import { DEFAULT_QUERY_TIMEOUT } from './defaults';

const PROXY_CLICKHOUSE_HOST = '/api/clickhouse-proxy';

export const getClickhouseClient = (
  options: ClickhouseClientOptions = {},
): ClickhouseClient => {
  // `??`, not a spread default: callers pass `{ queryTimeout: undefined }` when
  // a team has no override, and a spread would let that undefined win — leaving
  // the query with no max_execution_time and running to the server default.
  const withTimeout: ClickhouseClientOptions = {
    ...options,
    queryTimeout: options.queryTimeout ?? DEFAULT_QUERY_TIMEOUT,
  };

  if (IS_LOCAL_MODE) {
    const localConnections = getLocalConnections();
    if (localConnections.length === 0) {
      console.warn('No local connection found');
      return new ClickhouseClient({
        host: '',
        ...withTimeout,
      });
    }
    return new ClickhouseClient({
      host: localConnections[0].host,
      username: localConnections[0].username,
      password: localConnections[0].password,
      ...withTimeout,
    });
  }
  return new ClickhouseClient({
    host: PROXY_CLICKHOUSE_HOST,
    ...withTimeout,
  });
};

export const useClickhouseClient = (
  options: ClickhouseClientOptions = {},
): ClickhouseClient => {
  const { data: me } = api.useMe();

  // The team override wins when set; the DEFAULT_QUERY_TIMEOUT fallback now
  // lives in getClickhouseClient, so passing undefined through is enough.
  return getClickhouseClient({
    ...options,
    queryTimeout: me?.team?.queryTimeout,
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
    queryKey: [`direct_datasources/databases/${database}/tables`, connectionId],
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
