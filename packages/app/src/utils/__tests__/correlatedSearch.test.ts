import {
  SourceKind,
  TLogSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';

import { buildCorrelatedSearchWhere } from '@/utils/correlatedSearch';

const traceSource: TTraceSource = {
  kind: SourceKind.Trace,
  id: 'trace-source',
  name: 'Traces',
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'otel_traces' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: 'Timestamp, SpanName',
  traceIdExpression: 'TraceId',
  spanIdExpression: 'SpanId',
  parentSpanIdExpression: 'ParentSpanId',
  spanNameExpression: 'SpanName',
  spanKindExpression: 'SpanKind',
  durationExpression: 'Duration',
  durationPrecision: 9,
};

const logSource: TLogSource = {
  kind: SourceKind.Log,
  id: 'log-source',
  name: 'Logs',
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  timestampValueExpression: 'TimestampTime',
  defaultTableSelectExpression: 'Timestamp, Body',
  traceIdExpression: 'TraceId',
};

const build = (
  overrides: Partial<Parameters<typeof buildCorrelatedSearchWhere>[0]> = {},
) =>
  buildCorrelatedSearchWhere({
    searchedSource: traceSource,
    eventSource: logSource,
    eventWhere: "Body LIKE '%exception%'",
    ...overrides,
  });

const SUBQUERY =
  "TraceId IN (SELECT TraceId FROM default.otel_logs WHERE Body LIKE '%exception%')";

describe('buildCorrelatedSearchWhere', () => {
  it('builds a trace-id subquery on the event source', () => {
    expect(build()).toBe(SUBQUERY);
  });

  it('supports the mirror direction (span condition on a log search)', () => {
    expect(
      build({
        searchedSource: logSource,
        eventSource: traceSource,
        eventWhere: "SpanName = 'place order'",
      }),
    ).toBe(
      "TraceId IN (SELECT TraceId FROM default.otel_traces WHERE SpanName = 'place order')",
    );
  });

  it('builds the subquery even when the sources are on different connections (the query may fail, but the user can edit it)', () => {
    expect(build({ eventSource: { ...logSource, connection: 'conn-2' } })).toBe(
      SUBQUERY,
    );
  });

  it('defaults a missing trace id expression to TraceId', () => {
    expect(
      build({
        searchedSource: { ...traceSource, traceIdExpression: '' },
        eventSource: { ...logSource, traceIdExpression: undefined },
      }),
    ).toBe(SUBQUERY);
  });
});
