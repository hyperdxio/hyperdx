import { Exemplar } from '@hyperdx/common-utils/dist/types';

import { computeExemplarPoints } from '@/components/Exemplars/exemplarPoints';

const ex = (
  over: Partial<Exemplar> & { timestamp: number; value: number },
): Exemplar => ({
  traceId: `t-${over.timestamp}-${over.value}`,
  ...over,
});

const RANGE: [Date, Date] = [
  new Date('2025-01-01T00:00:00Z'),
  new Date('2025-01-01T01:00:00Z'),
];

describe('computeExemplarPoints', () => {
  const opts = { maxExemplars: 12, granularity: '1 minute', dateRange: RANGE };

  it('returns [] for empty/undefined', () => {
    expect(computeExemplarPoints(undefined, opts)).toEqual([]);
    expect(computeExemplarPoints([], opts)).toEqual([]);
  });

  it('maps timestamp (ms) to seconds on the x-axis and value to y', () => {
    const [p] = computeExemplarPoints(
      [ex({ timestamp: 1_700_000_000_000, value: 42 })],
      opts,
    );
    expect(p.x).toBe(1_700_000_000); // ms -> s
    expect(p.y).toBe(42);
  });

  it('unlimited (maxExemplars <= 0): keeps all, deduped by trace id + timestamp', () => {
    const points = computeExemplarPoints(
      [
        ex({ traceId: 'a', timestamp: 1000, value: 1 }),
        ex({ traceId: 'a', timestamp: 1000, value: 1 }), // dup
        ex({ traceId: 'b', timestamp: 2000, value: 2 }),
      ],
      { ...opts, maxExemplars: 0 },
    );
    expect(points).toHaveLength(2);
  });

  it('skips exemplars with a non-finite value', () => {
    const points = computeExemplarPoints(
      [ex({ timestamp: 1000, value: NaN }), ex({ timestamp: 2000, value: 3 })],
      { ...opts, maxExemplars: 0 },
    );
    expect(points).toHaveLength(1);
    expect(points[0].y).toBe(3);
  });

  it('keeps only the highest-value exemplar per time bucket', () => {
    // Two exemplars in the same coarse bucket (same ms) -> the max wins.
    const points = computeExemplarPoints(
      [
        ex({ traceId: 'low', timestamp: 1000, value: 1 }),
        ex({ traceId: 'high', timestamp: 1000, value: 9 }),
      ],
      opts,
    );
    expect(points).toHaveLength(1);
    expect(points[0].y).toBe(9);
  });

  it('separates buckets by series (groupKey) so distinct series both survive', () => {
    // Same time bucket, different groupKey -> both kept (one per series).
    const points = computeExemplarPoints(
      [
        ex({ traceId: 'a', timestamp: 1000, value: 5, groupKey: 'svc=a' }),
        ex({ traceId: 'b', timestamp: 1000, value: 5, groupKey: 'svc=b' }),
      ],
      opts,
    );
    expect(points).toHaveLength(2);
  });

  it('does not divide by zero when the range is empty (start == end)', () => {
    const points = computeExemplarPoints([ex({ timestamp: 1000, value: 1 })], {
      ...opts,
      dateRange: [RANGE[0], RANGE[0]],
    });
    expect(points).toHaveLength(1);
  });
});
