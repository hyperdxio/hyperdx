import { useMemo } from 'react';
import SqlString from 'sqlstring';
import {
  BuilderChartConfigWithDateRange,
  isTraceSource,
  TSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { Group, Text } from '@mantine/core';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import {
  getDisplayedTimestampValueExpression,
  getDurationMsExpression,
  getEventBody,
} from '@/source';
import { FormatTime } from '@/useFormatTime';

import { renderMs } from './TimelineChart/utils';
import type { SpanLinkData } from './SpanLinksSubpanel';

export const LINKED_SPAN_ALIASES = {
  TIMESTAMP: '__hdx_timestamp',
  TRACE_ID: '__hdx_trace_id',
  SPAN_ID: '__hdx_span_id',
  BODY: '__hdx_body',
  SERVICE_NAME: '__hdx_service_name',
  DURATION_MS: '__hdx_duration_ms',
} as const;

// A span link usually crosses trace boundaries in one time direction:
// consumers referencing a producer span run at/after it — sometimes hours
// later (queues, batch jobs) — while the spans a link points *to* ran at or
// before the linking span. Each direction searches a window skewed that way,
// with a small allowance for clock skew. The window is the primary
// performance mechanism: it drives partition/primary-key pruning, and there
// is deliberately no unbounded fallback.
const SKEW_MS = 60 * 60 * 1000;
const LINK_HORIZON_MS = 24 * 60 * 60 * 1000;

const MAX_LINKED_SPANS = 50;

export interface LinkedSpanDetails {
  TraceId: string;
  SpanId: string;
  spanName?: string;
  serviceName?: string;
  timestamp?: string;
  durationMs?: number;
}

// Requirements shared by both lookup directions; returns null when the source
// can't support either query (also gates out non-trace sources).
function getLinkedSpanSourceExpressions(source: TSource) {
  if (!isTraceSource(source)) {
    return null;
  }
  const timestampExpr = source.timestampValueExpression?.trim();
  if (!timestampExpr || !source.traceIdExpression || !source.spanIdExpression) {
    return null;
  }
  return {
    source,
    timestampExpr,
    traceIdExpression: source.traceIdExpression,
    spanIdExpression: source.spanIdExpression,
    spanLinksExpression: source.spanLinksValueExpression?.trim() || undefined,
  };
}

function getLinkedSpanSelect(source: TTraceSource) {
  const eventBodyExpr = getEventBody(source);
  return [
    {
      valueExpression: getDisplayedTimestampValueExpression(source),
      alias: LINKED_SPAN_ALIASES.TIMESTAMP,
    },
    {
      valueExpression: source.traceIdExpression,
      alias: LINKED_SPAN_ALIASES.TRACE_ID,
    },
    {
      valueExpression: source.spanIdExpression,
      alias: LINKED_SPAN_ALIASES.SPAN_ID,
    },
    ...(eventBodyExpr
      ? [
          {
            valueExpression: eventBodyExpr,
            alias: LINKED_SPAN_ALIASES.BODY,
          },
        ]
      : []),
    ...(source.serviceNameExpression
      ? [
          {
            valueExpression: source.serviceNameExpression,
            alias: LINKED_SPAN_ALIASES.SERVICE_NAME,
          },
        ]
      : []),
    ...(source.durationExpression
      ? [
          {
            valueExpression: getDurationMsExpression(source),
            alias: LINKED_SPAN_ALIASES.DURATION_MS,
          },
        ]
      : []),
  ];
}

export function getReverseSpanLinksConfig({
  source,
  traceId,
  spanId,
  anchorDate,
}: {
  source: TSource;
  traceId: string | undefined;
  spanId: string | undefined;
  anchorDate: Date | undefined;
}): BuilderChartConfigWithDateRange | null {
  const exprs = getLinkedSpanSourceExpressions(source);
  if (
    !exprs ||
    !exprs.spanLinksExpression ||
    !traceId ||
    !spanId ||
    anchorDate == null
  ) {
    return null;
  }

  const linkTraceIdExpr = SqlString.raw(`${exprs.spanLinksExpression}.TraceId`);
  const linkSpanIdExpr = SqlString.raw(`${exprs.spanLinksExpression}.SpanId`);
  // The WHERE has two conjuncts with different jobs:
  // - `has(Links.SpanId, x)`: cheap filter, and the only shape a bloom_filter
  //   skipping index can serve (an `arrayExists` lambda cannot).
  // - `arrayExists(...)`: exact match on the (TraceId, SpanId) pair, since
  //   `has()` alone would match the span id linked from any trace.
  //
  // No index serves the `has()` today — the default ClickStack schema has
  // none on Links.SpanId — so this lookup is bounded only by its dateRange
  // (a scan of ~2 daily partitions). If that gets slow (~1B spans/day),
  // adding to otel_traces:
  //   INDEX idx_link_span_id Links.SpanId TYPE bloom_filter(0.001)
  // lets ClickHouse skip nearly all granules with no app change.
  const where = SqlString.format(
    'has(?, ?) AND arrayExists((lt, ls) -> lt = ? AND ls = ?, ?, ?)',
    [linkSpanIdExpr, spanId, traceId, spanId, linkTraceIdExpr, linkSpanIdExpr],
  );

  return {
    connection: source.connection,
    from: source.from,
    select: getLinkedSpanSelect(exprs.source),
    where,
    whereLanguage: 'sql',
    timestampValueExpression: exprs.timestampExpr,
    dateRange: [
      new Date(anchorDate.getTime() - SKEW_MS),
      new Date(anchorDate.getTime() + LINK_HORIZON_MS),
    ],
    orderBy: [
      {
        valueExpression: LINKED_SPAN_ALIASES.TIMESTAMP,
        ordering: 'ASC',
      },
    ],
    limit: { limit: MAX_LINKED_SPANS },
  };
}

export function getLinkedSpansConfig({
  source,
  links,
  anchorDate,
}: {
  source: TSource;
  links: Pick<SpanLinkData, 'TraceId' | 'SpanId'>[];
  anchorDate: Date | undefined;
}): BuilderChartConfigWithDateRange | null {
  const exprs = getLinkedSpanSourceExpressions(source);
  if (!exprs || anchorDate == null || links.length === 0) {
    return null;
  }

  const seen = new Set<string>();
  const pairs: [string, string][] = [];
  for (const link of links) {
    const key = linkedSpanKey(link.TraceId, link.SpanId);
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push([link.TraceId, link.SpanId]);
    }
    if (pairs.length >= MAX_LINKED_SPANS) {
      break;
    }
  }

  const traceIdExpr = SqlString.raw(exprs.traceIdExpression);
  const spanIdExpr = SqlString.raw(exprs.spanIdExpression);
  // The plain trace-id IN is servable by the default schema's bloom_filter
  // index on TraceId; the tuple IN pins the exact (TraceId, SpanId) pairs.
  const where = SqlString.format('? IN (?) AND (?, ?) IN (?)', [
    traceIdExpr,
    pairs.map(([linkTraceId]) => linkTraceId),
    traceIdExpr,
    spanIdExpr,
    pairs,
  ]);

  return {
    connection: source.connection,
    from: source.from,
    select: getLinkedSpanSelect(exprs.source),
    where,
    whereLanguage: 'sql',
    timestampValueExpression: exprs.timestampExpr,
    dateRange: [
      new Date(anchorDate.getTime() - LINK_HORIZON_MS),
      new Date(anchorDate.getTime() + SKEW_MS),
    ],
    limit: { limit: MAX_LINKED_SPANS },
  };
}

