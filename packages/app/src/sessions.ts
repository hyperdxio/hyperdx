import { useCallback, useEffect, useRef, useState } from 'react';
import produce from 'immer';
import type { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { chSql } from '@hyperdx/common-utils/dist/clickhouse';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import {
  DateRange,
  pickSampleWeightExpressionProps,
  SearchCondition,
  SearchConditionLanguage,
  TSessionSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { useQuery, UseQueryOptions } from '@tanstack/react-query';

import { usePrevious } from '@/utils';

import useFieldExpressionGenerator, {
  FieldExpressionGenerator,
} from './hooks/useFieldExpressionGenerator';
import { useMetadataWithSettings } from './hooks/useMetadata';
import { getClickhouseClient, useClickhouseClient } from './clickhouse';
import { SESSION_TABLE_EXPRESSIONS, useSource } from './source';

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

export function useSessions(
  {
    traceSource,
    sessionSource,
    dateRange,
    where,
    whereLanguage,
  }: {
    traceSource?: TTraceSource;
    sessionSource?: TSessionSource;
    dateRange: DateRange['dateRange'];
    where?: SearchCondition;
    whereLanguage?: SearchConditionLanguage;
  },
  options?: Omit<UseQueryOptions<any, Error>, 'queryKey'>,
) {
  const { enabled = true } = options || {};

  const {
    getFieldExpression: getTraceSourceFieldExpression,
    isLoading: isLoadingFieldExpressionGenerator,
  } = useFieldExpressionGenerator(traceSource);

  const {
    getFieldExpression: getSessionsSourceFieldExpression,
    isLoading: isLoadingSessionsExpressionGenerator,
  } = useFieldExpressionGenerator(sessionSource);

  const FIXED_SDK_ATTRIBUTES = ['teamId', 'teamName', 'userEmail', 'userName'];
  const SESSIONS_CTE_NAME = 'sessions';
  const clickhouseClient = useClickhouseClient();
  const metadata = useMetadataWithSettings();
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
      if (
        !traceSource ||
        !sessionSource ||
        !getTraceSourceFieldExpression ||
        !getSessionsSourceFieldExpression
      ) {
        return [];
      }

      const traceSessionIdExpression = getTraceSourceFieldExpression(
        traceSource.resourceAttributesExpression ?? 'ResourceAttributes',
        'rum.sessionId',
      );

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
                valueExpression: traceSessionIdExpression,
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
                valueExpression: `MAX(${getTraceSourceFieldExpression(traceSource.eventAttributesExpression ?? 'SpanAttributes', attr)})`,
                alias: attr,
              })),
            ],
            from: traceSource.from,
            dateRange,
            where: `${traceSource.resourceAttributesExpression}.rum.sessionId:*`,
            whereLanguage: 'lucene',
            ...(where && {
              filters: [
                {
                  type:
                    (whereLanguage === 'promql' ? 'lucene' : whereLanguage) ??
                    'lucene',
                  condition: where,
                },
              ],
            }),
            timestampValueExpression: traceSource.timestampValueExpression,
            implicitColumnExpression: traceSource.implicitColumnExpression,
            useTextIndexForImplicitColumn:
              traceSource.useTextIndexForImplicitColumn,
            ...pickSampleWeightExpressionProps(traceSource),
            connection: traceSource.connection,
            groupBy: 'serviceName, sessionId',
          },
          metadata,
          traceSource.querySettings,
        ),
        renderChartConfig(
          {
            select: [
              {
                valueExpression: `DISTINCT ${getSessionsSourceFieldExpression(
                  sessionSource.resourceAttributesExpression ??
                    'ResourceAttributes',
                  'rum.sessionId',
                )}`,
                alias: 'sessionId',
              },
            ],
            from: sessionSource.from,
            dateRange,
            where: `${getSessionsSourceFieldExpression(
              sessionSource.resourceAttributesExpression ??
                'ResourceAttributes',
              'rum.sessionId',
            )} IN (SELECT sessions.sessionId FROM ${SESSIONS_CTE_NAME})`,
            whereLanguage: 'sql',
            timestampValueExpression: sessionSource.timestampValueExpression,
            implicitColumnExpression: undefined,
            connection: sessionSource.connection,
          },
          metadata,
          sessionSource.querySettings,
        ),
        renderChartConfig(
          {
            select: [
              {
                valueExpression: `DISTINCT ${getTraceSourceFieldExpression(traceSource.resourceAttributesExpression ?? 'ResourceAttributes', 'rum.sessionId')}`,
                alias: 'sessionId',
              },
            ],
            from: traceSource.from,
            dateRange,
            where: `(${traceSource.spanNameExpression}='record init' OR ${traceSource.spanNameExpression}='visibility') AND (${getTraceSourceFieldExpression(traceSource.resourceAttributesExpression ?? 'ResourceAttributes', 'rum.sessionId')} IN (SELECT sessions.sessionId FROM ${SESSIONS_CTE_NAME}))`,
            whereLanguage: 'sql',
            timestampValueExpression: traceSource.timestampValueExpression,
            implicitColumnExpression: traceSource.implicitColumnExpression,
            useTextIndexForImplicitColumn:
              traceSource.useTextIndexForImplicitColumn,
            connection: traceSource?.connection,
          },
          metadata,
          traceSource.querySettings,
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
    enabled:
      !!enabled &&
      !isLoadingFieldExpressionGenerator &&
      !isLoadingSessionsExpressionGenerator,
  });
}

// TODO: TO BE DEPRECATED
// we want to use clickhouse-proxy instead
class TimeoutError extends Error {}

