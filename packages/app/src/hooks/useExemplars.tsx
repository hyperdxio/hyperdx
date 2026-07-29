import { useMemo } from 'react';
import { isEqual } from 'lodash';
import {
  EXEMPLAR_QUERY_LIMIT,
  isPromqlExemplarEligible,
  renderMetricExemplarsChartConfig,
} from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { isPromqlChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  ChartConfigWithOptDateRange,
  Exemplar,
  ExemplarSchema,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { useQuery } from '@tanstack/react-query';

import { prometheusApi, type PrometheusExemplarsResult } from '@/api';
import { useClickhouseClient } from '@/clickhouse';
import {
  labelDistinguishesSeries,
  promqlSeriesLabelRule,
  type SeriesLabelRule,
} from '@/components/Exemplars/promqlSeriesLabels';
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
 *
 * `rule` restricts the key to the labels the query's aggregation actually keeps
 * — see promqlSeriesLabelRule.
 */
function seriesGroupKey(
  labels: Record<string, string>,
  ignoreLe: boolean,
  rule: SeriesLabelRule,
): string | undefined {
  return (
    Object.entries(labels)
      .filter(
        ([k]) =>
          k !== '__name__' &&
          !(ignoreLe && k === 'le') &&
          labelDistinguishesSeries(rule, k),
      )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(', ') || undefined
  );
}

/**
 * Why an otherwise-populated exemplar overlay was suppressed, for the UI.
 * Deliberately not exported: consumers reach it via NormalizedExemplars.dropped
 * and compare against the literal, so exporting the alias only adds dead surface.
 */
type ExemplarDropReason = 'multiple-series';

export type NormalizedExemplars = {
  exemplars: Exemplar[];
  /** Set when exemplars existed but the overlay was deliberately suppressed. */
  dropped?: ExemplarDropReason;
};

/**
 * Normalize a native Prometheus /query_exemplars response into the shared
 * Exemplar shape. Exported for testing — label naming varies by exporter.
 *
 * Prometheus returns one entry per *underlying* series, so a
 * `histogram_quantile(...)` query — a single plotted line — comes back split
 * across its `le` buckets and across every scrape target. Entries that the
 * query's aggregation collapses into one line are merged; a genuine fan-out
 * across *plotted* series, or across different metrics, is dropped rather than
 * rendered as unattributable markers.
 *
 * Every candidate is parsed through ExemplarSchema rather than coerced: the body
 * is an untrusted upstream response that `prometheusFetch` only type-asserts, and
 * a `Number()` of a malformed value yields NaN coordinates downstream.
 */
export function normalizePrometheusExemplars(
  data: PrometheusExemplarsResult[] | undefined,
  expression?: string,
): NormalizedExemplars {
  if (!data) return { exemplars: [] };
  const ignoreLe = collapsesHistogramBuckets(expression);
  const rule = promqlSeriesLabelRule(expression);
  const out: Exemplar[] = [];
  const seenSeries = new Set<string>();
  const seenMetrics = new Set<string>();
  for (const series of data) {
    const labels = series.seriesLabels ?? {};
    const groupKey = seriesGroupKey(labels, ignoreLe, rule);
    for (const ex of series.exemplars ?? []) {
      const traceId = pick(ex.labels ?? {}, TRACE_ID_LABELS);
      if (!traceId) continue;
      const parsed = ExemplarSchema.safeParse({
        timestamp: ex.timestamp * 1000, // prometheus exemplar ts is unix seconds
        value: Number(ex.value),
        traceId,
        spanId: pick(ex.labels ?? {}, SPAN_ID_LABELS),
        groupKey,
      });
      if (!parsed.success) continue;
      seenSeries.add(groupKey ?? '');
      seenMetrics.add(labels.__name__ ?? '');
      out.push(parsed.data);
    }
  }
  // Exemplars are a single-series feature today: their y-position is the trace's
  // own value on the chart's shared axis, so markers from multiple series can't
  // be attributed or coloured yet. Drop the overlay rather than render ambiguous
  // markers. Metric name is checked separately from the label key because it is
  // excluded from that key — two different metrics carrying no other labels
  // would both produce an empty key and merge.
  if (seenSeries.size > 1 || seenMetrics.size > 1) {
    return { exemplars: [], dropped: 'multiple-series' };
  }
  return { exemplars: out };
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

/**
 * Map raw ClickHouse exemplar rows (renderMetricExemplarsChartConfig) →
 * Exemplar[]. Parsed rather than coerced for the same reason as the Prometheus
 * normalizer: a row that can't produce a finite timestamp/value is dropped
 * instead of reaching recharts as a NaN coordinate.
 */
function mapClickhouseExemplars(rows: Record<string, any>[]): Exemplar[] {
  const out: Exemplar[] = [];
  for (const r of rows) {
    if (!r.traceId) continue;
    const parsed = ExemplarSchema.safeParse({
      timestamp: Number(r.timestamp),
      value: Number(r.value),
      traceId: String(r.traceId),
      spanId: r.spanId ? String(r.spanId) : undefined,
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

// Stable identity for "no exemplars". DBTimeChart forwards this straight into
// memo(MemoChart)'s props, so a fresh [] on every render would fail the shallow
// compare and re-render recharts for every time chart in the app on any parent
// state change — including with the feature flag off.
const NO_EXEMPLARS: Exemplar[] = [];

// The exemplar overlay is a coarse annotation layer, not the series itself, so it
// tolerates being a little stale in exchange for not refiring on every mount.
const EXEMPLAR_STALE_TIME_MS = 60_000;

// Live-tail charts advance `dateRange` continuously. Rounding the range in the
// query key to this bucket keeps sub-minute ticks on one cache entry — without
// it every tick mints a new key, empties the overlay, and force-closes the hover
// card the user is reaching for.
const EXEMPLAR_KEY_QUANTUM_MS = 30_000;

const quantize = (d: Date) =>
  Math.round(d.getTime() / EXEMPLAR_KEY_QUANTUM_MS) * EXEMPLAR_KEY_QUANTUM_MS;

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

  const isPromql = isPromqlChartConfig(config);
  const supported = !!source && EXEMPLAR_SUPPORTED_KINDS.includes(source.kind);
  // A PromQL expression only carries exemplars when it plots a duration — see
  // isPromqlExemplarEligible. Same rule the PromQL editor gates its toggle on, so
  // a config saved before the rule tightened (or written via the API) doesn't
  // plot duration markers on a requests/sec axis.
  const promqlEligible =
    !isPromql || isPromqlExemplarEligible(config.promqlExpression);
  // Global feature gate: even a config with enableExemplars set fetches nothing
  // while the feature is disabled for the deployment.
  const enabled =
    IS_EXEMPLARS_ENABLED &&
    config.enableExemplars === true &&
    supported &&
    promqlEligible;

  // `config` minus the raw dateRange. This identifies the *chart* — the metric or
  // PromQL expression, filters, connection — independently of the window being
  // viewed, which is what makes it safe to carry a placeholder across a range
  // change but not across a chart change (see placeholderData below).
  const keyConfig = useMemo(
    () => ({ ...config, dateRange: undefined }),
    [config],
  );

  const query = useQuery<NormalizedExemplars>({
    // The raw dateRange is replaced by its quantized form so a live-tail tick
    // doesn't invalidate the overlay every second.
    queryKey: ['exemplars', keyConfig, config.dateRange?.map(quantize)],
    queryFn: async context => {
      // PromQL → native Prometheus exemplars via the API proxy.
      if (isPromqlChartConfig(config) && config.dateRange) {
        const [startDate, endDate] = config.dateRange;
        const resp = await prometheusApi.queryExemplars(
          {
            query: config.promqlExpression,
            start: startDate.getTime() / 1000,
            end: endDate.getTime() / 1000,
            connectionId: config.connection,
            database: config.from?.databaseName,
            table: config.from?.tableName,
          },
          context.signal,
        );
        if (resp.status !== 'success') {
          throw new Error(resp.error ?? 'query_exemplars failed');
        }
        const { exemplars, dropped } = normalizePrometheusExemplars(
          resp.data,
          config.promqlExpression,
        );
        // Native Prometheus /query_exemplars has no result-limit parameter, so
        // bound the set client-side to keep an unbounded upstream response from
        // ballooning downstream thinning/render work.
        const all = [...exemplars].sort((a, b) => a.timestamp - b.timestamp);
        return {
          exemplars: capExemplarsPerBucket(all, startDate, endDate),
          dropped,
        };
      }

      // Structured metric source → exemplars stored on the OTel metric table.
      const exemplarSql = await renderMetricExemplarsChartConfig(
        config,
        metadata,
      );
      if (!exemplarSql) return { exemplars: [] };

      const resp = await clickhouseClient.query({
        query: exemplarSql.sql,
        query_params: exemplarSql.params,
        format: 'JSON',
        abort_signal: context.signal,
        connectionId: config.connection,
      });
      const json = await resp.json<Record<string, any>>();
      return { exemplars: mapClickhouseExemplars(json.data ?? []) };
    },
    enabled,
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: EXEMPLAR_STALE_TIME_MS,
    // Keep the previous overlay visible across a *time-range* key change (a
    // live-tail tick or a range nudge) instead of blanking it — the main series
    // query does the same, and blanking here would also force-close an open hover
    // card.
    //
    // Scoped to the same chart on purpose. TanStack keeps its last-defined-data on
    // the observer instance, which outlives a key change, so an unscoped
    // `prev => prev` hands the PREVIOUS metric's exemplars to the new chart: real,
    // clickable trace ids, clamped onto the new axes, while isLoading/isError both
    // report settled. The user clicks a marker and lands on an unrelated trace.
    // Comparing the chart identity means a genuine chart switch blanks the overlay
    // (correct) while a range tick keeps it (the point of the placeholder).
    placeholderData: (prev, prevQuery) =>
      isEqual(prevQuery?.queryKey?.[1], keyConfig) ? prev : undefined,
  });

  return {
    exemplars: enabled ? (query.data?.exemplars ?? NO_EXEMPLARS) : NO_EXEMPLARS,
    /** Exemplars were found but suppressed — see ExemplarDropReason. */
    dropped: enabled ? query.data?.dropped : undefined,
    isLoading: query.isLoading,
    isError: query.isError,
    /**
     * The upstream failure message, when there is one. Surfaced verbatim because
     * the API phrases these actionably (e.g. the /query_exemplars window bound
     * tells the user to narrow the chart's range), and a generic "could not load"
     * would throw that guidance away.
     */
    error: query.error instanceof Error ? query.error.message : undefined,
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
