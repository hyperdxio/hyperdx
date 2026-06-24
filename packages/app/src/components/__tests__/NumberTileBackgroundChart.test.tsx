import React from 'react';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import NumberTileBackgroundChart, {
  buildSparklineTimeConfig,
  sparklinePointsFromGraphResults,
} from '@/components/NumberTileBackgroundChart';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useSource } from '@/source';

jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: jest.fn(),
}));

jest.mock('@/source', () => ({
  useSource: jest.fn(),
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

describe('buildSparklineTimeConfig', () => {
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
    const result = buildSparklineTimeConfig({
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

  it("defaults granularity to 'auto' when the tile has none", () => {
    const result = buildSparklineTimeConfig(baseConfig);
    expect(result.granularity).toBe('auto');
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
    const queriedConfig = mockUseQueriedChartConfig.mock.calls[0][0];
    expect(queriedConfig).not.toHaveProperty('groupBy');
  });
});
