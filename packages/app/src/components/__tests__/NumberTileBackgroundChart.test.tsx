import React from 'react';
import { DisplayType, PromqlReducer } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';

import { convertToPromqlNumberChartConfig } from '@/ChartUtils';
import NumberTileBackgroundChart, {
  buildSparklineQueryConfig,
  sparklinePointsFromGraphResults,
} from '@/components/NumberTileBackgroundChart';
import { Sparkline } from '@/components/Sparkline';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useSource } from '@/source';

jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: jest.fn(),
  getMinGranularitySeconds: jest.fn().mockReturnValue(undefined),
}));

jest.mock('@/source', () => ({
  useSource: jest.fn(),
}));

jest.mock('../Sparkline', () => ({
  Sparkline: jest.fn(() => <div data-testid="sparkline" />),
}));

describe('sparklinePointsFromGraphResults', () => {
  const ts = '__hdx_time_bucket';
  const value = 'Count';

  it('maps graph results to ordered {x, y} points', () => {
    const graphResults = [
      { [ts]: 100, [value]: 5 },
      { [ts]: 200, [value]: 8 },
      { [ts]: 300, [value]: 3 },
    ];
    expect(sparklinePointsFromGraphResults(graphResults, ts, value)).toEqual([
      { x: 100, y: 5 },
      { x: 200, y: 8 },
      { x: 300, y: 3 },
    ]);
  });

  it('returns an empty array when the timestamp key is missing', () => {
    const graphResults = [{ [ts]: 100, [value]: 5 }];
    expect(
      sparklinePointsFromGraphResults(graphResults, undefined, value),
    ).toEqual([]);
  });

  it('returns an empty array when the value key is missing', () => {
    const graphResults = [{ [ts]: 100, [value]: 5 }];
    expect(
      sparklinePointsFromGraphResults(graphResults, ts, undefined),
    ).toEqual([]);
  });

  it('skips rows with non-finite or absent values', () => {
    const graphResults = [
      { [ts]: 100, [value]: 5 },
      { [ts]: 200, [value]: Number.NaN },
      { [ts]: 300 },
      { [ts]: 400, [value]: 9 },
    ];
    expect(sparklinePointsFromGraphResults(graphResults, ts, value)).toEqual([
      { x: 100, y: 5 },
      { x: 400, y: 9 },
    ]);
  });

  it('skips rows with a non-finite timestamp', () => {
    const graphResults = [
      { [ts]: Number.NaN, [value]: 5 },
      { [ts]: Number.POSITIVE_INFINITY, [value]: 6 },
      { [ts]: 300, [value]: 9 },
    ];
    expect(sparklinePointsFromGraphResults(graphResults, ts, value)).toEqual([
      { x: 300, y: 9 },
    ]);
  });
});

describe('buildSparklineQueryConfig', () => {
  const baseConfig = {
    dateRange: [
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-01T01:00:00Z'),
    ] as [Date, Date],
    from: { databaseName: 'test', tableName: 'test' },
    timestampValueExpression: 'timestamp',
    connection: 'test-connection',
    select: '',
    where: '',
  };

  it('drops groupBy and the display-only fields, keeps granularity, and forces a Line display type', () => {
    const result = buildSparklineQueryConfig({
      ...baseConfig,
      granularity: '5 minute',
      groupBy: 'ServiceName',
      backgroundChart: { type: 'area' as const },
      color: 'chart-success' as const,
      colorRules: [
        { operator: 'gte' as const, value: 1, color: 'chart-error' as const },
      ],
      numberFormat: { output: 'percent' as const, mantissa: 2 },
    });

    expect(result).not.toHaveProperty('groupBy');
    expect(result).not.toHaveProperty('backgroundChart');
    expect(result).not.toHaveProperty('color');
    expect(result).not.toHaveProperty('colorRules');
    expect(result).not.toHaveProperty('numberFormat');
    expect(result.granularity).toBe('5 minute');
    expect(result.displayType).toBe(DisplayType.Line);
  });

  // Naming no reducer is what leaves the shared response unreduced, so this
  // observer plots the buckets the number was reduced from.
  it("shares a promql tile's query, naming no reducer", () => {
    const promqlConfig = {
      configType: 'promql' as const,
      displayType: DisplayType.Number,
      connection: 'test-connection',
      dateRange: baseConfig.dateRange,
      promqlExpression: [
        {
          expression: 'up',
          queryType: 'range' as const,
          reducer: PromqlReducer.Max,
        },
      ],
    };

    expect(buildSparklineQueryConfig(promqlConfig)).toEqual(
      convertToPromqlNumberChartConfig(promqlConfig, { withReducer: false }),
    );
  });

  it('resolves an absent granularity, so the samples land on the grid', () => {
    const result = buildSparklineQueryConfig(baseConfig);
    expect(result.granularity).not.toBe('auto');
    expect(result.granularity).toBeDefined();
    expect(result.displayType).toBe(DisplayType.Line);
  });
});

