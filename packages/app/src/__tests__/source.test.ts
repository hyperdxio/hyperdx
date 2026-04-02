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

  it('detects raw duration expression with avg aggFn', () => {
    const result = getTraceDurationNumberFormat(TRACE_SOURCE, [
      { valueExpression: 'Duration', aggFn: 'avg' },
    ]);
    expect(result).toEqual({
      output: 'duration',
      factor: 1e-9,
    });
  });

  it('detects duration expression without aggFn (raw expression)', () => {
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

  it('returns undefined for count aggFn on duration', () => {
    const result = getTraceDurationNumberFormat(TRACE_SOURCE, [
      { valueExpression: 'Duration', aggFn: 'count' },
    ]);
    expect(result).toBeUndefined();
  });

  it('returns undefined for count_distinct aggFn on duration', () => {
    const result = getTraceDurationNumberFormat(TRACE_SOURCE, [
      { valueExpression: 'Duration', aggFn: 'count_distinct' },
    ]);
    expect(result).toBeUndefined();
  });

  it('detects duration with sum aggFn', () => {
    const result = getTraceDurationNumberFormat(TRACE_SOURCE, [
      { valueExpression: 'Duration', aggFn: 'sum' },
    ]);
    expect(result).toEqual({
      output: 'duration',
      factor: 1e-9,
    });
  });

  it('detects duration with quantile aggFn', () => {
    const result = getTraceDurationNumberFormat(TRACE_SOURCE, [
      { valueExpression: 'Duration', aggFn: 'quantile' },
    ]);
    expect(result).toEqual({
      output: 'duration',
      factor: 1e-9,
    });
  });

  it('detects duration with min/max aggFn', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration', aggFn: 'min' },
      ]),
    ).toEqual({ output: 'duration', factor: 1e-9 });
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration', aggFn: 'max' },
      ]),
    ).toEqual({ output: 'duration', factor: 1e-9 });
  });

  it('detects duration with combinator aggFn like avgIf', () => {
    const result = getTraceDurationNumberFormat(TRACE_SOURCE, [
      { valueExpression: 'Duration', aggFn: 'avgIf' },
    ]);
    expect(result).toEqual({
      output: 'duration',
      factor: 1e-9,
    });
  });

  it('skips non-preserving aggFn and detects preserving one in mixed selects', () => {
    const result = getTraceDurationNumberFormat(TRACE_SOURCE, [
      { valueExpression: 'Duration', aggFn: 'count' },
      { valueExpression: 'Duration', aggFn: 'avg' },
    ]);
    expect(result).toEqual({
      output: 'duration',
      factor: 1e-9,
    });
  });

  it('returns undefined when only non-preserving aggFns reference duration', () => {
    const result = getTraceDurationNumberFormat(TRACE_SOURCE, [
      { valueExpression: 'Duration', aggFn: 'count' },
      { valueExpression: 'Duration', aggFn: 'count_distinct' },
    ]);
    expect(result).toBeUndefined();
  });

  it('returns undefined when select is empty', () => {
    const result = getTraceDurationNumberFormat(TRACE_SOURCE, []);
    expect(result).toBeUndefined();
  });
});
