import {
  SourceKind,
  TLogSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';

/** Fully-typed trace source for tests (default OTel schema). */
export function makeTraceSource(
  overrides: Partial<TTraceSource> = {},
): TTraceSource {
  return {
    id: 'trace-source',
    kind: SourceKind.Trace,
    name: 'Traces',
    connection: 'c1',
    from: { databaseName: 'default', tableName: 'otel_traces' },
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression:
      'Timestamp, ServiceName, StatusCode, round(Duration / 1e6), SpanName',
    eventAttributesExpression: 'SpanAttributes',
    durationExpression: 'Duration',
    durationPrecision: 9,
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    parentSpanIdExpression: 'ParentSpanId',
    spanNameExpression: 'SpanName',
    spanKindExpression: 'SpanKind',
    statusCodeExpression: 'StatusCode',
    statusMessageExpression: 'StatusMessage',
    serviceNameExpression: 'ServiceName',
    ...overrides,
  };
}

/** Fully-typed log source for tests (default OTel schema). */
export function makeLogSource(overrides: Partial<TLogSource> = {}): TLogSource {
  return {
    id: 'log-source',
    kind: SourceKind.Log,
    name: 'Logs',
    connection: 'c1',
    from: { databaseName: 'default', tableName: 'otel_logs' },
    timestampValueExpression: 'TimestampTime',
    defaultTableSelectExpression: 'Timestamp, ServiceName, SeverityText, Body',
    eventAttributesExpression: 'LogAttributes',
    severityTextExpression: 'SeverityText',
    serviceNameExpression: 'ServiceName',
    ...overrides,
  };
}
