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

  // --- exact raw expression match ---

  it('detects exact raw duration expression with avg aggFn', () => {
    const result = getTraceDurationNumberFormat(TRACE_SOURCE, [
      { valueExpression: 'Duration', aggFn: 'avg' },
    ]);
    expect(result).toEqual({ output: 'duration', factor: 1e-9 });
  });

  it('does not match raw fallback when expression only contains duration name', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'avg(Duration)' },
      ]),
    ).toBeUndefined();
  });

  // --- ms expression variants ---

  it('detects ms expression with parens: (Duration)/1e6', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: '(Duration)/1e6' },
      ]),
    ).toEqual({ output: 'duration', factor: 0.001 });
  });

  it('detects ms expression without parens: Duration/1e6', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration/1e6' },
      ]),
    ).toEqual({ output: 'duration', factor: 0.001 });
  });

  it('detects ms expression with spaces: Duration / 1e6', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration / 1e6' },
      ]),
    ).toEqual({ output: 'duration', factor: 0.001 });
  });

  it('detects ms expression with parens and spaces: (Duration) / 1e6', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: '(Duration) / 1e6' },
      ]),
    ).toEqual({ output: 'duration', factor: 0.001 });
  });

  it('detects ms expression with inner spaces: ( Duration )/1e6', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: '( Duration )/1e6' },
      ]),
    ).toEqual({ output: 'duration', factor: 0.001 });
  });

  // --- seconds expression variants ---

  it('detects seconds expression with parens: (Duration)/1e9', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: '(Duration)/1e9' },
      ]),
    ).toEqual({ output: 'duration', factor: 1 });
  });

  it('detects seconds expression without parens: Duration/1e9', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration/1e9' },
      ]),
    ).toEqual({ output: 'duration', factor: 1 });
  });

  it('detects seconds expression with spaces: Duration / 1e9', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration / 1e9' },
      ]),
    ).toEqual({ output: 'duration', factor: 1 });
  });

  it('detects seconds expression with parens and spaces: ( Duration ) / 1e9', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: '( Duration ) / 1e9' },
      ]),
    ).toEqual({ output: 'duration', factor: 1 });
  });

  // --- non-matching expressions ---

  it('does not match unrelated expressions containing the duration name', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration * 2' },
      ]),
    ).toBeUndefined();
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'round(Duration / 1e6, 2)' },
      ]),
    ).toBeUndefined();
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'LongerDuration' },
      ]),
    ).toBeUndefined();
  });

  // --- aggFn filtering ---

  it('returns undefined for count aggFn on duration', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration', aggFn: 'count' },
      ]),
    ).toBeUndefined();
  });

  it('returns undefined for count_distinct aggFn on duration', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration', aggFn: 'count_distinct' },
      ]),
    ).toBeUndefined();
  });

  it('detects duration with sum aggFn', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration', aggFn: 'sum' },
      ]),
    ).toEqual({ output: 'duration', factor: 1e-9 });
  });

  it('detects duration with quantile aggFn', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration', aggFn: 'quantile' },
      ]),
    ).toEqual({ output: 'duration', factor: 1e-9 });
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
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration', aggFn: 'avgIf' },
      ]),
    ).toEqual({ output: 'duration', factor: 1e-9 });
  });

  it('skips non-preserving aggFn and detects preserving one in mixed selects', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration', aggFn: 'count' },
        { valueExpression: 'Duration', aggFn: 'avg' },
      ]),
    ).toEqual({ output: 'duration', factor: 1e-9 });
  });

  it('returns undefined when only non-preserving aggFns reference duration', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration', aggFn: 'count' },
        { valueExpression: 'Duration', aggFn: 'count_distinct' },
      ]),
    ).toBeUndefined();
  });

  it('returns undefined when select is empty', () => {
    expect(getTraceDurationNumberFormat(TRACE_SOURCE, [])).toBeUndefined();
  });
});
