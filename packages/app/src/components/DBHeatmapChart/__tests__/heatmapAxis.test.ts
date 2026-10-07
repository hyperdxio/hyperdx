import {
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
});
