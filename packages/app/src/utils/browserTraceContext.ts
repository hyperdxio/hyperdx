import { get } from 'lodash';
import type { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { classifyTimestampType } from '@hyperdx/common-utils/dist/core/utils';
import type { TLogSource } from '@hyperdx/common-utils/dist/types';

import { parseTimestampToMs } from '@/utils';
import {
  isSessionLogEventSource,
  SessionLogEventSource,
} from '@/utils/sessionLogEvents';
import { isSet } from '@/utils/spanAttributeReaders';

// The waterfall reads an hour either side of its focus. One long or broken
// span would otherwise stretch the timing query over its whole duration.
const MAX_TRACE_MS = 60 * 60 * 1000;

export type BrowserTraceContext = {
  serviceNames: string[];
  /** Earliest browser span start. */
  anchorMs: number;
  /** Latest browser span end, at most an hour after the anchor. */
  endMs: number;
  /** Whether the trace filter hid the anchor span. */
  anchorHidden: boolean;
  /** Of the anchor span. */
  sessionId: string | undefined;
  /** Of the anchor span. */
  serviceName: string | undefined;
};

export type BrowserTraceRow = {
  Timestamp?: unknown;
  Duration?: unknown;
  ServiceName?: unknown;
  SpanAttributes?: unknown;
  __hdx_hidden?: unknown;
};

export type BrowserEventLogSource = SessionLogEventSource &
  Required<Pick<TLogSource, 'traceIdExpression' | 'spanIdExpression'>>;

export function isBrowserEventLogSource(
  source: TLogSource | null | undefined,
): source is BrowserEventLogSource {
  return (
    isSessionLogEventSource(source) &&
    !!source.traceIdExpression &&
    !!source.spanIdExpression
  );
}

/**
 * Twin of the guard in the waterfall's traceExtent: timestamp-nano reads a
 * non-date as a finite instant.
 */
export function parseRowTimeMs(timestamp: unknown): number | undefined {
  if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
    return undefined;
  }
  try {
    const ms = parseTimestampToMs(timestamp);
    return Number.isFinite(ms) ? ms : undefined;
  } catch {
    return undefined;
  }
}

export type BrowserEventResult = Pick<
  ResponseJSON<Record<string, unknown>>,
  'data' | 'meta'
>;

export function hasSubSecondTimestamps(
  meta: BrowserEventResult['meta'],
): boolean {
  const type = meta?.find(column => column.name === 'timestamp')?.type;
  return (classifyTimestampType(type)?.precision ?? 0) > 0;
}

/**
 * The start is floored to the second: a DateTime time column compares its
 * truncated value and would otherwise lose the start's second. The end is
 * inclusive, so a truncated value is never past it.
 */
export function getBrowserEventDateRange(
  startMs: number,
  endMs: number,
): [Date, Date] {
  return [new Date(Math.floor(startMs / 1000) * 1000), new Date(endMs)];
}

function optionalString(value: unknown): string | undefined {
  return isSet(value) ? String(value) : undefined;
}

/**
 * Undefined unless the trace has a span from an OTel browser SDK, which sets
 * the page URL on every span. AI and backend spans can carry `session.id`
 * too, and legacy SDK spans have neither. Never anchored on the trace's
 * earliest span overall: backend spans run on another clock.
 */
export function getBrowserTraceContext(
  traceRows: readonly BrowserTraceRow[],
): BrowserTraceContext | undefined {
  let anchor: { row: BrowserTraceRow; startMs: number } | undefined;
  let endMs = Number.NEGATIVE_INFINITY;
  const serviceNames = new Set<string>();
  for (const row of traceRows) {
    if (!isSet(get(row.SpanAttributes, 'browser.document.url.full'))) {
      continue;
    }
    const startMs = parseRowTimeMs(row.Timestamp);
    if (startMs == null) {
      continue;
    }
    const durationSec = Number(row.Duration);
    endMs = Math.max(
      endMs,
      startMs + (Number.isFinite(durationSec) ? durationSec : 0) * 1000,
    );
    const serviceName = optionalString(row.ServiceName);
    if (serviceName != null) {
      serviceNames.add(serviceName);
    }
    if (anchor == null || startMs < anchor.startMs) {
      anchor = { row, startMs };
    }
  }
  if (anchor == null) {
    return undefined;
  }
  return {
    serviceNames: [...serviceNames].sort(),
    anchorMs: anchor.startMs,
    endMs: Math.min(endMs, anchor.startMs + MAX_TRACE_MS),
    anchorHidden: !!anchor.row.__hdx_hidden,
    sessionId: optionalString(get(anchor.row.SpanAttributes, 'session.id')),
    serviceName: optionalString(anchor.row.ServiceName),
  };
}
