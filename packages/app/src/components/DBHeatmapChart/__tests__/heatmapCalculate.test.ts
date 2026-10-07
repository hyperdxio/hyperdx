import {
  CALCULATED_TARGET_BUCKETS,
  gridFromSamples,
} from '@/components/DBHeatmapChart/heatmapCalculate';
import { EMPTY_HEATMAP_GRID } from '@/components/DBHeatmapChart/heatmapGrid';

const STEP = 60_000;
const times = [0, STEP, 2 * STEP];

const series = (name: string, points: [number, number][]) => ({
  name,
  points: points.map(([t, v]) => ({ t, v })),
});

const linearEdges = (values: number[]) => {
  const { grid } = gridFromSamples({
    series: [
      series(
        'a',
        values.map(v => [0, v]),
      ),
    ],
    times,
    scaleType: 'linear',
  });
  return grid.yAxis.type === 'numeric' ? grid.yAxis.edges : [];
};

describe('gridFromSamples', () => {
  it.each([
    [95, 10],
    [9, 1],
    [1, 0.1],
    [0.45, 0.05],
    [1000, 100],
    [130, 10],
    [150, 15],
  ])('splits [0, %p] into about 10 linear buckets of %p', (max, bucketSize) => {
    const edges = linearEdges([0, max]);
    expect(edges[0]).toBe(0);
    expect(edges[1]).toBe(bucketSize);
  });

  it('counts the samples of every series per time column and linear bucket', () => {
    const { grid, effectiveMin } = gridFromSamples({
      series: [
        series('a', [
          [0, 0],
          [STEP, 50],
        ]),
        series('b', [
          [0, 5],
          [STEP, 55],
          [2 * STEP, 95],
        ]),
      ],
      times,
      scaleType: 'linear',
    });

    expect(grid.yAxis).toEqual({
      type: 'numeric',
      scale: 'linear',
      edges: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    });
    expect(effectiveMin).toBe(0);
    const rows = 10;
    const column = (ti: number) =>
      grid.cells.slice(ti * rows, ti * rows + rows);
    expect(column(0)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(column(1)).toEqual([0, 0, 0, 0, 0, 2, 0, 0, 0, 0]);
    expect(column(2)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it('puts a value on a bucket edge in the bucket it starts', () => {
    const { grid } = gridFromSamples({
      series: [
        series('a', [
          [0, 0],
          [0, 0.3],
          [0, 0.9],
        ]),
      ],
      times,
      scaleType: 'linear',
    });

    expect(grid.yAxis.type === 'numeric' && grid.yAxis.edges).toEqual([
      0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
    ]);
    expect(grid.cells.slice(0, 10)).toEqual([1, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
  });

  it('starts the buckets at a multiple of the bucket size', () => {
    const edges = linearEdges([-12, 75]);
    expect(edges[0]).toBe(-18);
    expect(edges.at(-1)).toBe(81);
  });

  it('draws a constant value as one bucket sized by its magnitude', () => {
    const { grid } = gridFromSamples({
      series: [series('a', [[0, 1]]), series('b', [[0, 1]])],
      times,
      scaleType: 'linear',
    });

    expect(grid.yAxis).toEqual({
      type: 'numeric',
      scale: 'linear',
      edges: [1, 1.1],
    });
    expect(grid.cells).toEqual([2, 0, 0]);
  });

  it('keeps the edges of buckets smaller than 1e-6', () => {
    const edges = linearEdges([1e-7, 5e-7, 9e-7]);
    expect(edges[0]).toBe(8.5e-8);
    expect(edges[1]).toBe(1.7e-7);
    expect(edges.at(-1)).toBe(9.35e-7);
    expect(linearEdges([3e-6, 3e-6])).toEqual([3e-6, 3.3e-6]);
  });

  it('buckets a range wider than 1e17', () => {
    const edges = linearEdges([0, 9.2e18]);
    expect(edges[0]).toBe(0);
    expect(edges[1]).toBe(1e18);
    expect(edges.at(-1)).toBe(1e19);
  });

  it('buckets a range near the largest finite magnitude', () => {
    const edges = linearEdges([0, 1e300]);
    expect(edges[1]).toBe(1e299);
    expect(edges).toHaveLength(12);
  });

  it('places samples between column starts in the column containing them', () => {
    const { grid } = gridFromSamples({
      series: [series('a', [[STEP + 1000, 1]])],
      times,
      scaleType: 'linear',
    });

    expect(grid.cells).toEqual([0, 1, 0]);
  });

  it('skips non-finite values and samples outside the time range', () => {
    const { grid } = gridFromSamples({
      series: [
        series('a', [
          [0, NaN],
          [0, Infinity],
          [10 * STEP, 5],
          [0, 1],
        ]),
      ],
      times,
      scaleType: 'linear',
    });

    expect(grid.cells).toEqual([1, 0, 0]);
  });

  it('is empty without samples', () => {
    expect(
      gridFromSamples({ series: [], times, scaleType: 'linear' }).grid,
    ).toBe(EMPTY_HEATMAP_GRID);
  });

  describe('log scale', () => {
    it('spaces buckets geometrically from the effective min to the max', () => {
      const { grid, effectiveMin } = gridFromSamples({
        series: [
          series('a', [
            [0, 1],
            [0, 10],
            [STEP, 100],
          ]),
        ],
        times,
        scaleType: 'log',
      });

      expect(effectiveMin).toBe(1);
      const edges = grid.yAxis.type === 'numeric' ? grid.yAxis.edges : [];
      expect(grid.yAxis.type === 'numeric' && grid.yAxis.scale).toBe('log');
      expect(edges).toHaveLength(CALCULATED_TARGET_BUCKETS + 1);
      expect(edges[0]).toBe(1);
      expect(edges[CALCULATED_TARGET_BUCKETS / 2]).toBeCloseTo(10);
      expect(edges[CALCULATED_TARGET_BUCKETS]).toBeCloseTo(100);

      const rows = CALCULATED_TARGET_BUCKETS;
      expect(grid.cells[0]).toBe(1);
      expect(grid.cells[rows / 2]).toBe(1);
      expect(grid.cells[rows + rows - 1]).toBe(1);
      expect(grid.cells.reduce((a, b) => a + b, 0)).toBe(3);
    });

    it('clamps small values into the bottom bucket and drops non-positive ones', () => {
      const { grid, effectiveMin } = gridFromSamples({
        series: [
          series('a', [
            [0, -5],
            [0, 0],
            [0, 1e-9],
            [0, 1000],
          ]),
        ],
        times,
        scaleType: 'log',
      });

      expect(effectiveMin).toBeCloseTo(0.1);
      expect(grid.cells[0]).toBe(1);
      expect(grid.cells[CALCULATED_TARGET_BUCKETS - 1]).toBe(1);
      expect(grid.cells.reduce((a, b) => a + b, 0)).toBe(2);
    });

    it('bounds the buckets by the positive samples only', () => {
      const { effectiveMin } = gridFromSamples({
        series: [
          series('a', [
            ...Array.from({ length: 50 }, (): [number, number] => [0, 0]),
            [0, 10],
            [0, 1000],
          ]),
        ],
        times,
        scaleType: 'log',
      });

      expect(effectiveMin).toBe(10);
    });

    it('draws a constant value in the top bucket', () => {
      const { grid, effectiveMin } = gridFromSamples({
        series: [series('a', [[0, 1]]), series('b', [[0, 1]])],
        times,
        scaleType: 'log',
      });

      expect(effectiveMin).toBeCloseTo(1e-4);
      const edges = grid.yAxis.type === 'numeric' ? grid.yAxis.edges : [];
      expect(edges.at(-1)).toBeCloseTo(1);
      expect(grid.cells[CALCULATED_TARGET_BUCKETS - 1]).toBe(2);
      expect(grid.cells.reduce((a, b) => a + b, 0)).toBe(2);
    });

    it('starts at the smallest sample when the low quantile reaches the max', () => {
      const { grid, effectiveMin } = gridFromSamples({
        series: [
          series('a', [
            [0, 0.5],
            ...Array.from({ length: 100 }, (): [number, number] => [0, 1]),
          ]),
        ],
        times,
        scaleType: 'log',
      });

      expect(effectiveMin).toBe(0.5);
      expect(grid.cells[0]).toBe(1);
      expect(grid.cells[CALCULATED_TARGET_BUCKETS - 1]).toBe(100);
    });

    it('is empty when there is no positive range to bucket', () => {
      expect(
        gridFromSamples({
          series: [
            series('a', [
              [0, 0],
              [0, -1],
            ]),
          ],
          times,
          scaleType: 'log',
        }).grid,
      ).toBe(EMPTY_HEATMAP_GRID);
    });
  });
});
