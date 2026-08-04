import type {
  AggregationTemporality,
  ExponentialHistogramMetricRow,
  GaugeMetricRow,
  HistogramMetricRow,
  SummaryMetricRow,
  SumMetricRow,
} from './types';

const CUMULATIVE: AggregationTemporality = 2;

function withServiceName(
  serviceName: string,
  resourceAttributes?: Record<string, string>,
): Record<string, string> {
  return {
    'service.name': serviceName,
    ...(resourceAttributes ?? {}),
  };
}

export type GaugeInput = {
  timeUnixMs: number;
  startTimeUnixMs?: number;
  serviceName: string;
  metricName: string;
  value: number;
  metricDescription?: string;
  metricUnit?: string;
  resourceAttributes?: Record<string, string>;
  attributes?: Record<string, string>;
};

export function makeGauge(input: GaugeInput): GaugeMetricRow {
  return {
    timeUnixMs: input.timeUnixMs,
    startTimeUnixMs: input.startTimeUnixMs ?? input.timeUnixMs,
    serviceName: input.serviceName,
    metricName: input.metricName,
    metricDescription: input.metricDescription ?? '',
    metricUnit: input.metricUnit ?? '',
    value: input.value,
    resourceAttributes: withServiceName(
      input.serviceName,
      input.resourceAttributes,
    ),
    attributes: input.attributes ?? {},
  };
}

export type SumInput = GaugeInput & {
  aggregationTemporality?: AggregationTemporality;
  isMonotonic?: boolean;
};

export function makeSum(input: SumInput): SumMetricRow {
  return {
    timeUnixMs: input.timeUnixMs,
    startTimeUnixMs: input.startTimeUnixMs ?? input.timeUnixMs,
    serviceName: input.serviceName,
    metricName: input.metricName,
    metricDescription: input.metricDescription ?? '',
    metricUnit: input.metricUnit ?? '',
    value: input.value,
    aggregationTemporality: input.aggregationTemporality ?? CUMULATIVE,
    isMonotonic: input.isMonotonic ?? true,
    resourceAttributes: withServiceName(
      input.serviceName,
      input.resourceAttributes,
    ),
    attributes: input.attributes ?? {},
  };
}

export type HistogramInput = {
  timeUnixMs: number;
  startTimeUnixMs?: number;
  serviceName: string;
  metricName: string;
  count: number;
  sum: number;
  bucketCounts: number[];
  explicitBounds: number[];
  min?: number;
  max?: number;
  aggregationTemporality?: AggregationTemporality;
  metricDescription?: string;
  metricUnit?: string;
  resourceAttributes?: Record<string, string>;
  attributes?: Record<string, string>;
};

export function makeHistogram(input: HistogramInput): HistogramMetricRow {
  return {
    timeUnixMs: input.timeUnixMs,
    startTimeUnixMs: input.startTimeUnixMs ?? input.timeUnixMs,
    serviceName: input.serviceName,
    metricName: input.metricName,
    metricDescription: input.metricDescription ?? '',
    metricUnit: input.metricUnit ?? '',
    count: input.count,
    sum: input.sum,
    bucketCounts: input.bucketCounts,
    explicitBounds: input.explicitBounds,
    min: input.min,
    max: input.max,
    aggregationTemporality: input.aggregationTemporality ?? CUMULATIVE,
    resourceAttributes: withServiceName(
      input.serviceName,
      input.resourceAttributes,
    ),
    attributes: input.attributes ?? {},
  };
}

export type ExponentialHistogramInput = {
  timeUnixMs: number;
  startTimeUnixMs?: number;
  serviceName: string;
  metricName: string;
  count: number;
  sum: number;
  scale: number;
  zeroCount?: number;
  positiveOffset?: number;
  positiveBucketCounts?: number[];
  negativeOffset?: number;
  negativeBucketCounts?: number[];
  min?: number;
  max?: number;
  aggregationTemporality?: AggregationTemporality;
  metricDescription?: string;
  metricUnit?: string;
  resourceAttributes?: Record<string, string>;
  attributes?: Record<string, string>;
};

export function makeExponentialHistogram(
  input: ExponentialHistogramInput,
): ExponentialHistogramMetricRow {
  return {
    timeUnixMs: input.timeUnixMs,
    startTimeUnixMs: input.startTimeUnixMs ?? input.timeUnixMs,
    serviceName: input.serviceName,
    metricName: input.metricName,
    metricDescription: input.metricDescription ?? '',
    metricUnit: input.metricUnit ?? '',
    count: input.count,
    sum: input.sum,
    scale: input.scale,
    zeroCount: input.zeroCount ?? 0,
    positiveOffset: input.positiveOffset ?? 0,
    positiveBucketCounts: input.positiveBucketCounts ?? [],
    negativeOffset: input.negativeOffset ?? 0,
    negativeBucketCounts: input.negativeBucketCounts ?? [],
    min: input.min,
    max: input.max,
    aggregationTemporality: input.aggregationTemporality ?? CUMULATIVE,
    resourceAttributes: withServiceName(
      input.serviceName,
      input.resourceAttributes,
    ),
    attributes: input.attributes ?? {},
  };
}

