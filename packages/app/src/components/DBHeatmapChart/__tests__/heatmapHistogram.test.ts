import { gridFromHistogramSamples } from '@/components/DBHeatmapChart/heatmapHistogram';

const times = [1000, 2000];

describe('gridFromHistogramSamples', () => {
  it('sorts buckets by numeric bound, +Inf on top', () => {
    const grid = gridFromHistogramSamples({
      samples: [
        { le: '+Inf', t: 1000, v: 10 },
        { le: '10', t: 1000, v: 8 },
        { le: '2.5', t: 1000, v: 3 },
      ],
      times,
    });
    expect(grid.yAxis).toEqual({
      type: 'buckets',
      bounds: [2.5, 10, Infinity],
    });
  });

  it('de-accumulates each bucket from the one below it', () => {
    const grid = gridFromHistogramSamples({
      samples: [
        { le: '0.1', t: 1000, v: 2 },
        { le: '1', t: 1000, v: 5 },
        { le: '+Inf', t: 1000, v: 6 },
        { le: '0.1', t: 2000, v: 0 },
        { le: '1', t: 2000, v: 4 },
        { le: '+Inf', t: 2000, v: 4 },
      ],
      times,
    });
    expect(grid.cells).toEqual([2, 3, 1, 0, 4, 0]);
  });

  it('merges buckets whose le is written differently', () => {
    const grid = gridFromHistogramSamples({
      samples: [
        { le: '1', t: 1000, v: 5 },
        { le: '+Inf', t: 1000, v: 6 },
        { le: '1.0', t: 2000, v: 4 },
        { le: '+Inf', t: 2000, v: 4 },
      ],
      times,
    });
    expect(grid.yAxis).toEqual({ type: 'buckets', bounds: [1, Infinity] });
    expect(grid.cells).toEqual([5, 1, 4, 0]);
  });

  it('sums series at the same time whose le is written differently', () => {
    const grid = gridFromHistogramSamples({
      samples: [
        { le: '1', t: 1000, v: 2 },
        { le: '1.0', t: 1000, v: 3 },
        { le: '+Inf', t: 1000, v: 10 },
      ],
      times: [1000],
    });
    expect(grid.yAxis).toEqual({ type: 'buckets', bounds: [1, Infinity] });
    expect(grid.cells).toEqual([5, 5]);
  });

  it('de-accumulates across a missing bucket sample from the next one down', () => {
    const grid = gridFromHistogramSamples({
      samples: [
        { le: '0.1', t: 1000, v: 2 },
        { le: '1', t: 1000, v: 5 },
        { le: '+Inf', t: 1000, v: 6 },
        { le: '0.1', t: 2000, v: 1 },
        { le: '+Inf', t: 2000, v: 4 },
      ],
      times,
    });
    expect(grid.cells.slice(3)).toEqual([1, 0, 3]);
  });

  it('clamps a bucket below the one under it to 0', () => {
    const grid = gridFromHistogramSamples({
      samples: [
        { le: '1', t: 1000, v: 5 },
        { le: '+Inf', t: 1000, v: 4.9 },
      ],
      times,
    });
    expect(grid.cells.slice(0, 2)).toEqual([5, 0]);
  });

  it('does not let a dipped bucket inflate the ones above it', () => {
    const grid = gridFromHistogramSamples({
      samples: [
        { le: '0.1', t: 1000, v: 5 },
        { le: '1', t: 1000, v: 4.9 },
        { le: '+Inf', t: 1000, v: 8 },
      ],
      times: [1000],
    });
    expect(grid.cells).toEqual([5, 0, 3]);
  });

  it('draws a single bucket', () => {
    const grid = gridFromHistogramSamples({
      samples: [{ le: '+Inf', t: 2000, v: 7 }],
      times,
    });
    expect(grid.yAxis).toEqual({ type: 'buckets', bounds: [Infinity] });
    expect(grid.cells).toEqual([0, 7]);
  });

  it('is empty without samples', () => {
    const grid = gridFromHistogramSamples({ samples: [], times });
    expect(grid.yAxis).toEqual({ type: 'buckets', bounds: [] });
    expect(grid.cells).toEqual([]);
  });
});
