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

/**
 * Whether the expression collapses a histogram's `le` buckets into one line.
 * Only then is `le` a non-series label: `rate(x_bucket[5m])` genuinely plots one
 * line per bucket, and treating those as one series would render markers that
 * belong to no drawn line.
 */
function collapsesHistogramBuckets(expression: string | undefined): boolean {
  return !!expression && expression.includes('histogram_quantile(');
}

function pick(labels: Record<string, string>, keys: string[]) {
  for (const k of keys) {
    if (labels[k]) return labels[k];
  }
  return undefined;
}

/**
 * Stable identity for the plotted series an exemplar belongs to. `__name__` is
 * deliberately excluded from the *label* key and counted separately by the
 * caller — two different metrics with no other labels would otherwise both
 * produce an empty key and merge into one overlay.
 */
function seriesGroupKey(
  labels: Record<string, string>,
  ignoreLe: boolean,
): string | undefined {
  return (
    Object.entries(labels)
      .filter(([k]) => k !== '__name__' && !(ignoreLe && k === 'le'))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(', ') || undefined
  );
}

/**
 * Normalize a native Prometheus /query_exemplars response into the shared
 * Exemplar shape. Exported for testing — label naming varies by exporter.
 *
 * Prometheus returns one entry per *underlying* series, so a
 * `histogram_quantile(...)` query — a single plotted line — comes back split
 * across its `le` buckets. Those entries are merged into one set; a genuine
 * fan-out across different label values, or across different metrics, is
 * dropped rather than rendered as unattributable markers.
 */
export function normalizePrometheusExemplars(
  data: PrometheusExemplarsResult[] | undefined,
  expression?: string,
): Exemplar[] {
  if (!data) return [];
  const ignoreLe = collapsesHistogramBuckets(expression);
  const out: Exemplar[] = [];
  const seenSeries = new Set<string>();
  const seenMetrics = new Set<string>();
  for (const series of data) {
    const labels = series.seriesLabels ?? {};
    const groupKey = seriesGroupKey(labels, ignoreLe);
    for (const ex of series.exemplars ?? []) {
      const traceId = pick(ex.labels ?? {}, TRACE_ID_LABELS);
      if (!traceId) continue;
      seenSeries.add(groupKey ?? '');
      seenMetrics.add(labels.__name__ ?? '');
      out.push({
        timestamp: ex.timestamp * 1000, // prometheus exemplar ts is unix seconds
        value: Number(ex.value),
        traceId,
        spanId: pick(ex.labels ?? {}, SPAN_ID_LABELS),
        groupKey,
      });
    }
  }
  // Exemplars are a single-series feature today: their y-position is the trace's
  // own value on the chart's shared axis, so markers from multiple series can't
  // be attributed or coloured yet. Drop the overlay rather than render ambiguous
  // markers. Metric name is checked separately from the label key because it is
  // excluded from that key — two different metrics carrying no other labels
  // would both produce an empty key and merge.
  if (seenSeries.size > 1 || seenMetrics.size > 1) return [];
  return out;
}

/**
 * Bound a Prometheus exemplar set to EXEMPLAR_QUERY_LIMIT, mirroring what the
 * ClickHouse scan's `LIMIT n BY bucket` does server-side: bucket by time, then
 * keep the highest-value exemplars in each bucket.
 *
 * Exported for testing. A uniform index stride would be simpler but throws away
 * the slowest traces — on a 10k-exemplar response the p99 trace the overlay
 * exists to surface has a ~2% chance of surviving.
 */
export function capExemplarsPerBucket(
  sorted: Exemplar[],
  start: Date,
  end: Date,
): Exemplar[] {
  if (sorted.length <= EXEMPLAR_QUERY_LIMIT) return sorted;
  const rangeMs = end.getTime() - start.getTime();
  // Degenerate range: no meaningful buckets to spread across, so fall back to
  // the highest-value exemplars overall.
  if (!(rangeMs > 0)) {
    return [...sorted]
      .sort((a, b) => b.value - a.value)
      .slice(0, EXEMPLAR_QUERY_LIMIT)
      .sort((a, b) => a.timestamp - b.timestamp);
  }
  const bucketMs = rangeMs / EXEMPLAR_QUERY_LIMIT;
  const byBucket = new Map<number, Exemplar[]>();
  for (const ex of sorted) {
    const bucket = Math.floor((ex.timestamp - start.getTime()) / bucketMs);
    const inBucket = byBucket.get(bucket);
    if (inBucket) inBucket.push(ex);
    else byBucket.set(bucket, [ex]);
  }
  const perBucket = Math.max(
    1,
    Math.floor(EXEMPLAR_QUERY_LIMIT / byBucket.size),
  );
  return Array.from(byBucket.keys())
    .sort((a, b) => a - b)
    .flatMap(k =>
      [...byBucket.get(k)!]
        .sort((a, b) => b.value - a.value)
        .slice(0, perBucket),
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, EXEMPLAR_QUERY_LIMIT);
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
        // ballooning downstream thinning/render work.
        const all = normalizePrometheusExemplars(
          resp.data,
          config.promqlExpression,
        ).sort((a, b) => a.timestamp - b.timestamp);
        return capExemplarsPerBucket(all, startDate, endDate);
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
