import type { ClickHouseClient } from '@clickhouse/client';

import type { LogRow, TraceRow } from '@/generators/types';

import { EVAL_DATABASE } from './schema';

const BATCH_SIZE = 100_000;

function msToDateTime64(ms: number): string {
  const date = new Date(ms);
  const iso = date.toISOString();
  const base = iso.slice(0, 19).replace('T', ' ');
  const msPart = iso.slice(20, 23);
  return `${base}.${msPart}000000`;
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
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

export async function insertTraceRows(
  client: ClickHouseClient,
  table: string,
  rows: TraceRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    await client.insert({
      table: `${EVAL_DATABASE}.${table}`,
      values: batch.map(traceRowToCHObject),
      format: 'JSONEachRow',
    });
    inserted += batch.length;
  }
  return inserted;
}

export async function insertLogRows(
  client: ClickHouseClient,
  table: string,
  rows: LogRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (const batch of chunk(rows, BATCH_SIZE)) {
    await client.insert({
      table: `${EVAL_DATABASE}.${table}`,
      values: batch.map(logRowToCHObject),
      format: 'JSONEachRow',
    });
    inserted += batch.length;
  }
  return inserted;
}
