/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import React from 'react';
import { optimizeGetKeyValuesCalls } from '@hyperdx/common-utils/dist/core/materializedViews';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import {
  DashboardFilter,
  MetricsDataType,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import * as sourceModule from '@/source';

import { useDashboardFilterKeyValues } from '../useDashboardFilterValues';
import * as useMetadataModule from '../useMetadata';

// Mock modules
jest.mock('@/source');
jest.mock('../useMetadata');
jest.mock('@hyperdx/common-utils/dist/core/materializedViews', () => ({
  optimizeGetKeyValuesCalls: jest
    .fn()
    .mockImplementation(async ({ keys, chartConfig }) => [
      { keys, chartConfig },
    ]),
}));

describe('useDashboardFilterKeyValues', () => {
  let queryClient: QueryClient;
  let wrapper: React.ComponentType<{ children: any }>;
  let mockMetadata: jest.Mocked<Metadata>;

  const mockSources: Partial<TSource>[] = [
    {
      id: 'logs-source',
      name: 'Logs',
      timestampValueExpression: 'timestamp',
      connection: 'clickhouse-conn',
      from: {
        databaseName: 'telemetry',
        tableName: 'logs',
      },
    },
    {
      id: 'traces-source',
      name: 'Traces',
      timestampValueExpression: 'timestamp',
      connection: 'clickhouse-conn',
      from: {
        databaseName: 'telemetry',
        tableName: 'traces',
      },
    },
    {
      id: 'metric-source',
      name: 'Metrics',
      timestampValueExpression: 'timestamp',
      connection: 'clickhouse-conn',
      from: {
        databaseName: 'telemetry',
        tableName: '',
      },
      metricTables: {
        gauge: 'metrics_gauge',
        histogram: 'metrics_histogram',
        summary: 'metrics_summary',
        sum: 'metrics_sum',
        'exponential histogram': 'metrics_exponential_histogram',
      },
    },
  ];

  const mockFilters: DashboardFilter[] = [
    {
      id: 'filter1',
      type: 'QUERY_EXPRESSION',
      name: 'Environment',
      expression: 'environment',
      source: 'logs-source',
    },
    {
      id: 'filter2',
      type: 'QUERY_EXPRESSION',
      name: 'Service',
      expression: 'service.name',
      source: 'traces-source',
    },
    {
      id: 'filter3',
      type: 'QUERY_EXPRESSION',
      name: 'Metric Type',
      expression: 'MetricName',
      source: 'metric-source',
      sourceMetricType: MetricsDataType.Gauge,
    },
  ];

  const mockKeyValues: Record<string, string[] | undefined> = {
    environment: ['production', 'staging', 'development'],
    'service.name': ['frontend', 'backend', 'database'],
    MetricName: ['CPU_Usage', 'Memory_Usage'],
    status: ['200', '404', '500'],
    log_level: ['info', 'error'],
  };

  const mockDateRange: [Date, Date] = [
    new Date('2024-01-01'),
    new Date('2024-01-02'),
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock metadata with getKeyValues
    mockMetadata = {
      getKeyValues: jest.fn(),
    } as unknown as jest.Mocked<Metadata>;

    mockMetadata.getKeyValues.mockImplementation(({ keys }) => {
      return Promise.resolve(
        keys.map(key => ({
          key,
          value: mockKeyValues[key] ?? [],
        })),
      );
    });

    // Mock useMetadataWithSettings
    jest
      .spyOn(useMetadataModule, 'useMetadataWithSettings')
      .mockReturnValue(mockMetadata);

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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should fetch key values for filters grouped by source', async () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    // Act
    const { result } = renderHook(
      () =>
        useDashboardFilterKeyValues({
          filters: mockFilters,
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Assert
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(result.current.data).toEqual(
      new Map([
        [
          'environment',
          {
            values: ['production', 'staging', 'development'],
            isLoading: false,
          },
        ],
        [
          'service.name',
          {
            values: ['frontend', 'backend', 'database'],
            isLoading: false,
          },
        ],
        [
          'MetricName',
          { values: ['CPU_Usage', 'Memory_Usage'], isLoading: false },
        ],
      ]),
    );

    expect(optimizeGetKeyValuesCalls).toHaveBeenCalledTimes(3);
    expect(optimizeGetKeyValuesCalls).toHaveBeenCalledWith(
      expect.objectContaining({
        chartConfig: expect.objectContaining({
          from: { databaseName: 'telemetry', tableName: 'logs' },
          source: 'logs-source',
          dateRange: mockDateRange,
        }),
        keys: ['environment'],
      }),
    );
    expect(optimizeGetKeyValuesCalls).toHaveBeenCalledWith(
      expect.objectContaining({
        chartConfig: expect.objectContaining({
          from: { databaseName: 'telemetry', tableName: 'traces' },
          source: 'traces-source',
          dateRange: mockDateRange,
        }),
        keys: ['service.name'],
      }),
    );
    expect(optimizeGetKeyValuesCalls).toHaveBeenCalledWith(
      expect.objectContaining({
        chartConfig: expect.objectContaining({
          from: { databaseName: 'telemetry', tableName: 'metrics_gauge' },
          source: 'metric-source',
          dateRange: mockDateRange,
        }),
        keys: ['MetricName'],
      }),
    );

    expect(mockMetadata.getKeyValues).toHaveBeenCalledTimes(3);
    expect(mockMetadata.getKeyValues).toHaveBeenCalledWith(
      expect.objectContaining({
        chartConfig: expect.objectContaining({
          from: { databaseName: 'telemetry', tableName: 'logs' },
          source: 'logs-source',
          dateRange: mockDateRange,
        }),
        keys: ['environment'],
      }),
    );
    expect(mockMetadata.getKeyValues).toHaveBeenCalledWith(
      expect.objectContaining({
        chartConfig: expect.objectContaining({
          from: { databaseName: 'telemetry', tableName: 'traces' },
          source: 'traces-source',
          dateRange: mockDateRange,
        }),
        keys: ['service.name'],
      }),
    );
    expect(mockMetadata.getKeyValues).toHaveBeenCalledWith(
      expect.objectContaining({
        chartConfig: expect.objectContaining({
          from: { databaseName: 'telemetry', tableName: 'metrics_gauge' },
          source: 'metric-source',
          dateRange: mockDateRange,
        }),
        keys: ['MetricName'],
      }),
    );
  });

  it('should group multiple filters from the same source', async () => {
    // Arrange
    const sameSourceFilters: DashboardFilter[] = [
      {
        id: 'filter1',
        type: 'QUERY_EXPRESSION',
        name: 'Environment',
        expression: 'environment',
        source: 'logs-source',
      },
      {
        id: 'filter2',
        type: 'QUERY_EXPRESSION',
        name: 'Status',
        expression: 'status',
        source: 'logs-source',
      },
    ];

    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    // Act
    const { result } = renderHook(
      () =>
        useDashboardFilterKeyValues({
          filters: sameSourceFilters,
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Assert
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(mockMetadata.getKeyValues).toHaveBeenCalledTimes(1);
    expect(mockMetadata.getKeyValues).toHaveBeenCalledWith(
      expect.objectContaining({
        keys: ['environment', 'status'],
      }),
    );
  });

  it('should not fetch when filters array is empty', () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    // Act
    const { result } = renderHook(
      () =>
        useDashboardFilterKeyValues({
          filters: [],
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Assert
    expect(result.current.data).toEqual(new Map());
    expect(mockMetadata.getKeyValues).not.toHaveBeenCalled();
  });

  it('should not fetch when sources are still loading', () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: undefined,
      isLoading: true,
    } as any);

    // Act
    renderHook(
      () =>
        useDashboardFilterKeyValues({
          filters: mockFilters,
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Assert
    expect(mockMetadata.getKeyValues).not.toHaveBeenCalled();
  });

  it('should filter out filters for sources that do not exist', async () => {
    // Arrange
    const filtersWithInvalidSource: DashboardFilter[] = [
      ...mockFilters,
      {
        id: 'filter3',
        type: 'QUERY_EXPRESSION',
        name: 'Invalid',
        expression: 'invalid.field',
        source: 'nonexistent-source',
      },
    ];

    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    // Act
    const { result } = renderHook(
      () =>
        useDashboardFilterKeyValues({
          filters: filtersWithInvalidSource,
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Assert
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    // Should only call getKeyValues for valid sources
    expect(mockMetadata.getKeyValues).toHaveBeenCalledTimes(3);
  });

  it('should handle errors when fetching key values', async () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    mockMetadata.getKeyValues.mockRejectedValue(
      new Error('Failed to fetch key values'),
    );

    // Act
    const { result } = renderHook(
      () =>
        useDashboardFilterKeyValues({
          filters: mockFilters,
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Assert
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.isError).toBeTruthy();
  });

  it('should pass correct parameters to getKeyValues', async () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    // Act
    const { result } = renderHook(
      () =>
        useDashboardFilterKeyValues({
          filters: [mockFilters[0]], // Only first filter (logs-source)
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Assert
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(mockMetadata.getKeyValues).toHaveBeenCalledWith({
      chartConfig: {
        timestampValueExpression: 'timestamp',
        connection: 'clickhouse-conn',
        from: {
          databaseName: 'telemetry',
          tableName: 'logs',
        },
        source: 'logs-source',
        dateRange: mockDateRange,
        where: '',
        whereLanguage: 'sql',
        select: '',
      },
      keys: ['environment'],
      limit: 10000,
      disableRowLimit: true,
      signal: expect.any(AbortSignal),
    });
  });

  it('should use placeholderData to keep previous data', async () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    // Act
    const { result, rerender } = renderHook(
      ({ filters, dateRange }) =>
        useDashboardFilterKeyValues({
          filters,
          dateRange,
        }),
      {
        wrapper,
        initialProps: {
          filters: [mockFilters[0]],
          dateRange: mockDateRange,
        },
      },
    );

    // Assert - Wait for first fetch to complete
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    // Update with new date range (should trigger refetch)
    const newDateRange: [Date, Date] = [
      new Date('2024-01-02'),
      new Date('2024-01-03'),
    ];

    rerender({
      filters: [mockFilters[0]],
      dateRange: newDateRange,
    });

    // During fetching, previous data should still be available
    // Note: This tests the keepPreviousData behavior
    expect(result.current.data).toBeDefined();
  });

  it('should flatten results from multiple sources into a single Map', async () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    const multiFilters: DashboardFilter[] = [
      {
        id: 'filter1',
        type: 'QUERY_EXPRESSION',
        name: 'Environment',
        expression: 'environment',
        source: 'logs-source',
      },
      {
        id: 'filter2',
        type: 'QUERY_EXPRESSION',
        name: 'Log Level',
        expression: 'log_level',
        source: 'logs-source',
      },
      {
        id: 'filter3',
        type: 'QUERY_EXPRESSION',
        name: 'Service',
        expression: 'service.name',
        source: 'traces-source',
      },
    ];

    // Act
    const { result } = renderHook(
      () =>
        useDashboardFilterKeyValues({
          filters: multiFilters,
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Assert
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(result.current.data).toEqual(
      new Map([
        [
          'environment',
          {
            values: ['production', 'staging', 'development'],
            isLoading: false,
          },
        ],
        ['log_level', { values: ['info', 'error'], isLoading: false }],
        [
          'service.name',
          { values: ['frontend', 'backend', 'database'], isLoading: false },
        ],
      ]),
    );

    // Should have size of 3 (all keys)
    expect(result.current.data?.size).toBe(3);
  });

  it('should query keys from materialized views when optimizeGetKeyValuesCalls indicates MVs are available', async () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    // Mock optimizeGetKeyValuesCalls to return multiple calls (one for MV, one for original source)
    jest.mocked(optimizeGetKeyValuesCalls).mockResolvedValue([
      {
        chartConfig: {
          from: { databaseName: 'telemetry', tableName: 'logs_rollup_1m' },
          dateRange: mockDateRange,
          connection: 'clickhouse-conn',
          timestampValueExpression: 'timestamp',
          source: 'logs-source',
          where: '',
          whereLanguage: 'sql',
          select: '',
        },
        keys: ['environment'],
      },
      {
        chartConfig: {
          from: { databaseName: 'telemetry', tableName: 'logs' },
          dateRange: mockDateRange,
          connection: 'clickhouse-conn',
          timestampValueExpression: 'timestamp',
          source: 'logs-source',
          where: '',
          whereLanguage: 'sql',
          select: '',
        },
        keys: ['service.name'],
      },
    ]);

    const filtersForSameSource: DashboardFilter[] = [
      {
        id: 'filter1',
        type: 'QUERY_EXPRESSION',
        name: 'Environment',
        expression: 'environment',
        source: 'logs-source',
      },
      {
        id: 'filter2',
        type: 'QUERY_EXPRESSION',
        name: 'Service',
        expression: 'service.name',
        source: 'logs-source',
      },
    ];

    // Act
    const { result } = renderHook(
      () =>
        useDashboardFilterKeyValues({
          filters: filtersForSameSource,
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Assert
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    // Should call getKeyValues twice (once for MV, once for original source)
    expect(mockMetadata.getKeyValues).toHaveBeenCalledTimes(2);
    expect(mockMetadata.getKeyValues).toHaveBeenCalledWith(
      expect.objectContaining({
        chartConfig: expect.objectContaining({
          from: { databaseName: 'telemetry', tableName: 'logs_rollup_1m' },
        }),
        keys: ['environment'],
      }),
    );
    expect(mockMetadata.getKeyValues).toHaveBeenCalledWith(
      expect.objectContaining({
        chartConfig: expect.objectContaining({
          from: { databaseName: 'telemetry', tableName: 'logs' },
        }),
        keys: ['service.name'],
      }),
    );

    // Should return combined results
    expect(result.current.data).toEqual(
      new Map([
        [
          'environment',
          {
            values: ['production', 'staging', 'development'],
            isLoading: false,
          },
        ],
        [
          'service.name',
          { values: ['frontend', 'backend', 'database'], isLoading: false },
        ],
      ]),
    );
  });

  it('should provide partial results when some keys have loaded and others have not', async () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    // Mock optimizeGetKeyValuesCalls to return separate calls
    jest
      .mocked(optimizeGetKeyValuesCalls)
      .mockImplementation(async ({ chartConfig, keys }) => [
        { chartConfig, keys },
      ]);

    // First query resolves quickly, second query takes longer
    let resolveQuery;
    mockMetadata.getKeyValues
      .mockImplementationOnce(async () => {
        return [
          {
            key: 'environment',
            value: ['production'],
          },
        ];
      })
      .mockImplementationOnce(
        async () =>
          new Promise(resolve => {
            resolveQuery = resolve;
          }),
      );

    // Act
    const { result } = renderHook(
      () =>
        useDashboardFilterKeyValues({
          filters: mockFilters.slice(0, 2), // Only first two filters
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Assert - Wait for first query to complete
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // At this point, environment should be loaded but service.name should still be loading
    expect(result.current.data?.get('environment')).toEqual({
      values: ['production'],
      isLoading: false,
    });

    // Wait for all queries to complete
    resolveQuery!([
      {
        key: 'service.name',
        value: ['backend'],
      },
    ]);
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    // Now both should be loaded
    expect(result.current.data).toEqual(
      new Map([
        ['environment', { values: ['production'], isLoading: false }],
        ['service.name', { values: ['backend'], isLoading: false }],
      ]),
    );
  });

  it('should provide partial results when some keys have failed and others have not', async () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    // Mock optimizeGetKeyValuesCalls to return separate calls
    jest
      .mocked(optimizeGetKeyValuesCalls)
      .mockImplementationOnce(async ({ chartConfig, keys }) => [
        { chartConfig, keys },
      ]);

    // First query succeeds, second query fails
    mockMetadata.getKeyValues
      .mockResolvedValueOnce([
        {
          key: 'environment',
          value: ['production', 'staging'],
        },
      ])
      .mockRejectedValueOnce(new Error('Failed to fetch service.name'));

    // Act
    const { result } = renderHook(
      () =>
        useDashboardFilterKeyValues({
          filters: mockFilters.slice(0, 2), // Only first two filters
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Assert - Wait for queries to settle
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    // Should have partial results - environment loaded successfully
    expect(result.current.data?.get('environment')).toEqual({
      values: ['production', 'staging'],
      isLoading: false,
    });

    // service.name should not be in the map because the query failed
    expect(result.current.data?.has('service.name')).toBe(false);

    // Overall error state should be true
    expect(result.current.isError).toBe(true);

    // Should have called getKeyValues twice
    expect(mockMetadata.getKeyValues).toHaveBeenCalledTimes(2);
  });

  it('should keep previous data while fetching new data (placeholderData behavior)', async () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    const initialDateRange: [Date, Date] = [
      new Date('2024-01-01'),
      new Date('2024-01-02'),
    ];
    const updatedDateRange: [Date, Date] = [
      new Date('2024-01-03'),
      new Date('2024-01-04'),
    ];

    // Mock optimizeGetKeyValuesCalls for both date ranges
    jest
      .mocked(optimizeGetKeyValuesCalls)
      .mockImplementation(async ({ chartConfig }) => [
        {
          chartConfig,
          keys: ['environment'],
        },
      ]);

    // Initial data
    mockMetadata.getKeyValues.mockResolvedValueOnce([
      {
        key: 'environment',
        value: ['production', 'staging'],
      },
    ]);

    // Act - Initial render
    const { result, rerender } = renderHook(
      ({ filters, dateRange }) =>
        useDashboardFilterKeyValues({
          filters,
          dateRange,
        }),
      {
        wrapper,
        initialProps: {
          filters: [mockFilters[0]], // Only environment filter from logs-source
          dateRange: initialDateRange,
        },
      },
    );

    // Wait for initial data to load
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    const initialData = result.current.data;
    expect(initialData?.get('environment')).toEqual({
      values: ['production', 'staging'],
      isLoading: false,
    });

    // Setup a Promise we can control for the next query
    let resolveNextQuery: (value: { key: string; value: string[] }[]) => void;
    const nextQueryPromise = new Promise<{ key: string; value: string[] }[]>(
      resolve => {
        resolveNextQuery = resolve;
      },
    );

    mockMetadata.getKeyValues.mockImplementationOnce(async () => {
      return nextQueryPromise;
    });

    // Rerender with new date range
    rerender({
      filters: [mockFilters[0]],
      dateRange: updatedDateRange,
    });

    // Wait for refetch to start
    await waitFor(() => expect(result.current.isFetching).toBe(true));

    // Verify that previous data is still available during fetch (placeholderData behavior)
    expect(result.current.data?.get('environment')).toEqual({
      values: ['production', 'staging'],
      isLoading: false,
    });
    expect(result.current.isFetching).toBe(true);

    // Resolve the new query with updated data
    resolveNextQuery!([
      {
        key: 'environment',
        value: ['development', 'testing'],
      },
    ]);

    // Wait for new data to load
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    // Verify that new data has replaced the old data
    expect(result.current.data?.get('environment')).toEqual({
      values: ['development', 'testing'],
      isLoading: false,
    });

    // Verify optimizeGetKeyValuesCalls was called twice (once for each date range)
    expect(optimizeGetKeyValuesCalls).toHaveBeenCalledTimes(2);
    expect(optimizeGetKeyValuesCalls).toHaveBeenCalledWith(
      expect.objectContaining({
        chartConfig: expect.objectContaining({
          dateRange: initialDateRange,
        }),
      }),
    );
    expect(optimizeGetKeyValuesCalls).toHaveBeenCalledWith(
      expect.objectContaining({
        chartConfig: expect.objectContaining({
          dateRange: updatedDateRange,
        }),
      }),
    );
  });
});
