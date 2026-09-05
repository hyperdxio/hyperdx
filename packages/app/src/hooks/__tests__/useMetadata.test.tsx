import React from 'react';
import * as metadataModule from '@hyperdx/app/src/metadata';
import { JSDataType } from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import {
  Field,
  Metadata,
  MetadataCache,
} from '@hyperdx/common-utils/dist/core/metadata';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import api from '@/api';
import {
  deduplicate2dArray,
  intersect2dArray,
  useGetKeyValues,
  useMultipleAllFields,
  useMultipleGetKeyValues,
} from '@/hooks/useMetadata';
import { useSources } from '@/source';

// Create a mock ChartConfig based on the Zod schema
const createMockChartConfig = (
  overrides: Partial<BuilderChartConfigWithDateRange> = {},
): BuilderChartConfigWithDateRange =>
  ({
    timestampValueExpression: '',
    connection: 'foo',
    from: {
      databaseName: 'telemetry',
      tableName: 'traces',
    },
    ...overrides,
  }) as BuilderChartConfigWithDateRange;

jest.mock('@/source', () => ({
  useSources: jest.fn().mockReturnValue({
    data: [{ id: 'source1' }, { id: 'source2' }],
    isLoading: false,
  }),
}));

describe('useGetKeyValues', () => {
  let queryClient: QueryClient;
  let wrapper: React.ComponentType<{ children: any }>;
  let mockMetadata: Metadata;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // initialize metadata object
    mockMetadata = new Metadata({} as ClickhouseClient, {} as MetadataCache);
    jest.spyOn(metadataModule, 'getMetadata').mockReturnValue(mockMetadata);

    // Create a new QueryClient for each test
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    // Create a wrapper component with QueryClientProvider
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  });

  // Test case: Basic functionality with single chart config
  it('should fetch key values for a single chart config', async () => {
    // Arrange
    const mockChartConfig = createMockChartConfig();
    const mockKeys = ["ResourceAttributes['service.name']"];

    const mockKeyValues = [
      {
        key: "ResourceAttributes['service.name']",
        value: ['frontend', 'backend', 'database'],
      },
    ];

    jest
      .spyOn(mockMetadata, 'getKeyValuesWithMVs')
      .mockResolvedValue(mockKeyValues);

    // Act
    const { result } = renderHook(
      () =>
        useGetKeyValues({
          chartConfig: mockChartConfig,
          keys: mockKeys,
        }),
      { wrapper },
    );

    // Assert
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    //console.log(result.current.data);
    expect(result.current.data).toEqual(mockKeyValues);
  });

  // Test case: Multiple chart configs with different configurations
  it('should fetch key values for multiple chart configs', async () => {
    // Arrange
    const mockChartConfigs = [
      createMockChartConfig({
        from: { databaseName: 'telemetry', tableName: 'traces' },
        groupBy: "ResourceAttributes['service.name']",
      }),
      createMockChartConfig({
        from: { databaseName: 'logs', tableName: 'application_logs' },
        orderBy: '"timestamp" DESC',
      }),
    ];
    const mockKeys = [
      'ResourceAttributes.service.name',
      'ResourceAttributes.environment',
    ];

    jest
      .spyOn(mockMetadata, 'getKeyValuesWithMVs')
      .mockResolvedValueOnce([
        {
          key: "ResourceAttributes['service.name']",
          value: ['frontend', 'backend'],
        },
      ])
      .mockResolvedValueOnce([
        {
          key: "ResourceAttributes['environment']",
          value: ['production', 'staging'],
        },
      ]);

    // Act
    const { result } = renderHook(
      () =>
        useMultipleGetKeyValues({
          chartConfigs: mockChartConfigs,
          keys: mockKeys,
        }),
      { wrapper },
    );

    // Assert
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      {
        key: "ResourceAttributes['service.name']",
        value: ['frontend', 'backend'],
      },
      {
        key: "ResourceAttributes['environment']",
        value: ['production', 'staging'],
      },
    ]);
    expect(
      jest.spyOn(mockMetadata, 'getKeyValuesWithMVs'),
    ).toHaveBeenCalledTimes(2);
  });

  // Test case: Handling empty keys
  it('should not fetch when keys array is empty', () => {
    // Arrange
    const mockChartConfig = createMockChartConfig();

    // Act
    const { result } = renderHook(
      () =>
        useGetKeyValues({
          chartConfig: mockChartConfig,
          keys: [],
        }),
      { wrapper },
    );

    // Assert
    expect(result.current.isFetched).toBe(false);
    expect(
      jest.spyOn(mockMetadata, 'getKeyValuesWithMVs'),
    ).not.toHaveBeenCalled();
  });

  // Test case: Custom limit and disableRowLimit
  it('should pass custom limit and disableRowLimit', async () => {
    // Arrange
    const mockChartConfig = createMockChartConfig();
    const mockKeys = ['ResourceAttributes.service.name'];

    const mockKeyValues = [
      {
        key: "ResourceAttributes['service.name']",
        value: ['frontend', 'backend'],
      },
    ];

    jest
      .spyOn(mockMetadata, 'getKeyValuesWithMVs')
      .mockResolvedValue(mockKeyValues);

    // Act
    const { result } = renderHook(
      () =>
        useGetKeyValues({
          chartConfig: mockChartConfig,
          keys: mockKeys,
          limit: 50,
          disableRowLimit: true,
        }),
      { wrapper },
    );

    // Assert
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  // Test case: Error handling
  it('should handle errors when fetching key values', async () => {
    // Arrange
    const mockChartConfig = createMockChartConfig();
    const mockKeys = ['ResourceAttributes.service.name'];

    jest
      .spyOn(mockMetadata, 'getKeyValuesWithMVs')
      .mockRejectedValue(new Error('Fetch failed'));

    // Act
    const { result } = renderHook(
      () =>
        useGetKeyValues({
          chartConfig: mockChartConfig,
          keys: mockKeys,
        }),
      { wrapper },
    );

    // Assert
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toEqual(expect.any(Error));
    expect(result.current.error!.message).toBe('Fetch failed');
  });

  it('should be in a loading state while fetching sources', async () => {
    jest.mocked(useSources).mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
    } as any);

    // Arrange
    const mockChartConfig = createMockChartConfig();
    const mockKeys = ['ResourceAttributes.service.name'];

    // Act
    const { result } = renderHook(
      () =>
        useGetKeyValues({
          chartConfig: mockChartConfig,
          keys: mockKeys,
        }),
      { wrapper },
    );

    // Assert
    expect(
      jest.spyOn(mockMetadata, 'getKeyValuesWithMVs'),
    ).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.isLoading).toBe(true));
  });
});

