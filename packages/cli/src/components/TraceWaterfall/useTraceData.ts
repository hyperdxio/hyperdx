import { useState, useEffect, useRef } from 'react';

import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';

import type { ProxyClickhouseClient, SourceResponse } from '@/api/client';
import {
  buildTraceSpansQuery,
  buildTraceLogsQuery,
  buildTraceRowDetailQuery,
} from '@/api/eventQuery';
import { deriveDateRange } from '@/shared/traceConfig';

import type { SpanRow, TaggedSpanRow, SpanNode } from './types';

// ---- Types ---------------------------------------------------------

export interface UseTraceDataParams {
  clickhouseClient: ProxyClickhouseClient;
  metadata: Metadata;
  source: SourceResponse;
  logSource?: SourceResponse | null;
  traceId: string;
  /**
   * Timestamp of the originating event row. Used to derive a tight
   * dateRange for partition pruning.
   */
  eventTimestamp?: string;
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
  metadata,
  source,
  logSource,
  traceId,
  eventTimestamp,
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
  const [lastTraceChSql, setLastTraceChSql] = useState<{
    sql: string;
    params: Record<string, unknown>;
  } | null>(null);

  const fetchIdRef = useRef(0);

  // ---- Fetch trace spans + correlated logs -------------------------

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const dateRange = deriveDateRange(eventTimestamp);

    (async () => {
      try {
        // Build and execute trace spans query via renderChartConfig
        const traceChSql = await buildTraceSpansQuery(
          { source, traceId, dateRange },
          metadata,
        );

        if (!cancelled) {
          setLastTraceChSql(traceChSql);
        }

        const traceResultSet = await clickhouseClient.query({
          query: traceChSql.sql,
          query_params: traceChSql.params,
          format: 'JSON',
          connectionId: source.connection,
        });
        const traceJson = await traceResultSet.json<SpanRow>();
        const spans = ((traceJson.data ?? []) as SpanRow[]).map(r => ({
          ...r,
          kind: 'span' as const,
        }));

        // Fetch correlated log events (if log source exists)
        let logs: TaggedSpanRow[] = [];
        if (logSource) {
          const logChSql = await buildTraceLogsQuery(
            { source: logSource, traceId, dateRange },
            metadata,
          );
          const logResultSet = await clickhouseClient.query({
            query: logChSql.sql,
            query_params: logChSql.params,
            format: 'JSON',
            connectionId: logSource.connection,
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
  }, [clickhouseClient, metadata, source, logSource, traceId, eventTimestamp]);

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

    const fetchId = ++fetchIdRef.current;
    // Don't clear existing data or set loading — keep old data visible
    // while fetching to avoid flashing
    setSelectedRowError(null);

    (async () => {
      try {
        const chSql = await buildTraceRowDetailQuery(
          {
            source: rowSource,
            traceId,
            spanId: spanId ?? undefined,
            timestamp,
          },
          metadata,
        );
        const resultSet = await clickhouseClient.query({
          query: chSql.sql,
          query_params: chSql.params,
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
    lastTraceChSql,
    fetchSelectedRow,
  };
}
