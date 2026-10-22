import { get } from 'lodash';
import SqlString from 'sqlstring';
import type {
  BuilderChartConfigWithDateRange,
  Filter,
} from '@hyperdx/common-utils/dist/types';

import type { TTimelineSpanEventMarker } from '@/components/TimelineChart/TimelineSpanEventMarker';
import { getDisplayedTimestampValueExpression } from '@/source';
import { formatDurationMs } from '@/utils';
import { BROWSER_EVENT_NAMES } from '@/utils/browserEvents';
import {
  BrowserEventLogSource,
  BrowserEventResult,
  BrowserTraceContext,
  getBrowserEventDateRange,
  hasSubSecondTimestamps,
  parseRowTimeMs,
} from '@/utils/browserTraceContext';
import { formatBytes } from '@/utils/httpSpanAttributes';
import { isSet, toFiniteNumber } from '@/utils/spanAttributeReaders';

const ATTRIBUTE_PREFIX = 'browser.resource_timing.';

// Same names and order as the network span events @opentelemetry/sdk-trace-web
// adds to fetch and XHR spans, which the legacy SDK drew as dots.
const PHASES = [
  ['fetch_start', 'fetchStart'],
  ['domain_lookup_start', 'domainLookupStart'],
  ['domain_lookup_end', 'domainLookupEnd'],
  ['connect_start', 'connectStart'],
  ['secure_connection_start', 'secureConnectionStart'],
  ['connect_end', 'connectEnd'],
  ['request_start', 'requestStart'],
  ['response_start', 'responseStart'],
  ['response_end', 'responseEnd'],
] as const;

// Five keys with duration and next_hop_protocol: the marker tooltip's limit.
// New SDK spans carry no response size, and the dots replace the timing row.
const SIZE_ATTRIBUTES = [
  'transfer_size',
  'encoded_body_size',
  'decoded_body_size',
] as const;
const PROTOCOL_ATTRIBUTE = 'next_hop_protocol';

// A timing log's timestamp is its emit time, after the request ends. The SDK
// flushes within 1 s; the margin covers slow exports.
const EMIT_LAG_MS = 5 * 60 * 1000;
const RESOURCE_TIMING_LIMIT = 1000;

export type ResourceTimingMarker = Omit<
  TTimelineSpanEventMarker,
  'timestamp'
> & {
  attributes: Record<string, string>;
};

/**
 * Matches a timing log to its waterfall log row. Both queries select the same
 * timestamp expression, and another log on the span has another timestamp.
 */
export function resourceTimingRowKey(spanId: unknown, timestamp: unknown) {
  return `${String(spanId)}|${String(timestamp)}`;
}

export function buildResourceTimingQuery({
  logSource,
  context,
  traceId,
}: {
  logSource: BrowserEventLogSource;
  context: BrowserTraceContext;
  traceId: string;
}): BuilderChartConfigWithDateRange {
  // toString: a JSON path is Dynamic, which IN rejects.
  const filters: Filter[] = [
    {
      type: 'sql',
      condition: SqlString.format('? = ?', [
        SqlString.raw(`toString(${logSource.eventNameExpression})`),
        BROWSER_EVENT_NAMES.RESOURCE_TIMING,
      ]),
    },
  ];
  if (logSource.serviceNameExpression && context.serviceNames.length > 0) {
    filters.push({
      type: 'sql',
      condition: SqlString.format('? IN (?)', [
        SqlString.raw(`toString(${logSource.serviceNameExpression})`),
        context.serviceNames,
      ]),
    });
  }
  return {
    source: logSource.id,
    connection: logSource.connection,
    from: logSource.from,
    timestampValueExpression: logSource.timestampValueExpression,
    select: [
      { valueExpression: logSource.spanIdExpression, alias: 'span_id' },
      {
        valueExpression: getDisplayedTimestampValueExpression(logSource),
        alias: 'timestamp',
      },
      // The whole map: a single key would need a JSON metadata lookup first.
      {
        valueExpression: logSource.eventAttributesExpression,
        alias: 'attributes',
      },
    ],
    where: `${logSource.traceIdExpression} = ${SqlString.escape(traceId)}`,
    whereLanguage: 'sql',
    filters,
    dateRange: getBrowserEventDateRange(
      context.anchorMs,
      context.endMs + EMIT_LAG_MS,
    ),
    limit: { limit: RESOURCE_TIMING_LIMIT },
  };
}

