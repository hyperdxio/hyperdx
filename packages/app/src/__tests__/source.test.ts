import {
  SourceKind,
  TLogSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';

import {
  getEventBody,
  getSourceValidationNotificationId,
  getTraceDurationNumberFormat,
  useSources,
} from '../source';

jest.mock('../api', () => ({ hdxServer: jest.fn() }));
jest.mock('../config', () => ({ IS_LOCAL_MODE: false }));
jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}));
jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
}));

import { useQuery } from '@tanstack/react-query';

import { hdxServer } from '../api';

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

  // --- exact match ---

  it('matches when valueExpression exactly equals durationExpression', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration', aggFn: 'avg' },
      ]),
    ).toEqual({ output: 'duration', factor: 1e-9 });
  });

  it('matches without aggFn (raw expression passed through)', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration' },
      ]),
    ).toEqual({ output: 'duration', factor: 1e-9 });
  });

  // --- non-matching expressions ---

  it('does not match expressions that only contain the duration name', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'avg(Duration)' },
      ]),
    ).toBeUndefined();
  });

  it('does not match division expressions', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration/1e6' },
      ]),
    ).toBeUndefined();
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: '(Duration)/1e6' },
      ]),
    ).toBeUndefined();
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration / 1e9' },
      ]),
    ).toBeUndefined();
  });

  it('does not match modified or similar-named expressions', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration * 2' },
      ]),
    ).toBeUndefined();
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'LongerDuration' },
      ]),
    ).toBeUndefined();
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'round(Duration / 1e6, 2)' },
      ]),
    ).toBeUndefined();
  });

  // --- aggFn filtering ---

  it('returns undefined for count aggFn', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration', aggFn: 'count' },
      ]),
    ).toBeUndefined();
  });

  it('returns undefined for count_distinct aggFn', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, [
        { valueExpression: 'Duration', aggFn: 'count_distinct' },
      ]),
    ).toBeUndefined();
  });

  it.each(['sum', 'min', 'max', 'quantile', 'avg', 'any', 'last_value'])(
    'detects duration with %s aggFn',
    aggFn => {
      expect(
        getTraceDurationNumberFormat(TRACE_SOURCE, [
          { valueExpression: 'Duration', aggFn },
        ]),
      ).toEqual({ output: 'duration', factor: 1e-9 });
    },
  );

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

describe('useSources validation notifications', () => {
  const mockUseQuery = useQuery as jest.Mock;
  const mockHdxServer = hdxServer as jest.Mock;
  const mockShow = notifications.show as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reuses the same notification id for repeated validation errors', async () => {
    let capturedQueryFn: (() => Promise<unknown>) | undefined;
    mockUseQuery.mockImplementation(({ queryFn }) => {
      capturedQueryFn = queryFn;
      return { data: [] };
    });

    const invalidSource = {
      id: 'source-1',
      kind: SourceKind.Log,
      name: 'Broken Source',
      connection: 'conn-1',
      from: { databaseName: 'default', tableName: 'logs' },
      timestampValueExpression: 'Timestamp',
      // Intentionally invalid for SourceSchema to trigger validation error.
      serviceNameExpression: 42,
    };

    mockHdxServer.mockReturnValue({
      json: jest.fn().mockResolvedValue([invalidSource]),
    });

    useSources();
    expect(capturedQueryFn).toBeDefined();

    await capturedQueryFn?.();
    await capturedQueryFn?.();

    expect(mockShow).toHaveBeenCalledTimes(2);
    expect(mockShow).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: getSourceValidationNotificationId('source-1'),
        autoClose: false,
      }),
    );
    expect(mockShow).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: getSourceValidationNotificationId('source-1'),
        autoClose: false,
      }),
    );
  });
});
