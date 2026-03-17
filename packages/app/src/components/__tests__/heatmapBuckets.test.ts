/**
 * Tests for heatmap bucket boundary computation algorithm.
 *
 * Validates the logic extracted from DBHeatmapChart's HeatmapContainer —
 * specifically the range calculation, effectiveMin capping, and
 * bucketToYValue mapping.
 *
 * Background: The initial PR #1913 used p99 as the max boundary for log scale.
 * When latency spikes are rare (<1% of spans), they fell above p99 and were
 * crammed into a single overflow bucket — making them invisible. The fix
 * switches the upper bound to actual max() since log scale already compresses
 * wide ranges naturally. Future: #1914 adds overflow-bucket indicators.
 */

// ---------------------------------------------------------------------------
// Extracted algorithm (mirrors DBHeatmapChart HeatmapContainer)
// ---------------------------------------------------------------------------

type ScaleType = 'log' | 'linear';

/**
 * Compute quantile level for the lower bound.
 * Upper bound uses actual max() — no quantile needed.
 */
function getQuantileLo(scaleType: ScaleType) {
  return scaleType === 'log' ? 0.01 : 0.001;
}

/**
 * Simulate what ClickHouse `quantile(level)(values)` returns.
 * Nearest-rank method (same as ClickHouse default).
 */
