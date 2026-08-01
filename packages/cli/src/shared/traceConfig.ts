/**
 * Trace waterfall config builder.
 *
 * Builds a renderChartConfig-compatible config for fetching trace
 * spans and correlated log events, matching the web frontend's
 * getConfig pattern in DBTraceWaterfallChart.tsx.
 *
 * Using renderChartConfig instead of raw SQL enables:
 * - Time partition pruning via dateRange
 * - Materialized field optimisation
 * - Query parameterisation
 *
 * @source packages/app/src/components/DBTraceWaterfallChart.tsx (getConfig)
 */

import type { SelectList } from '@hyperdx/common-utils/dist/types';

import type { SourceResponse } from '@/api/client';
import { getDisplayedTimestampValueExpression, getEventBody } from './source';

/** Default window (±1 hour) around the event timestamp for partition pruning. */
const DEFAULT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Derive a dateRange from an optional event timestamp.
 * If no timestamp is available, returns undefined so the query runs
 * without time bounds (still correct, just slower).
 */
export function deriveDateRange(
  eventTimestamp: string | undefined,
): [Date, Date] | undefined {
  if (!eventTimestamp) return undefined;
  const ts = new Date(eventTimestamp).getTime();
  if (isNaN(ts)) return undefined;
  return [new Date(ts - DEFAULT_WINDOW_MS), new Date(ts + DEFAULT_WINDOW_MS)];
}

/**
 * Build a renderChartConfig-compatible config for trace span queries.
 */
export function buildTraceSpansConfig(opts: {
  source: SourceResponse;
  traceId: string;
  dateRange?: [Date, Date];
}) {
  const { source, traceId, dateRange } = opts;

  const tsExpr = getDisplayedTimestampValueExpression(source);
  const traceIdExpr = source.traceIdExpression ?? 'TraceId';
  const spanIdExpr = source.spanIdExpression ?? 'SpanId';
  const parentSpanIdExpr = source.parentSpanIdExpression ?? 'ParentSpanId';
  const spanNameExpr = source.spanNameExpression ?? 'SpanName';
  const serviceNameExpr = source.serviceNameExpression ?? 'ServiceName';
  const durationExpr = source.durationExpression ?? 'Duration';
  const statusCodeExpr = source.statusCodeExpression ?? 'StatusCode';

  const select: SelectList = [
    { valueExpression: tsExpr, alias: 'Timestamp' },
    { valueExpression: traceIdExpr, alias: 'TraceId' },
    { valueExpression: spanIdExpr, alias: 'SpanId' },
    { valueExpression: parentSpanIdExpr, alias: 'ParentSpanId' },
    { valueExpression: spanNameExpr, alias: 'SpanName' },
    ...(serviceNameExpr
      ? [{ valueExpression: serviceNameExpr, alias: 'ServiceName' }]
      : []),
    { valueExpression: durationExpr, alias: 'Duration' },
    ...(statusCodeExpr
      ? [{ valueExpression: statusCodeExpr, alias: 'StatusCode' }]
      : []),
  ];

  return {
    select,
    from: source.from,
    where: `${traceIdExpr} = '${traceId}'`,
    limit: { limit: 10000 },
    connection: source.connection,
    ...(dateRange != null
      ? {
          timestampValueExpression:
            source.timestampValueExpression ?? 'TimestampTime',
          dateRange,
        }
      : {}),
  };
}

/**
 * Build a renderChartConfig-compatible config for correlated log queries.
 * Logs are linked to spans via their SpanId.
 */
export function buildTraceLogsConfig(opts: {
  source: SourceResponse;
  traceId: string;
  dateRange?: [Date, Date];
}) {
  const { source, traceId, dateRange } = opts;

  const tsExpr = getDisplayedTimestampValueExpression(source);
  const traceIdExpr = source.traceIdExpression ?? 'TraceId';
  const spanIdExpr = source.spanIdExpression ?? 'SpanId';
  const bodyExpr = getEventBody(source) ?? source.bodyExpression ?? 'Body';
  const serviceNameExpr = source.serviceNameExpression ?? 'ServiceName';
  const sevExpr = source.severityTextExpression ?? 'SeverityText';

  const select: SelectList = [
    { valueExpression: tsExpr, alias: 'Timestamp' },
    { valueExpression: traceIdExpr, alias: 'TraceId' },
    { valueExpression: spanIdExpr, alias: 'SpanId' },
    { valueExpression: "''", alias: 'ParentSpanId' },
    { valueExpression: bodyExpr, alias: 'SpanName' },
    ...(serviceNameExpr
      ? [{ valueExpression: serviceNameExpr, alias: 'ServiceName' }]
      : []),
    { valueExpression: '0', alias: 'Duration' },
    ...(sevExpr ? [{ valueExpression: sevExpr, alias: 'StatusCode' }] : []),
  ];

  return {
    select,
    from: source.from,
    where: `${traceIdExpr} = '${traceId}'`,
    limit: { limit: 10000 },
    connection: source.connection,
    ...(dateRange != null
      ? {
          timestampValueExpression:
            source.timestampValueExpression ?? 'TimestampTime',
          dateRange,
        }
      : {}),
  };
}

/**
 * Build a renderChartConfig-compatible config for fetching a single
 * span/log row (SELECT *) from the trace waterfall detail panel.
 *
 * Omits dateRange/timestampValueExpression so ClickHouse uses the
 * WHERE clause directly without scanning time partitions. This matches
 * the web frontend's useRowData pattern in DBRowDataPanel.tsx.
 */
export function buildTraceRowDetailConfig(opts: {
  source: SourceResponse;
  traceId: string;
  spanId?: string;
  timestamp: string;
}) {
  const { source, traceId, spanId, timestamp } = opts;

  const traceIdExpr = source.traceIdExpression ?? 'TraceId';
  const spanIdExpr = source.spanIdExpression ?? 'SpanId';
  const tsExpr =
    source.displayedTimestampValueExpression ??
    source.timestampValueExpression ??
    'TimestampTime';

  const clauses = [
    `${traceIdExpr} = '${traceId}'`,
    `${tsExpr} = parseDateTime64BestEffort('${timestamp}', 9)`,
  ];
  if (spanId) {
    clauses.push(`${spanIdExpr} = '${spanId}'`);
  }

  return {
    select: [{ valueExpression: '*' }] as SelectList,
    from: source.from,
    where: clauses.join(' AND '),
    limit: { limit: 1 },
    connection: source.connection,
  };
}
