import {
  bucketRowSplits,
  formatBucketBound,
  formatBucketRange,
  formatHeatmapTick,
  logScaleSplits,
} from '@/components/DBHeatmapChart/heatmapAxis';

describe('formatHeatmapTick', () => {
  it('formats linear values compactly without a number format', () => {
    expect(formatHeatmapTick(1500, 'linear', undefined)).toBe('1.5K');
  });

  it('exponentiates log-space values before formatting', () => {
    expect(formatHeatmapTick(Math.log(1000), 'log', undefined)).toBe('1K');
  });

  it('formats duration outputs from seconds via the factor', () => {
    // factor 0.001: values are ms, so 250 -> 250ms
    expect(
      formatHeatmapTick(250, 'linear', { output: 'duration', factor: 0.001 }),
    ).toBe('250ms');
  });
});

describe('logScaleSplits', () => {
  it('places splits at powers of 10 within the range', () => {
    const splits = logScaleSplits(Math.log(1), Math.log(1000));
    expect(splits.map(Math.exp).map(v => Math.round(v))).toEqual([
      1, 10, 100, 1000,
    ]);
  });

  it('adds ×3 intermediates when the range holds fewer than 3 powers of 10', () => {
    const splits = logScaleSplits(Math.log(2), Math.log(40));
    expect(splits.map(Math.exp).map(v => Math.round(v))).toEqual([3, 10, 30]);
  });

  it('uses every mantissa within a range narrower than a decade', () => {
    const splits = logScaleSplits(Math.log(0.3), Math.log(0.66));
    expect(splits.map(v => +Math.exp(v).toFixed(2))).toEqual([
      0.3, 0.4, 0.5, 0.6,
    ]);
  });

  it('spaces nice values evenly within a range narrower than a mantissa step', () => {
    const splits = logScaleSplits(Math.log(0.3), Math.log(0.33));
    expect(splits.length).toBeGreaterThanOrEqual(3);
    expect(splits.map(v => +Math.exp(v).toFixed(3))).toEqual([
      0.3, 0.31, 0.32, 0.33,
    ]);
  });
});

describe('formatBucketBound', () => {
  it('labels the open-ended bucket +Inf', () => {
    expect(formatBucketBound(Infinity, undefined)).toBe('+Inf');
  });

  it('keeps the digits that tell adjacent bounds apart', () => {
    expect(formatBucketBound(0.0025, undefined)).toBe('0.0025');
    expect(formatBucketBound(2.5, undefined)).toBe('2.5');
    expect(formatBucketBound(2.5, { output: 'number', mantissa: 1 })).toBe(
      '2.5',
    );
  });

  it('formats durations', () => {
    expect(formatBucketBound(250, { output: 'number', unit: 'ms' })).toBe(
      '250ms',
    );
  });
});

describe('formatBucketRange', () => {
  const format = (bound: number) => formatBucketBound(bound, undefined);

  it('leaves the lowest bucket unbounded below', () => {
    expect(formatBucketRange([0.1, 1, Infinity], 0, format)).toBe('≤ 0.1');
    expect(formatBucketRange([-1, 1], 0, format)).toBe('≤ -1');
  });

  it('spans from the next bound down', () => {
    expect(formatBucketRange([0.1, 1, Infinity], 1, format)).toBe('0.1 – 1');
  });

  it('reads the +Inf bucket as everything above the last finite bound', () => {
    expect(formatBucketRange([0.1, 1, Infinity], 2, format)).toBe('> 1');
  });

  it('reads a lone +Inf bucket as every observation', () => {
    expect(formatBucketRange([Infinity], 0, format)).toBe('≤ +Inf');
  });
});

describe('bucketRowSplits', () => {
  it('ticks the top of every row when they fit', () => {
    expect(bucketRowSplits(4, 200)).toEqual([1, 2, 3, 4]);
  });

  it('thins ticks to evenly spaced rows that fit the height, keeping the top row', () => {
    const splits = bucketRowSplits(100, 200);
    expect(splits.length).toBeLessThan(100);
    expect(splits.at(-1)).toBe(100);
    const gaps = new Set(splits.slice(1).map((s, i) => s - splits[i]));
    expect(gaps.size).toBe(1);
    expect(bucketRowSplits(100, 400).length).toBeGreaterThan(splits.length);
  });

  it('keeps the top tick in a very short plot', () => {
    expect(bucketRowSplits(5, 0)).toEqual([5]);
  });
});
