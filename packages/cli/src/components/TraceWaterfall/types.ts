import type { Metadata } from '@hyperdx/common-utils/dist/core/metadata';

import type { ProxyClickhouseClient, SourceResponse } from '@/api/client';

export interface SpanRow {
  Timestamp: string;
  TraceId: string;
  SpanId: string;
  ParentSpanId: string;
  SpanName: string;
  ServiceName: string;
  Duration: number;
  StatusCode: string;
}

/** Extends SpanRow with a kind marker for distinguishing spans from logs */
export interface TaggedSpanRow extends SpanRow {
  kind: 'span' | 'log';
}

export interface SpanNode extends TaggedSpanRow {
  children: SpanNode[];
  level: number;
}

export interface TraceWaterfallProps {
  clickhouseClient: ProxyClickhouseClient;
  metadata: Metadata;
  source: SourceResponse;
  /** Correlated log source (optional) */
  logSource?: SourceResponse | null;
  traceId: string;
  /**
   * Timestamp of the originating event row. Used to derive a tight
   * dateRange for trace span queries so ClickHouse can prune time
   * partitions instead of scanning the entire table.
   */
  eventTimestamp?: string;
  /** Fuzzy filter query for span/log names */
  searchQuery?: string;
  /** Hint to identify the initial row to highlight in the waterfall */
  highlightHint?: {
    spanId: string;
    kind: 'span' | 'log';
  };
  /** Currently selected row index (controlled by parent via j/k) */
  selectedIndex?: number | null;
  /** Callback when the selected index should change (e.g. clamping) */
  onSelectedIndexChange?: (index: number | null) => void;
  /** Toggle line wrap in Event Details */
  wrapLines?: boolean;
  /** Scroll offset for Event Details */
  detailScrollOffset?: number;
  /** Max visible rows for Event Details */
  detailMaxRows?: number;
  /** Available width for the chart (characters) */
  width?: number;
  /** Max visible rows before truncation */
  maxRows?: number;
  /** Callback when the trace query SQL changes (for SQL preview) */
  onChSqlChange?: (
    chSql: { sql: string; params: Record<string, unknown> } | null,
  ) => void;
}
