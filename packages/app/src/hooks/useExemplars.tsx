import {
  EXEMPLAR_QUERY_LIMIT,
  renderMetricExemplarsChartConfig,
} from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { isPromqlChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  ChartConfigWithOptDateRange,
  Exemplar,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { prometheusApi, type PrometheusExemplarsResult } from '@/api';
import { useClickhouseClient } from '@/clickhouse';
import { IS_EXEMPLARS_ENABLED } from '@/config';
import { useMetadataWithSettings } from '@/hooks/useMetadata';
import { getDurationMsExpression } from '@/source';

// Source kinds that can produce exemplars today: native metric/promql sources.
// Trace-generated exemplars are added in a follow-up.
const EXEMPLAR_SUPPORTED_KINDS: SourceKind[] = [
  SourceKind.Metric,
  SourceKind.Promql,
];

// Native Prometheus exporters disagree on the trace/span id label name; accept
// the common spellings.
const TRACE_ID_LABELS = ['trace_id', 'traceID', 'traceId', 'trace.id'];
const SPAN_ID_LABELS = ['span_id', 'spanID', 'spanId', 'span.id'];

function pick(labels: Record<string, string>, keys: string[]) {
  for (const k of keys) {
    if (labels[k]) return labels[k];
  }
  return undefined;
}

/**
 * Normalize a native Prometheus /query_exemplars response into the shared
 * Exemplar shape. Exported for testing — label naming varies by exporter.
 */
export function normalizePrometheusExemplars(
  data: PrometheusExemplarsResult[] | undefined,
): Exemplar[] {
  if (!data) return [];
  // Exemplars are a single-series feature: their y-position is the trace's own
  // value on the chart's shared axis, so markers from multiple series can't be
  // attributed or scaled meaningfully. If the PromQL expression fans out to more
  // than one series, drop the overlay rather than render ambiguous markers.
  if (data.length > 1) return [];
  const out: Exemplar[] = [];
  for (const series of data) {
    const seriesLabels = series.seriesLabels ?? {};
    const groupKey =
      Object.entries(seriesLabels)
        .filter(([k]) => k !== '__name__')
        .map(([k, v]) => `${k}="${v}"`)
        .join(', ') || undefined;
    for (const ex of series.exemplars ?? []) {
      const traceId = pick(ex.labels ?? {}, TRACE_ID_LABELS);
      if (!traceId) continue;
      out.push({
        timestamp: ex.timestamp * 1000, // prometheus exemplar ts is unix seconds
        value: Number(ex.value),
        traceId,
        spanId: pick(ex.labels ?? {}, SPAN_ID_LABELS),
        groupKey,
      });
    }
  }
  return out;
}

/** Map raw ClickHouse exemplar rows (renderMetricExemplarsChartConfig) → Exemplar[]. */
function mapClickhouseExemplars(rows: Record<string, any>[]): Exemplar[] {
  return rows
    .filter(r => r.traceId)
    .map(r => ({
      timestamp: Number(r.timestamp),
      value: Number(r.value),
      traceId: String(r.traceId),
      spanId: r.spanId ? String(r.spanId) : undefined,
    }));
}

/**
 * Fetches exemplars for a chart in parallel with the main series query. A no-op
 * (disabled query) unless `config.enableExemplars` is set and the source kind
 * supports exemplars, so it adds zero cost to charts that don't use the overlay.
 */
export function useExemplars(
  config: ChartConfigWithOptDateRange,
  source: TSource | undefined,
) {
  const clickhouseClient = useClickhouseClient();
  const metadata = useMetadataWithSettings();

  const supported = !!source && EXEMPLAR_SUPPORTED_KINDS.includes(source.kind);
  // Global feature gate: even a config with enableExemplars set fetches nothing
  // while the feature is disabled for the deployment.
  const enabled =
    IS_EXEMPLARS_ENABLED && config.enableExemplars === true && supported;

  const query = useQuery<Exemplar[]>({
    queryKey: ['exemplars', config],
    queryFn: async context => {
      // PromQL → native Prometheus exemplars via the API proxy.
      if (isPromqlChartConfig(config) && config.dateRange) {
        const [startDate, endDate] = config.dateRange;
        const resp = await prometheusApi.queryExemplars({
          query: config.promqlExpression,
          start: startDate.getTime() / 1000,
          end: endDate.getTime() / 1000,
          connectionId: config.connection,
          database: config.from?.databaseName,
          table: config.from?.tableName,
        });
        if (resp.status !== 'success') {
          throw new Error(resp.error ?? 'query_exemplars failed');
        }
        // Native Prometheus /query_exemplars has no result-limit parameter, so
        // bound the set client-side to keep an unbounded upstream response from
        // ballooning downstream thinning/render work. Mirror the ClickHouse
        // path's EXEMPLAR_QUERY_LIMIT and keep the highest-value exemplars.
        return normalizePrometheusExemplars(resp.data)
          .sort((a, b) => b.value - a.value)
          .slice(0, EXEMPLAR_QUERY_LIMIT);
      }

      // Structured metric source → exemplars stored on the OTel metric table.
      const exemplarSql = await renderMetricExemplarsChartConfig(
        config,
        metadata,
      );
      if (!exemplarSql) return [];

      const resp = await clickhouseClient.query({
        query: exemplarSql.sql,
        query_params: exemplarSql.params,
        format: 'JSON',
        abort_signal: context.signal,
        connectionId: config.connection,
      });
      const json = await resp.json<Record<string, any>>();
      return mapClickhouseExemplars(json.data ?? []);
    },
    enabled,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  return {
    exemplars: enabled ? (query.data ?? []) : [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

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
