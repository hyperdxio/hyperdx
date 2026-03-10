import React from 'react';

import api from '@/api';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSource } from '@/source';

import DateRangeIndicator from '../charts/DateRangeIndicator';
import { DBTimeChart } from '../DBTimeChart';
import MVOptimizationIndicator from '../MaterializedViews/MVOptimizationIndicator';

// Mock dependencies
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: jest.fn(),
}));

jest.mock('@/hooks/useMVOptimizationExplanation', () => ({
  useMVOptimizationExplanation: jest.fn().mockReturnValue({
    data: undefined,
    isLoading: false,
    isPlaceholderData: false,
  }),
}));

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useMe: jest.fn(),
  },
}));

jest.mock('@/source', () => ({
  useSource: jest.fn(),
}));

jest.mock('../MaterializedViews/MVOptimizationIndicator', () =>
  jest.fn(() => null),
);

jest.mock('../charts/DateRangeIndicator', () => jest.fn(() => null));

describe('DBTimeChart', () => {
  const mockUseQueriedChartConfig = useQueriedChartConfig as jest.Mock;
  const mockUseMe = api.useMe as jest.Mock;
  const mockUseSource = useSource as jest.Mock;

  const baseTestConfig = {
    dateRange: [new Date('2024-01-01'), new Date('2024-01-02')] as [Date, Date],
    from: { databaseName: 'test', tableName: 'test' },
    timestampValueExpression: 'timestamp',
    connection: 'test-connection',
    select: 'value',
    where: '',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockUseMe.mockReturnValue({
      data: { team: { parallelizeWhenPossible: false } },
      isLoading: false,
    });

    mockUseSource.mockReturnValue({
      data: undefined,
      isLoading: false,
    });

    mockUseQueriedChartConfig.mockReturnValue({
      data: {
        data: [{ timestamp: 1704067200, value: 100 }],
        meta: [],
        rows: 1,
        isComplete: true,
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
      isPlaceholderData: false,
    });
  });

  it('passes enabled: false to useQueriedChartConfig for previous period when compareToPreviousPeriod is undefined', () => {
    const config = {
      ...baseTestConfig,
      compareToPreviousPeriod: undefined,
    };

    renderWithMantine(<DBTimeChart config={config} />);

    // Get the second call (previous period query)
    const [, secondCallOptions] = mockUseQueriedChartConfig.mock.calls[1];

    // Verify that enabled is false for the previous period query
    expect(secondCallOptions.enabled).toBe(false);
  });

  it('passes enabled: true to useQueriedChartConfig for previous period when compareToPreviousPeriod is true', () => {
    const config = {
      ...baseTestConfig,
      compareToPreviousPeriod: true,
    };

    renderWithMantine(<DBTimeChart config={config} />);

    // Get the second call (previous period query)
    const [, secondCallOptions] = mockUseQueriedChartConfig.mock.calls[1];

    // Verify that enabled is true for the previous period query
    expect(secondCallOptions.enabled).toBe(true);
  });

  it('passes enabled: false to useQueriedChartConfig for previous period when compareToPreviousPeriod is false', () => {
    const config = {
      ...baseTestConfig,
      compareToPreviousPeriod: false,
    };

    renderWithMantine(<DBTimeChart config={config} />);

    // Get the second call (previous period query)
    const [, secondCallOptions] = mockUseQueriedChartConfig.mock.calls[1];

    // Verify that enabled is false for the previous period query
    expect(secondCallOptions.enabled).toBe(false);
  });

  it('respects the enabled prop when determining if previous period query should run', () => {
    const config = {
      ...baseTestConfig,
      compareToPreviousPeriod: true,
    };

    // Render with enabled=false
    renderWithMantine(<DBTimeChart config={config} enabled={false} />);

    // Get the second call (previous period query)
    const [, secondCallOptions] = mockUseQueriedChartConfig.mock.calls[1];

    // Verify that enabled is false even when compareToPreviousPeriod is true
    // because the enabled prop is false
    expect(secondCallOptions.enabled).toBe(false);
  });

  it('passes the same config to useMVOptimizationExplanation, useQueriedChartConfig, and MVOptimizationIndicator', () => {
    // Mock useSource to return a source so MVOptimizationIndicator is rendered
    jest.mocked(useSource).mockReturnValue({
      data: { id: 'test-source', name: 'Test Source' },
    } as any);

    renderWithMantine(<DBTimeChart config={baseTestConfig} />);

    // Get the config that was passed to useMVOptimizationExplanation
    expect(jest.mocked(useMVOptimizationExplanation)).toHaveBeenCalled();
    const mvOptExplanationConfig = jest.mocked(useMVOptimizationExplanation)
      .mock.calls[0][0];

    // Get the config that was passed to useQueriedChartConfig (first call is the main query)
    expect(jest.mocked(useQueriedChartConfig)).toHaveBeenCalled();
    const queriedChartConfig = jest.mocked(useQueriedChartConfig).mock
      .calls[0][0];

    // Get the config that was passed to MVOptimizationIndicator
    expect(jest.mocked(MVOptimizationIndicator)).toHaveBeenCalled();
    const indicatorConfig = jest.mocked(MVOptimizationIndicator).mock
      .calls[0][0].config;

    // All three should receive the same config object reference
    expect(mvOptExplanationConfig).toBe(queriedChartConfig);
    expect(queriedChartConfig).toBe(indicatorConfig);
    expect(mvOptExplanationConfig).toBe(indicatorConfig);
  });

  it('renders DateRangeIndicator when MV optimization returns a different date range', () => {
    const originalStartDate = new Date('2024-01-01T00:00:30Z');
    const originalEndDate = new Date('2024-01-01T01:30:45Z');
    const alignedStartDate = new Date('2024-01-01T00:00:00Z');
    const alignedEndDate = new Date('2024-01-01T02:00:00Z');

    const config = {
      ...baseTestConfig,
      alignDateRangeToGranularity: false,
      dateRange: [originalStartDate, originalEndDate] as [Date, Date],
    };

    // Mock useMVOptimizationExplanation to return an optimized config with aligned date range
    jest.mocked(useMVOptimizationExplanation).mockReturnValue({
      data: {
        optimizedConfig: {
          ...config,
          dateRange: [alignedStartDate, alignedEndDate] as [Date, Date],
        },
        explanations: [
          {
            success: true,
            mvConfig: {
              minGranularity: '1 minute',
              tableName: 'metrics_rollup_1m',
            },
          },
        ],
      },
      isLoading: false,
      isPlaceholderData: false,
    } as any);

    renderWithMantine(<DBTimeChart config={config} />);

    // Verify DateRangeIndicator was called
    expect(jest.mocked(DateRangeIndicator)).toHaveBeenCalled();

    // Verify it was called with the correct props
    const dateRangeIndicatorCall =
      jest.mocked(DateRangeIndicator).mock.calls[0][0];
    expect(dateRangeIndicatorCall.originalDateRange).toEqual([
      originalStartDate,
      originalEndDate,
    ]);
    expect(dateRangeIndicatorCall.effectiveDateRange).toEqual([
      alignedStartDate,
      alignedEndDate,
    ]);
    expect(dateRangeIndicatorCall.mvGranularity).toBe('1 minute');
  });

  it('renders DateRangeIndicator when alignDateRangeToGranularity is true and results in a different date range', () => {
    const originalStartDate = new Date('2024-01-01T00:00:30Z');
    const originalEndDate = new Date('2024-01-01T01:30:45Z');
    const alignedStartDate = new Date('2024-01-01T00:00:00Z');
    const alignedEndDate = new Date('2024-01-01T01:35:00Z');

    const config = {
      ...baseTestConfig,
      alignDateRangeToGranularity: true,
      granularity: '5 minute',
      dateRange: [originalStartDate, originalEndDate] as [Date, Date],
    };

    // Mock useMVOptimizationExplanation to return no optimized config
    jest.mocked(useMVOptimizationExplanation).mockReturnValue({
      data: {
        optimizedConfig: undefined,
        explanations: [],
      },
      isLoading: false,
      isPlaceholderData: false,
    } as any);

    renderWithMantine(<DBTimeChart config={config} />);

    // Verify DateRangeIndicator was called
    expect(jest.mocked(DateRangeIndicator)).toHaveBeenCalled();

    // Verify it was called with the correct props
    const dateRangeIndicatorCall =
      jest.mocked(DateRangeIndicator).mock.calls[0][0];
    expect(dateRangeIndicatorCall.originalDateRange).toEqual([
      originalStartDate,
      originalEndDate,
    ]);
    expect(dateRangeIndicatorCall.effectiveDateRange).toEqual([
      alignedStartDate,
      alignedEndDate,
    ]);
    expect(dateRangeIndicatorCall.mvGranularity).toBeUndefined();
  });

  describe('raw SQL line chart', () => {
    const rawSqlConfig = {
      configType: 'sql' as const,
      sqlTemplate:
        'SELECT toStartOfInterval(ts, INTERVAL {intervalSeconds:Int64} SECOND) AS ts, count() AS count FROM logs GROUP BY ts ORDER BY ts ASC',
      connection: 'test-connection',
      displayType: 'line' as any,
      dateRange: [new Date('2024-01-01'), new Date('2024-01-02')] as [
        Date,
        Date,
      ],
    };

    it('passes the raw SQL config directly to useQueriedChartConfig without converting it', () => {
      renderWithMantine(<DBTimeChart config={rawSqlConfig} />);

      const firstCallConfig = mockUseQueriedChartConfig.mock.calls[0][0];
      // The config should be passed as-is, not wrapped by convertToTimeChartConfig
      // (which would add `limit`, `dateRangeEndInclusive`, etc.)
      expect(firstCallConfig.configType).toBe('sql');
      expect(firstCallConfig.sqlTemplate).toBe(rawSqlConfig.sqlTemplate);
      expect(firstCallConfig).not.toHaveProperty('limit');
    });

    it('does not pass the raw SQL config to useMVOptimizationExplanation', () => {
      renderWithMantine(<DBTimeChart config={rawSqlConfig} />);

      // useMVOptimizationExplanation should be called with undefined for raw SQL configs
      expect(
        jest.mocked(useMVOptimizationExplanation).mock.calls[0][0],
      ).toBeUndefined();
    });

    it('renders without crashing when query returns timestamp and value columns', () => {
      mockUseQueriedChartConfig.mockReturnValue({
        data: {
          data: [
            { ts: 1704067200, count: 42 },
            { ts: 1704067260, count: 17 },
          ],
          meta: [
            { name: 'ts', type: 'DateTime' },
            { name: 'count', type: 'UInt64' },
          ],
          rows: 2,
          isComplete: true,
        },
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      });

      // Should render without throwing
      expect(() =>
        renderWithMantine(<DBTimeChart config={rawSqlConfig} />),
      ).not.toThrow();
    });

    it('renders without crashing when query returns no data', () => {
      mockUseQueriedChartConfig.mockReturnValue({
        data: {
          data: [],
          meta: [],
          rows: 0,
          isComplete: true,
        },
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      });

      expect(() =>
        renderWithMantine(<DBTimeChart config={rawSqlConfig} />),
      ).not.toThrow();
    });

    it('renders without crashing when query returns multiple value columns', () => {
      mockUseQueriedChartConfig.mockReturnValue({
        data: {
          data: [
            { ts: 1704067200, errors: 5, warnings: 12 },
            { ts: 1704067260, errors: 3, warnings: 8 },
          ],
          meta: [
            { name: 'ts', type: 'DateTime' },
            { name: 'errors', type: 'UInt64' },
            { name: 'warnings', type: 'UInt64' },
          ],
          rows: 2,
          isComplete: true,
        },
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      });

      expect(() =>
        renderWithMantine(<DBTimeChart config={rawSqlConfig} />),
      ).not.toThrow();
    });
  });

  it('does not render DateRangeIndicator when MV optimization has no optimized date range and showDateRangeIndicator is false', () => {
    // Mock useMVOptimizationExplanation to return data without an optimized config
    jest.mocked(useMVOptimizationExplanation).mockReturnValue({
      data: {
        optimizedConfig: undefined,
        explanations: [],
      },
      isLoading: false,
      isPlaceholderData: false,
    } as any);

    renderWithMantine(
      <DBTimeChart config={baseTestConfig} showDateRangeIndicator={false} />,
    );

    // Verify DateRangeIndicator was not called
    expect(jest.mocked(DateRangeIndicator)).not.toHaveBeenCalled();
  });
});
