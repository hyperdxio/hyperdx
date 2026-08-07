export type TraceRow = {
  timestampMs: number;
  traceId: string;
  spanId: string;
  parentSpanId: string;
  spanName: string;
  spanKind:
    | 'SPAN_KIND_SERVER'
    | 'SPAN_KIND_CLIENT'
    | 'SPAN_KIND_INTERNAL'
    | 'SPAN_KIND_PRODUCER'
    | 'SPAN_KIND_CONSUMER';
  serviceName: string;
  durationNs: number;
  statusCode: 'STATUS_CODE_OK' | 'STATUS_CODE_ERROR' | 'STATUS_CODE_UNSET';
  statusMessage: string;
  resourceAttributes: Record<string, string>;
  spanAttributes: Record<string, string>;
};

/** Canonical, normalized severity levels (what most scenarios store). */
export type CanonicalSeverity = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export type LogRow = {
  timestampMs: number;
  traceId?: string;
  spanId?: string;
  serviceName: string;
  /**
   * Severity text as written to ClickHouse `SeverityText`, verbatim.
   *
   * Most scenarios store canonical uppercase values. Scenarios that want to
   * exercise messy real-world severity (mixed case + aliases like `warning`,
   * `fatal`, `information`) may store arbitrary strings here — a `string &
   * {}` member keeps the canonical literals as autocomplete hints while
   * allowing the raw OTel variants through.
   */
  severityText: CanonicalSeverity | (string & {});
  severityNumber: number;
  body: string;
  resourceAttributes: Record<string, string>;
  logAttributes: Record<string, string>;
};

export const SEVERITY_NUMBER: Record<CanonicalSeverity, number> = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
};

export type AggregationTemporality = 1 | 2;

export type BaseMetricRow = {
  timeUnixMs: number;
  startTimeUnixMs?: number;
  serviceName: string;
  metricName: string;
  metricDescription?: string;
  metricUnit?: string;
  resourceAttributes?: Record<string, string>;
  attributes?: Record<string, string>;
};

export type GaugeMetricRow = BaseMetricRow & {
  value: number;
};

export type SumMetricRow = BaseMetricRow & {
  value: number;
  aggregationTemporality?: AggregationTemporality;
  isMonotonic?: boolean;
};

export type HistogramMetricRow = BaseMetricRow & {
  count: number;
  sum: number;
  /** Per-bucket counts. Length must be `explicitBounds.length + 1`. */
  bucketCounts: number[];
  /** Upper bounds of each bucket (exclusive of the final +Inf bucket). */
  explicitBounds: number[];
  min?: number;
  max?: number;
  aggregationTemporality?: AggregationTemporality;
};

export type ExponentialHistogramMetricRow = BaseMetricRow & {
  count: number;
  sum: number;
  scale: number;
  zeroCount: number;
  positiveOffset: number;
  positiveBucketCounts: number[];
  negativeOffset: number;
  negativeBucketCounts: number[];
  min?: number;
  max?: number;
  aggregationTemporality?: AggregationTemporality;
};

export type SummaryMetricRow = BaseMetricRow & {
  count: number;
  sum: number;
  quantiles: { quantile: number; value: number }[];
};

export type MetricRow =
  | GaugeMetricRow
  | SumMetricRow
  | HistogramMetricRow
  | ExponentialHistogramMetricRow
  | SummaryMetricRow;
