import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { useClickhouseClient } from '@/clickhouse';
import { getDurationMsExpression } from '@/source';

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
 */
export function useExemplarTraceMeta(
  traceId: string | undefined,
  traceSource: TSource | undefined,
) {
  const clickhouseClient = useClickhouseClient();
  const isTrace = !!traceSource && traceSource.kind === SourceKind.Trace;

  return useQuery<ExemplarTraceMeta | null>({
    queryKey: ['exemplarTraceMeta', traceId, traceSource?.id],
    enabled: !!traceId && isTrace,
    staleTime: 5 * 60 * 1000,
    queryFn: async context => {
      if (!traceId || !traceSource || traceSource.kind !== SourceKind.Trace) {
        return null;
      }
      const s = traceSource;
      const from = s.from.databaseName
        ? `\`${s.from.databaseName}\`.\`${s.from.tableName}\``
        : `\`${s.from.tableName}\``;
      const traceIdExpr = s.traceIdExpression || 'TraceId';
      const parentExpr = s.parentSpanIdExpression || 'ParentSpanId';
      const tsExpr = s.timestampValueExpression || 'Timestamp';
      const sql = `
        SELECT
          ${s.serviceNameExpression || 'ServiceName'} AS service,
          ${s.spanNameExpression || 'SpanName'} AS spanName,
          ${s.statusCodeExpression || 'StatusCode'} AS statusCode,
          ${getDurationMsExpression(s)} AS durationMs,
          ${tsExpr} AS timestamp
        FROM ${from}
        WHERE ${traceIdExpr} = {traceId:String}
        ORDER BY (${parentExpr} = '') DESC, ${tsExpr} ASC
        LIMIT 1`;
      const resp = await clickhouseClient.query({
        query: sql,
        query_params: { traceId },
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
