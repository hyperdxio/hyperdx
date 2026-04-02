import type { SourceResponse } from '@/api/client';
import type { Column, EventRow, FormattedRow } from './types';

// ---- Column definitions per source kind ----------------------------

export function getColumns(source: SourceResponse): Column[] {
  if (source.kind === 'trace') {
    return [
      { header: 'Timestamp', width: '20%' },
      { header: 'Service', width: '15%' },
      { header: 'Span', width: '25%' },
      { header: 'Duration', width: '10%' },
      { header: 'Status', width: '8%' },
      { header: 'Trace ID', width: '22%' },
    ];
  }
  // Log source
  return [
    { header: 'Timestamp', width: '20%' },
    { header: 'Severity', width: '8%' },
    { header: 'Body', width: '72%' },
  ];
}

/**
 * Derive columns dynamically from the row data.
 * Distributes percentage widths: last column gets the remaining space.
 */
export function getDynamicColumns(events: EventRow[]): Column[] {
  if (events.length === 0) return [];
  const keys = Object.keys(events[0]);
  if (keys.length === 0) return [];

  const count = keys.length;
  if (count === 1) return [{ header: keys[0], width: '100%' }];

  // Give the last column (usually Body) more space
  const otherWidth = Math.floor(60 / (count - 1));
  const lastWidth = 100 - otherWidth * (count - 1);

  return keys.map((key, i) => ({
    header: key,
    width: `${i === count - 1 ? lastWidth : otherWidth}%`,
  }));
}

export function flatten(s: string): string {
  return s
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function getSeverityColor(
  sev: string,
): 'red' | 'yellow' | 'blue' | 'gray' | undefined {
  const s = sev.toLowerCase();
  if (s === 'error' || s === 'fatal' || s === 'critical') return 'red';
  if (s === 'warn' || s === 'warning') return 'yellow';
  if (s === 'info') return 'blue';
  if (s === 'debug' || s === 'trace') return 'gray';
  return undefined;
}

/**
 * Format a row generically — just stringify each value in column order.
 * Used when the user has a custom select clause.
 */
export function formatDynamicRow(
  row: EventRow,
  columns: Column[],
): FormattedRow {
  return {
    cells: columns.map(col => {
      const val = row[col.header];
      if (val == null) return '';
      if (typeof val === 'object') return flatten(JSON.stringify(val));
      return flatten(String(val));
    }),
  };
}

function formatTraceRow(
  row: EventRow,
  source: SourceResponse,
  timestamp: string,
): FormattedRow {
  const spanName = source.spanNameExpression
    ? String(row[source.spanNameExpression] ?? '')
    : '';
  const service = source.serviceNameExpression
    ? String(row[source.serviceNameExpression] ?? '')
    : '';
  const durationRaw = source.durationExpression
    ? String(row[source.durationExpression] ?? '')
    : '';
  const statusCode = source.statusCodeExpression
    ? String(row[source.statusCodeExpression] ?? '')
    : '';
  const traceId = source.traceIdExpression
    ? String(row[source.traceIdExpression] ?? '')
    : '';

  let durationStr = '';
  if (durationRaw) {
    const dur = Number(durationRaw);
    const precision = source.durationPrecision ?? 3;
    if (precision === 9) {
      durationStr = `${(dur / 1_000_000).toFixed(1)}ms`;
    } else if (precision === 6) {
      durationStr = `${(dur / 1_000).toFixed(1)}ms`;
    } else {
      durationStr = `${dur.toFixed(1)}ms`;
    }
  }

  const statusLabel =
    statusCode === '2' ? 'ERROR' : statusCode === '1' ? 'WARN' : 'OK';
  const color =
    statusCode === '2'
      ? ('red' as const)
      : statusCode === '1'
        ? ('yellow' as const)
        : undefined;

  return {
    cells: [
      timestamp,
      service,
      spanName,
      durationStr,
      statusLabel,
      traceId.slice(0, 16),
    ],
    severityColor: color,
  };
}

export function formatEventRow(
  row: EventRow,
  source: SourceResponse,
): FormattedRow {
  const tsExpr = source.timestampValueExpression ?? 'TimestampTime';
  const timestamp = String(row[tsExpr] ?? row['Timestamp'] ?? '');

  if (source.kind === 'trace') {
    return formatTraceRow(row, source, timestamp);
  }

  const bodyExpr = source.bodyExpression ?? 'Body';
  const sevExpr = source.severityTextExpression ?? 'SeverityText';
  const rawBody = String(row[bodyExpr] ?? JSON.stringify(row));
  const severity = String(row[sevExpr] ?? '');

  return {
    cells: [timestamp, severity, flatten(rawBody)],
    severityColor: getSeverityColor(severity),
  };
}

export function formatShortDate(d: Date): string {
  return d
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '');
}
