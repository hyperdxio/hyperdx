import {
  BuilderChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import { toHeatmapQuery } from '@/components/DBHeatmapChart/heatmapQueries';
import { useHeatmapData } from '@/components/DBHeatmapChart/useHeatmapData';

const mockUseQueriedChartConfig = jest.fn();
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: (...args: unknown[]) =>
    mockUseQueriedChartConfig(...args),
}));

const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-07-06T00:00:00Z').getTime();

const traceConfig: BuilderChartConfigWithDateRange = {
  displayType: DisplayType.Heatmap,
  select: [{ aggFn: 'count', aggCondition: '', valueExpression: 'Duration' }],
  from: { databaseName: 'default', tableName: 'otel_traces' },
  where: '',
  dateRange: [new Date(T0), new Date(T0 + 2 * HOUR)],
  granularity: 'auto',
  timestampValueExpression: 'Timestamp',
  connection: 'test-connection',
};

function renderDistributionHeatmap(config: BuilderChartConfigWithDateRange) {
  const query = toHeatmapQuery(config);
  if (query.mode !== 'distribution') throw new Error('Expected distribution');
  const { result } = renderHook(() =>
    useHeatmapData({
      config: query.config,
      scaleType: query.scaleType,
      enabled: true,
    }),
  );
  const bucketQuery = mockUseQueriedChartConfig.mock.calls
    .filter(([, options]) => options?.queryKey?.[0] === 'heatmap_bucket')
    .at(-1)?.[0];
  return { view: result.current.view, bucketQuery };
}

describe('useHeatmapData', () => {
  beforeEach(() => {
    mockUseQueriedChartConfig.mockReset();
    mockUseQueriedChartConfig.mockReturnValue({
      data: { data: [{ min: '1', max: '100' }], meta: [] },
      isLoading: false,
      isPlaceholderData: false,
      error: null,
    });
  });

  it('buckets at an explicit granularity', () => {
    const { view, bucketQuery } = renderDistributionHeatmap({
      ...traceConfig,
      granularity: '15 minute',
    });

    expect(bucketQuery.granularity).toBe('15 minute');
    expect(view.generatedTsBuckets).toHaveLength(8);
  });

  it("ignores the source's minimum granularity", () => {
    const { bucketQuery } = renderDistributionHeatmap({
      ...traceConfig,
      minGranularitySeconds: 300,
    });

    expect(bucketQuery.granularity).toBe('30 second');
  });
});
