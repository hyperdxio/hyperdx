import SqlString from 'sqlstring';

import type { SourceResponse } from '@/api/client';
import type { TimeRange } from '@/utils/editor';
import type { SpanNode } from '@/components/TraceWaterfall/types';
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

// ---- Tab name mapping (TUI → web app) ------------------------------

/** Map TUI detail tab names to the web app's `sidePanelTab` URL values. */
const SIDE_PANEL_TAB_MAP: Record<string, string> = {
  overview: 'overview',
  columns: 'parsed',
  trace: 'trace',
};

// ---- Span event row WHERE builder -----------------------------------

/**
 * Build a SQL WHERE clause that identifies a specific span/log in the
 * trace waterfall, matching the web app's `eventRowWhere.id` format.
 *
 * The web app's waterfall query uses aliased columns. `processRowToWhereClause`
 * resolves aliases back to raw expressions via the aliasMap. We replicate
 * the same output using the source's expression mappings.
 *
 * @source packages/app/src/components/DBTraceWaterfallChart.tsx (getConfig + useEventsAroundFocus)
 */
export function buildSpanEventRowWhere(
  node: SpanNode,
  source: SourceResponse,
): string {
  const spanNameExpr = source.spanNameExpression ?? 'SpanName';
  const tsExpr =
    source.displayedTimestampValueExpression ??
    source.timestampValueExpression ??
    'Timestamp';
  const spanIdExpr = source.spanIdExpression ?? 'SpanId';
  const serviceNameExpr = source.serviceNameExpression ?? 'ServiceName';
  const durationExpr = source.durationExpression ?? 'Duration';
  const precision = source.durationPrecision ?? 9;
  const parentSpanIdExpr = source.parentSpanIdExpression ?? 'ParentSpanId';
  const statusCodeExpr = source.statusCodeExpression ?? 'StatusCode';

  // Convert raw duration to seconds (matching getDurationSecondsExpression)
  const durationSeconds = node.Duration / Math.pow(10, precision);

  const clauses = [
    SqlString.format(`?=?`, [SqlString.raw(spanNameExpr), node.SpanName]),
    SqlString.format(`?=parseDateTime64BestEffort(?, 9)`, [
      SqlString.raw(tsExpr),
      node.Timestamp,
    ]),
    SqlString.format(`?=?`, [SqlString.raw(spanIdExpr), node.SpanId]),
    SqlString.format(`?=?`, [SqlString.raw(serviceNameExpr), node.ServiceName]),
    SqlString.format(`(?)/?=?`, [
      SqlString.raw(durationExpr),
      SqlString.raw(`1e${precision}`),
      durationSeconds,
    ]),
    SqlString.format(`?=?`, [
      SqlString.raw(parentSpanIdExpr),
      node.ParentSpanId,
    ]),
    SqlString.format(`?=?`, [SqlString.raw(statusCodeExpr), node.StatusCode]),
  ];

  return clauses.join(' AND ');
}

// ---- Browser URL builder -------------------------------------------

/**
 * Build a URL that opens the current view in the HyperDX web app.
 *
 * Generates a `/search` URL with parameters that:
 *  - Filter to the trace (if available)
 *  - Open the side panel for the specific expanded row
 *  - Select the correct tab (overview / column values / trace)
 *  - Pre-select the specific span in the trace waterfall (if on trace tab)
 *
 * String/JSON URL values are double-encoded via `encodeURIComponent` to
 * match the web app's `parseAsStringEncoded` / `parseAsJsonEncoded` parsers.
 *
 * @source packages/app/src/utils/queryParsers.ts
 * @source packages/app/src/components/DBSqlRowTableWithSidebar.tsx
 * @source packages/app/src/components/DBRowSidePanel.tsx
 */
export function buildBrowserUrl({
  appUrl,
  source,
  traceId,
  searchQuery,
  timeRange,
  rowWhere,
  detailTab,
  eventRowWhere,
}: {
  appUrl: string;
  source: SourceResponse;
  traceId: string | null;
  /** The user's current search query (Lucene) */
  searchQuery: string;
  timeRange: TimeRange;
  /** SQL WHERE clause identifying the expanded row (from useEventData) */
  rowWhere: string | null;
  /** Current detail tab in the TUI */
  detailTab: string;
  /** Identifies the selected span in the trace waterfall (trace tab only) */
  eventRowWhere: {
    id: string;
    type: string;
    aliasWith: never[];
  } | null;
}): string {
  const params = new URLSearchParams({
    source: source.id,
    from: timeRange.start.getTime().toString(),
    to: timeRange.end.getTime().toString(),
    isLive: 'false',
  });

  // Build the where clause: combine the user's search query with a
  // TraceId filter when viewing a trace.
  const whereParts: string[] = [];
  if (searchQuery) {
    whereParts.push(searchQuery);
  }
  if (traceId) {
    whereParts.push(`TraceId:${traceId}`);
  }
  if (whereParts.length > 0) {
    params.set('where', whereParts.join(' '));
    params.set('whereLanguage', 'lucene');
  }

  // Add row identification for the side panel.
  // Values are pre-encoded with encodeURIComponent to match
  // parseAsStringEncoded's serialize (double-encoding).
  if (rowWhere) {
    params.set('rowWhere', encodeURIComponent(rowWhere));
    params.set('rowSource', source.id);
  }

  // Map TUI tab name to web app tab name
  const webTab = SIDE_PANEL_TAB_MAP[detailTab] ?? 'overview';
  params.set('sidePanelTab', webTab);

  // Add trace waterfall span selection (trace tab only)
  if (eventRowWhere) {
    params.set(
      'eventRowWhere',
      encodeURIComponent(JSON.stringify(eventRowWhere)),
    );
  }

  return `${appUrl}/search?${params.toString()}`;
}
