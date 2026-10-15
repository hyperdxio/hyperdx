import { queryDistributionHeatmap } from '@/core/distributionHeatmap';
import {
  heatmapBucketEdges,
  resolveDistributionGranularity,
} from '@/core/heatmap';
import { timeBucketByGranularity } from '@/core/utils';
import { DisplayType } from '@/types';

const dateRange: [Date, Date] = [
  new Date('2026-10-13T00:00:00Z'),
  new Date('2026-10-13T00:02:00Z'),
];
const config = {
  displayType: DisplayType.Heatmap,
  select: [{ aggFn: 'count' as const, valueExpression: 'Duration' }],
  from: { databaseName: 'default', tableName: 'otel_traces' },
  where: '',
  timestampValueExpression: 'Timestamp',
  connection: 'c1',
  dateRange,
};

function fakeClient(
  bounds: Record<string, string>,
  buckets: Record<string, string>[],
) {
  const queryChartConfig = jest
    .fn()
    .mockResolvedValueOnce({ meta: [], data: [bounds] })
    .mockResolvedValueOnce({
      meta: [
        { name: '__hdx_time_bucket', type: 'DateTime' },
        { name: 'x_bucket', type: 'UInt32' },
        { name: 'count', type: 'UInt64' },
      ],
      data: buckets,
    });
  return { queryChartConfig };
}

const run = (client: ReturnType<typeof fakeClient>, granularity = '1 minute') =>
  queryDistributionHeatmap({
    client,
    metadata: {} as never,
    config,
    granularity,
    targetTimeBuckets: 48,
    nBuckets: 4,
    querySettings: undefined,
  });

describe('queryDistributionHeatmap', () => {
  it('buckets between the bounds query result and shapes a grid', async () => {
    const client = fakeClient({ min: '10', max: '1000' }, [
      { __hdx_time_bucket: '2026-10-13T00:00:00Z', x_bucket: '1', count: '7' },
      { __hdx_time_bucket: '2026-10-13T00:01:00Z', x_bucket: '4', count: '3' },
    ]);
    const { heatmap } = await run(client);

    const bucketQuery = client.queryChartConfig.mock.calls[1][0].config;
    expect(JSON.stringify(bucketQuery)).toContain('widthBucket(');
    expect(heatmap?.scaleType).toBe('log');
    expect(heatmap?.grid.times).toHaveLength(2);
    // nBuckets + under/overflow rows per time bucket
    expect(heatmap?.grid.cells).toEqual([0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0]);
    expect(heatmap?.bucketEdges[0]).toBeCloseTo(10);
    expect(heatmap?.bucketEdges.at(-1)).toBeCloseTo(1000);
  });

  it('skips the bucket query when the range has no spread', async () => {
    const client = fakeClient({ min: '5', max: '5' }, []);
    const result = await run(client);
    expect(result.heatmap).toBeUndefined();
    expect(client.queryChartConfig).toHaveBeenCalledTimes(1);
  });

  it('replaces an unsupported granularity instead of looping on it', async () => {
    const client = fakeClient({ min: '5', max: '5' }, []);
    const result = await run(client, '1 week');
    expect(result.granularity).not.toBe('1 week');
    expect(result.granularityNote).toContain('not supported');
  });
});

describe('resolveDistributionGranularity', () => {
  const day: [Date, Date] = [
    new Date('2026-10-13T00:00:00Z'),
    new Date('2026-10-14T00:00:00Z'),
  ];

  it('keeps a supported granularity that fits the bucket budget', () => {
    expect(resolveDistributionGranularity('1 hour', day, 48)).toEqual({
      granularity: '1 hour',
    });
  });

  it('coarsens a granularity that would flood the grid', () => {
    const { granularity, note } = resolveDistributionGranularity(
      '1 second',
      day,
      48,
    );
    expect(granularity).not.toBe('1 second');
    expect(note).toContain('86400 time buckets');
  });
});

describe('heatmapBucketEdges', () => {
  it('returns the widthBucket bounds, not the half-bucket display edges', () => {
    expect(heatmapBucketEdges('linear', 0, 100, 4)).toEqual([
      0, 25, 50, 75, 100,
    ]);
  });
});

describe('timeBucketByGranularity', () => {
  it('returns no buckets for a unit it cannot step by', () => {
    expect(
      timeBucketByGranularity(dateRange[0], dateRange[1], '1 week' as never),
    ).toEqual([]);
  });
});
