import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { useClickhouseClient } from '@/clickhouse';
import { exemplarTraceWindow } from '@/hooks/useExemplars/traceWindow';
import {
  getDurationMsExpression,
  getFirstTimestampValueExpression,
} from '@/source';

export type ExemplarTraceMeta = {
  service?: string;
  spanName?: string;
  statusCode?: string;
  durationMs?: number;
  timestamp?: string;
};

/**
 * Fetches a one-row summary of a trace (root/first span) from the given trace
 * source, for the exemplar hover card. Enabled only while a trace id is hovered
 * and a trace source is configured.
 *
 * `timestampMs` is the hovered exemplar's own timestamp, and is required: a
 * trace-id equality predicate alone reads every partition (the bloom-filter skip
 * index only helps when traceIdExpression is the indexed column verbatim), so
 * every first hover of a marker would scan the whole traces table.
 */
export function useExemplarTraceMeta(
  traceId: string | undefined,
  traceSource: TSource | undefined,
  timestampMs: number | undefined,
) {
  const clickhouseClient = useClickhouseClient();
  const isTrace = !!traceSource && traceSource.kind === SourceKind.Trace;

  return useQuery<ExemplarTraceMeta | null>({
    queryKey: ['exemplarTraceMeta', traceId, traceSource?.id, timestampMs],
    enabled: !!traceId && isTrace && timestampMs != null,
    staleTime: 5 * 60 * 1000,
    queryFn: async context => {
      if (
        !traceId ||
        !traceSource ||
        traceSource.kind !== SourceKind.Trace ||
        timestampMs == null
      ) {
        return null;
      }
      const s = traceSource;
      const from = s.from.databaseName
        ? `\`${s.from.databaseName}\`.\`${s.from.tableName}\``
        : `\`${s.from.tableName}\``;
      const [fromMs, toMs] = exemplarTraceWindow(timestampMs);
      const traceIdExpr = s.traceIdExpression || 'TraceId';
      const parentExpr = s.parentSpanIdExpression || 'ParentSpanId';
      const tsExpr = s.timestampValueExpression || 'Timestamp';
      // A composite sort key ('EventDate, EventTime') is legal in SELECT and
      // ORDER BY but a syntax error inside a WHERE conjunct, so the bound goes
      // on the first column only — wider on such a source, still prunes parts.
      const tsFilterExpr = getFirstTimestampValueExpression(tsExpr);
      const sql = `
        SELECT
          ${s.serviceNameExpression || 'ServiceName'} AS service,
          ${s.spanNameExpression || 'SpanName'} AS spanName,
          ${s.statusCodeExpression || 'StatusCode'} AS statusCode,
          ${getDurationMsExpression(s)} AS durationMs,
          ${tsExpr} AS timestamp
        FROM ${from}
        WHERE ${traceIdExpr} = {traceId:String}
          AND ${tsFilterExpr} >= fromUnixTimestamp64Milli({fromMs:Int64})
          AND ${tsFilterExpr} <= fromUnixTimestamp64Milli({toMs:Int64})
        ORDER BY (${parentExpr} = '') DESC, ${tsExpr} ASC
        LIMIT 1`;
      const resp = await clickhouseClient.query({
        query: sql,
        query_params: { traceId, fromMs, toMs },
        format: 'JSON',
        abort_signal: context.signal,
        connectionId: s.connection,
      });
      const json = await resp.json<ExemplarTraceMeta>();
      const row = json.data?.[0];
      if (!row) return null;
      return {
        ...row,
        durationMs: row.durationMs != null ? Number(row.durationMs) : undefined,
      };
    },
  });
}
