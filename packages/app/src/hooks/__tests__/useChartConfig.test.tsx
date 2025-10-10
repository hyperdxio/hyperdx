import React from 'react';
import { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import {
  ChartConfigWithDateRange,
  ChartConfigWithOptDateRange,
  MetricsDataType,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { useClickhouseClient } from '@/clickhouse';

import {
  getGranularityAlignedTimeWindows,
  useQueriedChartConfig,
} from '../useChartConfig';

// Mock the clickhouse module
jest.mock('@/clickhouse', () => ({
  useClickhouseClient: jest.fn(),
}));

// Mock the metadata module
jest.mock('@/metadata', () => ({
  getMetadata: jest.fn(() => ({
    sources: [],
    connections: {},
  })),
}));

// Mock the config module
jest.mock('@/config', () => ({
  IS_MTVIEWS_ENABLED: false,
}));

// Create a mock ChartConfig
const createMockChartConfig = (
  overrides: Partial<ChartConfigWithOptDateRange> = {},
): ChartConfigWithOptDateRange =>
  ({
    connection: 'foo',
    from: {
      databaseName: 'default',
      tableName: 'otel_logs',
    },
    where: '',
    select: [{ aggCondition: '', aggFn: 'count', valueExpression: '' }],
    timestampValueExpression: 'TimestampTime',
    groupBy: 'SeverityText',
    ...overrides,
  }) as ChartConfigWithOptDateRange;

const createMockQueryResponse = (data: any[]): ResponseJSON<any> => {
  return {
    data,
    rows: data.length,
    meta: [
      {
        name: 'count()',
        type: 'UInt64',
      },
      {
        name: 'SeverityText',
        type: 'LowCardinality(String)',
      },
      {
        name: '__hdx_time_bucket',
        type: 'DateTime',
      },
    ],
  };
};

describe('useChartConfig', () => {
  describe('getGranularityAlignedTimeWindows', () => {
    it('returns windows aligned to the granularity if the granularity is auto', () => {
      expect(
        getGranularityAlignedTimeWindows(
          {
            dateRange: [
              new Date('2023-01-10 00:00:00'),
              new Date('2023-01-10 01:00:00'),
            ],
            granularity: 'auto', // will be 1 minute
            timestampValueExpression: 'TimestampTime',
          } as ChartConfigWithDateRange & { granularity: string },
          [
            30, // 30s
            5 * 60, // 5m
            60 * 60, // 1hr
          ],
        ),
      ).toEqual([
        {
          dateRange: [
            new Date('2023-01-10 00:59:00'), // Aligned to minute, the auto-inferred granularity
            new Date('2023-01-10 01:00:00'),
          ],
          dateRangeEndInclusive: undefined,
        },
        {
          dateRange: [
            new Date('2023-01-10 00:54:00'),
            new Date('2023-01-10 00:59:00'),
          ],
          dateRangeEndInclusive: false,
        },
        {
          dateRange: [
            new Date('2023-01-10 00:00:00'),
            new Date('2023-01-10 00:54:00'),
          ],
          dateRangeEndInclusive: false,
        },
      ]);
    });

    it('returns windows aligned to the granularity if the granularity is larger than the window size', () => {
      expect(
        getGranularityAlignedTimeWindows(
          {
            dateRange: [
              new Date('2023-01-10 00:00:00'),
              new Date('2023-01-10 00:10:00'),
            ],
            granularity: '1 minute',
            timestampValueExpression: 'TimestampTime',
          } as ChartConfigWithDateRange & { granularity: string },
          [
            30, // 30s
            60, // 1m
            5 * 60, // 5m
          ],
        ),
      ).toEqual([
        {
          dateRange: [
            new Date('2023-01-10 00:09:00'), // window is expanded beyond the desired 30s, to align to 1m granularity
            new Date('2023-01-10 00:10:00'),
          ],
          dateRangeEndInclusive: undefined,
        },
        {
          dateRange: [
            new Date('2023-01-10 00:08:00'), // Second window is 1m (as desired) and aligned to granularity
            new Date('2023-01-10 00:09:00'),
          ],
          dateRangeEndInclusive: false,
        },
        {
          dateRange: [
            new Date('2023-01-10 00:03:00'), // Third window is 5m (as desired) and aligned to granularity
            new Date('2023-01-10 00:08:00'),
          ],
          dateRangeEndInclusive: false,
        },
        {
          dateRange: [
            new Date('2023-01-10 00:00:00'), // Fourth window is shortened to fit within the overall date range, but still aligned to granularity
            new Date('2023-01-10 00:03:00'),
          ],
          dateRangeEndInclusive: false,
        },
      ]);
    });

    it('Skips windows that would be double-queried due to alignment', () => {
      expect(
        getGranularityAlignedTimeWindows(
          {
            dateRange: [
              new Date('2023-01-10 00:08:00'),
              new Date('2023-01-10 00:10:00'),
            ],
            granularity: '1 minute',
            timestampValueExpression: 'TimestampTime',
          } as ChartConfigWithDateRange & { granularity: string },
          [
            15, // 15s
          ],
        ),
      ).toEqual([
        {
          dateRange: [
            new Date('2023-01-10 00:09:00'), // window is expanded beyond the desired 30s, to align to 1m granularity
            new Date('2023-01-10 00:10:00'),
          ],
          dateRangeEndInclusive: undefined,
        },
        {
          dateRange: [
            new Date('2023-01-10 00:08:00'),
            new Date('2023-01-10 00:09:00'),
          ],
          dateRangeEndInclusive: false,
        },
      ]);
    });

    it('returns windows aligned to the granularity if the granularity is smaller than the window size', () => {
      expect(
        getGranularityAlignedTimeWindows(
          {
            dateRange: [
              new Date('2023-01-09 22:00:40'),
              new Date('2023-01-10 00:00:30'),
            ],
            granularity: '1 minute',
            timestampValueExpression: 'TimestampTime',
            dateRangeEndInclusive: true,
          } as ChartConfigWithDateRange & { granularity: string },
          [
            15 * 60, // 15m
            30 * 60, // 30m
          ],
        ),
      ).toEqual([
        {
          dateRange: [
            new Date('2023-01-09 23:45:00'), // Window is lengthened to align to granularity
            new Date('2023-01-10 00:00:30'),
          ],
          dateRangeEndInclusive: true,
        },
        {
          dateRange: [
            new Date('2023-01-09 23:15:00'),
            new Date('2023-01-09 23:45:00'),
          ],
          dateRangeEndInclusive: false,
        },
        {
          dateRange: [
            new Date('2023-01-09 22:45:00'),
            new Date('2023-01-09 23:15:00'),
          ],
          dateRangeEndInclusive: false,
        },
        {
          dateRange: [
            new Date('2023-01-09 22:15:00'),
            new Date('2023-01-09 22:45:00'),
          ],
          dateRangeEndInclusive: false,
        },
        {
          dateRange: [
            new Date('2023-01-09 22:00:40'), // Window is shortened to fit within the overall date range
            new Date('2023-01-09 22:15:00'),
          ],
          dateRangeEndInclusive: false,
        },
      ]);
    });

    it('does not return a window that starts before the overall start date', () => {
      expect(
        getGranularityAlignedTimeWindows(
          {
            dateRange: [
              new Date('2023-01-10 00:00:30'),
              new Date('2023-01-10 00:02:00'),
            ],
            granularity: '1 minute',
            timestampValueExpression: 'TimestampTime',
          } as ChartConfigWithDateRange & { granularity: string },
          [
            60, // 1m
          ],
        ),
      ).toEqual([
        {
          dateRange: [
            new Date('2023-01-10 00:01:00'),
            new Date('2023-01-10 00:02:00'),
          ],
          dateRangeEndInclusive: undefined,
        },
        {
          dateRange: [
            new Date('2023-01-10 00:00:30'), // Window is shortened to fit within the overall date range
            new Date('2023-01-10 00:01:00'),
          ],
          dateRangeEndInclusive: false,
        },
      ]);
    });
  });

  describe('useQueriedChartConfig', () => {
    let queryClient: QueryClient;
    let wrapper: React.ComponentType<{ children: any }>;
    let mockClickhouseClient: jest.Mocked<ClickhouseClient>;

    beforeEach(() => {
      jest.clearAllMocks();

      queryClient = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
          },
        },
      });

      wrapper = ({ children }) => (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );

      mockClickhouseClient = {
        queryChartConfig: jest.fn(),
      } as unknown as jest.Mocked<ClickhouseClient>;

      jest.mocked(useClickhouseClient).mockReturnValue(mockClickhouseClient);
    });

    it('fetches data without chunking when no dateRange is provided', async () => {
      const config = createMockChartConfig({
        dateRange: undefined,
        granularity: '1 minute',
      });

      const mockResponse = createMockQueryResponse([
        {
          'count()': '71',
          SeverityText: 'info',
          __hdx_time_bucket: '2025-10-01T00:00:00Z',
        },
        {
          'count()': '73',
          SeverityText: 'info',
          __hdx_time_bucket: '2025-10-02T00:00:00Z',
        },
      ]);

      mockClickhouseClient.queryChartConfig.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useQueriedChartConfig(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await waitFor(() => expect(result.current.isFetching).toBe(false));

      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalledTimes(1);
      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalledWith({
        config,
        metadata: expect.any(Object),
        opts: {
          abort_signal: expect.any(AbortSignal),
        },
      });
      expect(result.current.data).toEqual({
        data: mockResponse.data,
        meta: mockResponse.meta,
        rows: mockResponse.rows,
        isComplete: true,
      });
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isPending).toBe(false);
    });

    it('fetches data without chunking when no granularity is provided', async () => {
      const config = createMockChartConfig({
        dateRange: [new Date('2025-10-01'), new Date('2025-10-02')],
        granularity: undefined,
      });

      const mockResponse = createMockQueryResponse([
        {
          'count()': '71',
          SeverityText: 'info',
          __hdx_time_bucket: '2025-10-01T00:00:00Z',
        },
        {
          'count()': '73',
          SeverityText: 'info',
          __hdx_time_bucket: '2025-10-02T00:00:00Z',
        },
      ]);

      mockClickhouseClient.queryChartConfig.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useQueriedChartConfig(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await waitFor(() => expect(result.current.isFetching).toBe(false));

      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalledTimes(1);
      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalledWith({
        config,
        metadata: expect.any(Object),
        opts: {
          abort_signal: expect.any(AbortSignal),
        },
      });
      expect(result.current.data).toEqual({
        data: mockResponse.data,
        meta: mockResponse.meta,
        rows: mockResponse.rows,
        isComplete: true,
      });
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isPending).toBe(false);
    });

    it('fetches data without chunking when no timestampValueExpression is provided', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2025-10-01 00:00:00Z'),
          new Date('2025-10-02 00:00:00Z'),
        ],
        granularity: '1 hour',
        timestampValueExpression: undefined,
      });

      const mockResponse = createMockQueryResponse([
        {
          'count()': '71',
          SeverityText: 'info',
          __hdx_time_bucket: '2025-10-01T00:00:00Z',
        },
        {
          'count()': '73',
          SeverityText: 'info',
          __hdx_time_bucket: '2025-10-02T00:00:00Z',
        },
      ]);

      mockClickhouseClient.queryChartConfig.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useQueriedChartConfig(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await waitFor(() => expect(result.current.isFetching).toBe(false));

      // Should only be called once since chunking is disabled without timestampValueExpression
      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalledTimes(1);
      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalledWith({
        config,
        metadata: expect.any(Object),
        opts: {
          abort_signal: expect.any(AbortSignal),
        },
      });
      expect(result.current.data).toEqual({
        data: mockResponse.data,
        meta: mockResponse.meta,
        rows: mockResponse.rows,
        isComplete: true,
      });
    });

    it('fetches data without chunking for metric chart configs', async () => {
      const config: ChartConfigWithOptDateRange = {
        select: [
          {
            aggFn: 'min',
            aggCondition: '',
            aggConditionLanguage: 'lucene',
            valueExpression: 'Value',
            metricName: 'system.network.io',
            metricType: MetricsDataType.Sum,
          },
        ],
        where: '',
        whereLanguage: 'lucene',
        granularity: '1 minute',
        from: {
          databaseName: 'default',
          tableName: '',
        },
        timestampValueExpression: 'TimeUnix',
        dateRange: [
          new Date('2025-10-06T18:35:47.599Z'),
          new Date('2025-10-10T19:35:47.599Z'),
        ],
        connection: 'foo',
        metricTables: {
          gauge: 'otel_metrics_gauge',
          histogram: 'otel_metrics_histogram',
          sum: 'otel_metrics_sum',
          summary: '',
          'exponential histogram': '',
        },
        limit: {
          limit: 100000,
        },
      };

      const mockResponse = createMockQueryResponse([
        {
          'count()': '71',
          SeverityText: 'info',
          __hdx_time_bucket: '2025-10-01T00:00:00Z',
        },
        {
          'count()': '73',
          SeverityText: 'info',
          __hdx_time_bucket: '2025-10-02T00:00:00Z',
        },
      ]);

      mockClickhouseClient.queryChartConfig.mockResolvedValue(mockResponse);

      const { result } = renderHook(() => useQueriedChartConfig(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await waitFor(() => expect(result.current.isFetching).toBe(false));

      // Should only be called once since chunking is disabled without timestampValueExpression
      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalledTimes(1);
      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalledWith({
        config,
        metadata: expect.any(Object),
        opts: {
          abort_signal: expect.any(AbortSignal),
        },
      });
      expect(result.current.data).toEqual({
        data: mockResponse.data,
        meta: mockResponse.meta,
        rows: mockResponse.rows,
        isComplete: true,
      });
    });

    it('fetches data without chunking when disableQueryChunking is true', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2025-10-01 00:00:00Z'),
          new Date('2025-10-02 00:00:00Z'),
        ],
        granularity: '1 hour',
      });

      const mockResponse = createMockQueryResponse([
        {
          'count()': '71',
          SeverityText: 'info',
          __hdx_time_bucket: '2025-10-01T00:00:00Z',
        },
        {
          'count()': '73',
          SeverityText: 'info',
          __hdx_time_bucket: '2025-10-02T00:00:00Z',
        },
      ]);

      mockClickhouseClient.queryChartConfig.mockResolvedValue(mockResponse);

      const { result } = renderHook(
        () => useQueriedChartConfig(config, { disableQueryChunking: true }),
        {
          wrapper,
        },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await waitFor(() => expect(result.current.isFetching).toBe(false));

      // Should only be called once since chunking is explicitly disabled
      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalledTimes(1);
      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalledWith({
        config,
        metadata: expect.any(Object),
        opts: {
          abort_signal: expect.any(AbortSignal),
        },
      });
      expect(result.current.data).toEqual({
        data: mockResponse.data,
        meta: mockResponse.meta,
        rows: mockResponse.rows,
        isComplete: true,
      });
    });

    it('fetches data with chunking when granularity and date range are provided', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2025-10-01 00:00:00Z'),
          new Date('2025-10-02 00:00:00Z'),
        ],
        granularity: '3 hour',
      });

      const mockResponse1 = createMockQueryResponse([
        {
          'count()': '71',
          __hdx_time_bucket: '2025-10-01T18:00:00Z',
        },
        {
          'count()': '72',
          __hdx_time_bucket: '2025-10-01T19:00:00Z',
        },
      ]);

      const mockResponse2 = createMockQueryResponse([
        {
          'count()': '73',
          __hdx_time_bucket: '2025-10-01T12:00:00Z',
        },
        {
          'count()': '74',
          __hdx_time_bucket: '2025-10-01T14:00:00Z',
        },
      ]);

      const mockResponse3 = createMockQueryResponse([
        {
          'count()': '75',
          __hdx_time_bucket: '2025-10-01T01:00:00Z',
        },
      ]);

      mockClickhouseClient.queryChartConfig
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2)
        .mockResolvedValueOnce(mockResponse3);

      const { result } = renderHook(() => useQueriedChartConfig(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await waitFor(() => expect(result.current.isFetching).toBe(false));

      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalledTimes(3);
      const clickHouseCalls = mockClickhouseClient.queryChartConfig.mock.calls;
      expect(clickHouseCalls[0][0].config).toEqual({
        ...config,
        dateRange: [
          new Date('2025-10-01T18:00:00.000Z'),
          new Date('2025-10-02T00:00:00.000Z'),
        ],
        dateRangeEndInclusive: undefined,
      });

      expect(clickHouseCalls[1][0].config).toEqual({
        ...config,
        dateRange: [
          new Date('2025-10-01T12:00:00.000Z'),
          new Date('2025-10-01T18:00:00.000Z'),
        ],
        dateRangeEndInclusive: false,
      });

      expect(clickHouseCalls[2][0].config).toEqual({
        ...config,
        dateRange: [
          new Date('2025-10-01T00:00:00.000Z'),
          new Date('2025-10-01T12:00:00.000Z'),
        ],
        dateRangeEndInclusive: false,
      });

      expect(result.current.data).toEqual({
        data: [
          ...mockResponse3.data,
          ...mockResponse2.data,
          ...mockResponse1.data,
        ],
        meta: mockResponse1.meta,
        rows: 5,
        isComplete: true,
      });
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isPending).toBe(false);
    });

    it('remains in a fetching state, with partial data until all data is loaded', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2025-10-01 00:00:00Z'),
          new Date('2025-10-02 00:00:00Z'),
        ],
        granularity: '3 hour',
      });

      const mockResponse1 = createMockQueryResponse([
        {
          'count()': '71',
          __hdx_time_bucket: '2025-10-01T18:00:00Z',
        },
        {
          'count()': '72',
          __hdx_time_bucket: '2025-10-01T19:00:00Z',
        },
      ]);

      const mockResponse2 = createMockQueryResponse([
        {
          'count()': '73',
          __hdx_time_bucket: '2025-10-01T12:00:00Z',
        },
        {
          'count()': '74',
          __hdx_time_bucket: '2025-10-01T14:00:00Z',
        },
      ]);

      // Create a promise that we can control when it resolves
      let resolveMockResponse3: (value: ResponseJSON<any>) => void | undefined;
      const mockResponse3 = new Promise<ResponseJSON<any>>(resolve => {
        resolveMockResponse3 = resolve;
      });

      mockClickhouseClient.queryChartConfig
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2)
        .mockResolvedValueOnce(mockResponse3);

      const { result } = renderHook(() => useQueriedChartConfig(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await waitFor(() => expect(result.current.isPending).toBe(false));

      // Partial response is available
      expect(result.current.data).toEqual({
        data: [...mockResponse2.data, ...mockResponse1.data],
        meta: mockResponse1.meta,
        rows: 4,
        isComplete: false,
      });
      expect(result.current.isFetching).toBe(true);
      expect(result.current.isLoading).toBe(false); // isLoading is false because we have partial data
      expect(result.current.isSuccess).toBe(true); // isSuccess is true because we have partial data

      // Resolve the final promise to simulate data arriving
      const mockResponse3Data = createMockQueryResponse([
        {
          'count()': '75',
          __hdx_time_bucket: '2025-10-01T01:00:00Z',
        },
      ]);

      resolveMockResponse3!(mockResponse3Data);

      await waitFor(() => expect(result.current.isFetching).toBe(false));
      expect(result.current.data).toEqual({
        data: [
          ...mockResponse3Data.data,
          ...mockResponse2.data,
          ...mockResponse1.data,
        ],
        meta: mockResponse1.meta,
        rows: 5,
        isComplete: true,
      });
    });

    it('is in a loading state until the first chunk has loaded', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2025-10-01 00:00:00Z'),
          new Date('2025-10-02 00:00:00Z'),
        ],
        granularity: '3 hour',
      });

      // Create a promise that we can control when it resolves
      let resolveMockResponse1: (value: ResponseJSON<any>) => void | undefined;
      const mockResponse1Promise = new Promise<ResponseJSON<any>>(resolve => {
        resolveMockResponse1 = resolve;
      });

      mockClickhouseClient.queryChartConfig.mockResolvedValueOnce(
        mockResponse1Promise,
      );

      const { result } = renderHook(() => useQueriedChartConfig(config), {
        wrapper,
      });

      // Should be in loading state before first chunk
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isPending).toBe(true);
      expect(result.current.data).toBeUndefined();

      // Resolve the first chunk
      const mockResponse1 = createMockQueryResponse([
        {
          'count()': '71',
          __hdx_time_bucket: '2025-10-01T18:00:00Z',
        },
      ]);
      resolveMockResponse1!(mockResponse1);

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await waitFor(() => expect(result.current.isPending).toBe(false));

      // Should now have data from first chunk
      expect(result.current.data).toEqual({
        data: mockResponse1.data,
        meta: mockResponse1.meta,
        rows: 1,
        isComplete: false,
      });
    });

    it('calls onError callback if provided when a query error occurs', async () => {
      const mockError = new Error('Query failed');
      mockClickhouseClient.queryChartConfig.mockRejectedValue(mockError);

      const onError = jest.fn();
      const config = createMockChartConfig({
        dateRange: [
          new Date('2025-10-01 00:00:00Z'),
          new Date('2025-10-02 00:00:00Z'),
        ],
        granularity: '3 hour',
      });

      const { result } = renderHook(
        () => useQueriedChartConfig(config, { onError, retry: false }),
        {
          wrapper,
        },
      );

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(onError).toHaveBeenCalledWith(mockError);
      expect(result.current.error).toBe(mockError);
    });

    it('does not make requests if it is disabled', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2025-10-01 00:00:00Z'),
          new Date('2025-10-02 00:00:00Z'),
        ],
        granularity: '3 hour',
      });

      const mockResponse = createMockQueryResponse([
        {
          'count()': '71',
          __hdx_time_bucket: '2025-10-01T18:00:00Z',
        },
      ]);

      mockClickhouseClient.queryChartConfig.mockResolvedValue(mockResponse);

      const { result } = renderHook(
        () => useQueriedChartConfig(config, { enabled: false }),
        {
          wrapper,
        },
      );

      // Wait a bit to ensure no calls are made
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockClickhouseClient.queryChartConfig).not.toHaveBeenCalled();
      expect(result.current.isPending).toBe(true);
      expect(result.current.data).toBeUndefined();
    });

    it('uses different query keys for the same config when one sets disableQueryChunking', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2025-10-01 00:00:00Z'),
          new Date('2025-10-02 00:00:00Z'),
        ],
        granularity: '3 hour',
      });

      const mockResponseChunked = createMockQueryResponse([
        {
          'count()': '50',
          __hdx_time_bucket: '2025-10-01T18:00:00Z',
        },
      ]);

      const mockResponseNonChunked = createMockQueryResponse([
        {
          'count()': '100',
          __hdx_time_bucket: '2025-10-01T12:00:00Z',
        },
      ]);

      mockClickhouseClient.queryChartConfig.mockResolvedValue(
        mockResponseChunked,
      );

      const { result: result1 } = renderHook(
        () => useQueriedChartConfig(config),
        {
          wrapper,
        },
      );

      await waitFor(() => expect(result1.current.isSuccess).toBe(true));
      await waitFor(() => expect(result1.current.isFetching).toBe(false));

      // Should have been called multiple times for chunked query
      const chunkedCallCount =
        mockClickhouseClient.queryChartConfig.mock.calls.length;
      expect(chunkedCallCount).toBeGreaterThan(1);
      expect(result1.current.data?.rows).toBeGreaterThan(1);

      // Second render with same config but disableQueryChunking=true
      mockClickhouseClient.queryChartConfig.mockResolvedValue(
        mockResponseNonChunked,
      );

      const { result: result2 } = renderHook(
        () => useQueriedChartConfig(config, { disableQueryChunking: true }),
        {
          wrapper,
        },
      );

      await waitFor(() => expect(result2.current.isSuccess).toBe(true));
      await waitFor(() => expect(result2.current.isFetching).toBe(false));

      // Should have made a new request (not using cached chunked data)
      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalledTimes(
        chunkedCallCount + 1,
      );
      expect(result2.current.data?.rows).toBe(1);

      // The original query should still have its chunked data
      expect(result1.current.data?.rows).toBeGreaterThan(1);
    });
  });
});
