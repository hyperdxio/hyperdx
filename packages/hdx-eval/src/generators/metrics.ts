import type { SeededRng } from '@/rng/seeded';

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
