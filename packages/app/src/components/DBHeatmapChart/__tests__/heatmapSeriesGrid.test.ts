import { gridFromSeries } from '@/components/DBHeatmapChart/heatmapSeriesGrid';

const STEP = 60_000;
const TIMES = [0, STEP, 2 * STEP];

describe('gridFromSeries', () => {
  it('sorts rows naturally by name from the top and leaves gaps empty', () => {
    const grid = gridFromSeries(
      [
        { name: 'pod-10', points: [{ t: 0, v: 1 }] },
        { name: 'pod-2', points: [{ t: STEP, v: 2 }] },
        { name: 'pod-1', points: [{ t: 2 * STEP, v: 3 }] },
      ],
      TIMES,
    );

    expect(grid.yAxis).toEqual({
      type: 'series',
      labels: ['pod-10', 'pod-2', 'pod-1'],
    });
    expect(grid.stepMs).toBe(STEP);
    expect(grid.cells).toEqual([1, NaN, NaN, NaN, 2, NaN, NaN, NaN, 3]);
  });

  it('keeps zero and negative values', () => {
    const grid = gridFromSeries(
      [
        {
          name: 'a',
          points: [
            { t: 0, v: 0 },
            { t: STEP, v: -2 },
          ],
        },
      ],
      TIMES,
    );

    expect(grid.cells).toEqual([0, -2, NaN]);
  });
});