describe('NumberTileBackgroundChart', () => {
  const mockUseQueriedChartConfig = useQueriedChartConfig as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseQueriedChartConfig.mockReturnValue({ data: undefined });
    (useSource as jest.Mock).mockReturnValue({ data: null });
  });

  it('strips groupBy from the issued query so the sparkline matches the single displayed aggregate', () => {
    const config = {
      dateRange: [
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T01:00:00Z'),
      ] as [Date, Date],
      from: { databaseName: 'test', tableName: 'test' },
      timestampValueExpression: 'timestamp',
      connection: 'test-connection',
      select: '',
      where: '',
      groupBy: 'ServiceName',
      backgroundChart: { type: 'area' as const },
    };

    renderWithMantine(
      <NumberTileBackgroundChart
        config={config}
        backgroundChart={{ type: 'area' }}
      />,
    );

    expect(mockUseQueriedChartConfig).toHaveBeenCalled();
    const [queriedConfig, options] = mockUseQueriedChartConfig.mock.calls[0];
    expect(queriedConfig).not.toHaveProperty('groupBy');
    // A builder tile has no query to share with its value, so it keeps its own
    // namespaced key rather than the one the hook builds.
    expect(options.queryKey).toEqual(['number-tile-background', queriedConfig]);
  });

  it('issues no query while the tile is disabled', () => {
    renderWithMantine(
      <NumberTileBackgroundChart
        config={{
          dateRange: [
            new Date('2024-01-01T00:00:00Z'),
            new Date('2024-01-01T01:00:00Z'),
          ] as [Date, Date],
          from: { databaseName: 'test', tableName: 'test' },
          timestampValueExpression: 'timestamp',
          connection: 'test-connection',
          select: '',
          where: '',
        }}
        backgroundChart={{ type: 'area' }}
        enabled={false}
      />,
    );

    const [, options] = mockUseQueriedChartConfig.mock.calls[0];
    expect(options.enabled).toBe(false);
  });

  it("scopes a builder tile's own key with the prefix, when given one", () => {
    renderWithMantine(
      <NumberTileBackgroundChart
        config={{
          dateRange: [
            new Date('2024-01-01T00:00:00Z'),
            new Date('2024-01-01T01:00:00Z'),
          ] as [Date, Date],
          from: { databaseName: 'test', tableName: 'test' },
          timestampValueExpression: 'timestamp',
          connection: 'test-connection',
          select: '',
          where: '',
        }}
        backgroundChart={{ type: 'area' }}
        queryKeyPrefix="tile-1"
      />,
    );

    const [queriedConfig, options] = mockUseQueriedChartConfig.mock.calls[0];
    expect(options.queryKey).toEqual([
      'tile-1',
      'number-tile-background',
      queriedConfig,
    ]);
  });

  describe('promql configs', () => {
    const promqlConfig = {
      configType: 'promql' as const,
      displayType: DisplayType.Number,
      promqlExpression: [
        { expression: 'e2e_service_up', queryType: 'range' as const },
      ],
      connection: 'test-connection',
      granularity: '1 minute' as const,
      dateRange: [
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T00:10:00Z'),
      ] as [Date, Date],
      backgroundChart: { type: 'area' as const },
    };

    const sampleRows = (
      values: number[],
      startDate: Date,
      stepSeconds: number,
    ) => ({
      data: values.map((value, index) => ({
        __hdx_time_bucket: new Date(
          startDate.getTime() + index * stepSeconds * 1000,
        ).toISOString(),
        value,
        series_name: 'up',
      })),
      meta: [
        { name: '__hdx_time_bucket', type: 'DateTime64(3)' },
        { name: 'value', type: 'Float64' },
        { name: 'series_name', type: 'String' },
      ],
      rows: values.length,
      isComplete: true,
    });

    // Prometheus answers a range query at `start + k * step`. Aligning the
    // range and resolving the granularity is what puts those samples on the
    // same grid the empty-bucket filler generates; querying the tile's own
    // unaligned range instead would interleave a zero between every sample and
    // draw a sawtooth.
    it('queries a granularity-aligned range', () => {
      renderWithMantine(
        <NumberTileBackgroundChart
          config={{
            ...promqlConfig,
            dateRange: [
              new Date('2024-01-01T00:00:14.076Z'),
              new Date('2024-01-01T00:10:14.076Z'),
            ],
          }}
          backgroundChart={{ type: 'area' }}
        />,
      );

      const queriedConfig = mockUseQueriedChartConfig.mock.calls[0][0];
      expect(queriedConfig.dateRange).toEqual([
        new Date('2024-01-01T00:00:00Z'),
        new Date('2024-01-01T00:11:00Z'),
      ]);
      expect(queriedConfig.granularity).toBe('1 minute');
    });

    it('plots one point per sample, with no zeros between them', () => {
      const values = [1, 1.2, 1.1, 1.3, 1.25, 1.4, 1.35, 1.5, 1.45, 1.6, 1.55];
      mockUseQueriedChartConfig.mockReturnValue({
        data: sampleRows(values, promqlConfig.dateRange[0], 60),
      });

      renderWithMantine(
        <NumberTileBackgroundChart
          config={promqlConfig}
          backgroundChart={{ type: 'area' }}
        />,
      );

      const { points } = jest.mocked(Sparkline).mock.calls[0][0];
      expect(points.map(({ y }) => y)).toEqual(values);
    });

    // The value's query differs only in the reducer, which the hook keeps out
    // of the key it builds -- so replacing that key would split the two apart.
    it('leaves the key to the hook, which the value shares', () => {
      renderWithMantine(
        <NumberTileBackgroundChart
          config={promqlConfig}
          backgroundChart={{ type: 'area' }}
        />,
      );

      const [, options] = mockUseQueriedChartConfig.mock.calls[0];
      expect(options).not.toHaveProperty('queryKey');
    });

    // A number evaluates only its first expression, but a leftover row would
    // otherwise be queried and plotted alongside it.
    it('queries only the expression the number came from', () => {
      renderWithMantine(
        <NumberTileBackgroundChart
          config={{
            ...promqlConfig,
            promqlExpression: [
              { expression: 'e2e_service_up', queryType: 'range' as const },
              { expression: 'e2e_requests_total', queryType: 'range' as const },
            ],
          }}
          backgroundChart={{ type: 'area' }}
        />,
      );

      const queriedConfig = mockUseQueriedChartConfig.mock.calls[0][0];
      expect(queriedConfig.promqlExpression).toEqual([
        { expression: 'e2e_service_up', queryType: 'range' },
      ]);
    });

    // An instant query answers with a single point, so there is no trend.
    it('renders nothing, and queries nothing, for an instant tile', () => {
      renderWithMantine(
        <NumberTileBackgroundChart
          config={{
            ...promqlConfig,
            promqlExpression: [
              { expression: 'e2e_service_up', queryType: 'instant' as const },
            ],
          }}
          backgroundChart={{ type: 'area' }}
        />,
      );

      expect(mockUseQueriedChartConfig).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId('number-tile-background-chart'),
      ).not.toBeInTheDocument();
    });
  });
});