export type SummaryInput = {
  timeUnixMs: number;
  startTimeUnixMs?: number;
  serviceName: string;
  metricName: string;
  count: number;
  sum: number;
  quantiles: { quantile: number; value: number }[];
  metricDescription?: string;
  metricUnit?: string;
  resourceAttributes?: Record<string, string>;
  attributes?: Record<string, string>;
};

export function makeSummary(input: SummaryInput): SummaryMetricRow {
  return {
    timeUnixMs: input.timeUnixMs,
    startTimeUnixMs: input.startTimeUnixMs ?? input.timeUnixMs,
    serviceName: input.serviceName,
    metricName: input.metricName,
    metricDescription: input.metricDescription ?? '',
    metricUnit: input.metricUnit ?? '',
    count: input.count,
    sum: input.sum,
    quantiles: input.quantiles,
    resourceAttributes: withServiceName(
      input.serviceName,
      input.resourceAttributes,
    ),
    attributes: input.attributes ?? {},
  };
}

/**
 * Build cumulative histogram bucket counts from raw samples given explicit
 * upper bounds. Returns `{ bucketCounts, count, sum, min, max }`. The returned
 * `bucketCounts` has `bounds.length + 1` entries (final entry is the +Inf
 * overflow bucket), matching the OTel/ClickHouse layout. Deterministic — a
 * pure function of its inputs.
 */
export function bucketize(
  samples: readonly number[],
  bounds: readonly number[],
): {
  bucketCounts: number[];
  count: number;
  sum: number;
  min: number;
  max: number;
} {
  const bucketCounts = new Array<number>(bounds.length + 1).fill(0);
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const s of samples) {
    sum += s;
    if (s < min) min = s;
    if (s > max) max = s;
    let placed = false;
    for (let b = 0; b < bounds.length; b++) {
      if (s <= bounds[b]) {
        bucketCounts[b]++;
        placed = true;
        break;
      }
    }
    if (!placed) bucketCounts[bounds.length]++;
  }
  return {
    bucketCounts,
    count: samples.length,
    sum,
    min: samples.length ? min : 0,
    max: samples.length ? max : 0,
  };
}

/**
 * Bucketize raw samples into an OTel *exponential* histogram at a fixed
 * `scale`. Returns the fields consumed by `makeExponentialHistogram`
 * (`scale`, `zeroCount`, `positiveOffset`, `positiveBucketCounts`, `count`,
 * `sum`, `min`, `max`), so a caller can spread the result straight into it.
 *
 * Bucket mapping follows the OTel spec: base = 2^(2^-scale), and a positive
 * value `v` maps to index `ceil(log_base(v)) - 1`, so bucket `i` covers the
 * half-open range `(base^i, base^(i+1)]`. `positiveBucketCounts[j]` holds the
 * count for index `positiveOffset + j`. Zero-valued samples go to
 * `zeroCount`; only non-negative samples are expected (GC pause / latency),
 * so negative buckets are left to the `makeExponentialHistogram` default.
 * Deterministic — a pure function of its inputs.
 */
export function expBucketize(
  samples: readonly number[],
  scale: number,
): {
  scale: number;
  zeroCount: number;
  positiveOffset: number;
  positiveBucketCounts: number[];
  count: number;
  sum: number;
  min: number;
  max: number;
} {
  const scaleFactor = Math.pow(2, scale) / Math.LN2;
  const indexOf = (v: number): number =>
    Math.ceil(Math.log(v) * scaleFactor) - 1;

  let sum = 0;
  let zeroCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let minIdx = Number.POSITIVE_INFINITY;
  let maxIdx = Number.NEGATIVE_INFINITY;
  const counts = new Map<number, number>();

  for (const s of samples) {
    sum += s;
    if (s < min) min = s;
    if (s > max) max = s;
    if (s <= 0) {
      zeroCount++;
      continue;
    }
    const idx = indexOf(s);
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
    if (idx < minIdx) minIdx = idx;
    if (idx > maxIdx) maxIdx = idx;
  }

  let positiveOffset = 0;
  let positiveBucketCounts: number[] = [];
  if (counts.size > 0) {
    positiveOffset = minIdx;
    positiveBucketCounts = new Array<number>(maxIdx - minIdx + 1).fill(0);
    for (const [idx, c] of counts) {
      positiveBucketCounts[idx - minIdx] = c;
    }
  }

  return {
    scale,
    zeroCount,
    positiveOffset,
    positiveBucketCounts,
    count: samples.length,
    sum,
    min: samples.length ? min : 0,
    max: samples.length ? max : 0,
  };
}
