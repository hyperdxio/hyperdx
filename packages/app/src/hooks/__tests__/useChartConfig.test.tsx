import React from 'react';
import { ResponseJSON } from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import {
  ChartConfigWithDateRange,
  ChartConfigWithOptDateRange,
  DisplayType,
  MetricsDataType,
  PromqlReducer,
  SourceKind,
  TSource,
} from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { prometheusApi } from '@/api';
import { useClickhouseClient } from '@/clickhouse';
import {
  appendChunk,
  getGranularityAlignedTimeWindows,
  getMinGranularitySeconds,
  mergeQuerySettings,
  useQueriedChartConfig,
} from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';

// Mock DEFAULT_TIME_WINDOWS_SECONDS to remove the 15m window
jest.mock('@/utils/searchWindows', () => {
  const original = jest.requireActual('@/utils/searchWindows');
  const mockWindows = [
    6 * 60 * 60, // 6h
    6 * 60 * 60, // 6h
    12 * 60 * 60, // 12h
    24 * 60 * 60, // 24h
  ];
  return {
    ...original,
    DEFAULT_TIME_WINDOWS_SECONDS: mockWindows,
    generateTimeWindowsDescending: (
      startDate: Date,
      endDate: Date,
      windowDurationsSeconds?: number[],
    ) =>
      original.generateTimeWindowsDescending(
        startDate,
        endDate,
        windowDurationsSeconds ?? mockWindows,
      ),
  };
});

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

// Mock the MV optimization module
jest.mock('../useMVOptimizationExplanation', () => ({
  useMVOptimizationExplanation: jest.fn().mockReturnValue({
    data: undefined,
    isLoading: false,
  }),
}));

