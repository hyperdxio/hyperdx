import { formatDataForHeatmap } from '@/components/DBHeatmapChart';

// CH widthBucket returns buckets 0..nBuckets+1, so each time bucket
// produces nBuckets+2 grid cells.
const N_BUCKETS = 4;
const CELLS_PER_TS = N_BUCKETS + 2;

const T0 = '2026-07-06T00:00:00Z';
const T1 = '2026-07-06T01:00:00Z';

// Linear scale with effectiveMin=0 and max=nBuckets makes
// bucketToYValue(j) === j, so y-values can be asserted directly.
const baseArgs = {
  timestampColumn: { name: '__hdx_time_bucket', type: 'DateTime' },
  generatedTsBuckets: [new Date(T0), new Date(T1)],
  scaleType: 'linear' as const,
  effectiveMin: 0,
  max: N_BUCKETS,
  nBuckets: N_BUCKETS,
};

// UInt64 counts are returned as strings by ClickHouse
const row = (ts: string, xBucket: number, count: string) => ({
  __hdx_time_bucket: ts,
  x_bucket: xBucket,
  count,
});

describe('formatDataForHeatmap', () => {
  it('generates a dense zero-filled grid when there is no data', () => {
    const [time, bucket, count] = formatDataForHeatmap({
      ...baseArgs,
      data: [],
    });

    expect(time).toEqual([
      ...Array(CELLS_PER_TS).fill(new Date(T0).getTime()),
      ...Array(CELLS_PER_TS).fill(new Date(T1).getTime()),
    ]);
    expect(bucket).toEqual([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]);
    expect(count).toEqual(Array(2 * CELLS_PER_TS).fill(0));
  });

  it('places each row count into its (time, x_bucket) cell', () => {
    const [time, bucket, count] = formatDataForHeatmap({
      ...baseArgs,
      data: [row(T0, 1, '5'), row(T0, 3, '2'), row(T1, 0, '7')],
    });

    expect(time).toHaveLength(2 * CELLS_PER_TS);
    expect(bucket).toHaveLength(2 * CELLS_PER_TS);
    // prettier-ignore
    expect(count).toEqual([
      0, 5, 0, 2, 0, 0, // T0
      7, 0, 0, 0, 0, 0, // T1
    ]);
  });

  it('tolerates time buckets with no rows at all', () => {
    const [, , count] = formatDataForHeatmap({
      ...baseArgs,
      data: [row(T1, 2, '9')],
    });

    // prettier-ignore
    expect(count).toEqual([
      0, 0, 0, 0, 0, 0, // T0 (empty)
      0, 0, 9, 0, 0, 0, // T1
    ]);
  });

  // A Distributed table can return the same (time, x_bucket) group more than once.
  // We drop the duplicate row(s). Summing the duplicate groups may not always be correct,
  // since the user sets the aggregation function. This is an unexpected case, so we just
  // want to make the behavior sane.
  it('drops duplicate (time, x_bucket) groups from unmerged distributed results', () => {
    const [time, bucket, count] = formatDataForHeatmap({
      ...baseArgs,
      data: [
        row(T0, 1, '5'),
        row(T0, 1, '3'),
        row(T0, 2, '4'),
        row(T1, 1, '6'),
      ],
    });

    // The grid stays dense — duplicates collapse into their cell
    expect(time).toHaveLength(2 * CELLS_PER_TS);
    expect(bucket).toHaveLength(2 * CELLS_PER_TS);
    // prettier-ignore
    expect(count).toEqual([
      0, 5, 4, 0, 0, 0, // T0: bucket 1 = 5, with the duplicate value
      0, 6, 0, 0, 0, 0, // T1: cells after the duplicate must still render
    ]);
  });
});
