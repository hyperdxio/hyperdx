import type { ClickHouseClient } from '@clickhouse/client';

import type {
  ExponentialHistogramMetricRow,
  GaugeMetricRow,
  HistogramMetricRow,
  LogRow,
  SummaryMetricRow,
  SumMetricRow,
  TraceRow,
} from '@/generators/types';

import { EVAL_DATABASE } from './schema';

const BATCH_SIZE = 100_000;

function msToDateTime64(ms: number): string {
  const date = new Date(ms);
  const iso = date.toISOString();
  const base = iso.slice(0, 19).replace('T', ' ');
  const msPart = iso.slice(20, 23);
  return `${base}.${msPart}000000`;
}

function msToDateTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
}

async function insertMappedRows<T>(
  client: ClickHouseClient,
  table: string,
  rows: T[],
  mapper: (row: T) => Record<string, unknown>,
): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    await client.insert({
      table: `${EVAL_DATABASE}.${table}`,
      values: batch.map(mapper),
      format: 'JSONEachRow',
    });
    inserted += batch.length;
  }
  return inserted;
}

function traceRowToCHObject(r: TraceRow): Record<string, unknown> {
  return {
    Timestamp: msToDateTime64(r.timestampMs),
    TraceId: r.traceId,
    SpanId: r.spanId,
    ParentSpanId: r.parentSpanId,
    TraceState: '',
    SpanName: r.spanName,
    SpanKind: r.spanKind,
    ServiceName: r.serviceName,
    ResourceAttributes: r.resourceAttributes,
    ScopeName: '',
    ScopeVersion: '',
    SpanAttributes: r.spanAttributes,
    Duration: String(r.durationNs),
    StatusCode: r.statusCode,
    StatusMessage: r.statusMessage,
    'Events.Timestamp': [],
    'Events.Name': [],
    'Events.Attributes': [],
    'Links.TraceId': [],
    'Links.SpanId': [],
    'Links.TraceState': [],
    'Links.Attributes': [],
  };
}

function logRowToCHObject(r: LogRow): Record<string, unknown> {
  return {
    Timestamp: msToDateTime64(r.timestampMs),
    TraceId: r.traceId ?? '',
    SpanId: r.spanId ?? '',
    TraceFlags: 0,
    SeverityText: r.severityText,
    SeverityNumber: r.severityNumber,
    ServiceName: r.serviceName,
    Body: r.body,
    ResourceSchemaUrl: '',
    ResourceAttributes: r.resourceAttributes,
    ScopeSchemaUrl: '',
    ScopeName: '',
    ScopeVersion: '',
    ScopeAttributes: {},
    LogAttributes: r.logAttributes,
    EventName: '',
  };
}

export function insertTraceRows(
  client: ClickHouseClient,
  table: string,
  rows: TraceRow[],
): Promise<number> {
  return insertMappedRows(client, table, rows, traceRowToCHObject);
}

export function insertLogRows(
  client: ClickHouseClient,
  table: string,
  rows: LogRow[],
): Promise<number> {
  return insertMappedRows(client, table, rows, logRowToCHObject);
}

const EMPTY_EXEMPLARS = {
  'Exemplars.FilteredAttributes': [],
  'Exemplars.TimeUnix': [],
  'Exemplars.Value': [],
  'Exemplars.SpanId': [],
  'Exemplars.TraceId': [],
} as const;

function metricCommon(r: {
  timeUnixMs: number;
  startTimeUnixMs?: number;
  serviceName: string;
  metricName: string;
  metricDescription?: string;
  metricUnit?: string;
  resourceAttributes?: Record<string, string>;
  attributes?: Record<string, string>;
}): Record<string, unknown> {
  return {
    ResourceAttributes: r.resourceAttributes ?? {},
    ResourceSchemaUrl: '',
    ScopeName: '',
    ScopeVersion: '',
    ScopeAttributes: {},
    ScopeDroppedAttrCount: 0,
    ScopeSchemaUrl: '',
    ServiceName: r.serviceName,
    MetricName: r.metricName,
    MetricDescription: r.metricDescription ?? '',
    MetricUnit: r.metricUnit ?? '',
    Attributes: r.attributes ?? {},
    StartTimeUnix: msToDateTime(r.startTimeUnixMs ?? r.timeUnixMs),
    TimeUnix: msToDateTime(r.timeUnixMs),
    Flags: 0,
  };
}

