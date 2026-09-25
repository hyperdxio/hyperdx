import { renderHook } from '@testing-library/react';

import {
  differsOnlyInDateRange,
  PATTERN_COLUMN_ALIAS,
  TIMESTAMP_COLUMN_ALIAS,
  useGroupedPatterns,
} from '@/hooks/usePatterns';

// Pyodide and the pattern miner run through react-query; route each query by
// its key so the hook sees the results a real refresh would produce.
const mockUseQuery = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: (options: unknown) => mockUseQuery(options),
}));

jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: () => ({
    data: { data: [], meta: [] },
    isLoading: false,
    error: null,
  }),
}));

jest.mock('@/components/DBRowTable', () => ({
  useConfigWithAdditionalSelect: (config: unknown) => config,
}));

const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-07-06T00:00:00Z').getTime();

function configFor(fromMs: number, where = '') {
  const config: Parameters<typeof useGroupedPatterns>[0]['config'] = {
    select: '',
    from: { databaseName: 'default', tableName: 'otel_logs' },
    where,
    timestampValueExpression: 'Timestamp',
    connection: 'test-connection',
    dateRange: [new Date(fromMs), new Date(fromMs + 2 * HOUR)],
  };
  return config;
}

// Mined sample rows from the first range.
const minedResults = {
  data: [
    {
      [PATTERN_COLUMN_ALIAS]: 'GET /api/users 200',
      [TIMESTAMP_COLUMN_ALIAS]: new Date(T0 + 10 * 60 * 1000).toISOString(),
      __hdx_patternId: 1,
      __hdx_pattern: 'GET <*> 200',
    },
  ],
  miner: null,
};

function mockMining({ isPlaceholderData }: { isPlaceholderData: boolean }) {
  mockUseQuery.mockImplementation(
    (options: { queryKey: readonly unknown[] }) =>
      options.queryKey[0] === 'patterns'
        ? {
            data: minedResults,
            isLoading: false,
            isPlaceholderData,
            error: null,
          }
        : { data: {}, isLoading: false, error: null },
  );
}

function patternsQueryOptions() {
  return mockUseQuery.mock.calls
    .map(([options]) => options)
    .filter(options => options.queryKey[0] === 'patterns')
    .at(-1);
}

const baseArgs = {
  samples: 100,
  bodyValueExpression: 'Body',
  totalCount: 1,
};

describe('differsOnlyInDateRange', () => {
  const key = ['patterns', configFor(T0), 'Body'];

  it('is true when only the date range changed', () => {
    expect(
      differsOnlyInDateRange(['patterns', configFor(T0 + HOUR), 'Body'], key),
    ).toBe(true);
  });

  it('is false when anything else changed', () => {
    expect(
      differsOnlyInDateRange(
        ['patterns', configFor(T0, 'level:error'), 'Body'],
        key,
      ),
    ).toBe(false);
    expect(
      differsOnlyInDateRange(['patterns', configFor(T0), 'Message'], key),
    ).toBe(false);
  });

  it('is false without a previous key', () => {
    expect(differsOnlyInDateRange(undefined, key)).toBe(false);
  });
});

describe('useGroupedPatterns keepPreviousData', () => {
  beforeEach(() => {
    mockUseQuery.mockReset();
  });

  it('keeps the previous patterns only across a date-range change', () => {
    mockMining({ isPlaceholderData: false });
    renderHook(() =>
      useGroupedPatterns({
        ...baseArgs,
        config: configFor(T0),
        keepPreviousData: true,
      }),
    );

    const { placeholderData } = patternsQueryOptions();
    const previous = { data: [] };
    const previousQuery = (config: ReturnType<typeof configFor>) => ({
      queryKey: ['patterns', config, 'Body'],
    });
    expect(placeholderData(previous, previousQuery(configFor(T0 - HOUR)))).toBe(
      previous,
    );
    expect(
      placeholderData(previous, previousQuery(configFor(T0, 'level:error'))),
    ).toBeUndefined();
  });

  it('does not keep previous patterns unless asked', () => {
    mockMining({ isPlaceholderData: false });
    renderHook(() =>
      useGroupedPatterns({ ...baseArgs, config: configFor(T0) }),
    );

    const { placeholderData } = patternsQueryOptions();
    expect(
      placeholderData(
        { data: [] },
        { queryKey: ['patterns', configFor(T0 - HOUR), 'Body'] },
      ),
    ).toBeUndefined();
  });

  it('keeps the groups from the previous range while its patterns are a placeholder', () => {
    mockMining({ isPlaceholderData: false });
    const { result, rerender } = renderHook(
      ({ fromMs }) =>
        useGroupedPatterns({
          ...baseArgs,
          config: configFor(fromMs),
          keepPreviousData: true,
        }),
      { initialProps: { fromMs: T0 } },
    );
    const settled = result.current.data;
    expect(Object.keys(settled)).toHaveLength(1);

    // The refresh moves to a later range while mining still shows the
    // previous range's patterns.
    mockMining({ isPlaceholderData: true });
    rerender({ fromMs: T0 + 3 * HOUR });

    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data).toBe(settled);
  });

  it('keeps the same groups when re-rendered with an equal config', () => {
    mockMining({ isPlaceholderData: false });
    const { result, rerender } = renderHook(
      ({ fromMs }) =>
        useGroupedPatterns({
          ...baseArgs,
          config: configFor(fromMs),
          keepPreviousData: true,
        }),
      { initialProps: { fromMs: T0 } },
    );
    const groups = result.current.data;

    // A parent re-render builds the same range from new Date objects.
    rerender({ fromMs: T0 });

    expect(result.current.data).toBe(groups);
  });
});
