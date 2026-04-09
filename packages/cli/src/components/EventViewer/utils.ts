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

export function formatShortDate(d: Date): string {
  return d
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '');
}
