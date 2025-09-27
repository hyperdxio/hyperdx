import React from 'react';
import * as metadataModule from '@hyperdx/app/src/metadata';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { Metadata, MetadataCache } from '@hyperdx/common-utils/dist/metadata';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import {
  deduplicate2dArray,
  useGetKeyValues,
  useMultipleGetKeyValues,
} from '../useMetadata';

// Create a mock ChartConfig based on the Zod schema
const createMockChartConfig = (
  overrides: Partial<ChartConfigWithDateRange> = {},
): ChartConfigWithDateRange =>
  ({
    timestampValueExpression: '',
    connection: 'foo',
    from: {
      databaseName: 'telemetry',
      tableName: 'traces',
    },
    ...overrides,
  }) as ChartConfigWithDateRange;

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

    jest.spyOn(mockMetadata, 'getKeyValues').mockResolvedValue(mockKeyValues);

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
      .spyOn(mockMetadata, 'getKeyValues')
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
    expect(jest.spyOn(mockMetadata, 'getKeyValues')).toHaveBeenCalledTimes(2);
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
    expect(jest.spyOn(mockMetadata, 'getKeyValues')).not.toHaveBeenCalled();
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

    jest.spyOn(mockMetadata, 'getKeyValues').mockResolvedValue(mockKeyValues);

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
      .spyOn(mockMetadata, 'getKeyValues')
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
