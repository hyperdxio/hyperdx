/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import React from 'react';
import {
  optimizeFacetedKeyValuesConfig,
  optimizeGetKeyValuesCalls,
} from '@hyperdx/common-utils/dist/core/materializedViews';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { FilterState } from '@hyperdx/common-utils/dist/filters';
import {
  DashboardFilter,
  MetricsDataType,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { useDashboardFilterValues } from '@/hooks/useDashboardFilterValues';
import * as useMetadataModule from '@/hooks/useMetadata';
import * as sourceModule from '@/source';

// Mock modules
jest.mock('@/source');
jest.mock('../useMetadata');
jest.mock('@hyperdx/common-utils/dist/core/materializedViews', () => ({
  optimizeGetKeyValuesCalls: jest
    .fn()
    .mockImplementation(async ({ keys, chartConfig }) => [
      { keys, chartConfig },
    ]),
  // Default: no covering MV → faceted query runs against the raw config.
  optimizeFacetedKeyValuesConfig: jest
    .fn()
    .mockImplementation(async ({ chartConfig }) => chartConfig),
}));

describe('useDashboardFilterValues', () => {
  let queryClient: QueryClient;
  let wrapper: React.ComponentType<{ children: any }>;
  let mockMetadata: jest.Mocked<Metadata>;

  const mockSources: Partial<TSource>[] = [
    {
      id: 'logs-source',
      kind: SourceKind.Log,
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
      kind: SourceKind.Trace,
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
      kind: SourceKind.Metric,
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

  const mockKeyValues: Record<string, string[] | number[] | undefined> = {
    environment: ['production', 'staging', 'development'],
    'service.name': ['frontend', 'backend', 'database'],
    MetricName: ['CPU_Usage', 'Memory_Usage'],
    status: ['200', '404', '500'],
    log_level: ['info', 'error'],
    SeverityNumber: [1, 2],
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
          value: (mockKeyValues[key] as string[]) ?? [],
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

  it('should convert non-string key values to strings', async () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    // Act
    const { result } = renderHook(
      () =>
        useDashboardFilterValues({
          filters: [
            {
              id: 'filterSevNumber',
              type: 'QUERY_EXPRESSION',
              name: 'SeverityNumber',
              expression: 'SeverityNumber',
              source: 'logs-source',
            },
          ],
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Assert
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    expect(result.current.data).toEqual(
      new Map([
        [
          'filterSevNumber',
          {
            values: ['1', '2'],
            isLoading: false,
          },
        ],
      ]),
    );
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
        useDashboardFilterValues({
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
          'filter1',
          {
            values: ['production', 'staging', 'development'],
            isLoading: false,
          },
        ],
        [
          'filter2',
          {
            values: ['frontend', 'backend', 'database'],
            isLoading: false,
          },
        ],
        [
          'filter3',
          { values: ['CPU_Usage', 'Memory_Usage'], isLoading: false },
        ],
      ]),
    );

    // Only Log and Trace sources use optimizeGetKeyValuesCalls (Metric uses direct fetch)
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
        useDashboardFilterValues({
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

  it('should not group filters with different where clauses', async () => {
    // Arrange
    const sameSourceFiltersDifferentWhere: DashboardFilter[] = [
      {
        id: 'filter1',
        type: 'QUERY_EXPRESSION',
        name: 'Environment',
        expression: 'environment',
        source: 'logs-source',
        where: "service_name = 'api'",
        whereLanguage: 'sql',
      },
      {
        id: 'filter2',
        type: 'QUERY_EXPRESSION',
        name: 'Status',
        expression: 'status',
        source: 'logs-source',
        where: "service_name = 'worker'",
        whereLanguage: 'sql',
      },
    ];

    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    // Act
    const { result } = renderHook(
      () =>
        useDashboardFilterValues({
          filters: sameSourceFiltersDifferentWhere,
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Assert
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    // Filters with different WHERE clauses are separate queries
    expect(optimizeGetKeyValuesCalls).toHaveBeenCalledTimes(2);
    expect(mockMetadata.getKeyValues).toHaveBeenCalledTimes(2);

    // Both filters should have their own values keyed by filter ID
    expect(result.current.data?.has('filter1')).toBe(true);
    expect(result.current.data?.has('filter2')).toBe(true);
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
        useDashboardFilterValues({
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
        useDashboardFilterValues({
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
        useDashboardFilterValues({
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
        useDashboardFilterValues({
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
        useDashboardFilterValues({
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
      source: {
        connection: 'clickhouse-conn',
        from: {
          databaseName: 'telemetry',
          tableName: 'logs',
        },
        id: 'logs-source',
        kind: SourceKind.Log,
        name: 'Logs',
        timestampValueExpression: 'timestamp',
      },
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
        useDashboardFilterValues({
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
        useDashboardFilterValues({
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
          'filter1',
          {
            values: ['production', 'staging', 'development'],
            isLoading: false,
          },
        ],
        ['filter2', { values: ['info', 'error'], isLoading: false }],
        [
          'filter3',
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
        useDashboardFilterValues({
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

    // Should return combined results keyed by filter ID
    expect(result.current.data).toEqual(
      new Map([
        [
          'filter1',
          {
            values: ['production', 'staging', 'development'],
            isLoading: false,
          },
        ],
        [
          'filter2',
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
        useDashboardFilterValues({
          filters: mockFilters.slice(0, 2), // Only first two filters
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Assert - Wait for first query to complete
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // At this point, filter1 (environment) should be loaded but filter2 (service.name) should still be loading
    expect(result.current.data?.get('filter1')).toEqual({
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
        ['filter1', { values: ['production'], isLoading: false }],
        ['filter2', { values: ['backend'], isLoading: false }],
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
        useDashboardFilterValues({
          filters: mockFilters.slice(0, 2), // Only first two filters
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Assert - Wait for queries to settle
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    // Should have partial results - filter1 (environment) loaded successfully
    expect(result.current.data?.get('filter1')).toEqual({
      values: ['production', 'staging'],
      isLoading: false,
    });

    // filter2 (service.name) is still present with empty values (so the UI can
    // keep the control interactive) and is flagged as errored so callers can
    // surface a warning.
    expect(result.current.data?.get('filter2')).toEqual({
      values: [],
      isLoading: false,
    });
    expect(result.current.erroredFilterIds.has('filter1')).toBe(false);
    expect(result.current.erroredFilterIds.has('filter2')).toBe(true);

    // Overall error state should be true
    expect(result.current.isError).toBe(true);

    // Should have called getKeyValues twice
    expect(mockMetadata.getKeyValues).toHaveBeenCalledTimes(2);
  });

  it('keeps a filter that returned no values present and interactive', async () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    jest
      .mocked(optimizeGetKeyValuesCalls)
      .mockImplementationOnce(async ({ chartConfig, keys }) => [
        { chartConfig, keys },
      ]);

    // Query succeeds but returns no rows for the requested key.
    mockMetadata.getKeyValues.mockResolvedValueOnce([]);

    // Act
    const { result } = renderHook(
      () =>
        useDashboardFilterValues({
          filters: [mockFilters[0]],
          dateRange: mockDateRange,
        }),
      { wrapper },
    );

    // Assert
    await waitFor(() => expect(result.current.isFetching).toBe(false));

    // Entry exists with empty values and is not loading → control stays usable.
    expect(result.current.data?.get('filter1')).toEqual({
      values: [],
      isLoading: false,
    });
    expect(result.current.erroredFilterIds.has('filter1')).toBe(false);
    expect(result.current.isError).toBe(false);
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
        useDashboardFilterValues({
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
    expect(initialData?.get('filter1')).toEqual({
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
    expect(result.current.data?.get('filter1')).toEqual({
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
    expect(result.current.data?.get('filter1')).toEqual({
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

  describe('faceted filtering (cascading filters)', () => {
    // Returns the single arg object passed to the MOST RECENT getKeyValues call
    // whose `keys` exactly match, or undefined if no such call was made. (Most
    // recent matters when a rerender issues a fresh call for the same keys.)
    const callForKeys = (keys: string[]) =>
      (mockMetadata.getKeyValues.mock.calls as any[])
        .filter(([arg]) => JSON.stringify(arg.keys) === JSON.stringify(keys))
        .at(-1)?.[0];

    const envAndStatus: DashboardFilter[] = [
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

    beforeEach(() => {
      jest.spyOn(sourceModule, 'useSources').mockReturnValue({
        data: mockSources,
        isLoading: false,
      } as any);
      // Unconstrained groups still go through the optimizer; restore its
      // passthrough (clearAllMocks resets call data but not implementations).
      jest
        .mocked(optimizeGetKeyValuesCalls)
        .mockImplementation(async ({ keys, chartConfig }) => [
          { keys, chartConfig },
        ]);
      // Default: faceted queries run against the raw config (no covering MV).
      jest
        .mocked(optimizeFacetedKeyValuesConfig)
        .mockImplementation(async ({ chartConfig }) => chartConfig);
    });

    it('resolves every key in one faceted scan, constraining each by the others (exclude-self)', async () => {
      const { result } = renderHook(
        () =>
          useDashboardFilterValues({
            filters: envAndStatus,
            dateRange: mockDateRange,
            filterValues: {
              environment: {
                included: new Set<string>(['production']),
                excluded: new Set<string>(),
              },
            },
          }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.isFetching).toBe(false));

      // A single scan for the whole source — not one query per filter.
      expect(mockMetadata.getKeyValues).toHaveBeenCalledTimes(1);
      // `status` is constrained by the environment selection; `environment` is
      // NOT constrained by its own selection (exclude-self → undefined).
      expect(callForKeys(['environment', 'status'])?.keyConditions).toEqual([
        undefined,
        "(environment IN ('production'))",
      ]);
    });

    it('runs one unconstrained query when nothing is selected', async () => {
      const { result } = renderHook(
        () =>
          useDashboardFilterValues({
            filters: envAndStatus,
            dateRange: mockDateRange,
            filterValues: {},
          }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.isFetching).toBe(false));

      expect(mockMetadata.getKeyValues).toHaveBeenCalledTimes(1);
      // No conditions → plain groupUniqArray (no keyConditions passed).
      expect(
        callForKeys(['environment', 'status'])?.keyConditions,
      ).toBeUndefined();
    });

    it('still uses a single scan for many filters when one is selected', async () => {
      const filters: DashboardFilter[] = [
        ...envAndStatus,
        {
          id: 'filter3',
          type: 'QUERY_EXPRESSION',
          name: 'Log Level',
          expression: 'log_level',
          source: 'logs-source',
        },
      ];

      const { result } = renderHook(
        () =>
          useDashboardFilterValues({
            filters,
            dateRange: mockDateRange,
            filterValues: {
              environment: {
                included: new Set<string>(['production']),
                excluded: new Set<string>(),
              },
            },
          }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.isFetching).toBe(false));

      // One faceted scan regardless of how many filters/selections.
      expect(mockMetadata.getKeyValues).toHaveBeenCalledTimes(1);
      expect(
        callForKeys(['environment', 'status', 'log_level'])?.keyConditions,
      ).toEqual([
        undefined,
        "(environment IN ('production'))",
        "(environment IN ('production'))",
      ]);
    });

    it('does not apply a selection from one source to filters on another source', async () => {
      const filters: DashboardFilter[] = [
        ...envAndStatus,
        {
          id: 'filter3',
          type: 'QUERY_EXPRESSION',
          name: 'Service',
          expression: 'service.name',
          source: 'traces-source',
        },
      ];

      const { result } = renderHook(
        () =>
          useDashboardFilterValues({
            filters,
            dateRange: mockDateRange,
            filterValues: {
              environment: {
                included: new Set<string>(['production']),
                excluded: new Set<string>(),
              },
            },
          }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.isFetching).toBe(false));

      // The logs group is faceted (status narrowed by env)...
      expect(callForKeys(['environment', 'status'])?.keyConditions).toEqual([
        undefined,
        "(environment IN ('production'))",
      ]);
      // ...but the traces filter is never constrained by the logs selection.
      expect(callForKeys(['service.name'])?.keyConditions).toBeUndefined();
    });

    it('refetches with updated conditions when a selection changes', async () => {
      const { result, rerender } = renderHook(
        ({ filterValues }) =>
          useDashboardFilterValues({
            filters: envAndStatus,
            dateRange: mockDateRange,
            filterValues,
          }),
        {
          wrapper,
          initialProps: { filterValues: {} as FilterState },
        },
      );

      await waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(
        callForKeys(['environment', 'status'])?.keyConditions,
      ).toBeUndefined();

      rerender({
        filterValues: {
          environment: {
            included: new Set<string>(['production']),
            excluded: new Set<string>(),
          },
        },
      });

      await waitFor(() => expect(result.current.isFetching).toBe(false));

      expect(callForKeys(['environment', 'status'])?.keyConditions).toEqual([
        undefined,
        "(environment IN ('production'))",
      ]);
    });

    it('runs the faceted scan against a covering materialized view when one is found', async () => {
      // Simulate a covering MV: the resolver points the faceted query at the
      // rollup table.
      jest
        .mocked(optimizeFacetedKeyValuesConfig)
        .mockImplementation(async ({ chartConfig }) => ({
          ...chartConfig,
          from: { databaseName: 'telemetry', tableName: 'logs_rollup_1m' },
        }));

      const { result } = renderHook(
        () =>
          useDashboardFilterValues({
            filters: envAndStatus,
            dateRange: mockDateRange,
            filterValues: {
              environment: {
                included: new Set<string>(['production']),
                excluded: new Set<string>(),
              },
            },
          }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.isFetching).toBe(false));

      const call = callForKeys(['environment', 'status']);
      // The single faceted scan targets the rollup, still carrying the per-key
      // conditions.
      expect(call?.chartConfig?.from).toEqual({
        databaseName: 'telemetry',
        tableName: 'logs_rollup_1m',
      });
      expect(call?.keyConditions).toEqual([
        undefined,
        "(environment IN ('production'))",
      ]);
    });
  });
});
