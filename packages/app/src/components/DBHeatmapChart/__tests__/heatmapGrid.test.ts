import {
  computeBucketPercentiles,
  gridFromBucketRows,
  gridToPlotData,
  HeatmapGrid,
  rowPlotBounds,
} from '@/components/DBHeatmapChart/heatmapGrid';

// CH widthBucket returns buckets 0..nBuckets+1, so each time bucket
// produces nBuckets+2 grid cells.
const N_BUCKETS = 4;
const CELLS_PER_TS = N_BUCKETS + 2;

const T0 = '2026-07-06T00:00:00Z';
const T1 = '2026-07-06T01:00:00Z';

// Linear scale with effectiveMin=0 and max=nBuckets centers row j on y=j,
// so y-values can be asserted directly.
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

describe('gridFromBucketRows', () => {
  it('generates a dense zero-filled grid when there is no data', () => {
    const grid = gridFromBucketRows({ ...baseArgs, data: [] });

    expect(grid.times).toEqual([
      new Date(T0).getTime(),
      new Date(T1).getTime(),
    ]);
    expect(grid.stepMs).toBe(60 * 60 * 1000);
    expect(grid.yAxis).toEqual({
      type: 'numeric',
      scale: 'linear',
      edges: [-0.5, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5],
    });
    expect(grid.cells).toEqual(Array(2 * CELLS_PER_TS).fill(0));
  });

  it('places each row count into its (time, x_bucket) cell', () => {
    const { cells } = gridFromBucketRows({
      ...baseArgs,
      data: [row(T0, 1, '5'), row(T0, 3, '2'), row(T1, 0, '7')],
    });

    // prettier-ignore
    expect(cells).toEqual([
      0, 5, 0, 2, 0, 0, // T0
      7, 0, 0, 0, 0, 0, // T1
    ]);
  });

  it('tolerates time buckets with no rows at all', () => {
    const { cells } = gridFromBucketRows({
      ...baseArgs,
      data: [row(T1, 2, '9')],
    });

    // prettier-ignore
    expect(cells).toEqual([
      0, 0, 0, 0, 0, 0, // T0 (empty)
      0, 0, 9, 0, 0, 0, // T1
    ]);
  });

  // A Distributed table can return the same (time, x_bucket) group more than once.
  // We drop the duplicate row(s). Summing the duplicate groups may not always be correct,
  // since the user sets the aggregation function. This is an unexpected case, so we just
  // want to make the behavior sane.
  it('drops duplicate (time, x_bucket) groups from unmerged distributed results', () => {
    const { cells } = gridFromBucketRows({
      ...baseArgs,
      data: [
        row(T0, 1, '5'),
        row(T0, 1, '3'),
        row(T0, 2, '4'),
        row(T1, 1, '6'),
      ],
    });

    // The grid stays dense — duplicates collapse into their cell
    // prettier-ignore
    expect(cells).toEqual([
      0, 5, 4, 0, 0, 0, // T0: bucket 1 = 5, with the duplicate value
      0, 6, 0, 0, 0, 0, // T1: cells after the duplicate must still render
    ]);
  });

  it('centers log-scale rows on evenly spaced log values', () => {
    const grid = gridFromBucketRows({
      ...baseArgs,
      scaleType: 'log',
      effectiveMin: 1,
      max: 10_000,
      data: [],
    });

    expect(grid.yAxis).toMatchObject({ type: 'numeric', scale: 'log' });
    const [, ys] = gridToPlotData(grid);
    // Row j sits on log(10^j): the upper bound of widthBucket's bucket j
    for (let j = 0; j < CELLS_PER_TS; j++) {
      expect(ys[j]).toBeCloseTo(Math.log(10 ** j));
    }
  });

  it('falls back to linear rows when the log range is unusable', () => {
    const grid = gridFromBucketRows({
      ...baseArgs,
      scaleType: 'log',
      effectiveMin: 0,
      data: [],
    });

    expect(grid.yAxis).toMatchObject({ scale: 'linear' });
  });
});

const grid = (overrides: Partial<HeatmapGrid>): HeatmapGrid => ({
  times: [1000, 2000],
  stepMs: 1000,
  yAxis: { type: 'numeric', scale: 'linear', edges: [0, 1, 3] },
  cells: [1, 2, 3, 4],
  ...overrides,
});

describe('rowPlotBounds', () => {
  it('keeps uneven linear rows as-is', () => {
    expect(rowPlotBounds(grid({}).yAxis)).toEqual({ lo: [0, 1], hi: [1, 3] });
  });

  it('plots log rows in natural-log space', () => {
    const { lo, hi } = rowPlotBounds({
      type: 'numeric',
      scale: 'log',
      edges: [1, 10, 1000],
    });
    expect(lo).toEqual([0, Math.log(10)]);
    expect(hi).toEqual([Math.log(10), Math.log(1000)]);
  });

  it('gives each histogram bucket a unit-height band, whatever its bound', () => {
    expect(
      rowPlotBounds({ type: 'buckets', bounds: [0.1, 10, Infinity] }),
    ).toEqual({ lo: [0, 1, 2], hi: [1, 2, 3] });
  });

  it('gives each series row a unit-height band', () => {
    expect(rowPlotBounds({ type: 'series', labels: ['a', 'b'] })).toEqual({
      lo: [0, 1],
      hi: [1, 2],
    });
  });
});

describe('gridToPlotData', () => {
  it('emits one cell per (time, row) with its center and extent', () => {
    const [xs, ys, cells, x0s, x1s, y0s, y1s] = gridToPlotData(grid({}));

    expect(xs).toEqual([1000, 1000, 2000, 2000]);
    expect(ys).toEqual([0.5, 2, 0.5, 2]);
    expect(cells).toEqual([1, 2, 3, 4]);
    expect(x0s).toEqual([500, 500, 1500, 1500]);
    expect(x1s).toEqual([1500, 1500, 2500, 2500]);
    expect(y0s).toEqual([0, 1, 0, 1]);
    expect(y1s).toEqual([1, 3, 1, 3]);
  });
});

describe('computeBucketPercentiles', () => {
  it('reports the share of events at or below each row, pooled across time buckets', () => {
    const percentiles = computeBucketPercentiles(
      gridFromBucketRows({
        ...baseArgs,
        data: [
          row(T0, 1, '3'),
          row(T0, 4, '1'),
          row(T1, 1, '5'),
          row(T1, 2, '1'),
        ],
      }),
    );

    expect(percentiles).toEqual(
      new Map([
        [0, 0],
        [1, 80], // 3 + 5 of the 10 events, both time buckets counted
        [2, 90],
        [3, 90], // empty bucket carries the share of the one below it
        [4, 100],
        [5, 100],
      ]),
    );
  });

  it('returns no percentiles when the grid holds no events', () => {
    // Every cell is 0, so there is no distribution to place a value in
    // the tooltip omits the percentile rather than dividing by zero.
    expect(
      computeBucketPercentiles(gridFromBucketRows({ ...baseArgs, data: [] })),
    ).toEqual(new Map());
  });
});