// Mock prometheusApi for the PromQL query path, keeping the rest of the
// module (useMetadata calls api.useMe at render time).
jest.mock('@/api', () => ({
  __esModule: true,
  ...jest.requireActual('@/api'),
  prometheusApi: {
    query: jest.fn(),
    queryRange: jest.fn(),
  },
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

    it('returns a single window matching the input date range if the input date range is empty', () => {
      expect(
        getGranularityAlignedTimeWindows(
          {
            dateRange: [
              new Date('2023-01-10 00:00:30'),
              new Date('2023-01-10 00:00:30'),
            ],
            granularity: '1 minute',
            timestampValueExpression: 'TimestampTime',
          } as ChartConfigWithDateRange & { granularity: string },
          [
            60, // 1m
            5 * 60, // 5m
          ],
        ),
      ).toEqual([
        {
          dateRange: [
            new Date('2023-01-10 00:00:30'),
            new Date('2023-01-10 00:00:30'),
          ],
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

    describe('promql configs', () => {
      const createPromqlConfig = (
        overrides: Partial<ChartConfigWithOptDateRange> = {},
      ): ChartConfigWithOptDateRange =>
        ({
          configType: 'promql',
          promqlExpression: 'e2e_service_up',
          connection: 'foo',
          dateRange: [
            new Date('2023-01-10 00:00:00'),
            new Date('2023-01-10 01:00:00'),
          ],
          ...overrides,
        }) as ChartConfigWithOptDateRange;

      const matrixResponse = {
        status: 'success' as const,
        data: {
          resultType: 'matrix' as const,
          result: [
            {
              metric: { __name__: 'e2e_service_up', service: 'accounting' },
              values: [[1673308800, '1']] as [number, string][],
            },
            {
              metric: { __name__: 'e2e_service_up', service: 'api-server' },
              values: [[1673308800, '2']] as [number, string][],
            },
          ],
        },
      };

      it('renders series names from the legend template', async () => {
        jest.mocked(prometheusApi.queryRange).mockResolvedValue(matrixResponse);

        const config = createPromqlConfig({
          legendTemplate: 'svc:{{service}}',
        });
        const { result } = renderHook(() => useQueriedChartConfig(config), {
          wrapper,
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(
          result.current.data?.data.map((r: any) => r.series_name),
        ).toEqual(['svc:accounting', 'svc:api-server']);
      });

      it('uses the default label-set name without a legend template', async () => {
        jest.mocked(prometheusApi.queryRange).mockResolvedValue(matrixResponse);

        const { result } = renderHook(
          () => useQueriedChartConfig(createPromqlConfig()),
          { wrapper },
        );

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(
          result.current.data?.data.map((r: any) => r.series_name),
        ).toEqual([
          'e2e_service_up{service="accounting"}',
          'e2e_service_up{service="api-server"}',
        ]);
      });

      const singleSeriesResponse = (metricName: string) => ({
        status: 'success' as const,
        data: {
          resultType: 'matrix' as const,
          result: [
            {
              metric: { __name__: metricName, service: 'accounting' },
              values: [[1673308800, '3']] as [number, string][],
            },
          ],
        },
      });

      it('queries every expression of a time series chart', async () => {
        jest
          .mocked(prometheusApi.queryRange)
          .mockResolvedValueOnce(matrixResponse)
          .mockResolvedValueOnce(singleSeriesResponse('e2e_requests_total'));

        const config = createPromqlConfig({
          displayType: DisplayType.Line,
          promqlExpression: [
            { expression: 'e2e_service_up', alias: 'up' },
            { expression: 'e2e_requests_total' },
          ],
        });
        const { result } = renderHook(() => useQueriedChartConfig(config), {
          wrapper,
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(prometheusApi.queryRange).toHaveBeenCalledTimes(2);
        expect(
          jest
            .mocked(prometheusApi.queryRange)
            .mock.calls.map(([a]) => a.query),
        ).toEqual(['e2e_service_up', 'e2e_requests_total']);
        // The alias covers two series here, so it keeps their label sets
        // behind it. service distinguishes series chart-wide, so the unaliased
        // expression shows it too even though its own result has one series.
        expect(
          result.current.data?.data.map((r: any) => r.series_name),
        ).toEqual([
          'up · e2e_service_up{service="accounting"}',
          'up · e2e_service_up{service="api-server"}',
          'e2e_requests_total{service="accounting"}',
        ]);
      });

      it('names one-series expressions after their aliases alone', async () => {
        jest
          .mocked(prometheusApi.queryRange)
          .mockResolvedValueOnce(singleSeriesResponse('e2e_service_up'))
          .mockResolvedValueOnce(singleSeriesResponse('e2e_requests_total'));

        const config = createPromqlConfig({
          displayType: DisplayType.Line,
          promqlExpression: [
            { expression: 'e2e_service_up', alias: 'up' },
            { expression: 'e2e_requests_total', alias: 'requests' },
          ],
        });
        const { result } = renderHook(() => useQueriedChartConfig(config), {
          wrapper,
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(
          result.current.data?.data.map((r: any) => r.series_name),
        ).toEqual(['up', 'requests']);
      });

      it('shows the legend template behind the alias', async () => {
        jest
          .mocked(prometheusApi.queryRange)
          .mockResolvedValueOnce(singleSeriesResponse('e2e_service_up'));

        const config = createPromqlConfig({
          displayType: DisplayType.Line,
          legendTemplate: 'svc:{{service}}',
          promqlExpression: [{ expression: 'e2e_service_up', alias: 'up' }],
        });
        const { result } = renderHook(() => useQueriedChartConfig(config), {
          wrapper,
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(
          result.current.data?.data.map((r: any) => r.series_name),
        ).toEqual(['up · svc:accounting']);
      });

      it('queries only the first expression of a non-time-series chart', async () => {
        jest.mocked(prometheusApi.queryRange).mockResolvedValue(matrixResponse);

        const config = createPromqlConfig({
          displayType: DisplayType.Number,
          promqlExpression: [
            { expression: 'e2e_service_up' },
            { expression: 'e2e_requests_total' },
          ],
        });
        const { result } = renderHook(() => useQueriedChartConfig(config), {
          wrapper,
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(prometheusApi.queryRange).toHaveBeenCalledTimes(1);
        expect(
          jest.mocked(prometheusApi.queryRange).mock.calls[0][0].query,
        ).toBe('e2e_service_up');
      });

      it("forwards the query's abort signal to every request", async () => {
        jest.mocked(prometheusApi.queryRange).mockResolvedValue(matrixResponse);

        const config = createPromqlConfig({
          displayType: DisplayType.Line,
          promqlExpression: [
            { expression: 'e2e_service_up' },
            { expression: 'e2e_requests_total' },
          ],
        });
        const { result } = renderHook(() => useQueriedChartConfig(config), {
          wrapper,
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        const { calls } = jest.mocked(prometheusApi.queryRange).mock;
        expect(calls).toHaveLength(2);
        for (const [params] of calls) {
          expect(params.signal).toBeInstanceOf(AbortSignal);
        }
      });

      it('skips the blank row the editor holds for an unfinished expression', async () => {
        jest.mocked(prometheusApi.queryRange).mockResolvedValue(matrixResponse);

        const config = createPromqlConfig({
          displayType: DisplayType.Line,
          promqlExpression: [
            { expression: 'e2e_service_up' },
            { expression: '' },
          ],
        });
        const { result } = renderHook(() => useQueriedChartConfig(config), {
          wrapper,
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(prometheusApi.queryRange).toHaveBeenCalledTimes(1);
      });

      // Prometheus drops __name__ from aggregation and arithmetic results, so
      // these series have nothing to be named after.
      describe('series without a metric name', () => {
        const unnamedResponse = (labels: Record<string, string> = {}) => ({
          status: 'success' as const,
          data: {
            resultType: 'matrix' as const,
            result: [
              {
                metric: labels,
                values: [[1673308800, '4']] as [number, string][],
              },
            ],
          },
        });

        it('names them after their expression', async () => {
          jest
            .mocked(prometheusApi.queryRange)
            .mockResolvedValueOnce(unnamedResponse())
            .mockResolvedValueOnce(unnamedResponse());

          const config = createPromqlConfig({
            displayType: DisplayType.Line,
            promqlExpression: [
              { expression: 'sum(rate(e2e_requests_total[5m]))' },
              { expression: 'sum(rate(e2e_errors_total[5m]))' },
            ],
          });
          const { result } = renderHook(() => useQueriedChartConfig(config), {
            wrapper,
          });

          await waitFor(() => expect(result.current.isSuccess).toBe(true));
          expect(
            result.current.data?.data.map((r: any) => r.series_name),
          ).toEqual([
            'sum(rate(e2e_requests_total[5m]))',
            'sum(rate(e2e_errors_total[5m]))',
          ]);
        });

        it('names a single aliased series after its alias alone', async () => {
          jest
            .mocked(prometheusApi.queryRange)
            .mockResolvedValueOnce(unnamedResponse());

          const config = createPromqlConfig({
            displayType: DisplayType.Line,
            promqlExpression: [
              { expression: 'sum(rate(e2e_requests_total[5m]))', alias: 'rps' },
            ],
          });
          const { result } = renderHook(() => useQueriedChartConfig(config), {
            wrapper,
          });

          await waitFor(() => expect(result.current.isSuccess).toBe(true));
          expect(
            result.current.data?.data.map((r: any) => r.series_name),
          ).toEqual(['rps']);
        });

        it('names them after their alias when the template renders nothing', async () => {
          jest
            .mocked(prometheusApi.queryRange)
            .mockResolvedValueOnce(unnamedResponse())
            .mockResolvedValueOnce(unnamedResponse());

          const config = createPromqlConfig({
            displayType: DisplayType.Line,
            legendTemplate: '{{service}}',
            promqlExpression: [
              { expression: 'sum(rate(e2e_requests_total[5m]))', alias: 'rps' },
              {
                expression: 'sum(rate(e2e_errors_total[5m]))',
                alias: 'errors',
              },
            ],
          });
          const { result } = renderHook(() => useQueriedChartConfig(config), {
            wrapper,
          });

          await waitFor(() => expect(result.current.isSuccess).toBe(true));
          expect(
            result.current.data?.data.map((r: any) => r.series_name),
          ).toEqual(['rps', 'errors']);
        });

        it('still prefers a distinguishing label set', async () => {
          jest.mocked(prometheusApi.queryRange).mockResolvedValueOnce({
            status: 'success' as const,
            data: {
              resultType: 'matrix' as const,
              result: [
                {
                  metric: { service: 'accounting' },
                  values: [[1673308800, '4']] as [number, string][],
                },
                {
                  metric: { service: 'api-server' },
                  values: [[1673308800, '5']] as [number, string][],
                },
              ],
            },
          });

          const config = createPromqlConfig({
            displayType: DisplayType.Line,
            promqlExpression: [
              { expression: 'sum by (service) (rate(e2e_requests_total[5m]))' },
            ],
          });
          const { result } = renderHook(() => useQueriedChartConfig(config), {
            wrapper,
          });

          await waitFor(() => expect(result.current.isSuccess).toBe(true));
          expect(
            result.current.data?.data.map((r: any) => r.series_name),
          ).toEqual(['{service="accounting"}', '{service="api-server"}']);
        });
      });

      describe('query type dispatch', () => {
        const instantResponse = {
          status: 'success' as const,
          data: {
            resultType: 'vector' as const,
            result: [
              {
                metric: { __name__: 'e2e_service_up', service: 'accounting' },
                value: [1673312400, '7'] as [number, string],
              },
            ],
          },
        };

        it('sends an instant expression to the instant endpoint', async () => {
          jest.mocked(prometheusApi.query).mockResolvedValue(instantResponse);

          const config = createPromqlConfig({
            displayType: DisplayType.Number,
            promqlExpression: [
              { expression: 'e2e_service_up', queryType: 'instant' },
            ],
          });
          const { result } = renderHook(() => useQueriedChartConfig(config), {
            wrapper,
          });

          await waitFor(() => expect(result.current.isSuccess).toBe(true));
          expect(prometheusApi.queryRange).not.toHaveBeenCalled();
          // Evaluated at the end of the window, and timeless: a Date column
          // here would be read back as a time series.
          expect(jest.mocked(prometheusApi.query).mock.calls[0][0].time).toBe(
            new Date('2023-01-10 01:00:00').getTime() / 1000,
          );
          expect(result.current.data?.data).toEqual([
            { series_name: 'e2e_service_up', value: 7 },
          ]);
          expect(result.current.data?.meta).toEqual([
            { name: 'value', type: 'Float64' },
            { name: 'series_name', type: 'String' },
          ]);
        });

        it('sends a range expression to the range endpoint', async () => {
          jest
            .mocked(prometheusApi.queryRange)
            .mockResolvedValue(matrixResponse);

          const config = createPromqlConfig({
            displayType: DisplayType.Number,
            promqlExpression: [
              { expression: 'e2e_service_up', queryType: 'range' },
              { expression: 'e2e_requests_total', queryType: 'instant' },
            ],
          });
          const { result } = renderHook(() => useQueriedChartConfig(config), {
            wrapper,
          });

          await waitFor(() => expect(result.current.isSuccess).toBe(true));
          expect(prometheusApi.query).not.toHaveBeenCalled();
          expect(prometheusApi.queryRange).toHaveBeenCalledTimes(1);
        });

        it('reports an expression that evaluates to a string', async () => {
          jest.mocked(prometheusApi.query).mockResolvedValue({
            status: 'success',
            data: { resultType: 'string', result: [1673312400, 'up'] },
          });

          const config = createPromqlConfig({
            displayType: DisplayType.Number,
            promqlExpression: [{ expression: '"up"', queryType: 'instant' }],
          });
          const { result } = renderHook(
            () => useQueriedChartConfig(config, { retry: false }),
            { wrapper },
          );

          await waitFor(() => expect(result.current.isError).toBe(true));
          expect(result.current.error?.message).toMatch(/returned a string/);
        });

        it('shows a scalar result as one unlabelled row', async () => {
          jest.mocked(prometheusApi.query).mockResolvedValue({
            status: 'success',
            data: { resultType: 'scalar', result: [1673312400, '42'] },
          });

          const config = createPromqlConfig({
            displayType: DisplayType.Number,
            promqlExpression: [
              { expression: 'scalar(e2e_service_up)', queryType: 'instant' },
            ],
          });
          const { result } = renderHook(() => useQueriedChartConfig(config), {
            wrapper,
          });

          await waitFor(() => expect(result.current.isSuccess).toBe(true));
          // A scalar carries no labels, so it is named after its expression.
          expect(result.current.data?.data).toEqual([
            { series_name: 'scalar(e2e_service_up)', value: 42 },
          ]);
          expect(result.current.data?.meta).toEqual([
            { name: 'value', type: 'Float64' },
            { name: 'series_name', type: 'String' },
          ]);
        });

        it('keeps the buckets of a matrix the instant endpoint answers with', async () => {
          // A range-vector selector evaluates to a matrix even at the instant
          // endpoint, so the rows span time and carry a bucket column.
          jest.mocked(prometheusApi.query).mockResolvedValue({
            status: 'success',
            data: {
              resultType: 'matrix',
              result: [
                {
                  metric: { __name__: 'e2e_service_up' },
                  values: [
                    [1673308800, '1'],
                    [1673308860, '2'],
                  ] as [number, string][],
                },
              ],
            },
          });

          const config = createPromqlConfig({
            displayType: DisplayType.Number,
            promqlExpression: [
              { expression: 'e2e_service_up[5m]', queryType: 'instant' },
            ],
          });
          const { result } = renderHook(() => useQueriedChartConfig(config), {
            wrapper,
          });

          await waitFor(() => expect(result.current.isSuccess).toBe(true));
          expect(result.current.data?.meta).toEqual([
            { name: '__hdx_time_bucket', type: 'DateTime64(3)' },
            { name: 'value', type: 'Float64' },
            { name: 'series_name', type: 'String' },
          ]);
          expect(result.current.data?.data).toEqual([
            {
              __hdx_time_bucket: new Date(1673308800 * 1000).toISOString(),
              series_name: 'e2e_service_up',
              value: 1,
            },
            {
              __hdx_time_bucket: new Date(1673308860 * 1000).toISOString(),
              series_name: 'e2e_service_up',
              value: 2,
            },
          ]);
        });

        it('ranges a time series chart whatever its expressions ask for', async () => {
          jest
            .mocked(prometheusApi.queryRange)
            .mockResolvedValue(matrixResponse);

          const config = createPromqlConfig({
            displayType: DisplayType.Line,
            promqlExpression: [
              { expression: 'e2e_service_up', queryType: 'instant' },
            ],
          });
          const { result } = renderHook(() => useQueriedChartConfig(config), {
            wrapper,
          });

          await waitFor(() => expect(result.current.isSuccess).toBe(true));
          expect(prometheusApi.query).not.toHaveBeenCalled();
          expect(prometheusApi.queryRange).toHaveBeenCalledTimes(1);
        });
      });

      describe('range reducers', () => {
        const rangeSamples = {
          status: 'success' as const,
          data: {
            resultType: 'matrix' as const,
            result: [
              {
                metric: { __name__: 'e2e_service_up', service: 'accounting' },
                values: [
                  [1673308800, '2'],
                  [1673308860, '8'],
                  [1673308920, '5'],
                ] as [number, string][],
              },
              {
                metric: { __name__: 'e2e_service_up', service: 'api-server' },
                values: [
                  [1673308800, '1'],
                  [1673308860, '3'],
                ] as [number, string][],
              },
            ],
          },
        };

        const rangeNumberConfig = (
          overrides: Partial<{
            reducer: PromqlReducer;
            expression: string;
          }> = {},
        ) =>
          createPromqlConfig({
            displayType: DisplayType.Number,
            promqlExpression: [
              {
                expression: overrides.expression ?? 'e2e_service_up',
                queryType: 'range' as const,
                reducer: overrides.reducer,
              },
            ],
          });

        beforeEach(() => {
          jest.mocked(prometheusApi.queryRange).mockResolvedValue(rangeSamples);
        });

        it('collapses the buckets to one row per series', async () => {
          const { result } = renderHook(
            () => useQueriedChartConfig(rangeNumberConfig()),
            { wrapper },
          );

          await waitFor(() => expect(result.current.isSuccess).toBe(true));
          expect(result.current.data?.data).toEqual([
            { series_name: 'e2e_service_up{service="accounting"}', value: 5 },
            { series_name: 'e2e_service_up{service="api-server"}', value: 3 },
          ]);
          expect(result.current.data?.rows).toBe(2);
          // A time bucket here would be read back as a time series.
          expect(result.current.data?.meta).toEqual([
            { name: 'series_name', type: 'String' },
            { name: 'value', type: 'Float64' },
          ]);
        });

        it.each([
          [PromqlReducer.Max, [8, 3]],
          [PromqlReducer.Min, [2, 1]],
          [PromqlReducer.Sum, [15, 4]],
          [PromqlReducer.Count, [3, 2]],
          [PromqlReducer.Mean, [5, 2]],
          [PromqlReducer.LastNotNull, [5, 3]],
        ])('reduces each series with %s', async (reducer, expected) => {
          const { result } = renderHook(
            () => useQueriedChartConfig(rangeNumberConfig({ reducer })),
            { wrapper },
          );

          await waitFor(() => expect(result.current.isSuccess).toBe(true));
          expect(result.current.data?.data.map((r: any) => r.value)).toEqual(
            expected,
          );
        });

        it('leaves a display type that plots the range unreduced', async () => {
          const config = createPromqlConfig({
            displayType: DisplayType.Line,
            promqlExpression: [
              {
                expression: 'e2e_service_up',
                queryType: 'range' as const,
                reducer: PromqlReducer.Max,
              },
            ],
          });
          const { result } = renderHook(() => useQueriedChartConfig(config), {
            wrapper,
          });

          await waitFor(() => expect(result.current.isSuccess).toBe(true));
          expect(result.current.data?.data.map((r: any) => r.value)).toEqual([
            2, 8, 5, 1, 3,
          ]);
        });

        // The samples are cached without the reducer, so switching it
        // re-derives the value rather than asking Prometheus again.
        it('re-derives the value when only the reducer changes', async () => {
          const { result, rerender } = renderHook(
            ({ reducer }: { reducer: PromqlReducer }) =>
              useQueriedChartConfig(rangeNumberConfig({ reducer })),
            { wrapper, initialProps: { reducer: PromqlReducer.Max } },
          );

          await waitFor(() =>
            expect(result.current.data?.data[0].value).toBe(8),
          );

          rerender({ reducer: PromqlReducer.Min });

          await waitFor(() =>
            expect(result.current.data?.data[0].value).toBe(2),
          );
          expect(prometheusApi.queryRange).toHaveBeenCalledTimes(1);
        });

        it('re-queries when a field other than the reducer changes', async () => {
          const { result, rerender } = renderHook(
            ({ expression }: { expression: string }) =>
              useQueriedChartConfig(rangeNumberConfig({ expression })),
            { wrapper, initialProps: { expression: 'e2e_service_up' } },
          );

          await waitFor(() => expect(result.current.isSuccess).toBe(true));

          rerender({ expression: 'e2e_requests_total' });

          await waitFor(() =>
            expect(prometheusApi.queryRange).toHaveBeenCalledTimes(2),
          );
        });
      });
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

      const { result } = renderHook(
        () => useQueriedChartConfig(config, { enableQueryChunking: true }),
        {
          wrapper,
        },
      );

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

    it('passes additionalQuerySettings to the query', async () => {
      const config = createMockChartConfig({
        dateRange: undefined,
        granularity: undefined,
      });
      const additionalQuerySettings = [
        { setting: 'asterisk_include_alias_columns', value: '1' },
      ];

      mockClickhouseClient.queryChartConfig.mockResolvedValue(
        createMockQueryResponse([]),
      );

      const { result } = renderHook(
        () => useQueriedChartConfig(config, { additionalQuerySettings }),
        {
          wrapper,
        },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalledTimes(1);
      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalledWith({
        config,
        metadata: expect.any(Object),
        opts: {
          abort_signal: expect.any(AbortSignal),
        },
        querySettings: additionalQuerySettings,
      });
    });

    it('adds additionalQuerySettings to a queryKey that the caller passes', async () => {
      const config = createMockChartConfig({
        dateRange: undefined,
        granularity: undefined,
      });
      const additionalQuerySettings = [
        { setting: 'asterisk_include_alias_columns', value: '1' },
      ];

      mockClickhouseClient.queryChartConfig.mockResolvedValue(
        createMockQueryResponse([]),
      );

      const { result } = renderHook(
        () =>
          useQueriedChartConfig(config, {
            queryKey: ['caller-key'],
            additionalQuerySettings,
          }),
        {
          wrapper,
        },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(
        queryClient.getQueryCache().find({
          queryKey: ['caller-key', additionalQuerySettings],
          exact: true,
        }),
      ).toBeDefined();
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

      const { result } = renderHook(
        () => useQueriedChartConfig(config, { enableQueryChunking: true }),
        {
          wrapper,
        },
      );

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

      const { result } = renderHook(
        () => useQueriedChartConfig(config, { enableQueryChunking: true }),
        {
          wrapper,
        },
      );

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

      const { result } = renderHook(
        () => useQueriedChartConfig(config, { enableQueryChunking: true }),
        {
          wrapper,
        },
      );

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

    it('fetches data without chunking when enableQueryChunking is false', async () => {
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
        () => useQueriedChartConfig(config, { enableQueryChunking: false }),
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

    it('fetches data without chunking when enableQueryChunking is not provided', async () => {
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

      const { result } = renderHook(() => useQueriedChartConfig(config), {
        wrapper,
      });

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

      const { result } = renderHook(
        () => useQueriedChartConfig(config, { enableQueryChunking: true }),
        {
          wrapper,
        },
      );

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

    it('pins the series-limit ranking to the newest window on each chunk', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2025-10-01 00:00:00Z'),
          new Date('2025-10-02 00:00:00Z'),
        ],
        granularity: '3 hour',
        seriesLimit: 3,
      });

      mockClickhouseClient.queryChartConfig.mockResolvedValue(
        createMockQueryResponse([]),
      );

      const { result } = renderHook(
        () => useQueriedChartConfig(config, { enableQueryChunking: true }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await waitFor(() => expect(result.current.isFetching).toBe(false));

      // Each chunk queries its own window but must rank top-N series over
      // the same fixed range, or the union across chunks exceeds the limit.
      // The newest window (first 6h mock window) bounds the ranking scan.
      const newestWindow: [Date, Date] = [
        new Date('2025-10-01T18:00:00.000Z'),
        new Date('2025-10-02T00:00:00.000Z'),
      ];
      const calls = mockClickhouseClient.queryChartConfig.mock.calls;
      expect(calls).toHaveLength(3);
      for (const [{ config: windowed }] of calls) {
        expect(windowed.seriesLimitDateRange).toEqual(newestWindow);
      }
    });

    it('does not set seriesLimitDateRange when the query is not chunked', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2025-10-01 00:00:00Z'),
          new Date('2025-10-02 00:00:00Z'),
        ],
        granularity: '3 hour',
        seriesLimit: 3,
      });

      mockClickhouseClient.queryChartConfig.mockResolvedValue(
        createMockQueryResponse([]),
      );

      const { result } = renderHook(() => useQueriedChartConfig(config), {
        wrapper,
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await waitFor(() => expect(result.current.isFetching).toBe(false));

      const calls = mockClickhouseClient.queryChartConfig.mock.calls;
      expect(calls).toHaveLength(1);
      expect('seriesLimitDateRange' in calls[0][0].config).toBe(false);
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

      const { result } = renderHook(
        () => useQueriedChartConfig(config, { enableQueryChunking: true }),
        {
          wrapper,
        },
      );

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

      const { result } = renderHook(
        () => useQueriedChartConfig(config, { enableQueryChunking: true }),
        {
          wrapper,
        },
      );

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
        () =>
          useQueriedChartConfig(config, {
            onError,
            retry: false,
            enableQueryChunking: true,
          }),
        {
          wrapper,
        },
      );

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(onError).toHaveBeenCalledWith(mockError);
      expect(result.current.error).toBe(mockError);
    });

    it('has an error status with partial data after the second chunk fails to fetch', async () => {
      const mockError = new Error('Query failed');
      const mockSuccess = createMockQueryResponse([
        {
          'count()': '71',
          __hdx_time_bucket: '2025-10-01T18:00:00Z',
        },
      ]);

      mockClickhouseClient.queryChartConfig
        .mockResolvedValueOnce(mockSuccess)
        .mockRejectedValueOnce(mockError);

      const onError = jest.fn();
      const config = createMockChartConfig({
        dateRange: [
          new Date('2025-10-01 00:00:00Z'),
          new Date('2025-10-02 00:00:00Z'),
        ],
        granularity: '3 hour',
      });

      const { result } = renderHook(
        () =>
          useQueriedChartConfig(config, {
            onError,
            retry: false,
            enableQueryChunking: true,
          }),
        {
          wrapper,
        },
      );

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.isFetching).toBe(false);
      expect(result.current.isSuccess).toBe(false);

      expect(result.current.error).toBe(mockError);
      expect(onError).toHaveBeenCalledWith(mockError);
      expect(result.current.data).toEqual({
        data: mockSuccess.data,
        meta: mockSuccess.meta,
        rows: mockSuccess.rows,
        isComplete: false,
      });
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
        () =>
          useQueriedChartConfig(config, {
            enabled: false,
            enableQueryChunking: true,
          }),
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

    it('uses different query keys for the same config when one sets enableQueryChunking', async () => {
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
        () => useQueriedChartConfig(config, { enableQueryChunking: true }),
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

      // Second render with same config but without query chunking enabled
      mockClickhouseClient.queryChartConfig.mockResolvedValue(
        mockResponseNonChunked,
      );

      const { result: result2 } = renderHook(
        () => useQueriedChartConfig(config),
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

    it('returns an empty result if the given date range is empty', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2025-10-01 00:00:00Z'),
          new Date('2025-10-01 00:00:00Z'),
        ],
        granularity: '1 hour',
      });

      const mockResponse = createMockQueryResponse([]);
      mockClickhouseClient.queryChartConfig.mockResolvedValue(mockResponse);

      const { result } = renderHook(
        () => useQueriedChartConfig(config, { enableQueryChunking: true }),
        {
          wrapper,
        },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await waitFor(() => expect(result.current.isFetching).toBe(false));

      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalledTimes(1);

      expect(result.current.data).toEqual({
        data: [],
        meta: mockResponse.meta,
        rows: 0,
        isComplete: true,
      });
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isPending).toBe(false);
    });

    const setupParallelQueries = () => {
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

      return { config, mockResponse1, mockResponse2, mockResponse3 };
    };

    it('fetches data in parallel when enableParallelQueries is true', async () => {
      const { config, mockResponse1, mockResponse2, mockResponse3 } =
        setupParallelQueries();

      // Create promises that resolve with different delays to simulate parallel execution
      const promise1 = Promise.resolve(mockResponse1);
      const promise2 = new Promise<typeof mockResponse2>(resolve =>
        setTimeout(() => resolve(mockResponse2), 50),
      );
      const promise3 = new Promise<typeof mockResponse3>(resolve =>
        setTimeout(() => resolve(mockResponse3), 100),
      );

      mockClickhouseClient.queryChartConfig
        .mockReturnValueOnce(promise1)
        .mockReturnValueOnce(promise2)
        .mockReturnValueOnce(promise3);

      const { result } = renderHook(
        () =>
          useQueriedChartConfig(config, {
            enableQueryChunking: true,
            enableParallelQueries: true,
          }),
        {
          wrapper,
        },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true), {
        timeout: 1000,
      });
      await waitFor(() => expect(result.current.isFetching).toBe(false), {
        timeout: 1000,
      });

      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalledTimes(3);

      // Data should be in order based on time window chunks (newest first)
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

    it('streams parallel query results in order', async () => {
      const { config, mockResponse1, mockResponse2, mockResponse3 } =
        setupParallelQueries();

      // Create promises with controlled resolution order - simulate last chunk finishing first
      let resolvePromise3: (value: any) => void;
      let resolvePromise2: (value: any) => void;
      let resolvePromise1: (value: any) => void;

      const promise1 = new Promise(resolve => {
        resolvePromise1 = resolve;
      });
      const promise2 = new Promise(resolve => {
        resolvePromise2 = resolve;
      });
      const promise3 = new Promise(resolve => {
        resolvePromise3 = resolve;
      });

      mockClickhouseClient.queryChartConfig
        .mockReturnValueOnce(promise1 as any)
        .mockReturnValueOnce(promise2 as any)
        .mockReturnValueOnce(promise3 as any);

      const { result } = renderHook(
        () =>
          useQueriedChartConfig(config, {
            enableQueryChunking: true,
            enableParallelQueries: true,
          }),
        {
          wrapper,
        },
      );

      // Should be in loading state initially
      expect(result.current.isLoading).toBe(true);
      expect(result.current.data).toBeUndefined();

      // Resolve the last chunk first (out of order)
      resolvePromise3!(mockResponse3);

      // Should still be loading since we need the first chunk
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(result.current.isLoading).toBe(true);

      // Resolve the first chunk
      resolvePromise1!(mockResponse1);

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Should have partial data from first chunk only (in chronological order)
      expect(result.current.data).toEqual({
        data: mockResponse1.data,
        meta: mockResponse1.meta,
        rows: 2,
        isComplete: false,
      });
      expect(result.current.isFetching).toBe(true);

      // Resolve the middle chunk
      resolvePromise2!(mockResponse2);

      await waitFor(() => expect(result.current.isFetching).toBe(false));

      // Should now have all data in chronological order
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
    });

    it('pins the series-limit ranking to the newest window with parallel queries', async () => {
      const { config } = setupParallelQueries();
      const configWithLimit = { ...config, seriesLimit: 3 };

      mockClickhouseClient.queryChartConfig.mockResolvedValue(
        createMockQueryResponse([]),
      );

      const { result } = renderHook(
        () =>
          useQueriedChartConfig(configWithLimit, {
            enableQueryChunking: true,
            enableParallelQueries: true,
          }),
        { wrapper },
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await waitFor(() => expect(result.current.isFetching).toBe(false));

      const newestWindow: [Date, Date] = [
        new Date('2025-10-01T18:00:00.000Z'),
        new Date('2025-10-02T00:00:00.000Z'),
      ];
      const calls = mockClickhouseClient.queryChartConfig.mock.calls;
      expect(calls).toHaveLength(3);
      for (const [{ config: windowed }] of calls) {
        expect(windowed.seriesLimitDateRange).toEqual(newestWindow);
      }
    });

    it('should not execute query while useMVOptimizationExplanation is in loading state', async () => {
      const config = createMockChartConfig({
        dateRange: [
          new Date('2025-10-01 00:00:00Z'),
          new Date('2025-10-02 00:00:00Z'),
        ],
        granularity: '1 hour',
        from: {
          databaseName: 'default',
          tableName: 'otel_logs',
        },
        select: [
          {
            aggCondition: '',
            aggFn: 'count',
            valueExpression: '',
          },
        ],
      });

      const optimizedConfig = createMockChartConfig({
        ...config,
        from: {
          databaseName: 'default',
          tableName: 'metrics_rollup_1h',
        },
        select: [
          {
            aggCondition: '',
            aggFn: 'countMerge',
            valueExpression: 'count__',
          },
        ],
      });

      // Mock useMVOptimizationExplanation to be in loading state
      jest.mocked(useMVOptimizationExplanation).mockReturnValue({
        data: undefined,
        isLoading: true, // MV optimization is still loading
      } as any);

      renderHook(
        () => useQueriedChartConfig(config, { enableQueryChunking: true }),
        {
          wrapper,
        },
      );

      // Wait a bit to ensure query doesn't execute
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify the query hasn't started because MV optimization is loading
      expect(mockClickhouseClient.queryChartConfig).not.toHaveBeenCalled();

      // Now mock the MV optimization to finish loading with an optimized config
      jest.mocked(useMVOptimizationExplanation).mockReturnValue({
        data: {
          optimizedConfig: optimizedConfig,
          explanations: [
            {
              success: true,
              mvConfig: {
                minGranularity: '1 hour',
                tableName: 'metrics_rollup_1h',
              },
            },
          ],
        },
        isLoading: false, // MV optimization finished loading
      } as any);

      const mockResponse = createMockQueryResponse([
        {
          'count()': '71',
          SeverityText: 'info',
          __hdx_time_bucket: '2025-10-01T00:00:00Z',
        },
      ]);

      mockClickhouseClient.queryChartConfig.mockResolvedValue(mockResponse);

      // Re-render with MV optimization completed
      const { result: result2 } = renderHook(
        () => useQueriedChartConfig(config, { enableQueryChunking: true }),
        {
          wrapper,
        },
      );

      await waitFor(() => expect(result2.current.isSuccess).toBe(true));
      await waitFor(() => expect(result2.current.isFetching).toBe(false));

      // Verify the query was executed after MV optimization finished
      expect(mockClickhouseClient.queryChartConfig).toHaveBeenCalled();

      // Verify the query used the optimized config (materialized view)
      const queryCall = mockClickhouseClient.queryChartConfig.mock.calls[0][0];
      if (!isBuilderChartConfig(queryCall.config)) {
        throw new Error('Expected a BuilderChartConfig');
      }
      expect(queryCall.config.from.tableName).toBe('metrics_rollup_1h');

      expect(result2.current.data?.data).toBeDefined();
    });
  });

  describe('getMinGranularitySeconds', () => {
    const baseMetricSource = {
      id: 'source-1',
      kind: SourceKind.Metric,
      name: 'Test Metrics',
      connection: 'conn-1',
      from: { databaseName: 'default', tableName: '' },
      timestampValueExpression: 'TimeUnix',
      resourceAttributesExpression: 'ResourceAttributes',
      metricTables: {
        gauge: 'otel_metrics_gauge',
        histogram: 'otel_metrics_histogram',
        sum: 'otel_metrics_sum',
        summary: 'otel_metrics_summary',
        'exponential histogram': 'otel_metrics_exponential_histogram',
      },
    } satisfies Extract<TSource, { kind: SourceKind.Metric }>;

    it('converts the source minAutoGranularity setting to seconds', () => {
      expect(
        getMinGranularitySeconds({
          ...baseMetricSource,
          minAutoGranularity: '5 minute',
        }),
      ).toBe(300);
    });

    it('returns undefined when the source has no minAutoGranularity set', () => {
      expect(getMinGranularitySeconds(baseMetricSource)).toBeUndefined();
    });

    it('returns undefined for a non-metric source', () => {
      expect(
        getMinGranularitySeconds({
          id: 'source-2',
          kind: SourceKind.Log,
          name: 'Test Logs',
          connection: 'conn-1',
          from: { databaseName: 'default', tableName: 'otel_logs' },
          timestampValueExpression: 'TimestampTime',
          defaultTableSelectExpression: 'Body',
        } satisfies TSource),
      ).toBeUndefined();
    });

    it('returns undefined when the source is undefined', () => {
      expect(getMinGranularitySeconds(undefined)).toBeUndefined();
    });
  });

  describe('mergeQuerySettings', () => {
    const sourceSettings = [{ setting: 'max_threads', value: '4' }];

    it('returns the source settings unchanged when there is nothing to add', () => {
      expect(mergeQuerySettings(sourceSettings, undefined)).toBe(
        sourceSettings,
      );
      expect(mergeQuerySettings(undefined, [])).toBeUndefined();
    });

    it('adds the additional settings after the source settings', () => {
      expect(
        mergeQuerySettings(sourceSettings, [
          { setting: 'asterisk_include_alias_columns', value: '1' },
        ]),
      ).toEqual([
        { setting: 'max_threads', value: '4' },
        { setting: 'asterisk_include_alias_columns', value: '1' },
      ]);
    });

    it('adds only the settings that the source does not define', () => {
      expect(
        mergeQuerySettings(
          [{ setting: 'asterisk_include_alias_columns', value: '0' }],
          [
            { setting: 'asterisk_include_materialized_columns', value: '1' },
            { setting: 'asterisk_include_alias_columns', value: '1' },
          ],
        ),
      ).toEqual([
        { setting: 'asterisk_include_alias_columns', value: '0' },
        { setting: 'asterisk_include_materialized_columns', value: '1' },
      ]);
    });

    it('keeps the value of a setting that the source already defines', () => {
      expect(
        mergeQuerySettings(
          [{ setting: 'asterisk_include_alias_columns', value: '0' }],
          [{ setting: 'asterisk_include_alias_columns', value: '1' }],
        ),
      ).toEqual([{ setting: 'asterisk_include_alias_columns', value: '0' }]);
    });
  });

  describe('appendChunk', () => {
    const empty = { data: [], meta: [], rows: 0, isComplete: false };

    it('reuses the chunk array on the first/only chunk (no copy)', () => {
      const chunkData = [{ a: 1 }, { a: 2 }];
      const chunk = {
        data: chunkData,
        meta: [{ name: 'a', type: 'UInt64' }],
        rows: 2,
      };
      const result = appendChunk(empty, { chunk, isComplete: true });
      // Same array reference — the large-array spread copy is skipped.
      expect(result.data).toBe(chunkData);
      expect(result.rows).toBe(2);
      expect(result.isComplete).toBe(true);
      expect(result.meta).toBe(chunk.meta);
    });

    it('prepends the newer chunk ahead of accumulated rows on later chunks', () => {
      const older = {
        data: [{ a: 3 }],
        meta: [{ name: 'a', type: 'UInt64' }],
        rows: 1,
        isComplete: false,
      };
      const chunk = {
        data: [{ a: 1 }, { a: 2 }],
        meta: [{ name: 'a', type: 'UInt64' }],
        rows: 2,
      };
      const result = appendChunk(older, { chunk, isComplete: true });
      // Newer chunk first, then accumulated (oldest-first ordering preserved).
      expect(result.data).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
      expect(result.data).not.toBe(chunk.data); // fresh array when merging
      expect(result.rows).toBe(3);
    });
  });
});
