import React from 'react';
import objectHash from 'object-hash';
import {
  BuilderChartConfigWithDateRange,
  ChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import { hashKey } from '@tanstack/react-query';

import { DBTimeChart } from '@/components/DBTimeChart';
import SearchHistogramLegend from '@/components/SearchHistogramLegend';
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

jest.mock('@/hooks/useMVOptimizationExplanation', () => ({
  useMVOptimizationExplanation: jest.fn().mockReturnValue({
    data: undefined,
    isLoading: false,
    isPlaceholderData: false,
  }),
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
  useChartNumberFormats: () => ({
    formatByColumn: new Map(),
    chartFormat: undefined,
  }),
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
  getPreviousDateRange: () => [new Date('2023-12-31'), new Date('2024-01-01')],
  getAlignedDateRange: (dateRange: [Date, Date]) => dateRange,
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

  // The severity legend re-aggregates the histogram's rows over the whole date
  // range, so it must resolve from the histogram's cache entry rather than
  // issuing a second ClickHouse query. React Query only dedupes when the keys
  // hash identically, so assert against its own hashing function: a plain
  // `toEqual` would pass even for keys that hash apart (e.g. an explicit
  // `disableQueryChunking: undefined` vs `false`).
  it('should use a queryKey that hashes identically to DBTimeChart for SearchHistogramLegend', () => {
    const config: BuilderChartConfigWithDateRange = {
      select: 'count()',
      from: { databaseName: 'test', tableName: 'logs' },
      where: '',
      timestampValueExpression: 'timestamp',
      connection: 'test-connection',
      displayType: DisplayType.StackedBar,
      dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
    };

    const queryKeyPrefix = 'search';

    // DBTimeChart also issues a (disabled) previous-period query whose key has
    // no options element, so render each component in isolation and pick the
    // main chunked query rather than indexing into a shared call list.
    const renderAndGetPrimaryQueryKey = (element: React.ReactElement) => {
      mockUseQueriedChartConfig.mockClear();
      renderWithMantine(element);
      const keys = mockUseQueriedChartConfig.mock.calls
        .map(call => call[1]?.queryKey)
        .filter(key => key?.length === 4);
      expect(keys).toHaveLength(1);
      return keys[0];
    };

    const chartQueryKey = renderAndGetPrimaryQueryKey(
      <DBTimeChart
        config={config}
        queryKeyPrefix={queryKeyPrefix}
        enableParallelQueries={true}
      />,
    );

    const legendQueryKey = renderAndGetPrimaryQueryKey(
      <SearchHistogramLegend
        config={config}
        queryKeyPrefix={queryKeyPrefix}
        enableParallelQueries={true}
      />,
    );

    const totalCountQueryKey = renderAndGetPrimaryQueryKey(
      <SearchTotalCountChart
        config={config}
        queryKeyPrefix={queryKeyPrefix}
        enableParallelQueries={true}
      />,
    );

    expect(hashKey(legendQueryKey)).toBe(hashKey(chartQueryKey));
    expect(hashKey(totalCountQueryKey)).toBe(hashKey(chartQueryKey));
  });

  it('should not pin disableQueryChunking in the legend queryKey when the histogram leaves it unset', () => {
    const config: BuilderChartConfigWithDateRange = {
      select: 'count()',
      from: { databaseName: 'test', tableName: 'logs' },
      where: '',
      timestampValueExpression: 'timestamp',
      connection: 'test-connection',
      displayType: DisplayType.StackedBar,
      dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
    };

    renderWithMantine(
      <SearchHistogramLegend config={config} queryKeyPrefix="search" />,
    );

    const legendQueryKey = mockUseQueriedChartConfig.mock.calls[0][1]?.queryKey;

    // `JSON.stringify` drops undefined values, so an unset flag must stay
    // undefined rather than being normalized to `false` — otherwise the key
    // hashes differently from the histogram's and the cache entry splits.
    expect(legendQueryKey[3].disableQueryChunking).toBeUndefined();
  });
});
