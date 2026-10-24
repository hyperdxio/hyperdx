import { flattenBody, minePatterns } from '@/drain/mine-patterns';

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const baseDate = new Date('2024-01-01T00:00:00Z');
const endDate = new Date('2024-01-02T00:00:00Z'); // 24h window

function makeRow(body: string, tsOffset = 0): Row {
  return {
    body,
    ts: new Date(baseDate.getTime() + tsOffset).toISOString(),
  };
}

const defaultCallbacks = {
  getBody: (row: Row) => String(row.body ?? ''),
  getTimestamp: (row: Row) => {
    const ts = row.ts;
    return ts != null ? new Date(String(ts)).getTime() : null;
  },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('minePatterns', () => {
  describe('empty rows', () => {
    it('should return empty patterns and sampleMultiplier 1', () => {
      const result = minePatterns([], {
        totalCount: 100,
        startDate: baseDate,
        endDate,
        ...defaultCallbacks,
      });

      expect(result.patterns).toEqual([]);
      expect(result.sampleMultiplier).toBe(1);
    });
  });

  describe('single row', () => {
    it('should return one pattern with the row as a sample', () => {
      const rows = [makeRow('hello world')];
      const result = minePatterns(rows, {
        totalCount: 1,
        startDate: baseDate,
        endDate,
        ...defaultCallbacks,
      });

      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0].sampleCount).toBe(1);
      expect(result.patterns[0].samples).toHaveLength(1);
      expect(result.patterns[0].samples[0]).toBe(rows[0]);
      expect(result.patterns[0].estimatedCount).toBe(1);
    });
  });

  describe('multi-cluster grouping and sort order', () => {
    it('should group rows into clusters and sort by estimatedCount descending', () => {
      // Create rows that will form two distinct patterns
      const rows = [
        // Pattern A: 3 rows
        makeRow('user alice logged in', 0),
        makeRow('user bob logged in', 1000),
        makeRow('user charlie logged in', 2000),
        // Pattern B: 1 row
        makeRow('payment processed for order 123', 3000),
      ];

      const result = minePatterns(rows, {
        totalCount: 4,
        startDate: baseDate,
        endDate,
        ...defaultCallbacks,
      });

      expect(result.patterns.length).toBeGreaterThanOrEqual(1);

      // Verify descending sort order
      for (let i = 1; i < result.patterns.length; i++) {
        expect(result.patterns[i - 1].estimatedCount).toBeGreaterThanOrEqual(
          result.patterns[i].estimatedCount,
        );
      }

      // Total sampleCount across all patterns should equal total rows
      const totalSampled = result.patterns.reduce(
        (sum, p) => sum + p.sampleCount,
        0,
      );
      expect(totalSampled).toBe(4);
    });

    it('should produce <*> placeholders in patterns with variable tokens', () => {
      const rows = [
        makeRow('user alice logged in'),
        makeRow('user bob logged in'),
        makeRow('user charlie logged in'),
      ];

      const result = minePatterns(rows, {
        totalCount: 3,
        startDate: baseDate,
        endDate,
        ...defaultCallbacks,
      });

      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0].pattern).toContain('<*>');
    });
  });

  describe('sampleMultiplier math', () => {
    it('should scale estimatedCount when totalCount > rows.length', () => {
      // 2 sample rows representing 200 total events → multiplier = 100
      const rows = [
        makeRow('request to /api/users', 0),
        makeRow('request to /api/users', 1000),
      ];

      const result = minePatterns(rows, {
        totalCount: 200,
        startDate: baseDate,
        endDate,
        ...defaultCallbacks,
      });

      expect(result.sampleMultiplier).toBe(100);
      expect(result.patterns[0].estimatedCount).toBe(200);
    });

    it('should use sampleMultiplier 1 when totalCount is 0', () => {
      const rows = [makeRow('hello')];
      const result = minePatterns(rows, {
        totalCount: 0,
        startDate: baseDate,
        endDate,
        ...defaultCallbacks,
      });

      expect(result.sampleMultiplier).toBe(1);
    });

    it('should use sampleMultiplier 1 when totalCount equals row count', () => {
      const rows = [makeRow('hello'), makeRow('world')];
      const result = minePatterns(rows, {
        totalCount: 2,
        startDate: baseDate,
        endDate,
        ...defaultCallbacks,
      });

      expect(result.sampleMultiplier).toBe(1);
    });
  });

  describe('maxSamples cap', () => {
    it('should cap samples per pattern to maxSamples', () => {
      // All rows match the same pattern
      const rows = Array.from({ length: 10 }, (_, i) =>
        makeRow(`request to /api/endpoint`, i * 1000),
      );

      const result = minePatterns(rows, {
        totalCount: 10,
        startDate: baseDate,
        endDate,
        maxSamples: 3,
        ...defaultCallbacks,
      });

      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0].samples).toHaveLength(3);
      expect(result.patterns[0].sampleCount).toBe(10);
    });

    it('should keep all samples when maxSamples is larger than row count', () => {
      const rows = Array.from({ length: 5 }, (_, i) =>
        makeRow(`request to /api/endpoint`, i * 1000),
      );

      const result = minePatterns(rows, {
        totalCount: 5,
        startDate: baseDate,
        endDate,
        maxSamples: 100,
        ...defaultCallbacks,
      });

      expect(result.patterns[0].samples).toHaveLength(5);
    });

    it('should default maxSamples to 5', () => {
      const rows = Array.from({ length: 10 }, (_, i) =>
        makeRow(`request to /api/endpoint`, i * 1000),
      );

      const result = minePatterns(rows, {
        totalCount: 10,
        startDate: baseDate,
        endDate,
        // maxSamples not set — should default to 5
        ...defaultCallbacks,
      });

      expect(result.patterns[0].samples).toHaveLength(5);
    });
  });

  describe('trend bucket alignment', () => {
    it('should generate trend buckets covering the time range', () => {
      const start = new Date('2024-01-01T00:00:00Z');
      const end = new Date('2024-01-01T01:00:00Z'); // 1 hour

      const rows = [
        { body: 'event', ts: '2024-01-01T00:15:00Z' },
        { body: 'event', ts: '2024-01-01T00:45:00Z' },
      ];

      const result = minePatterns(rows, {
        totalCount: 2,
        startDate: start,
        endDate: end,
        trendBuckets: 4,
        ...defaultCallbacks,
      });

      expect(result.patterns).toHaveLength(1);
      const trend = result.patterns[0].trend;

      // Should have multiple buckets
      expect(trend.length).toBeGreaterThan(0);

      // All bucket timestamps should be within [start, end)
      for (const bucket of trend) {
        expect(bucket.ts).toBeGreaterThanOrEqual(start.getTime());
        expect(bucket.ts).toBeLessThan(end.getTime());
      }

      // At least one bucket should have a non-zero count
      const nonZero = trend.filter(b => b.count > 0);
      expect(nonZero.length).toBeGreaterThan(0);
    });

    it('should scale trend bucket counts by sampleMultiplier', () => {
      const start = new Date('2024-01-01T00:00:00Z');
      const end = new Date('2024-01-01T01:00:00Z');

      const rows = [{ body: 'event', ts: '2024-01-01T00:15:00Z' }];

      const result = minePatterns(rows, {
        totalCount: 100,
        startDate: start,
        endDate: end,
        trendBuckets: 4,
        ...defaultCallbacks,
      });

      // With 1 sample row and totalCount 100, multiplier is 100
      const nonZeroBuckets = result.patterns[0].trend.filter(b => b.count > 0);
      expect(nonZeroBuckets.length).toBeGreaterThan(0);
      // The bucket containing the event should have count = 1 * 100 = 100
      expect(nonZeroBuckets[0].count).toBe(100);
    });

    it('rounds the bucket width up, so fewer buckets than requested can come back', () => {
      const start = new Date('2024-01-01T00:00:00Z');
      const end = new Date('2024-01-01T01:00:00Z');

      const result = minePatterns(
        [{ body: 'event', ts: start.toISOString() }],
        {
          totalCount: 1,
          startDate: start,
          endDate: end,
          trendBuckets: 24,
          ...defaultCallbacks,
        },
      );

      // 3600s / 24 = 150s, rounded up to the 5 minute interval.
      expect(result.trendGranularity).toBe('5 minute');
      expect(result.trendBucketStarts).toHaveLength(12);
      expect(result.patterns[0].trend.map(b => b.ts)).toEqual(
        result.trendBucketStarts,
      );
    });

    it('aligns the first bucket to the interval, before an unaligned start', () => {
      const start = new Date('2024-01-01T00:07:00Z');
      const end = new Date('2024-01-01T01:07:00Z');

      const result = minePatterns(
        [{ body: 'event', ts: start.toISOString() }],
        {
          totalCount: 1,
          startDate: start,
          endDate: end,
          trendBuckets: 4,
          ...defaultCallbacks,
        },
      );

      expect(result.trendGranularity).toBe('15 minute');
      expect(result.trendBucketStarts[0]).toBe(
        new Date('2024-01-01T00:00:00Z').getTime(),
      );
      expect(result.trendBucketStarts[0]).toBeLessThan(start.getTime());
    });

    it('skips trend computation when trendBuckets is 0', () => {
      const result = minePatterns([makeRow('event')], {
        totalCount: 1,
        startDate: baseDate,
        endDate,
        trendBuckets: 0,
        ...defaultCallbacks,
      });

      expect(result.trendGranularity).toBeUndefined();
      expect(result.trendBucketStarts).toEqual([]);
      expect(result.patterns[0].trend).toEqual([]);
      expect(result.patterns[0].sampleCount).toBe(1);
    });
  });

  describe('NaN/null timestamp handling', () => {
    it('should fall back to startDate for null timestamps', () => {
      const rows = [{ body: 'no timestamp', ts: null }];
      const result = minePatterns(rows, {
        totalCount: 1,
        startDate: baseDate,
        endDate,
        getBody: (row: Row) => String(row.body ?? ''),
        getTimestamp: () => null,
      });

      expect(result.patterns).toHaveLength(1);
      // The event should be bucketed — at least one trend bucket should have count > 0
      const nonZero = result.patterns[0].trend.filter(b => b.count > 0);
      expect(nonZero.length).toBeGreaterThan(0);
    });

    it('should fall back to startDate for undefined timestamps', () => {
      const rows = [{ body: 'no timestamp' }];
      const result = minePatterns(rows, {
        totalCount: 1,
        startDate: baseDate,
        endDate,
        getBody: (row: Row) => String(row.body ?? ''),
        getTimestamp: () => undefined,
      });

      expect(result.patterns).toHaveLength(1);
      const nonZero = result.patterns[0].trend.filter(b => b.count > 0);
      expect(nonZero.length).toBeGreaterThan(0);
    });
  });

  describe('estimatedCount floor', () => {
    it('should floor estimatedCount at 1 via Math.max', () => {
      // With sampleMultiplier < 1 (totalCount < rows.length is unusual but possible)
      // Each pattern with sampleCount=1 would get estimatedCount = round(1 * 0.5) = 1
      // But test with very small multiplier scenario: totalCount=1, 10 rows
      const rows = Array.from({ length: 10 }, (_, i) =>
        makeRow(`unique message ${i}`, i * 1000),
      );

      const result = minePatterns(rows, {
        totalCount: 1, // multiplier = 0.1
        startDate: baseDate,
        endDate,
        ...defaultCallbacks,
      });

      // Every pattern should have estimatedCount >= 1
      for (const p of result.patterns) {
        expect(p.estimatedCount).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('TRow generic typing', () => {
    it('should preserve row type in pattern samples', () => {
      interface MyRow extends Record<string, unknown> {
        body: string;
        ts: string;
        extra: number;
      }

      const rows: MyRow[] = [
        { body: 'hello world', ts: '2024-01-01T00:00:00Z', extra: 42 },
      ];

      const result = minePatterns(rows, {
        totalCount: 1,
        startDate: baseDate,
        endDate,
        getBody: (row: MyRow) => row.body,
        getTimestamp: (row: MyRow) => new Date(row.ts).getTime(),
      });

      // TypeScript should infer samples as MyRow[]
      const sample = result.patterns[0].samples[0];
      expect(sample.extra).toBe(42);
    });
  });

  describe('body normalization (flattenBody)', () => {
    it('should collapse newlines into spaces', () => {
      expect(flattenBody('line1\nline2\nline3')).toBe('line1 line2 line3');
    });

    it('should collapse runs of whitespace into single spaces', () => {
      expect(flattenBody('hello    world')).toBe('hello world');
    });

    it('should trim leading and trailing whitespace', () => {
      expect(flattenBody('  hello  ')).toBe('hello');
    });

    it('should handle combined newlines and whitespace', () => {
      expect(flattenBody('  line1\n  line2\n\n  line3  ')).toBe(
        'line1 line2 line3',
      );
    });

    it('should return empty string for whitespace-only input', () => {
      expect(flattenBody('   \n\n  ')).toBe('');
    });

    it('should group multiline bodies into the same pattern', () => {
      const rows = [
        makeRow('error occurred\n  at line 1\n  at line 2'),
        makeRow('error occurred\n  at line 5\n  at line 10'),
      ];

      const result = minePatterns(rows, {
        totalCount: 2,
        startDate: baseDate,
        endDate,
        ...defaultCallbacks,
      });

      // Both multiline messages should cluster together
      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0].sampleCount).toBe(2);
    });
  });
});

describe('minePatterns template fidelity', () => {
  // Deterministic PRNG so the fuzz input is stable across runs.
  function lcg(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) % 2 ** 31;
      return s / 2 ** 31;
    };
  }

  function fits(template: string, body: string): boolean {
    const t = template.split(/\s+/).filter(Boolean);
    const b = body.split(/\s+/).filter(Boolean);
    return (
      t.length === b.length &&
      t.every((tok, i) => tok === '<*>' || tok === b.at(i))
    );
  }

  it("reports each cluster's own template, which every member fits", () => {
    const words = ['a', 'b', 'c', 'ok', 'fail', 'x1', 'y2', '42', 'retry'];
    for (let seed = 1; seed <= 50; seed++) {
      const rand = lcg(seed);
      const rows = Array.from({ length: 300 }, () => {
        const len = 2 + Math.floor(rand() * 3);
        const body = Array.from(
          { length: len },
          () => words[Math.floor(rand() * words.length)],
        ).join(' ');
        return makeRow(body);
      });
      const { patterns } = minePatterns(rows, {
        totalCount: rows.length,
        startDate: baseDate,
        endDate,
        trendBuckets: 0,
        maxSamples: rows.length,
        ...defaultCallbacks,
      });
      for (const p of patterns) {
        for (const s of p.samples) {
          const body = String(s.body);
          if (!fits(p.pattern, body)) {
            throw new Error(
              `seed ${seed}: "${body}" does not fit "${p.pattern}"`,
            );
          }
        }
      }
    }
  });
});
