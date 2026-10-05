import React from 'react';
import { isBuilderChartConfig } from '@hyperdx/common-utils/dist/guards';
import { act } from '@testing-library/react';

import DateRangeIndicator from '@/components/charts/DateRangeIndicator';
import DBTableChart from '@/components/DBTableChart';
import MVOptimizationIndicator from '@/components/MaterializedViews/MVOptimizationIndicator';
import { Table } from '@/HDXMultiSeriesTableChart';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import useOffsetPaginatedQuery from '@/hooks/useOffsetPaginatedQuery';
import { useOnClickLinkBuilder } from '@/hooks/useOnClickLinkBuilder';
import { useSource } from '@/source';

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
  // Pure helper (no hooks/network) — use the real implementation so the
  // group-by column inference under test matches production behavior.
  getBuilderValueColumnCount:
    jest.requireActual('@/source').getBuilderValueColumnCount,
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

  type TableQueryResult = ReturnType<typeof useOffsetPaginatedQuery>;
  type TableQueryData = NonNullable<TableQueryResult['data']>;

  const mockTableRows = (
    rows: TableQueryData['data'],
    meta: TableQueryData['meta'] = [],
  ) => {
    const current = jest.mocked(useOffsetPaginatedQuery)(baseTestConfig);
    if (!current.data) {
      throw new Error('Expected the table query mock to have data');
    }
    jest.mocked(useOffsetPaginatedQuery).mockReturnValue({
      ...current,
      data: {
        ...current.data,
        data: rows,
        meta,
      },
    });
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

  describe('refresh indicator', () => {
    it('asks the query to keep the previous rows during a refetch', () => {
      renderWithMantine(<DBTableChart config={baseTestConfig} />);

      const options = jest.mocked(useOffsetPaginatedQuery).mock.calls[0][1];
      expect(options?.keepPreviousData).toBe(true);
    });

    it('pulses while a refetch is showing the previous rows', () => {
      jest.mocked(useOffsetPaginatedQuery).mockReturnValue({
        ...jest.mocked(useOffsetPaginatedQuery)(baseTestConfig),
        isPlaceholderData: true,
      });

      renderWithMantine(<DBTableChart config={baseTestConfig} />);
      expect(jest.mocked(Table).mock.calls.at(-1)![0].className).toBe(
        'effect-pulse',
      );
    });

    it('does not pulse once fresh rows have loaded', () => {
      renderWithMantine(<DBTableChart config={baseTestConfig} />);
      expect(
        jest.mocked(Table).mock.calls.at(-1)![0].className,
      ).toBeUndefined();
    });

    it('pulses the empty state while a refetch is running', () => {
      const current = jest.mocked(useOffsetPaginatedQuery)(baseTestConfig);
      jest.mocked(useOffsetPaginatedQuery).mockReturnValue({
        ...current,
        data: { ...current.data!, data: [] },
        isPlaceholderData: true,
      });

      const { getByText } = renderWithMantine(
        <DBTableChart config={baseTestConfig} />,
      );
      expect(getByText('No data found within time range.')).toHaveClass(
        'effect-pulse',
      );
    });

    describe('row links', () => {
      const getRowSearchLink = jest.fn(() => '/search');
      const rowAction = jest.fn();

      afterEach(() => {
        jest.mocked(useOnClickLinkBuilder).mockReturnValue(null);
      });

      const renderTable = (isPlaceholderData: boolean) => {
        jest.mocked(useOffsetPaginatedQuery).mockReturnValue({
          ...jest.mocked(useOffsetPaginatedQuery)(baseTestConfig),
          isPlaceholderData,
        });
        renderWithMantine(
          <DBTableChart
            config={baseTestConfig}
            getRowSearchLink={getRowSearchLink}
          />,
        );
        return jest.mocked(Table).mock.calls.at(-1)![0];
      };

      it('disables search links on rows kept from the previous query', () => {
        expect(renderTable(true).getRowSearchLink).toBeUndefined();
      });

      it('enables search links once fresh rows have loaded', () => {
        expect(renderTable(false).getRowSearchLink).toBe(getRowSearchLink);
      });

      it('disables the configured row action on rows kept from the previous query', () => {
        jest.mocked(useOnClickLinkBuilder).mockReturnValue(rowAction);

        expect(renderTable(true).getRowAction).toBeUndefined();
        expect(renderTable(false).getRowAction).toBe(rowAction);
      });
    });
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

  describe('builder output column identifiers', () => {
    const metricBuilderConfig = {
      ...baseTestConfig,
      metricTables: { gauge: 'metrics_gauge' },
      select: [{ aggFn: 'avg' as const, valueExpression: 'metric.total' }],
      formulas: [{ expression: 'A * 2', alias: 'error rate' }],
      groupBy: 'ServiceName',
    };

    beforeEach(() => {
      mockTableRows([
        {
          'avg(metric.total)': 42,
          'error rate': 84,
          ServiceName: 'web',
        },
      ]);
    });

    it('quotes composed metric result keys as output identifiers', () => {
      renderWithMantine(<DBTableChart config={metricBuilderConfig} />);

      const columns = jest.mocked(Table).mock.calls.at(-1)![0].columns;
      expect(
        columns.map(column => ({ id: column.id, dataKey: column.dataKey })),
      ).toEqual([
        { id: '"avg(metric.total)"', dataKey: 'avg(metric.total)' },
        { id: '"error rate"', dataKey: 'error rate' },
        { id: '"ServiceName"', dataKey: 'ServiceName' },
      ]);
    });

    it('uses the output identifier for composed metric sorting', () => {
      renderWithMantine(<DBTableChart config={metricBuilderConfig} />);

      const tableProps = jest.mocked(Table).mock.calls.at(-1)![0];
      act(() => {
        tableProps.onSortingChange?.([
          { id: '"avg(metric.total)"', desc: true },
        ]);
      });

      const queriedConfig = jest
        .mocked(useOffsetPaginatedQuery)
        .mock.calls.at(-1)![0];
      if (!isBuilderChartConfig(queriedConfig)) {
        throw new Error('Expected a builder chart config');
      }
      expect(queriedConfig.orderBy).toEqual([
        {
          valueExpression: '"avg(metric.total)"',
          ordering: 'DESC',
        },
      ]);
    });

    it('keeps single-series metric sorts in the original query scope', () => {
      const config = {
        ...baseTestConfig,
        metricTables: { gauge: 'metrics_gauge' },
        select: [{ aggFn: 'avg' as const, valueExpression: 'metric.total' }],
        groupBy: "ResourceAttributes['service.name']",
      };
      mockTableRows([
        {
          'avg(metric.total)': 42,
          "ResourceAttributes['service.name']": 'api',
        },
      ]);

      renderWithMantine(<DBTableChart config={config} />);

      const tableProps = jest.mocked(Table).mock.calls.at(-1)![0];
      expect(
        tableProps.columns.map(column => ({
          id: column.id,
          dataKey: column.dataKey,
        })),
      ).toEqual([
        { id: 'avg(metric.total)', dataKey: 'avg(metric.total)' },
        {
          id: "ResourceAttributes['service.name']",
          dataKey: "ResourceAttributes['service.name']",
        },
      ]);

      act(() => {
        tableProps.onSortingChange?.([
          { id: 'avg(metric.total)', desc: true },
        ]);
      });
      const queriedConfig = jest
        .mocked(useOffsetPaginatedQuery)
        .mock.calls.at(-1)![0];
      if (!isBuilderChartConfig(queriedConfig)) {
        throw new Error('Expected a builder chart config');
      }
      expect(queriedConfig.orderBy).toEqual([
        {
          valueExpression: 'avg(metric.total)',
          ordering: 'DESC',
        },
      ]);
    });

    it('keeps unaliased non-metric expressions as expressions', () => {
      const config = {
        ...baseTestConfig,
        select: [{ aggFn: 'count' as const, valueExpression: '' }],
        groupBy: "ResourceAttributes['service.name']",
      };
      mockTableRows([
        {
          'count()': 2,
          "ResourceAttributes['service.name']": 'api',
        },
      ]);

      renderWithMantine(<DBTableChart config={config} />);

      const tableProps = jest.mocked(Table).mock.calls.at(-1)![0];
      act(() => {
        tableProps.onSortingChange?.([{ id: 'count()', desc: true }]);
      });
      const queriedConfig = jest
        .mocked(useOffsetPaginatedQuery)
        .mock.calls.at(-1)![0];
      if (!isBuilderChartConfig(queriedConfig)) {
        throw new Error('Expected a builder chart config');
      }
      expect(queriedConfig.orderBy).toEqual([
        {
          valueExpression: 'count()',
          ordering: 'DESC',
        },
      ]);
    });

    it('sorts inline formula outputs by their quoted alias', () => {
      const config = {
        ...baseTestConfig,
        select: [{ aggFn: 'count' as const, valueExpression: '' }],
        formulas: [{ expression: 'A * 2', alias: 'error rate' }],
        groupBy: 'ServiceName',
      };
      mockTableRows([
        {
          'count()': 2,
          'error rate': 4,
          ServiceName: 'api',
        },
      ]);

      renderWithMantine(<DBTableChart config={config} />);

      const tableProps = jest.mocked(Table).mock.calls.at(-1)![0];
      expect(
        tableProps.columns.map(column => ({
          id: column.id,
          dataKey: column.dataKey,
        })),
      ).toEqual([
        { id: 'count()', dataKey: 'count()' },
        { id: '"error rate"', dataKey: 'error rate' },
        { id: 'ServiceName', dataKey: 'ServiceName' },
      ]);

      act(() => {
        tableProps.onSortingChange?.([{ id: '"error rate"', desc: true }]);
      });
      const queriedConfig = jest
        .mocked(useOffsetPaginatedQuery)
        .mock.calls.at(-1)![0];
      if (!isBuilderChartConfig(queriedConfig)) {
        throw new Error('Expected a builder chart config');
      }
      expect(queriedConfig.orderBy).toEqual([
        {
          valueExpression: '"error rate"',
          ordering: 'DESC',
        },
      ]);
    });

    it('normalizes legacy unquoted metric sort state to the column id', () => {
      renderWithMantine(
        <DBTableChart
          config={metricBuilderConfig}
          sort={[{ id: 'avg(metric.total)', desc: true }]}
        />,
      );

      const tableProps = jest.mocked(Table).mock.calls.at(-1)![0];
      expect(tableProps.sorting).toEqual([
        { id: '"avg(metric.total)"', desc: true },
      ]);
      const queriedConfig = jest
        .mocked(useOffsetPaginatedQuery)
        .mock.calls.at(-1)![0];
      if (!isBuilderChartConfig(queriedConfig)) {
        throw new Error('Expected a builder chart config');
      }
      expect(queriedConfig.orderBy).toEqual([
        {
          valueExpression: '"avg(metric.total)"',
          ordering: 'DESC',
        },
      ]);
    });

    it('keeps commas inside metric output identifiers', () => {
      const outputName = 'error, rate';
      const config = {
        ...metricBuilderConfig,
        formulas: [{ expression: 'A * 2', alias: outputName }],
      };
      mockTableRows([{ 'avg(metric.total)': 42, [outputName]: 84 }]);

      renderWithMantine(<DBTableChart config={config} />);

      const tableProps = jest.mocked(Table).mock.calls.at(-1)![0];
      const formulaColumn = tableProps.columns.find(
        column => column.dataKey === outputName,
      );
      expect(formulaColumn?.id).toBe('"error, rate"');

      act(() => {
        tableProps.onSortingChange?.([
          { id: '"error, rate"', desc: true },
        ]);
      });
      const queriedConfig = jest
        .mocked(useOffsetPaginatedQuery)
        .mock.calls.at(-1)![0];
      if (!isBuilderChartConfig(queriedConfig)) {
        throw new Error('Expected a builder chart config');
      }
      expect(queriedConfig.orderBy).toEqual([
        {
          valueExpression: '"error, rate"',
          ordering: 'DESC',
        },
      ]);
    });

    it.each([
      ['bad"name', '"bad""name"'],
      ['ratio\\', '"ratio\\\\"'],
    ])('escapes output identifier %p', (outputName, expectedId) => {
      const config = {
        ...metricBuilderConfig,
        formulas: [{ expression: 'A * 2', alias: outputName }],
      };
      mockTableRows([{ 'avg(metric.total)': 42, [outputName]: 84 }]);

      renderWithMantine(<DBTableChart config={config} />);

      const columns = jest.mocked(Table).mock.calls.at(-1)![0].columns;
      expect(columns.find(column => column.dataKey === outputName)?.id).toBe(
        expectedId,
      );
    });
  });

  describe('alternateRowBackground', () => {
    const builderConfig = {
      ...baseTestConfig,
      select: [
        { aggFn: 'count' as const, valueExpression: '', alias: 'Count' },
      ],
    };

    it('threads alternateRowBackground to the Table for builder configs', () => {
      renderWithMantine(
        <DBTableChart
          config={{ ...builderConfig, alternateRowBackground: true }}
        />,
      );

      expect(
        jest.mocked(Table).mock.calls.at(-1)![0].alternateRowBackground,
      ).toBe(true);
    });

    it('passes alternateRowBackground=false when the builder config omits it', () => {
      renderWithMantine(<DBTableChart config={builderConfig} />);

      expect(
        jest.mocked(Table).mock.calls.at(-1)![0].alternateRowBackground,
      ).toBe(false);
    });

    it('threads alternateRowBackground to the Table for raw SQL configs', () => {
      const rawSqlConfig = {
        configType: 'sql' as const,
        dateRange: [new Date(), new Date()] as [Date, Date],
        connection: 'test-connection',
        sqlTemplate: 'SELECT count() AS Count FROM t',
        alternateRowBackground: true,
      };

      renderWithMantine(<DBTableChart config={rawSqlConfig} />);

      expect(
        jest.mocked(Table).mock.calls.at(-1)![0].alternateRowBackground,
      ).toBe(true);
    });

    it('passes alternateRowBackground=false when a raw SQL config omits it', () => {
      const rawSqlConfig = {
        configType: 'sql' as const,
        dateRange: [new Date(), new Date()] as [Date, Date],
        connection: 'test-connection',
        sqlTemplate: 'SELECT count() AS Count FROM t',
      };

      renderWithMantine(<DBTableChart config={rawSqlConfig} />);

      expect(
        jest.mocked(Table).mock.calls.at(-1)![0].alternateRowBackground,
      ).toBe(false);
    });
  });

  describe('PromQL configs', () => {
    const promqlConfig = {
      configType: 'promql' as const,
      dateRange: [new Date(), new Date()] as [Date, Date],
      connection: 'test-connection',
      promqlExpression: [{ expression: 'up' }],
      numberFormat: { output: 'number' as const },
    };

    const queryResult = (valueType: string) => ({
      data: {
        data: [{ Time: '2023-11-14T22:13:20.000Z', service: 'web', Value: 1 }],
        meta: [
          { name: 'Time', type: 'DateTime64(3)' },
          { name: 'service', type: 'String' },
          { name: 'Value', type: valueType },
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
      isPlaceholderData: false,
      error: null,
    });

    beforeEach(() => {
      jest
        .mocked(useOffsetPaginatedQuery)
        .mockReturnValue(queryResult('Float64'));
    });

    it('queries a range aligned to a resolved granularity', () => {
      renderWithMantine(
        <DBTableChart
          config={{
            ...promqlConfig,
            dateRange: [
              new Date('2025-11-26T00:00:14.076Z'),
              new Date('2025-11-26T01:00:14.076Z'),
            ],
          }}
        />,
      );

      const queried = jest
        .mocked(useOffsetPaginatedQuery)
        .mock.calls.at(-1)![0];
      expect(queried.dateRange).toEqual([
        new Date('2025-11-26T00:00:00Z'),
        new Date('2025-11-26T01:01:00Z'),
      ]);
      expect(queried.granularity).toBe('1 minute');
    });

    it('sorts client-side, since the query cannot be re-ordered server-side', () => {
      renderWithMantine(<DBTableChart config={promqlConfig} />);

      expect(
        jest.mocked(Table).mock.calls.at(-1)![0].enableClientSideSorting,
      ).toBe(true);
    });

    it('formats only the value column, leaving the label columns alone', () => {
      renderWithMantine(<DBTableChart config={promqlConfig} />);

      const columns = jest.mocked(Table).mock.calls.at(-1)![0].columns;
      expect(columns.map(c => [c.dataKey, c.numberFormat?.output])).toEqual([
        ['Time', undefined],
        ['service', undefined],
        ['Value', 'number'],
      ]);
    });

    it('formats a value column of any numeric type', () => {
      jest
        .mocked(useOffsetPaginatedQuery)
        .mockReturnValue(queryResult('Nullable(Float64)'));

      renderWithMantine(<DBTableChart config={promqlConfig} />);

      const columns = jest.mocked(Table).mock.calls.at(-1)![0].columns;
      expect(columns.find(c => c.dataKey === 'Value')?.numberFormat).toEqual({
        output: 'number',
      });
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
