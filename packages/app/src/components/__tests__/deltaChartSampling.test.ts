import {
  computeEffectiveSampleSize,
  getStableSampleExpression,
  MAX_SAMPLE_SIZE,
  MIN_SAMPLE_SIZE,
  SAMPLE_RATIO,
  SAMPLE_SIZE,
} from '../deltaChartUtils';

describe('getStableSampleExpression', () => {
  it('returns cityHash64 of spanIdExpression when provided', () => {
    expect(getStableSampleExpression('SpanId')).toBe('cityHash64(SpanId)');
  });

  it('uses custom spanId column name', () => {
    expect(getStableSampleExpression('my_span_id')).toBe(
      'cityHash64(my_span_id)',
    );
  });

  it('falls back to rand() when spanIdExpression is undefined', () => {
    expect(getStableSampleExpression(undefined)).toBe('rand()');
  });

  it('falls back to rand() when spanIdExpression is empty', () => {
    expect(getStableSampleExpression('')).toBe('rand()');
  });
});

describe('computeEffectiveSampleSize', () => {
  it('returns SAMPLE_SIZE when totalCount is 0 (fallback)', () => {
    expect(computeEffectiveSampleSize(0)).toBe(SAMPLE_SIZE);
  });

  it('returns SAMPLE_SIZE when totalCount is negative', () => {
    expect(computeEffectiveSampleSize(-1)).toBe(SAMPLE_SIZE);
  });

  it('returns MIN_SAMPLE_SIZE for small datasets', () => {
    expect(computeEffectiveSampleSize(100)).toBe(MIN_SAMPLE_SIZE);
  });

  it('returns SAMPLE_RATIO * totalCount for mid-size datasets', () => {
    const result = computeEffectiveSampleSize(200_000);
    expect(result).toBe(Math.ceil(200_000 * SAMPLE_RATIO));
    expect(result).toBeGreaterThan(MIN_SAMPLE_SIZE);
    expect(result).toBeLessThan(MAX_SAMPLE_SIZE);
  });

  it('caps at MAX_SAMPLE_SIZE for very large datasets', () => {
    expect(computeEffectiveSampleSize(10_000_000)).toBe(MAX_SAMPLE_SIZE);
  });

  it('returns exact 1% for datasets where 1% falls in the valid range', () => {
    expect(computeEffectiveSampleSize(100_000)).toBe(1000);
  });
});
