import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResponseJSON } from '@clickhouse/client';
import {
  chSql,
  ClickhouseClient,
  ColumnMeta,
} from '@hyperdx/common-utils/dist/clickhouse';
import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import {
  DateRange,
  SearchCondition,
  SearchConditionLanguage,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import { IS_LOCAL_MODE } from '@/config';
import { getLocalConnections } from '@/connection';
import { getMetadata } from '@/metadata';
import { usePrevious } from '@/utils';

const PROXY_CLICKHOUSE_HOST = '/api/clickhouse-proxy';

export const getClickhouseClient = () => {
  if (IS_LOCAL_MODE) {
    const localConnections = getLocalConnections();
    if (localConnections.length === 0) {
      console.warn('No local connection found');
      return new ClickhouseClient({
        host: '',
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

export type Session = {
  errorCount: string;
  interactionCount: string;
  maxTimestamp: string;
  minTimestamp: string;
  recordingCount: string;
  sessionCount: string;
  sessionId: string;
  teamId: string;
  teamName: string;
  userEmail: string;
  userName: string;
};

// TODO: support where filtering
export function useSessions(
  {
    traceSource,
    sessionSource,
    dateRange,
    where,
    whereLanguage,
  }: {
    traceSource?: TSource;
    sessionSource?: TSource;
    dateRange: DateRange['dateRange'];
    where?: SearchCondition;
    whereLanguage?: SearchConditionLanguage;
  },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  const FIXED_SDK_ATTRIBUTES = ['teamId', 'teamName', 'userEmail', 'userName'];
  const SESSIONS_CTE_NAME = 'sessions';
  const clickhouseClient = getClickhouseClient();
  return useQuery<ResponseJSON<Session>, Error>({
    queryKey: [
      'sessions',
      traceSource?.id,
      sessionSource?.id,
      dateRange,
      where,
      whereLanguage,
    ],
    queryFn: async () => {
      if (!traceSource || !sessionSource) {
        return [];
      }
      // TODO: we
      const [
        sessionsQuery,
        sessionIdsWithRecordingsQuery,
        sessionIdsWithUserActivityQuery,
      ] = await Promise.all([
        renderChartConfig(
          {
            select: [
              {
                valueExpression: `${traceSource.resourceAttributesExpression}['rum.sessionId']`,
                alias: 'sessionId',
              },
              // TODO: can't use aggFn max/min here for string value field
              {
                alias: 'maxTimestamp',
                valueExpression: `MAX(${traceSource.timestampValueExpression})`,
              },
              {
                alias: 'minTimestamp',
                valueExpression: `MIN(${traceSource.timestampValueExpression})`,
              },
              {
                aggFn: 'count',
                alias: 'sessionCount',
                valueExpression: '*',
              },
              {
                aggFn: 'count',
                aggConditionLanguage: 'lucene',
                aggCondition: `${traceSource.eventAttributesExpression}.component:"user-interaction"`,
                valueExpression: '',
                alias: 'interactionCount',
              },
              {
                aggFn: 'count',
                aggConditionLanguage: 'lucene',
                aggCondition: `${traceSource.statusCodeExpression}:"Error"`,
                valueExpression: '',
                alias: 'errorCount',
              },
              {
                aggFn: 'count',
                aggConditionLanguage: 'lucene',
                aggCondition: `${traceSource.spanNameExpression}:"record init"`,
                valueExpression: '',
                alias: 'recordingCount',
              },
              ...FIXED_SDK_ATTRIBUTES.map(attr => ({
                valueExpression: `MAX(${traceSource.eventAttributesExpression}['${attr}'])`,
                alias: attr,
              })),
            ],
            from: traceSource.from,
            dateRange,
            where: `mapContains(${traceSource.resourceAttributesExpression}, 'rum.sessionId')`,
            whereLanguage: 'sql',
            timestampValueExpression: traceSource.timestampValueExpression,
            implicitColumnExpression: traceSource.implicitColumnExpression,
            connection: traceSource.connection,
            groupBy: 'sessionId',
          },
          getMetadata(),
        ),
        renderChartConfig(
          {
            select: [
              {
                valueExpression: `DISTINCT ${sessionSource.resourceAttributesExpression}['rum.sessionId']`,
                alias: 'sessionId',
              },
            ],
            from: sessionSource.from,
            dateRange,
            where: `${sessionSource.resourceAttributesExpression}['rum.sessionId'] IN (SELECT sessions.sessionId FROM ${SESSIONS_CTE_NAME})`,
            whereLanguage: 'sql',
            timestampValueExpression: sessionSource.timestampValueExpression,
            implicitColumnExpression: sessionSource.implicitColumnExpression,
            connection: sessionSource.connection,
          },
          getMetadata(),
        ),
        renderChartConfig(
          {
            select: [
              {
                valueExpression: `DISTINCT ${traceSource.resourceAttributesExpression}['rum.sessionId']`,
                alias: 'sessionId',
              },
            ],
            from: traceSource.from,
            dateRange,
            where: `(${traceSource.spanNameExpression}='record init' OR ${traceSource.spanNameExpression}='visibility') AND (${traceSource.resourceAttributesExpression}['rum.sessionId'] IN (SELECT sessions.sessionId FROM ${SESSIONS_CTE_NAME}))`,
            whereLanguage: 'sql',
            timestampValueExpression: traceSource.timestampValueExpression,
            implicitColumnExpression: traceSource.implicitColumnExpression,
            connection: traceSource?.connection,
          },
          getMetadata(),
        ),
      ]);

      const sessionsCTE = chSql`
        WITH _${SESSIONS_CTE_NAME} AS (${sessionsQuery}),
        ${SESSIONS_CTE_NAME} AS (
          SELECT * 
          FROM _${SESSIONS_CTE_NAME}
          HAVING interactionCount > 0 OR recordingCount > 0
          ORDER BY maxTimestamp DESC
          LIMIT 500
        )
      `;

      const finalQuery =
        where && where.length > 0
          ? chSql`
        ${sessionsCTE},
        sessionIdsWithRecordings AS (${sessionIdsWithRecordingsQuery}),
        sessionIdsWithUserActivity AS (${sessionIdsWithUserActivityQuery})
        SELECT *
        FROM ${SESSIONS_CTE_NAME}
        WHERE ${SESSIONS_CTE_NAME}.sessionId IN (
          SELECT sessionIdsWithRecordings.sessionId FROM sessionIdsWithRecordings
        ) OR ${SESSIONS_CTE_NAME}.sessionId IN (
          SELECT sessionIdsWithUserActivity.sessionId FROM sessionIdsWithUserActivity
        )
      `
          : chSql`
        ${sessionsCTE}
        SELECT *
        FROM ${SESSIONS_CTE_NAME}
        `;

      const json = await clickhouseClient
        .query({
          query: finalQuery.sql,
          query_params: finalQuery.params,
          connectionId: traceSource?.connection,
        })
        .then(res => res.json());

      return json;
    },
    staleTime: 1000 * 60 * 5, // Cache every 5 min
    ...options,
  });
}

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

// TODO: TO BE DEPRECATED
// we want to use clickhouse-proxy instead
class RetriableError extends Error {}
class FatalError extends Error {}
class TimeoutError extends Error {}
const EventStreamContentType = 'text/event-stream';

export function useRRWebEventStream(
  {
    sessionId,
    sourceId,
    startDate,
    endDate,
    limit = 100,
    onEvent,
    onEnd,
    resultsKey,
  }: {
    sessionId: string;
    sourceId: string;
    startDate: Date;
    endDate: Date;
    limit?: number;
    onEvent?: (event: any) => void;
    onEnd?: (error?: any) => void;
    resultsKey?: string;
  },
  options?: UseQueryOptions<any, Error> & {
    shouldAbortPendingRequest?: boolean;
  },
) {
  const enabled = options?.enabled ?? true;
  const keepPreviousData = options?.keepPreviousData ?? false;
  const shouldAbortPendingRequest = options?.shouldAbortPendingRequest ?? true;

  const [results, setResults] = useState<{ key: string; data: any[] }>({
    key: '',
    data: [],
  });
  // Set isFetching to true by default
  // unless we're not enabled
  const [isFetching, setIsFetching] = useState<boolean>(enabled);
  const [hasNextPage, setHasNextPage] = useState<boolean>(true);

  const lastAbortController = useRef<AbortController | null>(null);
  const [fetchStatus, setFetchStatus] = useState<'fetching' | 'idle'>('idle');
  const lastFetchStatusRef = useRef<'fetching' | 'idle' | undefined>();

  const fetchResults = useCallback(
    async ({
      pageParam = 0,
      limit: limitOverride,
    }: {
      pageParam: number;
      limit?: number;
    }) => {
      const resBuffer: any[] = [];
      let linesFetched = 0;

      const startTime = startDate.getTime().toString();
      const endTime = endDate.getTime().toString();

      const searchParams = new URLSearchParams([
        ['sourceId', sourceId],
        ['endTime', endTime],
        ['startTime', startTime],
        ['offset', pageParam.toString()],
        ['limit', (limitOverride ?? limit).toString()],
      ]);

      const ctrl = new AbortController();
      lastAbortController.current = ctrl;

      setIsFetching(true);
      setFetchStatus('fetching');
      lastFetchStatusRef.current = 'fetching';

      const fetchPromise = fetchEventSource(
        `/api/sessions/${sessionId}/rrweb?${searchParams.toString()}`,
        {
          method: 'GET',
          signal: ctrl.signal,
          credentials: 'include',
          async onopen(response) {
            if (
              response.ok &&
              response.headers.get('content-type') === EventStreamContentType
            ) {
              return; // everything's good
            } else if (
              response.status >= 400 &&
              response.status < 500 &&
              response.status !== 429
            ) {
              // client-side errors are usually non-retriable:
              // TODO: handle these???
              throw new FatalError();
            } else {
              throw new RetriableError();
            }
          },
          onmessage(event) {
            if (event.event === '') {
              const parsedRows = event.data
                .split('\n')
                .map((row: string) => {
                  try {
                    const parsed = JSON.parse(row);
                    linesFetched++;
                    return parsed;
                  } catch (e) {
                    return null;
                  }
                })
                .filter((v: any) => v !== null);

              if (onEvent != null) {
                parsedRows.forEach(onEvent);
              } else if (keepPreviousData) {
                resBuffer.push(...parsedRows);
              } else {
                setResults(prevResults => ({
                  key: resultsKey ?? prevResults.key ?? 'DEFAULT_KEY',
                  data: [...prevResults.data, ...parsedRows],
                }));
              }
            } else if (event.event === 'end') {
              onEnd?.();

              if (keepPreviousData) {
                setResults({
                  key: resultsKey ?? 'DEFAULT_KEY',
                  data: resBuffer,
                });
              }

              if (linesFetched === 0 || linesFetched < limit) {
                setHasNextPage(false);
              }
            }
          },
          onclose() {
            ctrl.abort();

            setIsFetching(false);
            setFetchStatus('idle');
            lastFetchStatusRef.current = 'idle';
            // if the server closes the connection unexpectedly, retry:
            // throw new RetriableError();
          },
          // onerror(err) {
          //   if (err instanceof FatalError) {
          //     throw err; // rethrow to stop the operation
          //   } else {
          //     // do nothing to automatically retry. You can also
          //     // return a specific retry interval here.
          //   }
          // },
        },
      );

      try {
        await Promise.race([
          fetchPromise,
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(new TimeoutError('Timeout'));
            }, 180 * 1000);
          }),
        ]);
      } catch (e) {
        if (e instanceof TimeoutError) {
          setIsFetching(false);
          setFetchStatus('idle');
          lastFetchStatusRef.current = 'idle';
          ctrl.abort();
          console.warn('Closing event source due to timeout');
          onEnd?.(new TimeoutError());
        } else {
          console.error(e);
        }
      }
    },
    [
      sessionId,
      startDate,
      endDate,
      limit,
      keepPreviousData,
      setResults,
      onEvent,
      onEnd,
      resultsKey,
    ],
  );

  const queryKey = [sessionId, startDate, endDate, limit].join('||');
  const prevQueryKey = usePrevious(queryKey);

  useEffect(() => {
    // Only attempt fetching on new query keys
    if (prevQueryKey != queryKey && enabled) {
      if (
        lastFetchStatusRef.current !== 'fetching' ||
        shouldAbortPendingRequest
      ) {
        // Abort previous pending request
        if (
          shouldAbortPendingRequest &&
          lastFetchStatusRef.current === 'fetching'
        ) {
          lastAbortController.current?.abort();
        }

        // Clean up previous results if we shouldn't keep them
        if (!keepPreviousData) {
          setResults({ key: '', data: [] });
        }

        setHasNextPage(true);
        fetchResults({ pageParam: 0 });
      }
    }
  }, [
    prevQueryKey,
    queryKey,
    shouldAbortPendingRequest,
    fetchResults,
    keepPreviousData,
    enabled,
  ]);

  const fetchNextPage = useCallback(
    (params?: { limit?: number; cb?: VoidFunction }) => {
      // Make sure we don't try to fetch again when we're already fetching
      // Make sure lastFetchStatusRef is not null, as that means we haven't done an initial fetch yet
      if (
        hasNextPage &&
        lastFetchStatusRef.current === 'idle' &&
        results.data.length > 0 // make sure we at least fetched initially
      ) {
        fetchResults({
          pageParam: results.data.length,
          limit: params?.limit,
        }).then(() => {
          params?.cb?.();
        });
      }
    },
    [fetchResults, results.data.length, hasNextPage],
  );

  const abort = useCallback(() => {
    lastAbortController.current?.abort();
  }, []);

  return {
    hasNextPage,
    isFetching,
    results: results.data,
    resultsKey: results.key,
    fetchNextPage,
    abort,
  };
}
