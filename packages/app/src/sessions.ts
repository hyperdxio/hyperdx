import { useCallback, useEffect, useRef, useState } from 'react';
import produce from 'immer';
import type { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { chSql } from '@hyperdx/common-utils/dist/clickhouse';
import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';
import {
  DateRange,
  SearchCondition,
  SearchConditionLanguage,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import { getMetadata } from '@/metadata';
import { usePrevious } from '@/utils';

import { getClickhouseClient, useClickhouseClient } from './clickhouse';
import { IS_LOCAL_MODE } from './config';
import { getLocalConnections } from './connection';
import { useSource } from './source';

export type Session = {
  errorCount: string;
  interactionCount: string;
  maxTimestamp: string;
  minTimestamp: string;
  recordingCount: string;
  serviceName: string;
  sessionCount: string;
  sessionId: string;
  teamId: string;
  teamName: string;
  userEmail: string;
  userName: string;
};

export const SESSION_TABLE_EXPRESSIONS = {
  resourceAttributesExpression: 'ResourceAttributes',
  eventAttributesExpression: 'LogAttributes',
  timestampValueExpression: 'TimestampTime',
  implicitColumnExpression: 'Body',
} as const;

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
  const clickhouseClient = useClickhouseClient();
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

      const [
        sessionsQuery,
        sessionIdsWithRecordingsQuery,
        sessionIdsWithUserActivityQuery,
      ] = await Promise.all([
        renderChartConfig(
          {
            select: [
              {
                valueExpression: `${traceSource.serviceNameExpression}`,
                alias: 'serviceName',
              },
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
                aggCondition: `${traceSource.statusCodeExpression}:error`,
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
            ...(where && {
              filters: [
                {
                  type: whereLanguage ?? 'lucene',
                  condition: where,
                },
              ],
            }),
            timestampValueExpression: traceSource.timestampValueExpression,
            implicitColumnExpression: traceSource.implicitColumnExpression,
            connection: traceSource.connection,
            groupBy: 'serviceName, sessionId',
          },
          getMetadata(),
        ),
        renderChartConfig(
          {
            select: [
              {
                valueExpression: `DISTINCT ${SESSION_TABLE_EXPRESSIONS.resourceAttributesExpression}['rum.sessionId']`,
                alias: 'sessionId',
              },
            ],
            from: sessionSource.from,
            dateRange,
            where: `${SESSION_TABLE_EXPRESSIONS.resourceAttributesExpression}['rum.sessionId'] IN (SELECT sessions.sessionId FROM ${SESSIONS_CTE_NAME})`,
            whereLanguage: 'sql',
            timestampValueExpression:
              SESSION_TABLE_EXPRESSIONS.timestampValueExpression,
            implicitColumnExpression:
              SESSION_TABLE_EXPRESSIONS.implicitColumnExpression,
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
          ${
            // If the user is giving us an explicit query, we don't need to filter out sessions with no interactions
            // this is because the events that match the query might not be user interactions, and we'll just show 0 results otherwise.
            where ? '' : 'HAVING interactionCount > 0 OR recordingCount > 0'
          }
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

// TODO: TO BE DEPRECATED
// we want to use clickhouse-proxy instead
class RetriableError extends Error {}
class FatalError extends Error {}
class TimeoutError extends Error {}
const EventStreamContentType = 'text/event-stream';

async function* streamToAsyncIterator<T = any>(
  stream: ReadableStream<T>,
): AsyncIterableIterator<T> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

// OPTIMIZATION STRATEGY
//
// 1. Write a clickhouse query to divide a session into different chunks, where each chunk has a start time. Maybe each chunk contains 100 events.
// 2. When slider advances, use the timestamp to determine which chunk you are in
// 3. Fetch data associated with that chunk
// 4. Probably do some prefetching for future times
export function useRRWebEventStream(
  {
    serviceName,
    sessionId,
    sourceId,
    startDate,
    endDate,
    limit = 100,
    onEvent,
    onEnd,
    resultsKey,
  }: {
    serviceName: string;
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
  // FIXME: keepPreviousData type
  // @ts-ignore
  const keepPreviousData = options?.keepPreviousData ?? false;
  const shouldAbortPendingRequest = options?.shouldAbortPendingRequest ?? true;

  const [results, setResults] = useState<{ key: string; data: any[] }>({
    key: '',
    data: [],
  });
  const [isFetching, setIsFetching] = useState<boolean>(true);
  const [hasNextPage, setHasNextPage] = useState<boolean>(true);

  const lastAbortController = useRef<AbortController | null>(null);
  const [fetchStatus, setFetchStatus] = useState<'fetching' | 'idle'>('idle');
  const lastFetchStatusRef = useRef<'fetching' | 'idle' | undefined>();

  const { data: source } = useSource({ id: sourceId });

  const fetchResults = useCallback(
    async ({
      pageParam = 0,
      limit: limitOverride,
    }: {
      pageParam: number;
      limit?: number;
    }) => {
      if (!source) return;
      const resBuffer: any[] = [];
      let linesFetched = 0;

      const startTime = startDate.getTime().toString();
      const endTime = endDate.getTime().toString();
      const queryLimit = (limitOverride ?? limit).toString();
      const offset = pageParam.toString();

      const ctrl = new AbortController();
      lastAbortController.current = ctrl;

      setIsFetching(true);
      setFetchStatus('fetching');
      lastFetchStatusRef.current = 'fetching';

      const MAX_LIMIT = 1e6;

      const metadata = getMetadata();
      const query = await renderChartConfig(
        {
          // FIXME: add mappings to session source
          select: [
            {
              valueExpression:
                SESSION_TABLE_EXPRESSIONS.implicitColumnExpression,
              alias: 'b',
            },
            {
              valueExpression: `simpleJSONExtractInt(Body, 'type')`,
              alias: 't',
            },
            {
              valueExpression: `${SESSION_TABLE_EXPRESSIONS.eventAttributesExpression}['rr-web.chunk']`,
              alias: 'ck',
            },
            {
              valueExpression: `${SESSION_TABLE_EXPRESSIONS.eventAttributesExpression}['rr-web.total-chunks']`,
              alias: 'tcks',
            },
          ],
          dateRange: [
            new Date(parseInt(startTime)),
            new Date(parseInt(endTime)),
          ],
          from: source.from,
          whereLanguage: 'lucene',
          where: `ServiceName:"${serviceName}" AND ${SESSION_TABLE_EXPRESSIONS.resourceAttributesExpression}.rum.sessionId:"${sessionId}"`,
          timestampValueExpression:
            SESSION_TABLE_EXPRESSIONS.timestampValueExpression,
          implicitColumnExpression:
            SESSION_TABLE_EXPRESSIONS.implicitColumnExpression,
          connection: source.connection,
          orderBy: `${SESSION_TABLE_EXPRESSIONS.timestampValueExpression} ASC`,
          limit: {
            limit: Math.min(MAX_LIMIT, parseInt(queryLimit)),
            offset: parseInt(offset),
          },
        },
        metadata,
      );

      const format = 'JSONEachRow';
      const fetchPromise = (async () => {
        const clickhouseClient = getClickhouseClient();
        const resultSet = await clickhouseClient.query({
          query: query.sql,
          query_params: query.params,
          format,
          connectionId: source.connection,
        });

        let forFunc: (data: any) => void;
        if (onEvent) {
          forFunc = onEvent;
        } else if (keepPreviousData) {
          forFunc = (data: any) => resBuffer.push(data);
        } else {
          forFunc = (data: any) =>
            setResults(prevResults =>
              produce(prevResults, draft => {
                draft.key = resultsKey ?? draft.key ?? 'DEFAULT_KEY';
                draft.data.push(data);
              }),
            );
        }
        const stream = resultSet.stream();
        for await (const chunk of streamToAsyncIterator(stream)) {
          for (const row of chunk) {
            try {
              const parsed = row.json();
              linesFetched++;
              forFunc(parsed);
            } catch {
              // do noting
            }
          }
        }

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
      })();

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

      ctrl.abort();
      setIsFetching(false);
      setFetchStatus('idle');
      lastFetchStatusRef.current = 'idle';
    },
    [
      source,
      serviceName,
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
    if (prevQueryKey != queryKey) {
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
