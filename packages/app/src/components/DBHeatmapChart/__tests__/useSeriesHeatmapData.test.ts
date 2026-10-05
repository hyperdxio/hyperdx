import {
  BuilderChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import { useSeriesHeatmapData } from '@/components/DBHeatmapChart/useSeriesHeatmapData';

const mockUseQueriedChartConfig = jest.fn();
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: (...args: unknown[]) =>
    mockUseQueriedChartConfig(...args),
}));

const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-07-06T00:00:00Z').getTime();
const dateRange: [Date, Date] = [new Date(T0), new Date(T0 + 2 * HOUR)];

const seriesConfig: BuilderChartConfigWithDateRange = {
  displayType: DisplayType.Heatmap,
  select: [{ aggFn: 'count', aggCondition: '', valueExpression: '' }],
  groupBy: 'ServiceName',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  where: '',
  dateRange,
  granularity: 'auto',
  timestampValueExpression: 'Timestamp',
  connection: 'test-connection',
};

const seriesResponse = {
  meta: [
    { name: '__hdx_time_bucket', type: 'DateTime' },
    { name: 'count()', type: 'UInt64' },
    { name: 'ServiceName', type: 'String' },
  ],
  data: [
    {
      __hdx_time_bucket: new Date(T0).toISOString(),
      'count()': '4',
      ServiceName: 'web',
    },
    {
      __hdx_time_bucket: new Date(T0).toISOString(),
      'count()': '1',
      ServiceName: 'api',
    },
    {
      __hdx_time_bucket: new Date(T0 + HOUR).toISOString(),
      'count()': '2',
      ServiceName: 'api',
    },
  ],
};

function mockSeriesQuery(response = seriesResponse) {
  mockUseQueriedChartConfig.mockImplementation((_config, options) =>
    options?.queryKey?.[0] === 'heatmap_series'
      ? {
          data: response,
          isLoading: false,
          isPlaceholderData: false,
          error: null,
        }
      : {
          data: undefined,
          isLoading: false,
          isPlaceholderData: false,
          error: null,
        },
  );
}

const optionsFor = (queryName: string) =>
  mockUseQueriedChartConfig.mock.calls
    .filter(([, options]) => options?.queryKey?.[0] === queryName)
    .at(-1);

describe('useSeriesHeatmapData', () => {
  beforeEach(() => {
    mockUseQueriedChartConfig.mockReset();
  });

  it('builds one row per series', () => {
    mockSeriesQuery();
    const { result } = renderHook(() =>
      useSeriesHeatmapData({ config: seriesConfig, enabled: true }),
    );

    const { grid, generatedTsBuckets } = result.current.view;
    const times = generatedTsBuckets.map(d => d.getTime());
    const t1 = times.indexOf(T0 + HOUR);
    expect(grid.yAxis).toEqual({ type: 'series', labels: ['web', 'api'] });
    expect(grid.cells.slice(0, 2)).toEqual([4, 1]);
    expect(grid.cells.slice(t1 * 2, t1 * 2 + 2)).toEqual([0, 2]);
    expect(optionsFor('heatmap_series')?.[1].enabled).toBe(true);
  });

  it('queries select[0] with the group by, bucketed at the heatmap granularity', () => {
    mockSeriesQuery();
    const { result } = renderHook(() =>
      useSeriesHeatmapData({ config: seriesConfig, enabled: true }),
    );

    const [queried] = optionsFor('heatmap_series')!;
    const { generatedTsBuckets } = result.current.view;
    const stepSeconds =
      (generatedTsBuckets[1].getTime() - generatedTsBuckets[0].getTime()) /
      1000;
    expect(queried).toMatchObject({
      select: seriesConfig.select,
      groupBy: 'ServiceName',
    });
    expect(queried.granularity).toBe(`${stepSeconds} second`);
  });

  it('keeps the 50 series with the largest peaks', () => {
    mockSeriesQuery({
      ...seriesResponse,
      data: Array.from({ length: 51 }, (_, i) => ({
        __hdx_time_bucket: new Date(T0).toISOString(),
        'count()': String(i + 1),
        ServiceName: `service-${i}`,
      })),
    });
    const { result } = renderHook(() =>
      useSeriesHeatmapData({ config: seriesConfig, enabled: true }),
    );

    const { grid, hiddenSeriesCount } = result.current.view;
    expect(grid.yAxis.type === 'series' && grid.yAxis.labels).toHaveLength(50);
    expect(grid.yAxis.type === 'series' && grid.yAxis.labels).not.toContain(
      'service-0',
    );
    expect(hiddenSeriesCount).toBe(1);
  });

  it('ignores a series limit carried over from another chart type', () => {
    mockSeriesQuery();
    const { result } = renderHook(() =>
      useSeriesHeatmapData({
        config: { ...seriesConfig, seriesLimit: 1 },
        enabled: true,
      }),
    );

    expect(result.current.view.grid.yAxis).toEqual({
      type: 'series',
      labels: ['web', 'api'],
    });
    expect(optionsFor('heatmap_series')![0].seriesLimit).toBeUndefined();
  });

  it('surfaces a response it cannot read as an error', () => {
    mockSeriesQuery({ meta: [], data: [] });
    const { result } = renderHook(() =>
      useSeriesHeatmapData({ config: seriesConfig, enabled: true }),
    );

    expect(result.current.error).toBeInstanceOf(Error);
  });
});
