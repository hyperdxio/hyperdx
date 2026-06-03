import React from 'react';

import { Table } from '@/HDXMultiSeriesTableChart';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';
import { useSource } from '@/source';

import DateRangeIndicator from '../charts/DateRangeIndicator';
import DBTableChart from '../DBTableChart';
import MVOptimizationIndicator from '../MaterializedViews/MVOptimizationIndicator';

// Mock dependencies
jest.mock('@/hooks/useOffsetPaginatedQuery', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('next/router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('@/hooks/useMVOptimizationExplanation', () => ({
  useMVOptimizationExplanation: jest.fn().mockReturnValue({
    data: undefined,
    isLoading: false,
    isPlaceholderData: false,
  }),
}));

jest.mock('@/source', () => ({
  useSource: jest.fn().mockReturnValue({ data: null }),
  useSources: jest.fn().mockReturnValue({ data: [] }),
  useChartNumberFormats: jest
    .fn()
    .mockReturnValue({ formatByColumn: new Map(), chartFormat: undefined }),
}));

jest.mock('@/HDXMultiSeriesTableChart', () => ({
  __esModule: true,
  Table: jest.fn(() => null),
}));

jest.mock('@/hooks/useOnClickLinkBuilder', () => ({
  useOnClickLinkBuilder: jest.fn().mockReturnValue(null),
}));

jest.mock('../MaterializedViews/MVOptimizationIndicator', () =>
  jest.fn(() => null),
);

jest.mock('../charts/DateRangeIndicator', () => jest.fn(() => null));

