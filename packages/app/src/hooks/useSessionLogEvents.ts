import { useCallback, useMemo } from 'react';
import sortBy from 'lodash/sortBy';
import {
  BuilderChartConfigWithDateRange,
  SourceKind,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { keepPreviousData } from '@tanstack/react-query';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import useFieldExpressionGenerator from '@/hooks/useFieldExpressionGenerator';
import useRowWhere from '@/hooks/useRowWhere';
import { useSource } from '@/source';
import { useFormatTime } from '@/useFormatTime';
import { formatmmss } from '@/utils';
import { CONSOLE_METHOD_ATTRIBUTE } from '@/utils/browserEvents';
import type { SessionIdKey } from '@/utils/sessionId';
import {
  buildSessionLogEventsQuery,
  SESSION_LOG_EVENT_KEY_COLUMNS,
  SessionEventNavigate,
  SessionLogEvent,
  SessionLogEvents,
  toSessionLogEvents,
} from '@/utils/sessionLogEvents';

// Stable, so the event list and the timeline keep their memoized rows.
const NO_LOG_EVENTS: SessionLogEvent[] = [];

// Twin of linkedSpans' usePlaceholderConfig, without a source because the log
// source may not resolve. Never fetched: the query is disabled while it is used.
const PLACEHOLDER_CONFIG: BuilderChartConfigWithDateRange = {
  connection: '',
  from: { databaseName: '', tableName: '' },
  select: [{ valueExpression: '1' }],
  where: '0=1',
  whereLanguage: 'sql',
  timestampValueExpression: '',
  dateRange: [new Date(0), new Date(0)],
  limit: { limit: 0 },
};

/**
 * Clicks, navigations, console calls and exceptions that OTel browser SDKs
 * record as log events, read from the trace source's log source. Legacy SDK
 * sessions send no queries, metadata lookups included.
 */
export function useSessionLogEvents({
  traceSource,
  sessionId,
  sessionIdKey,
  serviceName,
  dateRange,
  tab,
  searchedQuery,
  onEventNavigate,
}: {
  traceSource: TTraceSource;
  sessionId: string;
  sessionIdKey: SessionIdKey | undefined;
  serviceName: string;
  dateRange: [Date, Date];
  tab: string;
  searchedQuery: string;
  onEventNavigate: SessionEventNavigate | undefined;
}): SessionLogEvents {
  const isOtelSession = sessionIdKey === 'session.id';
  const { data: logSource, isLoading: isSourceLoading } = useSource({
    id: isOtelSession ? traceSource.logSourceId : null,
    kinds: [SourceKind.Log],
  });
  // A search disables the query, so it skips the metadata lookup too.
  const attrs =
    searchedQuery === '' && logSource?.eventNameExpression
      ? logSource.eventAttributesExpression
      : undefined;
  const { getFieldExpression, isLoading: isFieldExpressionLoading } =
    useFieldExpressionGenerator(attrs ? logSource : undefined);
  // Strings, not the generator: the generator is a new function each render.
  const sessionIdExpression =
    attrs && getFieldExpression?.(attrs, 'session.id');
  const consoleMethodExpression =
    attrs && getFieldExpression?.(attrs, CONSOLE_METHOD_ATTRIBUTE);

  const query = useMemo(
    () =>
      buildSessionLogEventsQuery({
        logSource,
        sessionId,
        sessionIdKey,
        serviceName,
        searchedQuery,
        dateRange,
        tab,
        sessionIdExpression,
        consoleMethodExpression,
      }),
    [
      logSource,
      sessionId,
      sessionIdKey,
      serviceName,
      searchedQuery,
      dateRange,
      tab,
      sessionIdExpression,
      consoleMethodExpression,
    ],
  );

  // Keeps the last tab's rows until the next tab's land, as the span queries
  // do. They can't show while gated off: `data` is ignored without a query.
  const { data, isLoading, isError } = useQueriedChartConfig(
    query?.config ?? PLACEHOLDER_CONFIG,
    {
      enabled: query != null,
      queryKeyPrefix: 'SessionLogEvents',
      placeholderData: keepPreviousData,
    },
  );
  // A failed query hides log events; the spans still show.
  const result = query != null && !isError ? data : undefined;
  const rows = result?.data;
  const events = useMemo(
    () => (rows?.length ? toSessionLogEvents(rows) : NO_LOG_EVENTS),
    [rows],
  );

  const getRowWhere = useRowWhere({
    meta: result?.meta,
    aliasMap: query?.aliasMap,
    primaryKeyColumns: SESSION_LOG_EVENT_KEY_COLUMNS,
  });
  const open = useCallback(
    (event: SessionLogEvent) => {
      if (logSource == null) {
        return;
      }
      // Built on click: it throws on a column without meta, which must not
      // take down the player and the list.
      let rowId: string;
      try {
        rowId = getRowWhere(event.row).where;
      } catch (e) {
        console.error(e);
        return;
      }
      // The row id is made of raw expressions, so it needs no WITH clauses.
      onEventNavigate?.(rowId, [], {
        sourceId: logSource.id,
        focusTimestamp: event.timestamp.toISOString(),
      });
    },
    [getRowWhere, logSource, onEventNavigate],
  );

  const isPreparingQuery =
    isOtelSession &&
    searchedQuery === '' &&
    (isSourceLoading || isFieldExpressionLoading);
  return {
    events,
    isLoading: query != null ? isLoading : isPreparingQuery,
    open,
  };
}

/**
 * The span rows with the log events merged in by time. Log events come first
 * on ties: a click and the request it starts usually share a millisecond.
 * Without log events the span rows come back as they are.
 */
export function useLogEventRows<T extends { timestamp: Date }>(
  spanRows: T[],
  { events }: SessionLogEvents,
  showRelativeTime: boolean,
  minTs: number,
) {
  const formatTime = useFormatTime();
  return useMemo(() => {
    if (events.length === 0) {
      return spanRows;
    }
    const logRows = events.map(event => {
      const ts = event.timestamp.getTime();
      return {
        id: event.id,
        open: { kind: 'log' as const, event },
        isError: event.isError,
        isSuccess: false,
        eventSource: event.eventSource,
        title: event.title,
        description: event.description,
        timestamp: event.timestamp,
        formattedTimestamp: showRelativeTime
          ? formatmmss(ts - minTs)
          : formatTime(ts, { format: 'time' }),
        duration: 0,
      };
    });
    return sortBy([...logRows, ...spanRows], row => row.timestamp.getTime());
  }, [spanRows, events, showRelativeTime, minTs, formatTime]);
}
