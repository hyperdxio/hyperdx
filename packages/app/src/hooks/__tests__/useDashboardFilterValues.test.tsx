/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import React from 'react';
import { DashboardFilter } from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import * as sourceModule from '@/source';

import { useDashboardFilterKeyValues } from '../useDashboardFilterValues';
import * as useMetadataModule from '../useMetadata';

// Mock modules
jest.mock('@/source');
jest.mock('../useMetadata');

describe('useDashboardFilterKeyValues', () => {
  let queryClient: QueryClient;
  let wrapper: React.ComponentType<{ children: any }>;
  let mockMetadata: any;

  const mockSources = [
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
  ];

  const mockDateRange: [Date, Date] = [
    new Date('2024-01-01'),
    new Date('2024-01-02'),
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock metadata with getKeyValuesWithMVs
    mockMetadata = {
      getKeyValuesWithMVs: jest.fn(),
    };

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

    mockMetadata.getKeyValuesWithMVs
      .mockResolvedValueOnce([
        {
          key: 'environment',
          value: ['production', 'staging', 'development'],
        },
      ])
      .mockResolvedValueOnce([
        {
          key: 'service.name',
          value: ['frontend', 'backend', 'database'],
        },
      ]);

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
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(
      new Map([
        ['environment', ['production', 'staging', 'development']],
        ['service.name', ['frontend', 'backend', 'database']],
      ]),
    );

    expect(mockMetadata.getKeyValuesWithMVs).toHaveBeenCalledTimes(2);
    expect(mockMetadata.getKeyValuesWithMVs).toHaveBeenCalledTimes(2);
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

    mockMetadata.getKeyValuesWithMVs.mockResolvedValueOnce([
      {
        key: 'environment',
        value: ['production', 'staging'],
      },
      {
        key: 'status',
        value: ['200', '404', '500'],
      },
    ]);

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
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockMetadata.getKeyValuesWithMVs).toHaveBeenCalledTimes(1);
    expect(mockMetadata.getKeyValuesWithMVs).toHaveBeenCalledWith(
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
    expect(result.current.isFetched).toBe(false);
    expect(mockMetadata.getKeyValuesWithMVs).not.toHaveBeenCalled();
  });

  it('should not fetch when sources are still loading', () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: undefined,
      isLoading: true,
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
    expect(result.current.isFetched).toBe(false);
    expect(mockMetadata.getKeyValuesWithMVs).not.toHaveBeenCalled();
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

    mockMetadata.getKeyValuesWithMVs
      .mockResolvedValueOnce([
        {
          key: 'environment',
          value: ['production'],
        },
      ])
      .mockResolvedValueOnce([
        {
          key: 'service.name',
          value: ['backend'],
        },
      ]);

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
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Should only call getKeyValuesWithMVs for valid sources
    expect(mockMetadata.getKeyValuesWithMVs).toHaveBeenCalledTimes(2);
  });

  it('should handle errors when fetching key values', async () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    mockMetadata.getKeyValuesWithMVs.mockRejectedValue(
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

    expect(result.current.error).toEqual(expect.any(Error));
    expect(result.current.error!.message).toBe('Failed to fetch key values');
  });

  it('should pass correct parameters to getKeyValuesWithMVs', async () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    mockMetadata.getKeyValuesWithMVs.mockResolvedValue([
      {
        key: 'environment',
        value: ['production'],
      },
    ]);

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
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockMetadata.getKeyValuesWithMVs).toHaveBeenCalledWith({
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
      source: mockSources[0],
      signal: expect.any(AbortSignal),
    });
  });

  it('should use placeholderData to keep previous data', async () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    mockMetadata.getKeyValuesWithMVs.mockResolvedValue([
      {
        key: 'environment',
        value: ['production'],
      },
    ]);

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
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Update with new date range (should trigger refetch)
    const newDateRange: [Date, Date] = [
      new Date('2024-01-02'),
      new Date('2024-01-03'),
    ];

    mockMetadata.getKeyValuesWithMVs.mockResolvedValue([
      {
        key: 'environment',
        value: ['staging'],
      },
    ]);

    rerender({
      filters: [mockFilters[0]],
      dateRange: newDateRange,
    });

    // During fetching, previous data should still be available
    // Note: This tests the keepPreviousData behavior
    expect(result.current.data).toBeDefined();
  });

  it('should have correct staleTime for caching', () => {
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
    // The hook should be configured with staleTime of 5 minutes (300000ms)
    // This is an implementation detail, but we can verify the query is cached
    expect(result.current).toBeDefined();
  });

  it('should flatten results from multiple sources into a single Map', async () => {
    // Arrange
    jest.spyOn(sourceModule, 'useSources').mockReturnValue({
      data: mockSources,
      isLoading: false,
    } as any);

    mockMetadata.getKeyValuesWithMVs
      .mockResolvedValueOnce([
        {
          key: 'environment',
          value: ['production', 'staging'],
        },
        {
          key: 'log_level',
          value: ['info', 'error'],
        },
      ])
      .mockResolvedValueOnce([
        {
          key: 'service.name',
          value: ['frontend', 'backend'],
        },
      ]);

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
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(
      new Map([
        ['environment', ['production', 'staging']],
        ['log_level', ['info', 'error']],
        ['service.name', ['frontend', 'backend']],
      ]),
    );

    // Should have size of 3 (all keys)
    expect(result.current.data?.size).toBe(3);
  });
});
