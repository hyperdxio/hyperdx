import {
  DisplayType,
  PromqlConfigWithDateRange,
} from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import { useCalculatedHeatmapData } from '@/components/DBHeatmapChart/useCalculatedHeatmapData';
import { useSeriesHeatmapData } from '@/components/DBHeatmapChart/useSeriesHeatmapData';

const mockUseQueriedChartConfig = jest.fn();
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: (...args: unknown[]) =>
    mockUseQueriedChartConfig(...args),
}));

const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-07-06T00:00:00Z').getTime();
const dateRange: [Date, Date] = [new Date(T0), new Date(T0 + 2 * HOUR)];

const config: PromqlConfigWithDateRange = {
  configType: 'promql',
  displayType: DisplayType.Heatmap,
  promqlExpression: [{ expression: 'up' }],
  connection: 'test-connection',
  dateRange,
  granularity: 'auto',
};

const meta = [
  { name: '__hdx_time_bucket', type: 'DateTime64(3)' },
  { name: 'value', type: 'Float64' },
  { name: 'series_name', type: 'String' },
];

function mockResponse(data: Record<string, unknown>[]) {
  mockUseQueriedChartConfig.mockReturnValue({
    data: { meta, data },
    isLoading: false,
    isPlaceholderData: false,
    error: null,
  });
}

const row = (t: number, value: number, series_name: string) => ({
  __hdx_time_bucket: new Date(t).toISOString(),
  value,
  series_name,
});

describe('useCalculatedHeatmapData', () => {
  beforeEach(() => {
    mockUseQueriedChartConfig.mockReset();
  });

  it('counts the series samples in each time column and value bucket', () => {
    mockResponse([row(T0, 0, 'a'), row(T0, 5, 'b'), row(T0 + HOUR, 95, 'a')]);
    const { result } = renderHook(() =>
      useCalculatedHeatmapData({ config, scaleType: 'linear', enabled: true }),
    );

    const { grid, generatedTsBuckets } = result.current.view;
    const t1 = generatedTsBuckets.map(d => d.getTime()).indexOf(T0 + HOUR);
    expect(grid.yAxis).toMatchObject({ type: 'numeric', scale: 'linear' });
    const rows = 10;
    expect(grid.cells.slice(0, rows)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(grid.cells.slice(t1 * rows, t1 * rows + rows)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
  });

  it('counts every series', () => {
    mockResponse(
      Array.from({ length: 60 }, (_, i) => row(T0, 1, `series-${i}`)),
    );
    const { result } = renderHook(() =>
      useCalculatedHeatmapData({ config, scaleType: 'linear', enabled: true }),
    );

    expect(result.current.view.grid.cells[0]).toBe(60);
    expect(result.current.view.hiddenSeriesCount).toBe(0);
  });

  it('re-buckets a scale change without changing the query', () => {
    mockResponse([row(T0, 1, 'a'), row(T0, 100, 'b')]);
    const { result, rerender } = renderHook(
      ({ scaleType }: { scaleType: 'linear' | 'log' }) =>
        useCalculatedHeatmapData({
          config: { ...config, heatmap: { scaleType } },
          scaleType,
          enabled: true,
        }),
      { initialProps: { scaleType: 'linear' } },
    );
    const [linearQuery] = mockUseQueriedChartConfig.mock.calls.at(-1)!;

    rerender({ scaleType: 'log' });

    const [logQuery] = mockUseQueriedChartConfig.mock.calls.at(-1)!;
    expect(logQuery).toEqual(linearQuery);
    expect(result.current.view.grid.yAxis).toMatchObject({
      type: 'numeric',
      scale: 'log',
    });
  });

  it('shares its query with a series heatmap of the same expression', () => {
    mockResponse([]);
    renderHook(() =>
      useCalculatedHeatmapData({ config, scaleType: 'linear', enabled: true }),
    );
    const [, calculatedOptions] = mockUseQueriedChartConfig.mock.calls.at(-1)!;

    renderHook(() =>
      useSeriesHeatmapData({
        config: { ...config, heatmap: { mode: 'series' } },
        enabled: true,
      }),
    );
    const [, seriesOptions] = mockUseQueriedChartConfig.mock.calls.at(-1)!;

    expect(seriesOptions.queryKey).toEqual(calculatedOptions.queryKey);
  });
});
