import { SourceKind, TTraceSource } from '@hyperdx/common-utils/dist/types';

import { getEventBody } from '../source';

describe('getEventBody', () => {
  // Added to prevent regression back to HDX-3361
  it('returns spanNameExpression for trace kind source when both bodyExpression and spanNameExpression are present', () => {
    const source = {
      kind: SourceKind.Trace,
      from: {
        databaseName: 'default',
        tableName: 'otel_traces',
      },
      timestampValueExpression: 'Timestamp',
      connection: 'test-connection',
      name: 'Traces',
      id: 'test-source-id',
      spanNameExpression: 'SpanName',
      durationExpression: 'Duration',
      durationPrecision: 9,
      traceIdExpression: 'TraceId',
      spanIdExpression: 'SpanId',
      parentSpanIdExpression: 'ParentSpanId',
      spanKindExpression: 'SpanKind',
    } as TTraceSource;

    const result = getEventBody(source);

    expect(result).toBe('SpanName');
  });
});