function gaugeRowToCHObject(r: GaugeMetricRow): Record<string, unknown> {
  return {
    ...metricCommon(r),
    Value: r.value,
    ...EMPTY_EXEMPLARS,
  };
}

function sumRowToCHObject(r: SumMetricRow): Record<string, unknown> {
  return {
    ...metricCommon(r),
    Value: r.value,
    ...EMPTY_EXEMPLARS,
    AggregationTemporality: r.aggregationTemporality ?? 2,
    IsMonotonic: r.isMonotonic ?? true,
  };
}

function histogramRowToCHObject(
  r: HistogramMetricRow,
): Record<string, unknown> {
  return {
    ...metricCommon(r),
    Count: String(r.count),
    Sum: r.sum,
    BucketCounts: r.bucketCounts.map(String),
    ExplicitBounds: r.explicitBounds,
    ...EMPTY_EXEMPLARS,
    Min: r.min ?? 0,
    Max: r.max ?? 0,
    AggregationTemporality: r.aggregationTemporality ?? 2,
  };
}

function exponentialHistogramRowToCHObject(
  r: ExponentialHistogramMetricRow,
): Record<string, unknown> {
  return {
    ...metricCommon(r),
    Count: String(r.count),
    Sum: r.sum,
    Scale: r.scale,
    ZeroCount: String(r.zeroCount),
    PositiveOffset: r.positiveOffset,
    PositiveBucketCounts: r.positiveBucketCounts.map(String),
    NegativeOffset: r.negativeOffset,
    NegativeBucketCounts: r.negativeBucketCounts.map(String),
    ...EMPTY_EXEMPLARS,
    Min: r.min ?? 0,
    Max: r.max ?? 0,
    AggregationTemporality: r.aggregationTemporality ?? 2,
  };
}

function summaryRowToCHObject(r: SummaryMetricRow): Record<string, unknown> {
  return {
    ...metricCommon(r),
    Count: String(r.count),
    Sum: r.sum,
    'ValueAtQuantiles.Quantile': r.quantiles.map(q => q.quantile),
    'ValueAtQuantiles.Value': r.quantiles.map(q => q.value),
  };
}

export function insertGaugeMetricRows(
  client: ClickHouseClient,
  table: string,
  rows: GaugeMetricRow[],
): Promise<number> {
  return insertMappedRows(client, table, rows, gaugeRowToCHObject);
}

export function insertSumMetricRows(
  client: ClickHouseClient,
  table: string,
  rows: SumMetricRow[],
): Promise<number> {
  return insertMappedRows(client, table, rows, sumRowToCHObject);
}

export function insertHistogramMetricRows(
  client: ClickHouseClient,
  table: string,
  rows: HistogramMetricRow[],
): Promise<number> {
  return insertMappedRows(client, table, rows, histogramRowToCHObject);
}

export function insertExponentialHistogramMetricRows(
  client: ClickHouseClient,
  table: string,
  rows: ExponentialHistogramMetricRow[],
): Promise<number> {
  return insertMappedRows(
    client,
    table,
    rows,
    exponentialHistogramRowToCHObject,
  );
}

export function insertSummaryMetricRows(
  client: ClickHouseClient,
  table: string,
  rows: SummaryMetricRow[],
): Promise<number> {
  return insertMappedRows(client, table, rows, summaryRowToCHObject);
}

// Exported for unit tests so the CH row shape can be asserted without a live
// ClickHouse. Not part of the public seeding API.
export const __metricMappers = {
  gauge: gaugeRowToCHObject,
  sum: sumRowToCHObject,
  histogram: histogramRowToCHObject,
  exponentialHistogram: exponentialHistogramRowToCHObject,
  summary: summaryRowToCHObject,
};
