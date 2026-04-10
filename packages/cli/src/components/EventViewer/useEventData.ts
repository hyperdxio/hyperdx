import { useState, useCallback, useEffect, useRef } from 'react';

import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';

import type { SourceResponse, ProxyClickhouseClient } from '@/api/client';
import { buildEventSearchQuery, buildFullRowQuery } from '@/api/eventQuery';
import { ROW_DATA_ALIASES } from '@/shared/rowDataPanel';
import type { TimeRange } from '@/utils/editor';

import type { EventRow } from './types';
import { TAIL_INTERVAL_MS, PAGE_SIZE } from './types';

// ---- Types ---------------------------------------------------------

export interface UseEventDataParams {
  clickhouseClient: ProxyClickhouseClient;
  metadata: Metadata;
  source: SourceResponse;
  customSelect: string | undefined;
  submittedQuery: string;
  timeRange: TimeRange;
  isFollowing: boolean;
  setTimeRange: React.Dispatch<React.SetStateAction<TimeRange>>;
  expandedRow: number | null;
}

export interface UseEventDataReturn {
  events: EventRow[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadingMore: boolean;
  paginationError: Error | null;
  expandedRowData: Record<string, unknown> | null;
  expandedRowLoading: boolean;
  expandedRowError: Error | null;
  expandedTraceId: string | null;
  expandedSpanId: string | null;
  /** The last rendered ChSql (parameterized SQL + params) for the table query */
  lastChSql: { sql: string; params: Record<string, unknown> } | null;
  fetchNextPage: () => Promise<void>;
}

// ---- Hook ----------------------------------------------------------

export function useEventData({
  clickhouseClient,
  metadata,
  source,
  customSelect,
  submittedQuery,
  timeRange,
  isFollowing,
  setTimeRange,
  expandedRow,
}: UseEventDataParams): UseEventDataReturn {
  const tsExpr = source.timestampValueExpression ?? 'TimestampTime';

  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [paginationError, setPaginationError] = useState<Error | null>(null);
  const [expandedRowData, setExpandedRowData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [expandedRowLoading, setExpandedRowLoading] = useState(false);
  const [expandedRowError, setExpandedRowError] = useState<Error | null>(null);
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);
  const [expandedSpanId, setExpandedSpanId] = useState<string | null>(null);

  const lastTimestampRef = useRef<string | null>(null);
  const dateRangeRef = useRef<{ start: Date; end: Date } | null>(null);
  const lastTableChSqlRef = useRef<{
    sql: string;
    params: Record<string, unknown>;
  } | null>(null);
  const lastTableMetaRef = useRef<Array<{ name: string; type: string }> | null>(
    null,
  );

  // ---- fetchEvents -------------------------------------------------

  const fetchEvents = useCallback(
    async (
      query: string,
      startTime: Date,
      endTime: Date,
      mode: 'replace' | 'prepend' = 'replace',
    ) => {
      setLoading(true);
      setError(null);
      setPaginationError(null);
      try {
        const chSql = await buildEventSearchQuery(
          {
            source,
            selectOverride: customSelect,
            searchQuery: query,
            startTime,
            endTime,
            limit: PAGE_SIZE,
          },
          metadata,
        );
        lastTableChSqlRef.current = chSql;
        const resultSet = await clickhouseClient.query({
          query: chSql.sql,
          query_params: chSql.params,
          format: 'JSON',
          connectionId: source.connection,
        });
        const json = (await resultSet.json()) as {
          data: EventRow[];
          meta?: Array<{ name: string; type: string }>;
        };
        const rows = (json.data ?? []) as EventRow[];
        if (json.meta) {
          lastTableMetaRef.current = json.meta;
        }

        if (mode === 'prepend' && rows.length > 0) {
          setEvents(prev => [...rows, ...prev]);
        } else {
          setEvents(rows);
          setHasMore(rows.length >= PAGE_SIZE);
          dateRangeRef.current = { start: startTime, end: endTime };
        }
        if (rows.length > 0) {
          const ts = rows[0][tsExpr];
          if (ts) lastTimestampRef.current = String(ts);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
      }
    },
    [clickhouseClient, metadata, source, tsExpr, customSelect],
  );

  // ---- fetchNextPage -----------------------------------------------

  const fetchNextPage = useCallback(async () => {
    if (!hasMore || loadingMore || !dateRangeRef.current) return;
    setLoadingMore(true);
    setPaginationError(null);
    try {
      const { start, end } = dateRangeRef.current;
      const chSql = await buildEventSearchQuery(
        {
          source,
          selectOverride: customSelect,
          searchQuery: submittedQuery,
          startTime: start,
          endTime: end,
          limit: PAGE_SIZE,
          offset: events.length,
        },
        metadata,
      );
      const resultSet = await clickhouseClient.query({
        query: chSql.sql,
        query_params: chSql.params,
        format: 'JSON',
        connectionId: source.connection,
      });
      const json = await resultSet.json<EventRow>();
      const rows = (json.data ?? []) as EventRow[];

      if (rows.length > 0) {
        setEvents(prev => [...prev, ...rows]);
      }
      setHasMore(rows.length >= PAGE_SIZE);
    } catch (err: unknown) {
      // Non-fatal — stop pagination but surface the error
      setHasMore(false);
      setPaginationError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoadingMore(false);
    }
  }, [
    hasMore,
    loadingMore,
    events.length,
    submittedQuery,
    customSelect,
    source,
    metadata,
    clickhouseClient,
  ]);

  // ---- Effect: initial fetch + re-fetch on query/time change -------

  useEffect(() => {
    fetchEvents(submittedQuery, timeRange.start, timeRange.end, 'replace');
  }, [submittedQuery, timeRange, fetchEvents]);

  // ---- Effect: follow mode -----------------------------------------

  useEffect(() => {
    if (!isFollowing) return;

    const tick = () => {
      // Slide the time range forward — the replace-fetch effect picks it up
      setTimeRange(prev => {
        const now = new Date();
        const duration = prev.end.getTime() - prev.start.getTime();
        return { start: new Date(now.getTime() - duration), end: now };
      });
    };

    // Fire immediately on activation, then repeat on interval
    tick();
    const interval = setInterval(tick, TAIL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isFollowing]);

  // ---- Effect: fetch full row data when expanded (SELECT *) --------

  useEffect(() => {
    if (expandedRow === null) {
      setExpandedRowData(null);
      setExpandedRowError(null);
      setExpandedTraceId(null);
      setExpandedSpanId(null);
      return;
    }
    const row = events[expandedRow];
    if (!row) return;

    let cancelled = false;
    setExpandedRowLoading(true);
    setExpandedRowError(null);

    (async () => {
      try {
        const tableChSql = lastTableChSqlRef.current ?? {
          sql: '',
          params: {},
        };
        const tableMeta = lastTableMetaRef.current ?? [];
        const chSql = await buildFullRowQuery({
          source,
          row: row as Record<string, unknown>,
          tableChSql,
          tableMeta,
          metadata,
        });
        const resultSet = await clickhouseClient.query({
          query: chSql.sql,
          query_params: chSql.params,
          format: 'JSON',
          connectionId: source.connection,
        });
        const json = await resultSet.json<Record<string, unknown>>();
        const fullRow = (json.data as Record<string, unknown>[])?.[0];
        if (!cancelled) {
          const data = fullRow ?? (row as Record<string, unknown>);
          setExpandedRowData(data);

          // Extract trace ID and span ID from the full row.
          // Try the source expression name first, then __hdx_* alias.
          if (source.kind === 'trace' || source.kind === 'log') {
            const traceIdExpr = source.traceIdExpression ?? 'TraceId';
            const traceVal = String(
              data[traceIdExpr] ?? data[ROW_DATA_ALIASES.TRACE_ID] ?? '',
            );
            setExpandedTraceId(traceVal || null);

            const spanIdExpr = source.spanIdExpression ?? 'SpanId';
            const spanVal = String(
              data[spanIdExpr] ?? data[ROW_DATA_ALIASES.SPAN_ID] ?? '',
            );
            setExpandedSpanId(spanVal || null);
          }
        }
      } catch (err) {
        // Non-fatal — fall back to partial row data, surface the error
        // separately so ErrorDisplay can render query context from
        // ClickHouseQueryError.
        if (!cancelled) {
          setExpandedRowData(row as Record<string, unknown>);
          setExpandedRowError(
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      } finally {
        if (!cancelled) setExpandedRowLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [expandedRow, events, source, metadata, clickhouseClient]);

  return {
    events,
    loading,
    error,
    hasMore,
    loadingMore,
    paginationError,
    expandedRowData,
    expandedRowLoading,
    expandedRowError,
    expandedTraceId,
    expandedSpanId,
    lastChSql: lastTableChSqlRef.current,
    fetchNextPage,
  };
}
