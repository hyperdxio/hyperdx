import React from 'react';
import objectHash from 'object-hash';
import {
  ChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';

import { DBTimeChart } from '@/components/DBTimeChart';
import SearchTotalCountChart from '@/components/SearchTotalCountChart';

// Mock the API and hooks
jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useMe: () => ({
      data: { team: { parallelizeWhenPossible: false } },
      isLoading: false,
    }),
  },
}));

jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: jest.fn(() => ({
    data: { data: [], isComplete: true },
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
    isSuccess: true,
  })),
}));

jest.mock('@/source', () => ({
  useSource: () => ({ data: null, isLoading: false }),
}));

jest.mock('@/ChartUtils', () => ({
  useTimeChartSettings: () => ({
    displayType: DisplayType.StackedBar,
    dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
    granularity: '30 minutes',
    fillNulls: true,
  }),
  formatResponseForTimeChart: () => ({
    graphResults: [],
    timestampColumn: undefined,
    lineData: [],
    groupColumns: [],
    valueColumns: [],
    isSingleValueColumn: true,
  }),
  getPreviousDateRange: (dateRange: [Date, Date]) => [
    new Date('2023-12-31'),
    new Date('2024-01-01'),
  ],
  getPreviousPeriodOffsetSeconds: () => 86400,
  convertToTimeChartConfig:
    jest.requireActual('@/ChartUtils').convertToTimeChartConfig,
}));

describe('DBSearchPage QueryKey Consistency', () => {
  let mockUseQueriedChartConfig: jest.Mock;

  beforeEach(async () => {
    mockUseQueriedChartConfig = (await import('@/hooks/useChartConfig'))
      .useQueriedChartConfig as any;
    mockUseQueriedChartConfig.mockClear();
  });

  it('should use matching queryKeys between SearchTotalCountChart and DBTimeChart', () => {
    const config: ChartConfigWithDateRange = {
      select: 'count()',
      from: { databaseName: 'test', tableName: 'logs' },
      where: '',
      timestampValueExpression: 'timestamp',
      connection: 'test-connection',
      displayType: DisplayType.StackedBar,
      dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
    };

    const queryKeyPrefix = 'search';

    // Render SearchTotalCountChart
    renderWithMantine(
      <SearchTotalCountChart
        config={config}
        queryKeyPrefix={queryKeyPrefix}
        enableParallelQueries={true}
      />,
    );

    // Render DBTimeChart
    renderWithMantine(
      <DBTimeChart
        config={config}
        queryKeyPrefix={queryKeyPrefix}
        enableParallelQueries={true}
      />,
    );

    // Get all calls to useQueriedChartConfig
    const calls = mockUseQueriedChartConfig.mock.calls;

    // Should have at least 2 calls (one for each component)
    expect(calls.length).toBeGreaterThanOrEqual(2);

    // Extract queryKey from each call
    const searchTotalCountQueryKey = calls[0][1]?.queryKey;
    const dbTimeChartQueryKey = calls[1][1]?.queryKey;

    // Both should exist
    expect(searchTotalCountQueryKey).toBeDefined();
    expect(dbTimeChartQueryKey).toBeDefined();

    // The key structure should be identical for both components
    // This ensures React Query can properly dedupe the queries
    expect(searchTotalCountQueryKey).toEqual(dbTimeChartQueryKey);

    // Additional object hash check for deep equality verification
    const searchQueryKeyHash = objectHash(searchTotalCountQueryKey);
    const chartQueryKeyHash = objectHash(dbTimeChartQueryKey);
    expect(searchQueryKeyHash).toBe(chartQueryKeyHash);
  });

  it('should use consistent queryKeys when disableQueryChunking is set', () => {
    const config: ChartConfigWithDateRange = {
      select: 'count()',
      from: { databaseName: 'test', tableName: 'logs' },
      where: '',
      timestampValueExpression: 'timestamp',
      connection: 'test-connection',
      displayType: DisplayType.StackedBar,
      dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
    };

    const queryKeyPrefix = 'search';

    // Render both components with disableQueryChunking
    renderWithMantine(
      <SearchTotalCountChart
        config={config}
        queryKeyPrefix={queryKeyPrefix}
        disableQueryChunking={true}
      />,
    );

    renderWithMantine(
      <DBTimeChart
        config={config}
        queryKeyPrefix={queryKeyPrefix}
        disableQueryChunking={true}
      />,
    );

    const calls = mockUseQueriedChartConfig.mock.calls;
    const searchQueryKey = calls[0][1]?.queryKey;
    const chartQueryKey = calls[1][1]?.queryKey;

    // Verify the options include disableQueryChunking
    expect(searchQueryKey[3]).toHaveProperty('disableQueryChunking', true);
    expect(chartQueryKey[3]).toHaveProperty('disableQueryChunking', true);

    // Keys should still match
    expect(searchQueryKey).toEqual(chartQueryKey);

    // Additional object hash check for deep equality verification
    const searchQueryKeyHash = objectHash(searchQueryKey);
    const chartQueryKeyHash = objectHash(chartQueryKey);
    expect(searchQueryKeyHash).toBe(chartQueryKeyHash);
  });
});
