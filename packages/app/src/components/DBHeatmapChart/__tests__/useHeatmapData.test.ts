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
  const lastQuery = (key: string) =>
    mockUseQueriedChartConfig.mock.calls
      .filter(([, options]) => options?.queryKey?.[0] === key)
      .at(-1)?.[0];
  return {
    view: result.current.view,
    boundsQuery: lastQuery('heatmap'),
    bucketQuery: lastQuery('heatmap_bucket'),
  };
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

  it.each([undefined, 'auto' as const])(
    'buckets the inner bounds query of an aggregate value when granularity is %s',
    granularity => {
      const { boundsQuery } = renderDistributionHeatmap({
        ...traceConfig,
        select: [
          {
            aggFn: 'count',
            aggCondition: '',
            valueExpression: 'sum(Duration)',
          },
        ],
        granularity,
      });

      expect(boundsQuery.timestampValueExpression).toBe('__hdx_time_bucket');
      expect(boundsQuery.with[0].chartConfig.granularity).toBe('30 second');
    },
  );

  it('aligns only the bucket-label filter of an aggregate value', () => {
    const dateRange: [Date, Date] = [
      new Date(T0 + 5 * 60 * 1000),
      new Date(T0 + HOUR + 20 * 60 * 1000),
    ];
    const { boundsQuery, bucketQuery } = renderDistributionHeatmap({
      ...traceConfig,
      select: [
        { aggFn: 'count', aggCondition: '', valueExpression: 'avg(Duration)' },
      ],
      dateRange,
      granularity: '1 hour',
    });

    for (const query of [boundsQuery, bucketQuery]) {
      expect(query.dateRange).toEqual([new Date(T0), new Date(T0 + 2 * HOUR)]);
      expect(query.with[0].chartConfig.dateRange).toEqual(dateRange);
    }
  });

  it('keeps the original range for a non-aggregate value', () => {
    const dateRange: [Date, Date] = [
      new Date(T0 + 5 * 60 * 1000),
      new Date(T0 + HOUR + 20 * 60 * 1000),
    ];
    const { boundsQuery, bucketQuery } = renderDistributionHeatmap({
      ...traceConfig,
      dateRange,
      granularity: '1 hour',
    });

    expect(boundsQuery.dateRange).toEqual(dateRange);
    expect(bucketQuery.dateRange).toEqual(dateRange);
  });
});