function quantile(values: number[], level: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(level * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Compute effectiveMin given the min/max and scale type.
 */
function computeEffectiveMin(
  min: number,
  max: number,
  scaleType: ScaleType,
): number {
  return scaleType === 'log' ? Math.max(min, max * 1e-4 || 1e-4) : min;
}

/**
 * Compute the y-value for a given bucket index.
 */
function bucketToYValue(
  j: number,
  nBuckets: number,
  effectiveMin: number,
  max: number,
  scaleType: ScaleType,
): number {
  if (scaleType === 'log' && effectiveMin > 0 && max > effectiveMin) {
    const actualValue =
      effectiveMin * Math.pow(max / effectiveMin, j / nBuckets);
    return Math.log(actualValue);
  }
  return effectiveMin + j * ((max - effectiveMin) / nBuckets);
}

/**
 * Simulate ClickHouse widthBucket(value, lo, hi, nBuckets).
 * Returns 0 for values < lo, nBuckets+1 for values >= hi,
 * and 1..nBuckets for values in [lo, hi).
 */
function widthBucket(
  value: number,
  lo: number,
  hi: number,
  nBuckets: number,
): number {
  if (value < lo) return 0;
  if (value >= hi) return nBuckets + 1;
  return Math.floor(((value - lo) / (hi - lo)) * nBuckets) + 1;
}

/**
 * For log scale, widthBucket operates on log(value).
 */
function widthBucketLog(
  value: number,
  effectiveMin: number,
  max: number,
  nBuckets: number,
): number {
  const clamped = Math.max(value, effectiveMin);
  return widthBucket(
    Math.log(clamped),
    Math.log(effectiveMin),
    Math.log(max),
    nBuckets,
  );
}

/**
 * Current (fixed) pipeline: uses quantile for lower bound, actual max()
 * for upper bound. Matches DBHeatmapChart after the fix.
 */
function computeHeatmapBuckets(
  values: number[],
  scaleType: ScaleType,
  nBuckets = 40,
) {
  const qLo = getQuantileLo(scaleType);
  const nonNeg = values.filter(v => v >= 0);
  const min = quantile(nonNeg, qLo);
  const max = Math.max(...values); // actual max, not quantile

  const effectiveMin = computeEffectiveMin(min, max, scaleType);

  const bucketCounts = new Array(nBuckets + 2).fill(0);
  for (const v of values) {
    let b: number;
    if (scaleType === 'log') {
      b = widthBucketLog(v, effectiveMin, max, nBuckets);
    } else {
      b = widthBucket(v, effectiveMin, max, nBuckets);
    }
    bucketCounts[b]++;
  }

  return { min, max, effectiveMin, bucketCounts, nBuckets };
}

/**
 * BUGGY version (pre-fix): used quantile(p99) for max on log scale.
 * Kept for regression tests.
 */
function computeHeatmapBuckets_BUGGY(
  values: number[],
  scaleType: ScaleType,
  nBuckets = 40,
) {
  const qLo = scaleType === 'log' ? 0.01 : 0.001;
  const qHi = scaleType === 'log' ? 0.99 : 0.999;

  const nonNeg = values.filter(v => v >= 0);
  const min = quantile(nonNeg, qLo);
  const max = quantile(values, qHi);

  const effectiveMin = computeEffectiveMin(min, max, scaleType);

  const bucketCounts = new Array(nBuckets + 2).fill(0);
  for (const v of values) {
    let b: number;
    if (scaleType === 'log') {
      b = widthBucketLog(v, effectiveMin, max, nBuckets);
    } else {
      b = widthBucket(v, effectiveMin, max, nBuckets);
    }
    bucketCounts[b]++;
  }

  return { min, max, effectiveMin, bucketCounts, nBuckets };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Generate a realistic latency distribution: mostly fast, with rare spikes.
 */
function generateLatencyData(opts: {
  baseCount: number;
  baseMean: number;
  baseStd: number;
  spikeCount: number;
  spikeMean: number;
  spikeStd: number;
}): number[] {
  const values: number[] = [];
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const normal = (mean: number, std: number) => {
    const u1 = rand();
    const u2 = rand();
    const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0.001, mean + z * std);
  };

  for (let i = 0; i < opts.baseCount; i++) {
    values.push(normal(opts.baseMean, opts.baseStd));
  }
  for (let i = 0; i < opts.spikeCount; i++) {
    values.push(normal(opts.spikeMean, opts.spikeStd));
  }
  return values;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Heatmap bucket boundary algorithm', () => {
  describe('quantile lower bound selection', () => {
    it('log scale uses p1 for lower bound', () => {
      expect(getQuantileLo('log')).toBe(0.01);
    });

    it('linear scale uses p0.1 for lower bound', () => {
      expect(getQuantileLo('linear')).toBe(0.001);
    });
  });

  describe('effectiveMin capping', () => {
    it('caps log-scale min to max*1e-4', () => {
      expect(computeEffectiveMin(0.001, 1000, 'log')).toBe(0.1);
    });

    it('uses actual min when it exceeds the cap', () => {
      expect(computeEffectiveMin(5, 1000, 'log')).toBe(5);
    });

    it('linear scale uses raw min', () => {
      expect(computeEffectiveMin(0.001, 1000, 'linear')).toBe(0.001);
    });
  });

  describe('bucketToYValue', () => {
    it('linear: produces uniformly spaced values', () => {
      const nBuckets = 10;
      const values = Array.from({ length: nBuckets + 1 }, (_, j) =>
        bucketToYValue(j, nBuckets, 0, 100, 'linear'),
      );
      for (let i = 0; i <= nBuckets; i++) {
        expect(values[i]).toBeCloseTo(i * 10);
      }
    });

    it('log: produces uniformly spaced values in log space', () => {
      const nBuckets = 10;
      const values = Array.from({ length: nBuckets + 1 }, (_, j) =>
        bucketToYValue(j, nBuckets, 1, 1000, 'log'),
      );
      const diffs = values.slice(1).map((v, i) => v - values[i]);
      for (let i = 1; i < diffs.length; i++) {
        expect(diffs[i]).toBeCloseTo(diffs[0], 5);
      }
    });
  });

  describe('widthBucket', () => {
    it('underflow goes to bucket 0', () => {
      expect(widthBucket(-1, 0, 100, 10)).toBe(0);
    });

    it('overflow goes to bucket nBuckets+1', () => {
      expect(widthBucket(100, 0, 100, 10)).toBe(11);
      expect(widthBucket(200, 0, 100, 10)).toBe(11);
    });

    it('values in range get distributed across 1..nBuckets', () => {
      expect(widthBucket(5, 0, 100, 10)).toBe(1);
      expect(widthBucket(50, 0, 100, 10)).toBe(6);
      expect(widthBucket(99, 0, 100, 10)).toBe(10);
    });
  });

  // =========================================================================
  // Regression: the old p99-based max hid latency spikes
  // =========================================================================

  describe('regression: old p99 max hid latency spikes (log scale)', () => {
    const values = generateLatencyData({
      baseCount: 1000,
      baseMean: 50,
      baseStd: 30,
      spikeCount: 5, // 0.5% of total — was above p99 cutoff
      spikeMean: 2000,
      spikeStd: 500,
    });

    it('old p99 max excluded spike values from visible range', () => {
      const buggy = computeHeatmapBuckets_BUGGY(values, 'log', 40);

      expect(buggy.max).toBeLessThan(1000);

      const overflowCount = buggy.bucketCounts[buggy.nBuckets + 1];
      const totalSpikes = values.filter(v => v > 1000).length;
      expect(overflowCount).toBeGreaterThanOrEqual(totalSpikes);
    });

    it('fixed max() includes the full spike range', () => {
      const fixed = computeHeatmapBuckets(values, 'log', 40);

      // actual max includes the spikes
      expect(fixed.max).toBeGreaterThan(1000);

      // At most 1 value overflows (the exact max, due to widthBucket >= check)
      const overflowCount = fixed.bucketCounts[fixed.nBuckets + 1];
      expect(overflowCount).toBeLessThanOrEqual(1);
    });

    it('fixed version distributes spikes across visible buckets', () => {
      const buggy = computeHeatmapBuckets_BUGGY(values, 'log', 40);
      const fixed = computeHeatmapBuckets(values, 'log', 40);

      // Old: all spikes crammed into overflow
      const buggyOverflow = buggy.bucketCounts[buggy.nBuckets + 1];
      expect(buggyOverflow).toBeGreaterThan(0);

      // Fixed: spikes spread across high buckets
      const fixedOverflow = fixed.bucketCounts[fixed.nBuckets + 1];
      expect(fixedOverflow).toBeLessThan(buggyOverflow);

      const highBuckets = fixed.bucketCounts.slice(30, 41);
      const highBucketTotal = highBuckets.reduce(
        (a: number, b: number) => a + b,
        0,
      );
      expect(highBucketTotal).toBeGreaterThan(0);
    });
  });

  describe('regression: old p99 max hid spikes at exactly 1%', () => {
    const values = generateLatencyData({
      baseCount: 990,
      baseMean: 50,
      baseStd: 20,
      spikeCount: 10, // exactly 1%
      spikeMean: 3000,
      spikeStd: 500,
    });

    it('old algorithm was fragile at the 1% boundary', () => {
      const buggy = computeHeatmapBuckets_BUGGY(values, 'log', 40);
      const spikeValues = values.filter(v => v > 1000);
      const spikesInOverflow = buggy.bucketCounts[buggy.nBuckets + 1];
      // Most or all spikes ended up in overflow
      expect(spikesInOverflow).toBeGreaterThanOrEqual(spikeValues.length - 2);
    });

    it('fixed algorithm shows spikes regardless of percentage', () => {
      const fixed = computeHeatmapBuckets(values, 'log', 40);
      // At most 1 value overflows (the exact max, due to widthBucket >= check)
      const overflowCount = fixed.bucketCounts[fixed.nBuckets + 1];
      expect(overflowCount).toBeLessThanOrEqual(1);
    });
  });

  // =========================================================================
  // Current algorithm behavior
  // =========================================================================

  describe('current algorithm: near-zero outliers still handled', () => {
    it('effectiveMin caps near-zero values on log scale', () => {
      const values = [
        0.0001,
        0.0001, // near-zero outliers
        ...Array(998)
          .fill(0)
          .map((_, i) => 10 + i * 0.1), // 10-110ms
      ];

      const result = computeHeatmapBuckets(values, 'log', 40);

      // effectiveMin should cap near-zero values (max * 1e-4)
      expect(result.effectiveMin).toBeGreaterThan(0.001);
      // Near-zero outliers go to bucket 0 (underflow)
      expect(result.bucketCounts[0]).toBeGreaterThan(0);
    });
  });

  describe('current algorithm: wide range works on log scale', () => {
    it('handles 4+ orders of magnitude without compression artifacts', () => {
      // 0.1ms to 10000ms — 5 orders of magnitude
      const values = [
        ...Array(100)
          .fill(0)
          .map((_, i) => 0.1 + i * 0.01), // 0.1-1ms
        ...Array(500)
          .fill(0)
          .map((_, i) => 1 + i * 0.2), // 1-100ms
        ...Array(300)
          .fill(0)
          .map((_, i) => 100 + i * 3), // 100-1000ms
        ...Array(50)
          .fill(0)
          .map((_, i) => 1000 + i * 200), // 1000-10000ms
      ];

      const result = computeHeatmapBuckets(values, 'log', 40);

      // At most 1 value overflows (the exact max, due to widthBucket >= check)
      expect(result.bucketCounts[result.nBuckets + 1]).toBeLessThanOrEqual(1);

      // Values distributed across many buckets (not compressed)
      const nonZeroBuckets = result.bucketCounts
        .slice(1, result.nBuckets + 1)
        .filter((c: number) => c > 0).length;
      expect(nonZeroBuckets).toBeGreaterThan(20);
    });
  });
});
