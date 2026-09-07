import { useCallback, useEffect, useRef, useState } from 'react';
import produce from 'immer';
import type { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { chSql } from '@hyperdx/common-utils/dist/clickhouse';
import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { escapeSqlString } from '@hyperdx/common-utils/dist/core/utils';
import {
  DateRange,
  Filter,
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

/**
 * Build the `ServiceName IN (...)` scope filter for the trace aggregation.
 *
 * `serviceNames` come from ingested telemetry, so each value is escaped with
 * `escapeSqlString` (backslash then single-quote) before being interpolated
 * into the SQL literal — otherwise a crafted name (e.g. `x') OR 1=1 --`) could
 * break out of the literal (second-order injection), and any backslash name
 * would produce invalid SQL. Returns `[]` for an empty list so the caller
 * emits no predicate and falls back to the unscoped scan.
 *
 * `serviceNameExpression` is source config (a column expression), not user
 * input, so it is interpolated as-is.
 */
export function buildServiceScopeFilters(
  serviceNames: string[],
  serviceNameExpression: string,
): Filter[] {
  if (serviceNames.length === 0) {
    return [];
  }
  const inList = serviceNames
    .map(name => `'${escapeSqlString(name)}'`)
    .join(', ');
  return [
    {
      type: 'sql',
      condition: `${serviceNameExpression} IN (${inList})`,
    },
  ];
}

export function useSessions(
  {
    traceSource,
    sessionSource,
    dateRange,
    where,
    whereLanguage,
    filters,
  }: {
    traceSource?: TTraceSource;
    sessionSource?: TSessionSource;
    dateRange: DateRange['dateRange'];
    where?: SearchCondition;
    whereLanguage?: SearchConditionLanguage;
    /**
     * Faceted filters from the sidebar (`DBSearchPageFilters`), applied to the
     * trace source alongside the free-text `where`. Persisted in their quoted
     * ClickHouse key form so they emit valid SQL verbatim.
     */
    filters?: Filter[];
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
      filters,
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

      // Combine the free-text `where` with the sidebar's faceted filters into a
      // single filter list applied to the trace source. When either is present
      // we treat the query as an explicit user search (see `hasSearchQuery`).
      const searchFilters: Filter[] = [
        ...(where
          ? [
              {
                type:
                  (whereLanguage === 'promql' ? 'lucene' : whereLanguage) ??
                  'lucene',
                condition: where,
              } as Filter,
            ]
          : []),
        ...(filters ?? []),
      ];
      const hasSearchQuery = searchFilters.length > 0;

      // Scope the trace aggregation to just the service(s) that emit RUM
      // sessions. `otel_traces` is sorted by (ServiceName, SpanName, Timestamp),
      // so with no ServiceName predicate the time filter can't prune via the
      // primary index — the query scans the whole table's marks (~100k) to
      // evaluate the `rum.sessionId` skip index. RUM traffic comes from a tiny
      // set of services, which we read cheaply from the session source (sorted
      // by time), turning the trace scan into a primary-key range (~50 marks,
      // ~20x faster cold).
      //
      // Correctness assumption: the session and trace sources report the same
      // `ServiceName` for RUM spans (the session source is the cheap,
      // time-sorted projection of the same RUM traffic, which is why we read the
      // list from there instead of re-scanning the trace table). If they diverge
      // — a service present in trace RUM spans but absent from the session-source
      // scan, or a differing service-name column — that service's sessions would
      // be dropped. On any query failure or an empty result we fall back to the
      // unscoped (correct) scan.
      const serviceNameExpression =
        traceSource.serviceNameExpression || 'ServiceName';
      // Enumerate RUM services over a window wider than the selected range. A
      // session's row in the session source is timestamped at (near) its start,
      // which can fall *before* `dateRange` even though its trace spans land
      // inside it. Scoping to only services seen within the exact range would
      // then drop those sessions. Over-inclusion is safe — an extra ServiceName
      // only widens the primary-key range scanned; the `rum.sessionId`
      // predicate + HAVING still filter the rows — so we look back a generous
      // margin. Under-inclusion is the correctness bug we must avoid.
      const SERVICE_SCOPE_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
      const serviceScopeDateRange: [Date, Date] = [
        new Date(dateRange[0].getTime() - SERVICE_SCOPE_LOOKBACK_MS),
        dateRange[1],
      ];
      // Resolve the scope AND serialize it inside the try: `ServiceName` is
      // ingested telemetry, so a value with a quote/backslash must be escaped
      // (see `buildServiceScopeFilters`). Keeping construction here means any
      // failure — query or serialization — falls back to the unscoped (correct)
      // scan rather than emitting broken/injectable SQL into the aggregation.
      let serviceScopeFilters: Filter[] = [];
      try {
        const serviceNamesQuery = await renderChartConfig(
          {
            select: [
              {
                valueExpression: `DISTINCT ${serviceNameExpression}`,
                alias: 'serviceName',
              },
            ],
            from: sessionSource.from,
            dateRange: serviceScopeDateRange,
            where: `notEmpty(${getSessionsSourceFieldExpression(
              sessionSource.resourceAttributesExpression ??
                'ResourceAttributes',
              'rum.sessionId',
            )})`,
            whereLanguage: 'sql',
            timestampValueExpression: sessionSource.timestampValueExpression,
            connection: sessionSource.connection,
          },
          metadata,
          sessionSource.querySettings,
        );
        const serviceNamesJson = await clickhouseClient
          .query({
            query: serviceNamesQuery.sql,
            query_params: serviceNamesQuery.params,
            connectionId: sessionSource.connection,
          })
          .then(res => res.json<{ serviceName: string }>());
        const rumServiceNames = (serviceNamesJson.data ?? [])
          .map(row => row.serviceName)
          .filter((name): name is string => !!name);
        serviceScopeFilters = buildServiceScopeFilters(
          rumServiceNames,
          serviceNameExpression,
        );
      } catch {
        // Optimization only — fall back to an unscoped scan.
      }

      const sessionsQueryFilters: Filter[] = [
        // Service scope kept separate from `hasSearchQuery` so it never flips
        // the HAVING/CTE behavior below.
        ...serviceScopeFilters,
        ...(hasSearchQuery ? searchFilters : []),
      ];

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
            ...(sessionsQueryFilters.length > 0 && {
              filters: sessionsQueryFilters,
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
            hasSearchQuery
              ? ''
              : 'HAVING interactionCount > 0 OR recordingCount > 0'
          }
          ORDER BY maxTimestamp DESC
          LIMIT 500
        )
      `;

      const finalQuery = hasSearchQuery
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