function readNumber(attributes: unknown, key: string): number | undefined {
  // lodash get reads both a flat Map key and a nested JSON path. Map values
  // are strings, and JSON Int64 values come quoted.
  return toFiniteNumber(get(attributes, `${ATTRIBUTE_PREFIX}${key}`));
}

function getTooltipAttributes(attributes: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  const duration = readNumber(attributes, 'duration');
  if (duration != null) {
    result.duration = formatDurationMs(duration);
  }
  // A cross-origin response without Timing-Allow-Origin reports every size as
  // 0, which isn't its size. A lone 0 transfer size is a cache hit and stays.
  const sizes = SIZE_ATTRIBUTES.map(
    key => [key, readNumber(attributes, key)] as const,
  );
  if (sizes.some(([, size]) => size)) {
    for (const [key, size] of sizes) {
      if (size != null) {
        result[key] = formatBytes(size);
      }
    }
  }
  const protocol: unknown = get(
    attributes,
    `${ATTRIBUTE_PREFIX}${PROTOCOL_ATTRIBUTE}`,
  );
  if (isSet(protocol)) {
    result[PROTOCOL_ATTRIBUTE] = String(protocol);
  }
  return result;
}

/**
 * Phases are milliseconds from the page's time origin, and the log timestamp
 * is its emit time, so dots are placed relative to the span start. Zero
 * phases weren't measured (a cross-origin request without
 * Timing-Allow-Origin) and are skipped, as sdk-trace-web does.
 */
function toMarkers(
  attributes: unknown,
  spanStartMs: number,
  fetchStart: number,
): ResourceTimingMarker[] {
  const markers = PHASES.flatMap(([key, name]) => {
    const phase = readNumber(attributes, key);
    return phase != null && phase !== 0
      ? [{ epochMs: spanStartMs + (phase - fetchStart), name, attributes: {} }]
      : [];
  });
  markers[markers.length - 1].attributes = getTooltipAttributes(attributes);
  return markers;
}

/**
 * A log on a span outside the trace isn't drawn, so its row stays. A drawn
 * log's row stays too when the trace filter hides its span, since the dots
 * don't show, or when the timestamp column is whole seconds, since the key
 * would match every log on the span in that second.
 */
export function getResourceTimingMarkers(
  { data, meta }: BrowserEventResult,
  traceRows: readonly {
    SpanId?: unknown;
    Timestamp?: unknown;
    __hdx_hidden?: unknown;
  }[],
): {
  markersBySpanId: ReadonlyMap<string, ResourceTimingMarker[]>;
  drawnRowKeys: ReadonlySet<string>;
} {
  const spanStarts = new Map<string, number>();
  const shownSpanIds = new Set<string>();
  for (const row of traceRows) {
    const startMs = parseRowTimeMs(row.Timestamp);
    if (isSet(row.SpanId) && startMs != null) {
      const spanId = String(row.SpanId);
      spanStarts.set(spanId, startMs);
      if (!row.__hdx_hidden) {
        shownSpanIds.add(spanId);
      }
    }
  }

  const foldable = hasSubSecondTimestamps(meta);
  const markersBySpanId = new Map<string, ResourceTimingMarker[]>();
  const drawnRowKeys = new Set<string>();
  for (const row of data) {
    const spanId = isSet(row.span_id) ? String(row.span_id) : undefined;
    const spanStartMs = spanId != null ? spanStarts.get(spanId) : undefined;
    const fetchStart = readNumber(row.attributes, 'fetch_start');
    if (spanId == null || spanStartMs == null || !fetchStart) {
      continue;
    }
    markersBySpanId.set(spanId, [
      ...(markersBySpanId.get(spanId) ?? []),
      ...toMarkers(row.attributes, spanStartMs, fetchStart),
    ]);
    if (foldable && shownSpanIds.has(spanId)) {
      drawnRowKeys.add(resourceTimingRowKey(spanId, row.timestamp));
    }
  }
  return { markersBySpanId, drawnRowKeys };
}
