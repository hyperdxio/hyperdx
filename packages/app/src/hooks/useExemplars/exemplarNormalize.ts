import { EXEMPLAR_QUERY_LIMIT } from '@hyperdx/common-utils/dist/core/renderChartConfig';
import { Exemplar, ExemplarSchema } from '@hyperdx/common-utils/dist/types';

import { type PrometheusExemplarsResult } from '@/api';
import {
  labelDistinguishesSeries,
  promqlSeriesLabelRule,
  type SeriesLabelRule,
} from '@/components/Exemplars/promqlSeriesLabels';

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
export function mapClickhouseExemplars(
  rows: Record<string, any>[],
): Exemplar[] {
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
