import {
  DisplayType,
  PromqlConfigWithDateRange,
} from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import { useHistogramHeatmapData } from '@/components/DBHeatmapChart/useHistogramHeatmapData';

const mockUseQueriedChartConfig = jest.fn();
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: (...args: unknown[]) =>
    mockUseQueriedChartConfig(...args),
}));

const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-07-06T00:00:00Z').getTime();

const config: PromqlConfigWithDateRange = {
  configType: 'promql',
  displayType: DisplayType.Heatmap,
  promqlExpression: [{ expression: 'sum by (le) (rate(x_bucket[5m]))' }],
  connection: 'test-connection',
  dateRange: [new Date(T0), new Date(T0 + 2 * HOUR)],
  granularity: '1 hour',
  heatmap: { mode: 'histogram' },
};

const row = (t: number, le: string, value: number) => ({
  __hdx_time_bucket: new Date(t).toISOString(),
  le,
  value,
});

describe('useHistogramHeatmapData', () => {
  beforeEach(() => {
    mockUseQueriedChartConfig.mockReset();
  });

  it('draws a row per bucket from the queried rows', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: {
        data: [
          row(T0, '0.5', 2),
          row(T0, '+Inf', 3),
          row(T0 + HOUR, '0.5', 1),
          row(T0 + HOUR, '+Inf', 5),
        ],
      },
      isLoading: false,
      isPlaceholderData: false,
      error: null,
    });
    const { result } = renderHook(() =>
      useHistogramHeatmapData({ config, enabled: true }),
    );

    const { grid } = result.current.view;
    expect(grid.yAxis).toEqual({ type: 'buckets', bounds: [0.5, Infinity] });
    expect(grid.times.slice(0, 2)).toEqual([T0, T0 + HOUR]);
    expect(grid.cells.slice(0, 4)).toEqual([2, 1, 1, 4]);
  });

  it('passes the query error through', () => {
    const error = new Error('Several series share le="0.5"');
    mockUseQueriedChartConfig.mockReturnValue({
      data: undefined,
      isLoading: false,
      isPlaceholderData: false,
      error,
    });
    const { result } = renderHook(() =>
      useHistogramHeatmapData({ config, enabled: true }),
    );
    expect(result.current.error).toBe(error);
  });
});