export function linkedSpanKey(traceId: string, spanId: string) {
  return `${traceId}:${spanId}`;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// ClickHouse's JSON format can quote 64-bit numerics, so a duration may
// arrive as either a number or a numeric string.
function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value !== '' && !isNaN(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function mapLinkedSpanRow(
  row: Record<string, unknown>,
): LinkedSpanDetails | null {
  const linkTraceId = row[LINKED_SPAN_ALIASES.TRACE_ID];
  const linkSpanId = row[LINKED_SPAN_ALIASES.SPAN_ID];
  if (typeof linkTraceId !== 'string' || typeof linkSpanId !== 'string') {
    return null;
  }
  return {
    TraceId: linkTraceId,
    SpanId: linkSpanId,
    spanName: asString(row[LINKED_SPAN_ALIASES.BODY]),
    serviceName: asString(row[LINKED_SPAN_ALIASES.SERVICE_NAME]),
    timestamp: asString(row[LINKED_SPAN_ALIASES.TIMESTAMP]),
    durationMs: asNumber(row[LINKED_SPAN_ALIASES.DURATION_MS]),
  };
}

function usePlaceholderConfig(source: TSource) {
  // Never fetched (the query is disabled while the real config is null);
  // exists only so useQueriedChartConfig always receives a structurally valid
  // config.
  return useMemo<BuilderChartConfigWithDateRange>(
    () => ({
      connection: source.connection,
      from: source.from,
      select: [{ valueExpression: '1' }],
      where: '0=1',
      whereLanguage: 'sql',
      timestampValueExpression: source.timestampValueExpression,
      dateRange: [new Date(0), new Date(0)],
      limit: { limit: 0 },
    }),
    [source],
  );
}

export function useReverseSpanLinks({
  source,
  traceId,
  spanId,
  anchorDate,
  enabled = true,
}: {
  source: TSource;
  traceId: string | undefined;
  spanId: string | undefined;
  anchorDate: Date | undefined;
  enabled?: boolean;
}) {
  const config = useMemo(
    () => getReverseSpanLinksConfig({ source, traceId, spanId, anchorDate }),
    [source, traceId, spanId, anchorDate],
  );

  const placeholderConfig = usePlaceholderConfig(source);
  const queryResult = useQueriedChartConfig(config ?? placeholderConfig, {
    queryKey: ['reverse-span-links', config],
    enabled: enabled && config != null,
  });

  const links = useMemo<LinkedSpanDetails[]>(() => {
    const rows = queryResult.data?.data ?? [];
    // Also serves rendering: the (TraceId, SpanId) pair doubles as the React
    // list key, so it must be unique.
    const seen = new Set<string>();
    return rows.flatMap(row => {
      const mapped = mapLinkedSpanRow(row);
      if (mapped == null) {
        return [];
      }
      // A span whose links include itself would otherwise list the span the
      // user is already looking at.
      if (mapped.TraceId === traceId && mapped.SpanId === spanId) {
        return [];
      }
      const key = linkedSpanKey(mapped.TraceId, mapped.SpanId);
      if (seen.has(key)) {
        return [];
      }
      seen.add(key);
      return [mapped];
    });
  }, [queryResult.data, traceId, spanId]);

  return {
    links,
    isLoading: queryResult.isLoading,
    error: queryResult.error,
  };
}

/**
 * Resolves the spans a row's forward span links point to, so the link list
 * can show details (span name, service, duration) instead of bare ids.
 * Returns a map keyed by `linkedSpanKey`; links whose target span isn't found
 * (outside the window, TTL'd out) are simply absent.
 */
export function useLinkedSpanDetails({
  source,
  links,
  anchorDate,
  enabled = true,
}: {
  source: TSource;
  links: Pick<SpanLinkData, 'TraceId' | 'SpanId'>[];
  anchorDate: Date | undefined;
  enabled?: boolean;
}) {
  const config = useMemo(
    () => getLinkedSpansConfig({ source, links, anchorDate }),
    [source, links, anchorDate],
  );

  const placeholderConfig = usePlaceholderConfig(source);
  const queryResult = useQueriedChartConfig(config ?? placeholderConfig, {
    queryKey: ['linked-span-details', config],
    enabled: enabled && config != null,
  });

  const details = useMemo(() => {
    const map = new Map<string, LinkedSpanDetails>();
    for (const row of queryResult.data?.data ?? []) {
      const mapped = mapLinkedSpanRow(row);
      if (mapped != null) {
        const key = linkedSpanKey(mapped.TraceId, mapped.SpanId);
        if (!map.has(key)) {
          map.set(key, mapped);
        }
      }
    }
    return map;
  }, [queryResult.data]);

  return {
    details,
    isLoading: queryResult.isLoading,
    error: queryResult.error,
  };
}

export function LinkedSpanMetaLine({
  details,
}: {
  details: LinkedSpanDetails;
}) {
  const hasDuration =
    details.durationMs != null && !isNaN(Number(details.durationMs));
  if (!details.serviceName && !hasDuration && !details.timestamp) {
    return null;
  }
  return (
    <Group gap="sm" wrap="wrap">
      {details.serviceName ? (
        <Text size="xs" c="dimmed">
          {details.serviceName}
        </Text>
      ) : null}
      {hasDuration ? (
        <Text size="xs" c="dimmed">
          {renderMs(Number(details.durationMs))}
        </Text>
      ) : null}
      {details.timestamp ? (
        <Text size="xs" c="dimmed">
          <FormatTime value={details.timestamp} format="withMs" />
        </Text>
      ) : null}
    </Group>
  );
}
