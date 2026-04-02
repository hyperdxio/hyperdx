import {
  SourceKind,
  TLogSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';

import { getEventBody, getTraceDurationNumberFormat } from '../source';

const TRACE_SOURCE: TTraceSource = {
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
  defaultTableSelectExpression: 'Timestamp, ServiceName',
} as TTraceSource;

describe('getEventBody', () => {
  it('returns spanNameExpression for trace kind source when both bodyExpression and spanNameExpression are present', () => {
    const result = getEventBody(TRACE_SOURCE);
    expect(result).toBe('SpanName');
  });
});

describe('getTraceDurationNumberFormat', () => {
  it('returns undefined for non-trace sources', () => {
    const logSource = {
      kind: SourceKind.Log,
      id: 'log-source',
    } as TLogSource;
    const result = getTraceDurationNumberFormat(logSource, [
      { valueExpression: 'count()' },
    ]);
    expect(result).toBeUndefined();
  });

  it('returns undefined when source is undefined', () => {
    const result = getTraceDurationNumberFormat(undefined, [
      { valueExpression: 'count()' },
    ]);
    expect(result).toBeUndefined();
  });

  it('returns undefined when select expressions do not reference duration', () => {
    const result = getTraceDurationNumberFormat(TRACE_SOURCE, [
      { valueExpression: 'count()' },
    ]);
    expect(result).toBeUndefined();
  });

  it('detects raw duration expression reference', () => {
    const result = getTraceDurationNumberFormat(TRACE_SOURCE, [
      { valueExpression: 'avg(Duration)' },
    ]);
    expect(result).toEqual({
      output: 'duration',
      factor: 1e-9,
    });
  });

  it('detects duration ms expression reference', () => {
    const result = getTraceDurationNumberFormat(TRACE_SOURCE, [
      { valueExpression: '(Duration)/1e6' },
    ]);
    expect(result).toEqual({
      output: 'duration',
      factor: 0.001,
    });
  });

  it('detects duration seconds expression reference', () => {
    const result = getTraceDurationNumberFormat(TRACE_SOURCE, [
      { valueExpression: '(Duration)/1e9' },
    ]);
    expect(result).toEqual({
      output: 'duration',
      factor: 1,
    });
  });

  it('returns undefined when select is empty', () => {
    const result = getTraceDurationNumberFormat(TRACE_SOURCE, []);
    expect(result).toBeUndefined();
  });
});
