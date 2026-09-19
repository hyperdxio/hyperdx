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
  mergeQueryAttribution,
  type QueryAttribution,
  ResponseJSON,
} from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import { IS_LOCAL_MODE } from '@/config';
import { getLocalConnections } from '@/connection';
import { useQueryAttribution } from '@/queryAttribution';

import api from './api';
import { DEFAULT_QUERY_TIMEOUT } from './defaults';

const PROXY_CLICKHOUSE_HOST = '/api/clickhouse-proxy';

/**
 * `attribution` is required, not optional, on purpose. This cannot read React
 * context the way `useClickhouseClient` below does, so a caller that forgot it
 * would silently produce queries with no `log_comment` and an
 * `hdx-unknown-*` id. Making it required means the compiler asks instead.
 */
export const getClickhouseClient = (
  options: ClickhouseClientOptions & { attribution: QueryAttribution },
): ClickhouseClient => {
  if (IS_LOCAL_MODE) {
    const localConnections = getLocalConnections();
    if (localConnections.length === 0) {
      console.warn('No local connection found');
      return new ClickhouseClient({
        host: '',
        ...options,
      });
    }
    return new ClickhouseClient({
      host: localConnections[0].host,
      username: localConnections[0].username,
      password: localConnections[0].password,
      ...options,
    });
  }
  return new ClickhouseClient({
    host: PROXY_CLICKHOUSE_HOST,
    ...options,
  });
};

export const useClickhouseClient = (
  options: ClickhouseClientOptions = {},
): ClickhouseClient => {
  const { data: me } = api.useMe();
  // The team's timeout wins over anything the caller passed, as it always has.
  const queryTimeout = me?.team?.queryTimeout ?? DEFAULT_QUERY_TIMEOUT;

  // Set on the client, not at each query: everything reaches ClickHouse
  // through a client from here or from the factory above.
  const surfaceAttribution = useQueryAttribution();
  const attribution = mergeQueryAttribution(
    surfaceAttribution,
    options.attribution,
  );

  return getClickhouseClient({ ...options, queryTimeout, attribution });
};

export function useDatabasesDirect(
  { connectionId }: { connectionId: string },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  const clickhouseClient = getClickhouseClient({
    // Page context first so its ids are kept, then `metadata` pinned over the
    // top: SHOW DATABASES is schema browsing whichever page asked for it.
    attribution: mergeQueryAttribution(useQueryAttribution(), {
      surface: 'metadata',
    }),
  });
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
  const clickhouseClient = getClickhouseClient({
    // Page context first so its ids are kept, then `metadata` pinned over the
    // top: SHOW TABLES is schema browsing whichever page asked for it.
    attribution: mergeQueryAttribution(useQueryAttribution(), {
      surface: 'metadata',
    }),
  });
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
