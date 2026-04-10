import { useState, useEffect, useRef } from 'react';
import SqlString from 'sqlstring';

import type { ProxyClickhouseClient, SourceResponse } from '@/api/client';
import { buildTraceSpansSql, buildTraceLogsSql } from '@/api/eventQuery';

import type { SpanRow, TaggedSpanRow, SpanNode } from './types';

// ---- Types ---------------------------------------------------------

export interface UseTraceDataParams {
  clickhouseClient: ProxyClickhouseClient;
  source: SourceResponse;
  logSource?: SourceResponse | null;
  traceId: string;
}

export interface UseTraceDataReturn {
  traceSpans: TaggedSpanRow[];
  logEvents: TaggedSpanRow[];
  loading: boolean;
  error: Error | null;
  selectedRowData: Record<string, unknown> | null;
  selectedRowLoading: boolean;
  selectedRowError: Error | null;
  /** The SQL used to fetch trace spans (first query in the trace tab) */
  lastTraceChSql: { sql: string; params: Record<string, unknown> } | null;
  fetchSelectedRow: (node: SpanNode | null) => void;
}

// ---- Hook ----------------------------------------------------------

export function useTraceData({
  clickhouseClient,
  source,
  logSource,
  traceId,
}: UseTraceDataParams): UseTraceDataReturn {
  const [traceSpans, setTraceSpans] = useState<TaggedSpanRow[]>([]);
  const [logEvents, setLogEvents] = useState<TaggedSpanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [selectedRowData, setSelectedRowData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [selectedRowLoading, setSelectedRowLoading] = useState(false);
  const [selectedRowError, setSelectedRowError] = useState<Error | null>(null);
  const lastTraceChSqlRef = useRef<{
    sql: string;
    params: Record<string, unknown>;
  } | null>(null);

  const fetchIdRef = useRef(0);

  // ---- Fetch trace spans + correlated logs -------------------------

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Fetch trace spans
        const traceQuery = buildTraceSpansSql({ source, traceId });
        lastTraceChSqlRef.current = { sql: traceQuery.sql, params: {} };
        const traceResultSet = await clickhouseClient.query({
          query: traceQuery.sql,
          format: 'JSON',
          connectionId: traceQuery.connectionId,
        });
        const traceJson = await traceResultSet.json<SpanRow>();
        const spans = ((traceJson.data ?? []) as SpanRow[]).map(r => ({
          ...r,
          kind: 'span' as const,
        }));

        // Fetch correlated log events (if log source exists)
        let logs: TaggedSpanRow[] = [];
        if (logSource) {
          const logQuery = buildTraceLogsSql({
            source: logSource,
            traceId,
          });
          const logResultSet = await clickhouseClient.query({
            query: logQuery.sql,
            format: 'JSON',
            connectionId: logQuery.connectionId,
          });
          const logJson = await logResultSet.json<SpanRow>();
          logs = ((logJson.data ?? []) as SpanRow[]).map(r => ({
            ...r,
            Duration: 0, // Logs have no duration
            kind: 'log' as const,
          }));
        }

        if (!cancelled) {
          setTraceSpans(spans);
          setLogEvents(logs);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [clickhouseClient, source, logSource, traceId]);

  // ---- Fetch SELECT * for the selected span/log --------------------
  // Stable scalar deps (SpanId, Timestamp, kind) are used to avoid
  // infinite re-fetch loops from array ref changes.

  const lastNodeRef = useRef<{
    spanId: string | null;
    timestamp: string | null;
    kind: 'span' | 'log' | null;
  }>({ spanId: null, timestamp: null, kind: null });

  const fetchSelectedRow = (node: SpanNode | null) => {
    const spanId = node?.SpanId ?? null;
    const timestamp = node?.Timestamp ?? null;
    const kind = node?.kind ?? null;

    // Skip if same node as last fetch
    const last = lastNodeRef.current;
    if (
      last.spanId === spanId &&
      last.timestamp === timestamp &&
      last.kind === kind
    ) {
      return;
    }
    lastNodeRef.current = { spanId, timestamp, kind };

    if (!timestamp || !kind) {
      // Don't clear existing data — keep showing old data while
      // transitioning between spans to avoid flashing
      return;
    }

    const isLog = kind === 'log';
    const rowSource = isLog && logSource ? logSource : source;

    const db = rowSource.from.databaseName;
    const table = rowSource.from.tableName;
    const spanIdExpr = rowSource.spanIdExpression ?? 'SpanId';
    const tsExpr =
      rowSource.displayedTimestampValueExpression ??
      rowSource.timestampValueExpression ??
      'TimestampTime';

    const traceIdExpr = rowSource.traceIdExpression ?? 'TraceId';
    const escapedTs = SqlString.escape(timestamp);
    const escapedTraceId = SqlString.escape(traceId);

    // Build WHERE: always use TraceId + Timestamp; add SpanId if available
    const clauses = [
      `${traceIdExpr} = ${escapedTraceId}`,
      `${tsExpr} = parseDateTime64BestEffort(${escapedTs}, 9)`,
    ];
    if (spanId) {
      clauses.push(`${spanIdExpr} = ${SqlString.escape(spanId)}`);
    }
    const where = clauses.join(' AND ');
    const sql = `SELECT * FROM ${db}.${table} WHERE ${where} LIMIT 1`;

    const fetchId = ++fetchIdRef.current;
    // Don't clear existing data or set loading — keep old data visible
    // while fetching to avoid flashing
    setSelectedRowError(null);

    (async () => {
      try {
        const resultSet = await clickhouseClient.query({
          query: sql,
          format: 'JSON',
          connectionId: rowSource.connection,
        });
        const json = await resultSet.json<Record<string, unknown>>();
        const row = (json.data as Record<string, unknown>[])?.[0];
        if (fetchId === fetchIdRef.current) {
          setSelectedRowData(row ?? null);
          setSelectedRowLoading(false);
        }
      } catch (err) {
        if (fetchId === fetchIdRef.current) {
          setSelectedRowData(null);
          setSelectedRowLoading(false);
          setSelectedRowError(
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      }
    })();
  };

  return {
    traceSpans,
    logEvents,
    loading,
    error,
    selectedRowData,
    selectedRowLoading,
    selectedRowError,
    lastTraceChSql: lastTraceChSqlRef.current,
    fetchSelectedRow,
  };
}