describe('useMultipleAllFields', () => {
  let queryClient: QueryClient;
  let wrapper: React.ComponentType<{ children: any }>;
  let mockMetadata: Metadata;

  const fieldsA: Field[] = [
    { path: ['col_a'], type: 'string', jsType: JSDataType.String },
    { path: ['col_shared'], type: 'number', jsType: JSDataType.Number },
  ];

  const fieldsB: Field[] = [
    { path: ['col_b'], type: 'string', jsType: JSDataType.String },
    { path: ['col_shared'], type: 'number', jsType: JSDataType.Number },
  ];

  const tcA = {
    databaseName: 'db',
    tableName: 'table_a',
    connectionId: 'conn1',
  };

  const tcB = {
    databaseName: 'db',
    tableName: 'table_b',
    connectionId: 'conn1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockMetadata = new Metadata({} as ClickhouseClient, {} as MetadataCache);
    jest.spyOn(metadataModule, 'getMetadata').mockReturnValue(mockMetadata);
    jest.spyOn(api, 'useMe').mockReturnValue({
      data: { team: {} },
      isFetched: true,
    } as any);

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  });

  it('should return fields from successful connections and empty array for failed ones', async () => {
    jest
      .spyOn(mockMetadata, 'getAllFields')
      .mockResolvedValueOnce(fieldsA)
      .mockRejectedValueOnce(new Error('connection refused'));

    const { result } = renderHook(() => useMultipleAllFields([tcA, tcB]), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Should contain only fieldsA since fieldsB failed
    expect(result.current.data).toEqual(fieldsA);
  });

  it('should deduplicate fields across successful connections', async () => {
    jest
      .spyOn(mockMetadata, 'getAllFields')
      .mockResolvedValueOnce(fieldsA)
      .mockResolvedValueOnce(fieldsB);

    const { result } = renderHook(() => useMultipleAllFields([tcA, tcB]), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // col_shared appears in both but should be deduplicated
    expect(result.current.data).toEqual([
      { path: ['col_a'], type: 'string', jsType: JSDataType.String },
      { path: ['col_shared'], type: 'number', jsType: JSDataType.Number },
      { path: ['col_b'], type: 'string', jsType: JSDataType.String },
    ]);
  });

  it('should return empty array when all connections fail', async () => {
    jest
      .spyOn(mockMetadata, 'getAllFields')
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'));

    const { result } = renderHook(() => useMultipleAllFields([tcA, tcB]), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });

  it('should log a warning for each failed connection', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    jest
      .spyOn(mockMetadata, 'getAllFields')
      .mockResolvedValueOnce(fieldsA)
      .mockRejectedValueOnce(new Error('timeout'));

    const { result } = renderHook(() => useMultipleAllFields([tcA, tcB]), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to fetch fields for table connection',
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });

  it('should skip deduplication for a single connection', async () => {
    jest.spyOn(mockMetadata, 'getAllFields').mockResolvedValueOnce(fieldsA);

    const { result } = renderHook(() => useMultipleAllFields([tcA]), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(fieldsA);
  });

  // `tcFromSource` returns an all-empty-strings connection (never undefined)
  // while the source is still loading, so an unpopulated connection must never
  // reach `getAllFields` — it would issue `DESCRIBE .` with no connection id.
  it('should not fetch for an unpopulated table connection', async () => {
    const getAllFields = jest.spyOn(mockMetadata, 'getAllFields');

    const { result } = renderHook(
      () =>
        useMultipleAllFields([
          { databaseName: '', tableName: '', connectionId: '' },
        ]),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(getAllFields).not.toHaveBeenCalled();
  });

  it('should not fetch for an unpopulated table connection even when the caller passes enabled: true', async () => {
    const getAllFields = jest.spyOn(mockMetadata, 'getAllFields');

    const { result } = renderHook(
      () =>
        useMultipleAllFields(
          [{ databaseName: '', tableName: '', connectionId: '' }],
          { enabled: true },
        ),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(getAllFields).not.toHaveBeenCalled();
  });

  it('should still honor a caller opting out with enabled: false', async () => {
    const getAllFields = jest
      .spyOn(mockMetadata, 'getAllFields')
      .mockResolvedValue(fieldsA);

    const { result } = renderHook(
      () => useMultipleAllFields([tcA], { enabled: false }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(getAllFields).not.toHaveBeenCalled();
  });

  it('should fetch a populated table connection when the caller passes enabled: true', async () => {
    jest.spyOn(mockMetadata, 'getAllFields').mockResolvedValueOnce(fieldsA);

    const { result } = renderHook(
      () => useMultipleAllFields([tcA], { enabled: true }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(fieldsA);
  });

  it('substitutes a default lookback when only a timestamp expression is given', async () => {
    const getAllFields = jest
      .spyOn(mockMetadata, 'getAllFields')
      .mockResolvedValue(fieldsA);

    const { result } = renderHook(
      () =>
        useMultipleAllFields([tcA], {
          timestampValueExpression: 'Timestamp',
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const dateRange = getAllFields.mock.calls.at(-1)?.[0].dateRange;
    if (!dateRange) {
      throw new Error('expected getAllFields to receive a dateRange');
    }
    const HOUR = 60 * 60 * 1000;
    expect(
      dateRange[1].getTime() - dateRange[0].getTime(),
    ).toBeGreaterThanOrEqual(24 * HOUR);
    expect(dateRange[0].getTime() % HOUR).toBe(0);
    expect(dateRange[1].getTime() % HOUR).toBe(0);
    expect(dateRange[1].getTime()).toBeGreaterThanOrEqual(Date.now());
  });

  it('reuses the same default window across refetches within the hour', async () => {
    const getAllFields = jest
      .spyOn(mockMetadata, 'getAllFields')
      .mockResolvedValue(fieldsA);

    const { result } = renderHook(
      () =>
        useMultipleAllFields([tcA], {
          timestampValueExpression: 'Timestamp',
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await result.current.refetch();

    const ranges = getAllFields.mock.calls
      .map(([args]) => args.dateRange)
      .filter((range): range is [Date, Date] => range != null);
    expect(ranges).toHaveLength(getAllFields.mock.calls.length);
    expect(ranges.length).toBeGreaterThan(1);
    expect(
      new Set(ranges.map(r => `${r[0].getTime()}-${r[1].getTime()}`)).size,
    ).toBe(1);
  });

  it('still supplies the default window without a timestamp expression', async () => {
    const getAllFields = jest
      .spyOn(mockMetadata, 'getAllFields')
      .mockResolvedValue(fieldsA);

    const { result } = renderHook(() => useMultipleAllFields([tcA]), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Only the raw scan needs the expression, and getMapKeys gates it.
    expect(getAllFields).toHaveBeenCalledWith(
      expect.objectContaining({
        dateRange: expect.any(Array),
        timestampValueExpression: undefined,
      }),
    );
  });

  it('aborts the getAllFields fetch when the last observer unmounts', async () => {
    let received: AbortSignal | undefined;
    jest
      .spyOn(mockMetadata, 'getAllFields')
      .mockImplementation(({ signal }) => {
        received = signal;
        return new Promise(() => {});
      });

    const { unmount } = renderHook(() => useMultipleAllFields([tcA]), {
      wrapper,
    });

    await waitFor(() => expect(received).toBeDefined());
    expect(received?.aborted).toBe(false);

    // Only react-query's own signal is wired to observer teardown.
    unmount();
    await waitFor(() => expect(received?.aborted).toBe(true));
  });
});

describe('deduplicate2dArray', () => {
  // Test basic deduplication
  it('should remove duplicate objects across 2D array', () => {
    const input = [
      [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      [
        { id: 1, name: 'Alice' },
        { id: 3, name: 'Charlie' },
      ],
    ];

    const result = deduplicate2dArray(input);

    expect(result).toHaveLength(3);
    expect(result).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Charlie' },
    ]);
  });

  // Test with empty arrays
  it('should handle empty 2D array', () => {
    const input: object[][] = [];

    const result = deduplicate2dArray(input);

    expect(result).toHaveLength(0);
  });

  // Test with nested empty arrays
  it('should handle 2D array with empty subarrays', () => {
    const input = [[], [], []];

    const result = deduplicate2dArray(input);

    expect(result).toHaveLength(0);
  });

  // Test with complex objects
  it('should deduplicate complex nested objects', () => {
    const input = [
      [
        { user: { id: 1, details: { name: 'Alice' } } },
        { user: { id: 2, details: { name: 'Bob' } } },
      ],
      [
        { user: { id: 1, details: { name: 'Alice' } } },
        { user: { id: 3, details: { name: 'Charlie' } } },
      ],
    ];

    const result = deduplicate2dArray(input);

    expect(result).toHaveLength(3);
    expect(result).toEqual([
      { user: { id: 1, details: { name: 'Alice' } } },
      { user: { id: 2, details: { name: 'Bob' } } },
      { user: { id: 3, details: { name: 'Charlie' } } },
    ]);
  });

  // Test with different types of objects
  it('should work with different types of objects', () => {
    const input: {
      value: any;
    }[][] = [
      [{ value: 'string' }, { value: 42 }],
      [{ value: 'string' }, { value: true }],
    ];

    const result = deduplicate2dArray(input);

    expect(result).toHaveLength(3);
  });

  // Test order preservation
  it('should preserve the order of first occurrence', () => {
    const input = [
      [{ id: 1 }, { id: 2 }],
      [{ id: 1 }, { id: 3 }],
      [{ id: 4 }, { id: 2 }],
    ];

    const result = deduplicate2dArray(input);

    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
  });
});

describe('intersect2dArray', () => {
  it('keeps only elements present in every sub-array', () => {
    const input = [
      [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      [
        { id: 1, name: 'Alice' },
        { id: 3, name: 'Charlie' },
      ],
    ];

    // Only Alice appears in both — the fields valid across all connections.
    expect(intersect2dArray(input)).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('collapses to empty when any sub-array is empty (a failed fetch fails closed)', () => {
    const input = [[{ id: 1, name: 'Alice' }], []];

    expect(intersect2dArray(input)).toEqual([]);
  });

  it('dedupes repeats within a single sub-array before intersecting', () => {
    const input = [
      [
        { id: 1, name: 'Alice' },
        { id: 1, name: 'Alice' },
      ],
      [{ id: 1, name: 'Alice' }],
    ];

    // A repeat within one table must not be counted twice toward the "present
    // in every sub-array" tally.
    expect(intersect2dArray(input)).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('returns empty for an empty 2D array', () => {
    expect(intersect2dArray([])).toEqual([]);
  });
});
