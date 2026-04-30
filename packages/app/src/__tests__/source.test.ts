import { ColumnMetaType } from '@hyperdx/common-utils/dist/clickhouse';
import {
  ChartConfigWithOptTimestamp,
  NumberFormat,
  SourceKind,
  TLogSource,
  TTraceSource,
} from '@hyperdx/common-utils/dist/types';
import { notifications } from '@mantine/notifications';
import { renderHook } from '@testing-library/react';

import {
  getEventBody,
  getSourceValidationNotificationId,
  getTraceDurationNumberFormat,
  useChartNumberFormats,
  useSingleSeriesNumberFormat,
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
    const result = getTraceDurationNumberFormat(logSource, {
      valueExpression: 'count()',
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when source is undefined', () => {
    const result = getTraceDurationNumberFormat(undefined, {
      valueExpression: 'count()',
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when select expression does not reference duration', () => {
    const result = getTraceDurationNumberFormat(TRACE_SOURCE, {
      valueExpression: 'count()',
    });
    expect(result).toBeUndefined();
  });

  // --- exact match ---

  it('matches when valueExpression exactly equals durationExpression', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, {
        valueExpression: 'Duration',
        aggFn: 'avg',
      }),
    ).toEqual({ output: 'duration', factor: 1e-9 });
  });

  it('matches without aggFn (raw expression passed through)', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, {
        valueExpression: 'Duration',
      }),
    ).toEqual({ output: 'duration', factor: 1e-9 });
  });

  // --- non-matching expressions ---

  it('does not match expressions that only contain the duration name', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, {
        valueExpression: 'avg(Duration)',
      }),
    ).toBeUndefined();
  });

  it.each(['Duration/1e6', '(Duration)/1e6', 'Duration / 1e9'])(
    'does not match division expression %s',
    valueExpression => {
      expect(
        getTraceDurationNumberFormat(TRACE_SOURCE, { valueExpression }),
      ).toBeUndefined();
    },
  );

  it.each(['Duration * 2', 'LongerDuration', 'round(Duration / 1e6, 2)'])(
    'does not match modified or similar-named expression %s',
    valueExpression => {
      expect(
        getTraceDurationNumberFormat(TRACE_SOURCE, { valueExpression }),
      ).toBeUndefined();
    },
  );

  // --- aggFn filtering ---

  it('returns undefined for count aggFn', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, {
        valueExpression: 'Duration',
        aggFn: 'count',
      }),
    ).toBeUndefined();
  });

  it('returns undefined for count_distinct aggFn', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, {
        valueExpression: 'Duration',
        aggFn: 'count_distinct',
      }),
    ).toBeUndefined();
  });

  it.each(['sum', 'min', 'max', 'quantile', 'avg', 'any', 'last_value'])(
    'detects duration with %s aggFn',
    aggFn => {
      expect(
        getTraceDurationNumberFormat(TRACE_SOURCE, {
          valueExpression: 'Duration',
          aggFn,
        }),
      ).toEqual({ output: 'duration', factor: 1e-9 });
    },
  );

  it('detects duration with combinator aggFn like avgIf', () => {
    expect(
      getTraceDurationNumberFormat(TRACE_SOURCE, {
        valueExpression: 'Duration',
        aggFn: 'avgIf',
      }),
    ).toEqual({ output: 'duration', factor: 1e-9 });
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

const DURATION_FORMAT: NumberFormat = { output: 'duration', factor: 1e-9 };
const CURRENCY_FORMAT: NumberFormat = { output: 'currency' };
const PERCENT_FORMAT: NumberFormat = { output: 'percent' };
const NUMBER_FORMAT: NumberFormat = { output: 'number' };

function makeBuilderConfig(
  overrides: Partial<ChartConfigWithOptTimestamp> = {},
): ChartConfigWithOptTimestamp {
  return {
    connection: 'test-connection',
    source: TRACE_SOURCE.id,
    from: { databaseName: 'default', tableName: 'otel_traces' },
    select: [],
    where: '',
    ...overrides,
  } as unknown as ChartConfigWithOptTimestamp;
}

function makeRawSqlConfig(
  overrides: Partial<ChartConfigWithOptTimestamp> = {},
): ChartConfigWithOptTimestamp {
  return {
    configType: 'sql',
    sqlTemplate: 'SELECT 1',
    connection: 'test-connection',
    source: TRACE_SOURCE.id,
    ...overrides,
  } as unknown as ChartConfigWithOptTimestamp;
}

describe('useSingleSeriesNumberFormat', () => {
  const mockUseQuery = useQuery as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseQuery.mockReturnValue({ data: TRACE_SOURCE });
  });

  it.each<{
    name: string;
    config: ChartConfigWithOptTimestamp;
    expected: NumberFormat | undefined;
  }>([
    {
      name: 'returns config.numberFormat for raw SQL configs',
      config: makeRawSqlConfig({ numberFormat: CURRENCY_FORMAT }),
      expected: CURRENCY_FORMAT,
    },
    {
      name: 'returns config.numberFormat for builder configs with empty select',
      config: makeBuilderConfig({
        select: [],
        numberFormat: CURRENCY_FORMAT,
      }),
      expected: CURRENCY_FORMAT,
    },
    {
      name: "returns the first series' numberFormat when defined",
      config: makeBuilderConfig({
        select: [{ valueExpression: 'count()', numberFormat: PERCENT_FORMAT }],
        numberFormat: CURRENCY_FORMAT,
      }),
      expected: PERCENT_FORMAT,
    },
    {
      name: 'falls back to config.numberFormat when the first series has no numberFormat',
      config: makeBuilderConfig({
        select: [{ valueExpression: 'count()' }],
        numberFormat: CURRENCY_FORMAT,
      }),
      expected: CURRENCY_FORMAT,
    },
    {
      name: 'prefers config.numberFormat over inferred duration on the first series',
      config: makeBuilderConfig({
        select: [{ valueExpression: 'Duration', aggFn: 'avg' }],
        numberFormat: CURRENCY_FORMAT,
      }),
      expected: CURRENCY_FORMAT,
    },
    {
      name: 'falls back to the inferred duration format from the first series when no explicit format is set',
      config: makeBuilderConfig({
        select: [{ valueExpression: 'Duration', aggFn: 'avg' }],
      }),
      expected: DURATION_FORMAT,
    },
    {
      name: 'returns undefined when no format can be resolved',
      config: makeBuilderConfig({
        select: [{ valueExpression: 'count()' }],
      }),
      expected: undefined,
    },
    {
      name: 'only inspects the first series — ignores formats and duration in later series',
      config: makeBuilderConfig({
        select: [
          { valueExpression: 'count()' },
          { valueExpression: 'Duration', aggFn: 'avg' },
          { valueExpression: 'something', numberFormat: PERCENT_FORMAT },
        ],
      }),
      expected: undefined,
    },
  ])('$name', ({ config, expected }) => {
    const { result } = renderHook(() => useSingleSeriesNumberFormat(config));
    expect(result.current).toEqual(expected);
  });
});

