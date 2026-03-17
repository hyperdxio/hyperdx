import {
  computeComparisonScore,
  computeEntropyScore,
  semanticBoost,
} from '../deltaChartUtils';

describe('computeComparisonScore', () => {
  it('returns 0 for empty maps', () => {
    expect(computeComparisonScore(new Map(), new Map())).toBe(0);
  });

  it('returns 0 when both groups have identical proportions', () => {
    const outlier = new Map([
      ['GET', 80],
      ['POST', 20],
    ]);
    const inlier = new Map([
      ['GET', 40],
      ['POST', 10],
    ]);
    expect(computeComparisonScore(outlier, inlier)).toBeCloseTo(0);
  });

  it('returns high score for different proportions', () => {
    const outlier = new Map([
      ['error', 90],
      ['ok', 10],
    ]);
    const inlier = new Map([
      ['error', 10],
      ['ok', 90],
    ]);
    expect(computeComparisonScore(outlier, inlier)).toBeGreaterThan(70);
  });

  it('returns 0 for single-value field when other group is empty', () => {
    // Single value with no comparison group is uninformative
    // (e.g., Events.Name[N] = "message" at 100% with no inlier data)
    const outlier = new Map([['error', 50]]);
    expect(computeComparisonScore(outlier, new Map())).toBe(0);
  });

  it('normalizes multi-value field to [0, 100] when other group is empty', () => {
    // Multi-value with no comparison group IS informative — shows distribution
    const outlier = new Map([
      ['error', 80],
      ['ok', 20],
    ]);
    expect(computeComparisonScore(outlier, new Map())).toBe(80);
  });

  it('normalizes by group sum so different sample sizes produce same score', () => {
    const outlierSmall = new Map([
      ['GET', 8],
      ['POST', 2],
    ]);
    const outlierLarge = new Map([
      ['GET', 800],
      ['POST', 200],
    ]);
    const inlier = new Map([
      ['GET', 50],
      ['POST', 50],
    ]);
    const scoreSmall = computeComparisonScore(outlierSmall, inlier);
    const scoreLarge = computeComparisonScore(outlierLarge, inlier);
    expect(scoreSmall).toBeCloseTo(scoreLarge, 1);
  });
});

describe('computeEntropyScore', () => {
  it('returns 0 for single-value fields', () => {
    expect(computeEntropyScore(new Map([['only', 100]]))).toBe(0);
  });

  it('returns 0 for empty map', () => {
    expect(computeEntropyScore(new Map())).toBe(0);
  });

  it('returns ~0 for perfectly uniform distribution', () => {
    expect(
      computeEntropyScore(
        new Map([
          ['a', 50],
          ['b', 50],
        ]),
      ),
    ).toBeCloseTo(0);
  });

  it('returns high score for skewed distribution', () => {
    const score = computeEntropyScore(
      new Map([
        ['ok', 99],
        ['error', 1],
      ]),
    );
    expect(score).toBeGreaterThan(0.5);
  });

  it('ranks more-skewed fields higher', () => {
    const scoreA = computeEntropyScore(
      new Map([
        ['a', 95],
        ['b', 5],
      ]),
    );
    const scoreB = computeEntropyScore(
      new Map([
        ['a', 60],
        ['b', 40],
      ]),
    );
    expect(scoreA).toBeGreaterThan(scoreB);
  });

  it('returns ~0 for uniform 3-value field', () => {
    expect(
      computeEntropyScore(
        new Map([
          ['a', 33.33],
          ['b', 33.33],
          ['c', 33.34],
        ]),
      ),
    ).toBeCloseTo(0, 2);
  });

  it('handles power-law distributions', () => {
    const powerLaw = new Map([
      ['v1', 50],
      ['v2', 25],
      ['v3', 12],
      ['v4', 6],
      ['v5', 4],
      ['v6', 2],
      ['v7', 1],
    ]);
    const score = computeEntropyScore(powerLaw);
    expect(score).toBeGreaterThan(0.1);
    expect(score).toBeLessThan(1);
  });
});

describe('semanticBoost', () => {
  it('boosts well-known OTel attributes', () => {
    expect(semanticBoost('ResourceAttributes.service.name')).toBe(1);
    expect(semanticBoost('SpanAttributes.http.method')).toBe(1);
    expect(semanticBoost('SpanAttributes.http.status_code')).toBe(1);
    expect(semanticBoost('SpanAttributes.error')).toBe(1);
  });

  it('returns 0 for non-boosted attributes', () => {
    expect(semanticBoost('SpanAttributes.custom.field')).toBe(0);
    expect(semanticBoost('TraceId')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(semanticBoost('ResourceAttributes.Service.Name')).toBe(1);
    expect(semanticBoost('SpanAttributes.HTTP.METHOD')).toBe(1);
  });
});
