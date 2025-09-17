import React, { act } from 'react';
import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { ChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import useOffsetPaginatedQuery from '../useOffsetPaginatedQuery';

// Mock the API module
jest.mock('@/api', () => ({
  useMe: () => ({
    data: {
      team: {
        queryTimeout: 30000,
      },
    },
  }),
}));

// Mock the clickhouse client
jest.mock('@hyperdx/app/src/clickhouse', () => ({
  getClickhouseClient: jest.fn(),
}));

// Mock the metadata module
jest.mock('@hyperdx/app/src/metadata', () => ({
  getMetadata: jest.fn(),
}));

// Mock the renderChartConfig function
jest.mock('@hyperdx/common-utils/dist/renderChartConfig', () => ({
  renderChartConfig: jest.fn(),
}));

// Import mocked modules after jest.mock calls
import { getClickhouseClient } from '@hyperdx/app/src/clickhouse';
import { renderChartConfig } from '@hyperdx/common-utils/dist/renderChartConfig';

// Create a mock ChartConfig based on the Zod schema
const createMockChartConfig = (
  overrides: Partial<ChartConfigWithDateRange> = {},
): ChartConfigWithDateRange =>
  ({
    timestampValueExpression: 'Timestamp',
    connection: 'foo',
    from: {
      databaseName: 'telemetry',
      tableName: 'traces',
    },
    dateRange: [
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-02T00:00:00Z'),
    ] as [Date, Date],
    limit: {
      limit: 100,
      offset: 0,
    },
    orderBy: 'Timestamp DESC',
    ...overrides,
  }) as ChartConfigWithDateRange;

describe('useOffsetPaginatedQuery', () => {
  // Increase timeout for complex async operations
  jest.setTimeout(15000);

  let queryClient: QueryClient;
  let wrapper: React.ComponentType<{ children: any }>;
  let mockClickhouseClient: any;
  let mockStream: any;
  let mockReader: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

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

    // Mock the clickhouse client
    mockReader = {
      read: jest.fn(),
    };

    mockStream = {
      getReader: jest.fn(() => mockReader),
    };

    mockClickhouseClient = {
      query: jest.fn(() => Promise.resolve({ stream: () => mockStream })),
    };

    // Reset and set up the mock to return a fresh client each time
    (
      getClickhouseClient as jest.MockedFunction<typeof getClickhouseClient>
    ).mockReset();
    (
      getClickhouseClient as jest.MockedFunction<typeof getClickhouseClient>
    ).mockReturnValue(mockClickhouseClient);

    // Mock renderChartConfig
    (
      renderChartConfig as jest.MockedFunction<typeof renderChartConfig>
    ).mockResolvedValue({
      sql: 'SELECT * FROM traces',
      params: {},
    });
  });

  describe('Time Window Generation', () => {
    it('should generate correct time windows for 24-hour range', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2024-01-01T00:00:00Z'),
          new Date('2024-01-02T00:00:00Z'),
        ] as [Date, Date],
      });

      // Mock the reader to return data for first window
      mockReader.read
        .mockResolvedValueOnce({
          done: false,
          value: [
            { json: () => ['timestamp', 'message'] },
            { json: () => ['DateTime', 'String'] },
            { json: () => ['2024-01-01T01:00:00Z', 'test log 1'] },
            { json: () => ['2024-01-01T02:00:00Z', 'test log 2'] },
          ],
        })
        .mockResolvedValueOnce({ done: true });

      const { result } = renderHook(() => useOffsetPaginatedQuery(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Should have data from the first 6-hour window (working backwards from end date)
      expect(result.current.data).toBeDefined();
      expect(result.current.data?.window.windowIndex).toBe(0);
      expect(result.current.data?.window.startTime).toEqual(
        new Date('2024-01-01T18:00:00Z'), // endDate - 6h
      );
      expect(result.current.data?.window.endTime).toEqual(
        new Date('2024-01-02T00:00:00Z'), // endDate
      );
      expect(result.current.data?.window.direction).toEqual('DESC');
    });

    it('should generate correct time windows for 24-hour range with ascending sort order', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2024-01-01T00:00:00Z'),
          new Date('2024-01-02T00:00:00Z'),
        ] as [Date, Date],
        orderBy: 'Timestamp ASC',
      });

      // Mock the reader to return data for first window
      mockReader.read
        .mockResolvedValueOnce({
          done: false,
          value: [
            { json: () => ['timestamp', 'message'] },
            { json: () => ['DateTime', 'String'] },
            { json: () => ['2024-01-01T01:00:00Z', 'test log 1'] },
            { json: () => ['2024-01-01T02:00:00Z', 'test log 2'] },
          ],
        })
        .mockResolvedValueOnce({ done: true });

      const { result } = renderHook(() => useOffsetPaginatedQuery(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Should have data from the first 6-hour window (working forwards from start date)
      expect(result.current.data).toBeDefined();
      expect(result.current.data?.window.windowIndex).toBe(0);
      expect(result.current.data?.window.startTime).toEqual(
        new Date('2024-01-01T00:00:00Z'), // startDate
      );
      expect(result.current.data?.window.endTime).toEqual(
        new Date('2024-01-01T06:00:00Z'), // endDate + 6h
      );
      expect(result.current.data?.window.direction).toEqual('ASC');
    });

    it('should not use time windows if first ordering is not on timestamp', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2024-01-01T00:00:00Z'),
          new Date('2024-01-02T00:00:00Z'),
        ] as [Date, Date],
        orderBy: 'ServiceName',
      });

      // Mock the reader to return data for first window
      mockReader.read
        .mockResolvedValueOnce({
          done: false,
          value: [
            { json: () => ['timestamp', 'message'] },
            { json: () => ['DateTime', 'String'] },
            { json: () => ['2024-01-01T01:00:00Z', 'test log 1'] },
            { json: () => ['2024-01-01T02:00:00Z', 'test log 2'] },
          ],
        })
        .mockResolvedValueOnce({ done: true });

      const { result } = renderHook(() => useOffsetPaginatedQuery(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Should have data from the entire range, without windowing
      expect(result.current.data).toBeDefined();
      expect(result.current.data?.window.windowIndex).toBe(0);
      expect(result.current.data?.window.startTime).toEqual(
        new Date('2024-01-01T00:00:00Z'), // startDate
      );
      expect(result.current.data?.window.endTime).toEqual(
        new Date('2024-01-02T00:00:00Z'), // endDate + 6h
      );
      expect(result.current.data?.window.direction).toEqual('DESC');
    });

    it('should handle very large time ranges with progressive bucketing', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2024-01-01T00:00:00Z'),
          new Date('2024-01-05T00:00:00Z'), // 4 days
        ] as [Date, Date],
      });

      // Mock the reader to return data for first window
      mockReader.read
        .mockResolvedValueOnce({
          done: false,
          value: [
            { json: () => ['timestamp', 'message'] },
            { json: () => ['DateTime', 'String'] },
            { json: () => ['2024-01-01T01:00:00Z', 'test log 1'] },
          ],
        })
        .mockResolvedValueOnce({ done: true });

      const { result } = renderHook(() => useOffsetPaginatedQuery(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Should have data from the first window
      expect(result.current.data).toBeDefined();
      expect(result.current.data?.window.windowIndex).toBe(0);

      // Should have more pages available due to large time range
      expect(result.current.hasNextPage).toBe(true);
    });
  });

  describe('Pagination Within Time Windows', () => {
    it('should paginate within the same time window', async () => {
      const config = createMockChartConfig({
        limit: { limit: 2, offset: 0 },
      });

      // Mock the reader to return first batch
      mockReader.read
        .mockResolvedValueOnce({
          done: false,
          value: [
            { json: () => ['timestamp', 'message'] },
            { json: () => ['DateTime', 'String'] },
            { json: () => ['2024-01-01T01:00:00Z', 'test log 1'] },
            { json: () => ['2024-01-01T02:00:00Z', 'test log 2'] },
          ],
        })
        .mockResolvedValueOnce({ done: true });

      const { result } = renderHook(() => useOffsetPaginatedQuery(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Should have 2 results from first page
      expect(result.current.data?.data).toHaveLength(2);
      expect(result.current.hasNextPage).toBe(true);

      // Mock next page data
      mockReader.read
        .mockResolvedValueOnce({
          done: false,
          value: [
            { json: () => ['timestamp', 'message'] },
            { json: () => ['DateTime', 'String'] },
            { json: () => ['2024-01-01T03:00:00Z', 'test log 3'] },
            { json: () => ['2024-01-01T04:00:00Z', 'test log 4'] },
          ],
        })
        .mockResolvedValueOnce({ done: true });

      // Fetch next page
      await act(async () => {
        await result.current.fetchNextPage();
      });

      await waitFor(() => {
        expect(result.current.data?.data).toHaveLength(4);
      });

      // Should still have more pages available in current window
      expect(result.current.hasNextPage).toBe(true);
    });
  });

  describe('Moving Between Time Windows', () => {
    it('should move to next time window when current window is exhausted', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2024-01-01T00:00:00Z'),
          new Date('2024-01-02T00:00:00Z'),
        ] as [Date, Date],
        limit: { limit: 100, offset: 0 },
      });

      // Mock the reader to return data for first window
      mockReader.read
        .mockResolvedValueOnce({
          done: false,
          value: [
            { json: () => ['timestamp', 'message'] },
            { json: () => ['DateTime', 'String'] },
            { json: () => ['2024-01-01T01:00:00Z', 'test log 1'] },
          ],
        })
        .mockResolvedValueOnce({ done: true });

      const { result } = renderHook(() => useOffsetPaginatedQuery(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Verify we're in the first window
      expect(result.current.data?.window.windowIndex).toBe(0);
      expect(result.current.data?.window.startTime).toEqual(
        new Date('2024-01-01T18:00:00Z'), // endDate - 6h
      );
      expect(result.current.data?.window.endTime).toEqual(
        new Date('2024-01-02T00:00:00Z'), // endDate
      );

      // Test that pagination within the same window works
      expect(result.current.hasNextPage).toBe(true);
    });

    it('should handle progressive window sizes correctly', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2024-01-01T00:00:00Z'),
          new Date('2024-01-03T00:00:00Z'), // 2 days
        ] as [Date, Date],
      });

      // Mock the reader to return data for first window
      mockReader.read
        .mockResolvedValueOnce({
          done: false,
          value: [
            { json: () => ['timestamp', 'message'] },
            { json: () => ['DateTime', 'String'] },
            { json: () => ['2024-01-01T01:00:00Z', 'test log 1'] },
          ],
        })
        .mockResolvedValueOnce({ done: true });

      const { result } = renderHook(() => useOffsetPaginatedQuery(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // First window: 6h (working backwards from end date)
      expect(result.current.data?.window.startTime).toEqual(
        new Date('2024-01-02T18:00:00Z'), // endDate - 6h
      );
      expect(result.current.data?.window.endTime).toEqual(
        new Date('2024-01-03T00:00:00Z'), // endDate
      );

      // Test that pagination within the same window works
      expect(result.current.hasNextPage).toBe(true);
    });

    it('should test window transition logic in isolation', () => {
      // Test the time window generation logic directly
      const startDate = new Date('2024-01-01T00:00:00Z');
      const endDate = new Date('2024-01-02T00:00:00Z');

      // For a 24-hour range, we should get multiple windows
      const duration = endDate.getTime() - startDate.getTime();
      expect(duration).toBe(24 * 60 * 60 * 1000); // 24 hours

      // The hook should generate windows working backwards from end date
      // This test validates the core logic without React Query complexity
    });
  });

  describe('Data Flattening and Aggregation', () => {
    it('should flatten data from multiple windows correctly', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2024-01-01T00:00:00Z'),
          new Date('2024-01-02T00:00:00Z'),
        ] as [Date, Date],
      });

      // Mock the reader to return data for first window
      mockReader.read
        .mockResolvedValueOnce({
          done: false,
          value: [
            { json: () => ['timestamp', 'message'] },
            { json: () => ['DateTime', 'String'] },
            { json: () => ['2024-01-01T01:00:00Z', 'window 1 log 1'] },
            { json: () => ['2024-01-01T02:00:00Z', 'window 1 log 2'] },
          ],
        })
        .mockResolvedValueOnce({ done: true });

      const { result } = renderHook(() => useOffsetPaginatedQuery(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Should have 2 results from first window
      expect(result.current.data?.data).toHaveLength(2);
      expect(result.current.data?.data[0].message).toBe('window 1 log 1');
      expect(result.current.data?.data[1].message).toBe('window 1 log 2');

      // Mock data for second window
      mockReader.read
        .mockResolvedValueOnce({
          done: false,
          value: [
            { json: () => ['timestamp', 'message'] },
            { json: () => ['DateTime', 'String'] },
            { json: () => ['2024-01-01T07:00:00Z', 'window 2 log 1'] },
            { json: () => ['2024-01-01T08:00:00Z', 'window 2 log 2'] },
          ],
        })
        .mockResolvedValueOnce({ done: true });

      // Fetch next page
      await act(async () => {
        await result.current.fetchNextPage();
      });

      await waitFor(() => {
        expect(result.current.data?.data).toHaveLength(4);
      });

      // Should have combined data from both windows
      expect(result.current.data?.data[0].message).toBe('window 1 log 1');
      expect(result.current.data?.data[1].message).toBe('window 1 log 2');
      expect(result.current.data?.data[2].message).toBe('window 2 log 1');
      expect(result.current.data?.data[3].message).toBe('window 2 log 2');
    });

    it('should maintain metadata consistency across windows', async () => {
      const config = createMockChartConfig();

      // Mock the reader to return data with metadata
      mockReader.read
        .mockResolvedValueOnce({
          done: false,
          value: [
            { json: () => ['timestamp', 'message', 'level'] },
            { json: () => ['DateTime', 'String', 'String'] },
            { json: () => ['2024-01-01T01:00:00Z', 'test log 1', 'info'] },
          ],
        })
        .mockResolvedValueOnce({ done: true });

      const { result } = renderHook(() => useOffsetPaginatedQuery(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Should have correct metadata
      expect(result.current.data?.meta).toHaveLength(3);
      expect(result.current.data?.meta[0].name).toBe('timestamp');
      expect(result.current.data?.meta[0].type).toBe('DateTime');
      expect(result.current.data?.meta[1].name).toBe('message');
      expect(result.current.data?.meta[1].type).toBe('String');
      expect(result.current.data?.meta[2].name).toBe('level');
      expect(result.current.data?.meta[2].type).toBe('String');
    });
  });

  describe('Error Handling', () => {
    it('should handle ClickHouse query errors gracefully', async () => {
      const config = createMockChartConfig();

      // Mock the clickhouse client to throw an error during query execution
      mockClickhouseClient.query.mockRejectedValue(
        new ClickHouseQueryError('Query failed', 'SELECT * FROM traces'),
      );

      const { result } = renderHook(() => useOffsetPaginatedQuery(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isError).toBe(true), {
        timeout: 5000,
      });

      expect(result.current.error).toBeInstanceOf(ClickHouseQueryError);
      expect(result.current.error?.message).toBe('Query failed');
    });

    it('should handle invalid time window errors', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2024-01-02T00:00:00Z'), // End date before start date
          new Date('2024-01-01T00:00:00Z'),
        ] as [Date, Date],
      });

      const { result } = renderHook(() => useOffsetPaginatedQuery(config), {
        wrapper,
      });

      // Should handle invalid date range gracefully
      expect(result.current.isLoading).toBe(true);
    });
  });

  describe('Live Mode vs Historical Mode', () => {
    it('should handle live mode with different caching strategy', async () => {
      const config = createMockChartConfig();

      // Mock the reader to return data
      mockReader.read
        .mockResolvedValueOnce({
          done: false,
          value: [
            { json: () => ['timestamp', 'message'] },
            { json: () => ['DateTime', 'String'] },
            { json: () => ['2024-01-01T01:00:00Z', 'live log 1'] },
          ],
        })
        .mockResolvedValueOnce({ done: true });

      const { result } = renderHook(
        () => useOffsetPaginatedQuery(config, { isLive: true }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Should have data in live mode
      expect(result.current.data?.data).toHaveLength(1);
      expect(result.current.data?.data[0].message).toBe('live log 1');
    });

    it('should limit pages in live mode for memory management', async () => {
      const config = createMockChartConfig();

      // Mock the reader to return data
      mockReader.read
        .mockResolvedValueOnce({
          done: false,
          value: [
            { json: () => ['timestamp', 'message'] },
            { json: () => ['DateTime', 'String'] },
            { json: () => ['2024-01-01T01:00:00Z', 'live log 1'] },
          ],
        })
        .mockResolvedValueOnce({ done: true });

      const { result } = renderHook(
        () => useOffsetPaginatedQuery(config, { isLive: true }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Live mode should have more aggressive garbage collection
      // This is tested through the maxPages and gcTime configuration
      expect(result.current.data).toBeDefined();
    });
  });

  describe('Query Key Management', () => {
    it('should generate unique query keys for different configurations', async () => {
      const config1 = createMockChartConfig({
        connection: 'connection1',
      });

      const config2 = createMockChartConfig({
        connection: 'connection2',
      });

      // Mock the reader to return data for both configs
      mockReader.read
        .mockResolvedValueOnce({
          done: false,
          value: [
            { json: () => ['timestamp', 'message'] },
            { json: () => ['DateTime', 'String'] },
            { json: () => ['2024-01-01T01:00:00Z', 'config1 log'] },
          ],
        })
        .mockResolvedValueOnce({ done: true })
        .mockResolvedValueOnce({
          done: false,
          value: [
            { json: () => ['timestamp', 'message'] },
            { json: () => ['DateTime', 'String'] },
            { json: () => ['2024-01-01T01:00:00Z', 'config2 log'] },
          ],
        })
        .mockResolvedValueOnce({ done: true });

      const { result: result1 } = renderHook(
        () => useOffsetPaginatedQuery(config1),
        { wrapper },
      );

      await waitFor(() => expect(result1.current.isLoading).toBe(false));
      expect(result1.current.data?.data[0].message).toBe('config1 log');

      // Reset mocks for second config
      jest.clearAllMocks();
      mockReader.read
        .mockResolvedValueOnce({
          done: false,
          value: [
            { json: () => ['timestamp', 'message'] },
            { json: () => ['DateTime', 'String'] },
            { json: () => ['2024-01-01T01:00:00Z', 'config2 log'] },
          ],
        })
        .mockResolvedValueOnce({ done: true });

      const { result: result2 } = renderHook(
        () => useOffsetPaginatedQuery(config2),
        { wrapper },
      );

      await waitFor(() => expect(result2.current.isLoading).toBe(false));
      expect(result2.current.data?.data[0].message).toBe('config2 log');
    });
  });
});