describe('useChartNumberFormats', () => {
  const mockUseQuery = useQuery as jest.Mock;

  const META_A = { name: 'col_a', type: 'Float64' } as ColumnMetaType;
  const META_B = { name: 'col_b', type: 'Float64' } as ColumnMetaType;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseQuery.mockReturnValue({ data: TRACE_SOURCE });
  });

  // --- chartFormat resolution ---

  it.each<{
    name: string;
    config: ChartConfigWithOptTimestamp;
    expected: NumberFormat | undefined;
  }>([
    {
      name: 'uses config.numberFormat when set',
      config: makeBuilderConfig({
        select: [{ valueExpression: 'count()', numberFormat: PERCENT_FORMAT }],
        numberFormat: CURRENCY_FORMAT,
      }),
      expected: CURRENCY_FORMAT,
    },
    {
      name: 'falls back to first series numberFormat when config.numberFormat is unset',
      config: makeBuilderConfig({
        select: [
          { valueExpression: 'count()' },
          { valueExpression: 'sum(x)', numberFormat: PERCENT_FORMAT },
        ],
      }),
      expected: PERCENT_FORMAT,
    },
    {
      name: 'falls back to inferred duration format when no explicit formats',
      config: makeBuilderConfig({
        select: [
          { valueExpression: 'count()' },
          { valueExpression: 'Duration', aggFn: 'avg' },
        ],
      }),
      expected: DURATION_FORMAT,
    },
    {
      name: 'returns undefined when no format can be resolved',
      config: makeBuilderConfig({
        select: [{ valueExpression: 'count()' }],
      }),
      expected: undefined,
    },
    {
      name: 'uses config.numberFormat for raw SQL configs',
      config: makeRawSqlConfig({ numberFormat: CURRENCY_FORMAT }),
      expected: CURRENCY_FORMAT,
    },
  ])('chartFormat: $name', ({ config, expected }) => {
    const { result } = renderHook(() => useChartNumberFormats(config));
    expect(result.current.chartFormat).toEqual(expected);
  });

  // --- formatByColumn resolution ---

  it('returns empty formatByColumn when meta is not provided', () => {
    const config = makeBuilderConfig({
      select: [{ valueExpression: 'count()', numberFormat: PERCENT_FORMAT }],
    });
    const { result } = renderHook(() => useChartNumberFormats(config));
    expect(result.current.formatByColumn.size).toBe(0);
  });

  it('returns empty formatByColumn for raw SQL configs even when meta is provided', () => {
    const config = makeRawSqlConfig({ numberFormat: CURRENCY_FORMAT });
    const { result } = renderHook(() =>
      useChartNumberFormats(config, [META_A]),
    );
    expect(result.current.formatByColumn.size).toBe(0);
  });

  it('maps each series numberFormat to the meta column name at the same index', () => {
    const config = makeBuilderConfig({
      select: [
        { valueExpression: 'count()', numberFormat: PERCENT_FORMAT },
        { valueExpression: 'sum(x)', numberFormat: NUMBER_FORMAT },
      ],
    });
    const { result } = renderHook(() =>
      useChartNumberFormats(config, [META_A, META_B]),
    );
    expect(Array.from(result.current.formatByColumn.entries())).toEqual([
      ['col_a', PERCENT_FORMAT],
      ['col_b', NUMBER_FORMAT],
    ]);
  });

  it('falls back to config.numberFormat when a series has no numberFormat', () => {
    const config = makeBuilderConfig({
      select: [
        { valueExpression: 'count()' },
        { valueExpression: 'sum(x)', numberFormat: PERCENT_FORMAT },
      ],
      numberFormat: CURRENCY_FORMAT,
    });
    const { result } = renderHook(() =>
      useChartNumberFormats(config, [META_A, META_B]),
    );
    expect(result.current.formatByColumn.get('col_a')).toEqual(CURRENCY_FORMAT);
    expect(result.current.formatByColumn.get('col_b')).toEqual(PERCENT_FORMAT);
  });

  it('falls back to inferred duration format when neither series nor config has a numberFormat', () => {
    const config = makeBuilderConfig({
      select: [
        { valueExpression: 'count()' },
        { valueExpression: 'Duration', aggFn: 'avg' },
      ],
    });
    const { result } = renderHook(() =>
      useChartNumberFormats(config, [META_A, META_B]),
    );
    expect(result.current.formatByColumn.has('col_a')).toBe(false);
    expect(result.current.formatByColumn.get('col_b')).toEqual(DURATION_FORMAT);
  });

  // --- ratio config ---

  it('ratio config: maps the first meta column with select[0].numberFormat', () => {
    const config = makeBuilderConfig({
      seriesReturnType: 'ratio',
      select: [
        { valueExpression: 'count()', numberFormat: PERCENT_FORMAT },
        { valueExpression: 'sum(x)', numberFormat: NUMBER_FORMAT },
      ],
    });
    const { result } = renderHook(() =>
      useChartNumberFormats(config, [META_A]),
    );
    expect(Array.from(result.current.formatByColumn.entries())).toEqual([
      ['col_a', PERCENT_FORMAT],
    ]);
  });

  it('ratio config: falls back to select[1].numberFormat when select[0] has none', () => {
    const config = makeBuilderConfig({
      seriesReturnType: 'ratio',
      select: [
        { valueExpression: 'count()' },
        { valueExpression: 'sum(x)', numberFormat: NUMBER_FORMAT },
      ],
    });
    const { result } = renderHook(() =>
      useChartNumberFormats(config, [META_A]),
    );
    expect(result.current.formatByColumn.get('col_a')).toEqual(NUMBER_FORMAT);
  });

  it('ratio config: falls back to config.numberFormat when neither series has one', () => {
    const config = makeBuilderConfig({
      seriesReturnType: 'ratio',
      select: [{ valueExpression: 'count()' }, { valueExpression: 'sum(x)' }],
      numberFormat: CURRENCY_FORMAT,
    });
    const { result } = renderHook(() =>
      useChartNumberFormats(config, [META_A]),
    );
    expect(result.current.formatByColumn.get('col_a')).toEqual(CURRENCY_FORMAT);
  });

  it('ratio config: returns empty formatByColumn when no format can be resolved', () => {
    const config = makeBuilderConfig({
      seriesReturnType: 'ratio',
      select: [{ valueExpression: 'count()' }, { valueExpression: 'sum(x)' }],
    });
    const { result } = renderHook(() =>
      useChartNumberFormats(config, [META_A]),
    );
    expect(result.current.formatByColumn.size).toBe(0);
  });
});