/**
 * Whether an error is the expected rejection of an aborted request —
 * replaced or unmounted rrweb event streams are cancelled on purpose.
 */
function isAbortError(e: unknown): boolean {
  return (
    e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message))
  );
}

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
/**
 * Builds the chart config used to stream rrweb events for a session replay.
 *
 * Large rrweb events are split by the recorder into multiple log records
 * ("chunks") that all share the same event timestamp, so ordering by the
 * timestamp alone lets ClickHouse return chunks of one event in arbitrary
 * order, scrambling reassembly. `rr-web.offset` is a monotonically increasing
 * counter stamped on every record, and `rr-web.chunk` is the 1-based chunk
 * index within an event — ordering by both (numerically — the attributes are
 * stored as strings) makes the stream order deterministic.
 * https://github.com/hyperdxio/hyperdx/issues/2569
 */
export function buildRRWebStreamChartConfig({
  source,
  serviceName,
  sessionId,
  startDate,
  endDate,
  limit,
  offset,
  getSessionSourceFieldExpression,
}: {
  source: {
    from: TSessionSource['from'];
    timestampValueExpression: string;
    connection: string;
  };
  serviceName: string;
  sessionId: string;
  startDate: Date;
  endDate: Date;
  limit: number;
  offset: number;
  getSessionSourceFieldExpression: FieldExpressionGenerator;
}) {
  const eventAttributeExpression = (key: string) =>
    getSessionSourceFieldExpression(
      SESSION_TABLE_EXPRESSIONS.eventAttributesExpression,
      key,
    );

  return {
    // FIXME: add mappings to session source
    select: [
      {
        valueExpression: SESSION_TABLE_EXPRESSIONS.implicitColumnExpression,
        alias: 'b',
      },
      {
        valueExpression: `simpleJSONExtractInt(${SESSION_TABLE_EXPRESSIONS.implicitColumnExpression}, 'type')`,
        alias: 't',
      },
      {
        valueExpression: `${eventAttributeExpression('rr-web.chunk')}`,
        alias: 'ck',
      },
      {
        valueExpression: `${eventAttributeExpression('rr-web.total-chunks')}`,
        alias: 'tcks',
      },
      {
        valueExpression: `${eventAttributeExpression('rr-web.event')}`,
        alias: 'ev',
      },
    ],
    dateRange: [startDate, endDate] as [Date, Date],
    from: source.from,
    whereLanguage: 'lucene' as const,
    where: `ServiceName:"${serviceName}" AND ${SESSION_TABLE_EXPRESSIONS.resourceAttributesExpression}.rum.sessionId:"${sessionId}"`,
    timestampValueExpression: source.timestampValueExpression,
    implicitColumnExpression:
      SESSION_TABLE_EXPRESSIONS.implicitColumnExpression,
    connection: source.connection,
    orderBy: `${source.timestampValueExpression} ASC, toUInt64OrZero(${eventAttributeExpression('rr-web.offset')}) ASC, toUInt64OrZero(${eventAttributeExpression('rr-web.chunk')}) ASC`,
    limit: {
      limit,
      offset,
    },
  };
}

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
    getSessionSourceFieldExpression,
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
    getSessionSourceFieldExpression: FieldExpressionGenerator;
  },
  options?: {
    keepPreviousData?: boolean;
    shouldAbortPendingRequest?: boolean;
  },
) {
  const keepPreviousData = options?.keepPreviousData ?? false;
  const shouldAbortPendingRequest = options?.shouldAbortPendingRequest ?? true;
  const metadata = useMetadataWithSettings();

  const [results, setResults] = useState<{ key: string; data: any[] }>({
    key: '',
    data: [],
  });
  const [isFetching, setIsFetching] = useState<boolean>(true);
  const [hasNextPage, setHasNextPage] = useState<boolean>(true);

  const lastAbortControllerRef = useRef<AbortController | null>(null);
  const [_fetchStatus, setFetchStatus] = useState<'fetching' | 'idle'>('idle');
  const lastFetchStatusRef = useRef<'fetching' | 'idle' | undefined>(undefined);

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
      lastAbortControllerRef.current = ctrl;

      setIsFetching(true);
      setFetchStatus('fetching');
      lastFetchStatusRef.current = 'fetching';

      const MAX_LIMIT = 1e6;

      const query = await renderChartConfig(
        buildRRWebStreamChartConfig({
          source,
          serviceName,
          sessionId,
          startDate: new Date(parseInt(startTime)),
          endDate: new Date(parseInt(endTime)),
          limit: Math.min(MAX_LIMIT, parseInt(queryLimit)),
          offset: parseInt(offset),
          getSessionSourceFieldExpression,
        }),
        metadata,
        source.querySettings,
      );

      const format = 'JSONEachRow';
      const fetchPromise = (async () => {
        const clickhouseClient = getClickhouseClient();
        const resultSet = await clickhouseClient.query({
          query: query.sql,
          query_params: query.params,
          format,
          connectionId: source.connection,
          // Cancels the request when the stream is replaced (query key
          // change), times out, or the consumer unmounts — otherwise a
          // replaced stream keeps downloading and delivering rows to its
          // callbacks until completion.
          abort_signal: ctrl.signal,
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
        } else if (isAbortError(e)) {
          // Expected: the stream was cancelled because it was replaced or
          // its consumer unmounted. Not an error, and onEnd must not fire —
          // the aborted stream did not finish.
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
      metadata,
      getSessionSourceFieldExpression,
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
          lastAbortControllerRef.current?.abort();
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
    lastAbortControllerRef.current?.abort();
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