describe('DBTableChart', () => {
  const baseTestConfig = {
    dateRange: [new Date(), new Date()] as [Date, Date],
    from: { databaseName: 'test', tableName: 'test' },
    timestampValueExpression: 'timestamp',
    connection: 'test-connection',
    select: '',
    where: '',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    jest.mocked(useOffsetPaginatedQuery).mockReturnValue({
      data: {
        data: [{ column1: 'value1', column2: 'value2' }],
        meta: [
          { name: 'column1', type: 'String' },
          { name: 'column2', type: 'String' },
        ],
        chSql: { sql: '', params: {} },
        window: {
          startTime: new Date(),
          endTime: new Date(),
          windowIndex: 0,
          direction: 'DESC' as const,
        },
      },
      fetchNextPage: jest.fn(),
      hasNextPage: false,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    } as any);
  });

  it('passes the same config to useMVOptimizationExplanation, useOffsetPaginatedQuery, and MVOptimizationIndicator', () => {
    // Mock useSource to return a source so MVOptimizationIndicator is rendered
    jest.mocked(useSource).mockReturnValue({
      data: { id: 'test-source', name: 'Test Source' },
    } as any);

    renderWithMantine(<DBTableChart config={baseTestConfig} />);

    // Get the config that was passed to useMVOptimizationExplanation
    expect(jest.mocked(useMVOptimizationExplanation)).toHaveBeenCalled();
    const mvOptExplanationConfig = jest.mocked(useMVOptimizationExplanation)
      .mock.calls[0][0];

    // Get the config that was passed to useOffsetPaginatedQuery
    expect(jest.mocked(useOffsetPaginatedQuery)).toHaveBeenCalled();
    const paginatedQueryConfig = jest.mocked(useOffsetPaginatedQuery).mock
      .calls[0][0];

    // Get the config that was passed to MVOptimizationIndicator
    expect(jest.mocked(MVOptimizationIndicator)).toHaveBeenCalled();
    const indicatorConfig = jest.mocked(MVOptimizationIndicator).mock
      .calls[0][0].config;

    // All three should receive the same config object reference
    expect(mvOptExplanationConfig).toBe(paginatedQueryConfig);
    expect(paginatedQueryConfig).toBe(indicatorConfig);
    expect(mvOptExplanationConfig).toBe(indicatorConfig);
  });

  it('renders DateRangeIndicator when MV optimization returns a different date range', () => {
    const originalStartDate = new Date('2024-01-01T00:00:30Z');
    const originalEndDate = new Date('2024-01-01T01:30:45Z');
    const alignedStartDate = new Date('2024-01-01T00:00:00Z');
    const alignedEndDate = new Date('2024-01-01T02:00:00Z');

    const config = {
      ...baseTestConfig,
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

    renderWithMantine(<DBTableChart config={config} />);

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

  describe('groupByColumnsOnLeft', () => {
    // Emulates how the ClickHouse query returns rows for a builder table chart:
    // series columns are produced before groupBy columns.
    beforeEach(() => {
      jest.mocked(useOffsetPaginatedQuery).mockReturnValue({
        data: {
          data: [
            {
              Count: 10,
              AvgDuration: 42,
              ServiceName: 'web',
              SpanName: 'GET /',
            },
          ],
          meta: [],
          chSql: { sql: '', params: {} },
          window: {
            startTime: new Date(),
            endTime: new Date(),
            windowIndex: 0,
            direction: 'DESC' as const,
          },
        },
        fetchNextPage: jest.fn(),
        hasNextPage: false,
        isLoading: false,
        isFetching: false,
        isError: false,
        error: null,
      } as any);
    });

    const configWithGroupBy = {
      ...baseTestConfig,
      select: [
        { aggFn: 'count' as const, valueExpression: '', alias: 'Count' },
        {
          aggFn: 'avg' as const,
          valueExpression: 'Duration',
          alias: 'AvgDuration',
        },
      ],
      groupBy: 'ServiceName, SpanName',
    };

    it('preserves the row key order (series, then groupBy) by default', () => {
      renderWithMantine(<DBTableChart config={configWithGroupBy} />);

      const columns = jest.mocked(Table).mock.calls.at(-1)![0].columns;
      expect(columns.map(c => c.dataKey)).toEqual([
        'Count',
        'AvgDuration',
        'ServiceName',
        'SpanName',
      ]);
    });

    it('moves groupBy columns to the left when groupByColumnsOnLeft is true', () => {
      renderWithMantine(
        <DBTableChart
          config={{ ...configWithGroupBy, groupByColumnsOnLeft: true }}
        />,
      );

      const columns = jest.mocked(Table).mock.calls.at(-1)![0].columns;
      expect(columns.map(c => c.dataKey)).toEqual([
        'ServiceName',
        'SpanName',
        'Count',
        'AvgDuration',
      ]);
    });

    it('treats ratio configs as a single series column when moving groupBy columns left', () => {
      // With seriesReturnType === 'ratio' and two selects, ClickHouse returns a
      // single computed column for the ratio — not one column per select. The
      // row shape reflects this: 1 series column followed by the groupBy
      // columns.
      jest.mocked(useOffsetPaginatedQuery).mockReturnValue({
        data: {
          data: [
            {
              'divide(count(), count())': 0.5,
              ServiceName: 'web',
              SpanName: 'GET /',
            },
          ],
          meta: [],
          chSql: { sql: '', params: {} },
          window: {
            startTime: new Date(),
            endTime: new Date(),
            windowIndex: 0,
            direction: 'DESC' as const,
          },
        },
        fetchNextPage: jest.fn(),
        hasNextPage: false,
        isLoading: false,
        isFetching: false,
        isError: false,
        error: null,
      } as any);

      const ratioConfig = {
        ...baseTestConfig,
        select: [
          { aggFn: 'count' as const, valueExpression: '', alias: 'Numerator' },
          {
            aggFn: 'count' as const,
            valueExpression: '',
            alias: 'Denominator',
          },
        ],
        groupBy: 'ServiceName, SpanName',
        seriesReturnType: 'ratio' as const,
        groupByColumnsOnLeft: true,
      };

      renderWithMantine(<DBTableChart config={ratioConfig} />);

      const columns = jest.mocked(Table).mock.calls.at(-1)![0].columns;
      expect(columns.map(c => c.dataKey)).toEqual([
        'ServiceName',
        'SpanName',
        'divide(count(), count())',
      ]);
    });

    it('does not reorder columns for raw SQL configs even when the flag is set', () => {
      const rawSqlConfig = {
        configType: 'sql' as const,
        dateRange: [new Date(), new Date()] as [Date, Date],
        connection: 'test-connection',
        sqlTemplate: 'SELECT Count, AvgDuration, ServiceName, SpanName FROM t',
        groupByColumnsOnLeft: true,
      };

      jest.mocked(useOffsetPaginatedQuery).mockReturnValue({
        data: {
          data: [
            {
              Count: 10,
              AvgDuration: 42,
              ServiceName: 'web',
              SpanName: 'GET /',
            },
          ],
          meta: [],
          chSql: { sql: '', params: {} },
          window: {
            startTime: new Date(),
            endTime: new Date(),
            windowIndex: 0,
            direction: 'DESC' as const,
          },
        },
        fetchNextPage: jest.fn(),
        hasNextPage: false,
        isLoading: false,
        isFetching: false,
        isError: false,
        error: null,
      } as any);

      renderWithMantine(<DBTableChart config={rawSqlConfig} />);

      const columns = jest.mocked(Table).mock.calls.at(-1)![0].columns;
      expect(columns.map(c => c.dataKey)).toEqual([
        'Count',
        'AvgDuration',
        'ServiceName',
        'SpanName',
      ]);
    });
  });

  it('does not render DateRangeIndicator when MV optimization has no optimized date range', () => {
    // Mock useMVOptimizationExplanation to return data without an optimized config
    jest.mocked(useMVOptimizationExplanation).mockReturnValue({
      data: {
        optimizedConfig: undefined,
        explanations: [],
      },
      isLoading: false,
      isPlaceholderData: false,
    } as any);

    renderWithMantine(<DBTableChart config={baseTestConfig} />);

    // Verify DateRangeIndicator was not called
    expect(jest.mocked(DateRangeIndicator)).not.toHaveBeenCalled();
  });
});
