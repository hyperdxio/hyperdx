import { Exemplar } from '@hyperdx/common-utils/dist/types';

import {
  clampExemplarY,
  computeExemplarPoints,
  computeExemplarYBounds,
} from '@/components/Exemplars/exemplarPoints';

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

describe('computeExemplarYBounds', () => {
  it('uses both numeric domain bounds when the axis is fitted to data', () => {
    expect(computeExemplarYBounds([120, 480], 400)).toEqual({
      min: 120,
      max: 480,
    });
  });

  it("falls back to the visible series max for an 'auto' upper bound", () => {
    expect(computeExemplarYBounds([0, 'auto'], 400)).toEqual({
      min: 0,
      max: 400,
    });
  });

  it("floors at 0 for an 'auto' lower bound", () => {
    expect(computeExemplarYBounds(['auto', 'auto'], 400)).toEqual({
      min: 0,
      max: 400,
    });
  });

  it('tolerates a non-array domain (recharts allows a function)', () => {
    expect(computeExemplarYBounds(() => [0, 1], 400)).toEqual({
      min: 0,
      max: 400,
    });
  });
});

describe('clampExemplarY', () => {
  it('pins an outlier to the top of the domain instead of overflowing it', () => {
    // Without this, recharts' default ifOverflow="discard" drops the marker and
    // the overlay silently loses the slowest trace.
    expect(clampExemplarY(9000, { min: 0, max: 400 })).toBe(400);
  });

  it('lifts a marker below a fitted axis floor up to the floor', () => {
    // The regression this guards: fitYAxisToData puts the floor above an
    // individual duration when the series is a high quantile.
    expect(clampExemplarY(12, { min: 120, max: 480 })).toBe(120);
  });

  it('leaves an in-domain value untouched', () => {
    expect(clampExemplarY(200, { min: 120, max: 480 })).toBe(200);
  });

  it('leaves the value alone when there is no numeric series data yet', () => {
    // visibleSeriesMax is -Infinity before any data arrives.
    expect(clampExemplarY(200, { min: 0, max: -Infinity })).toBe(200);
  });

  it('leaves the value alone for inverted bounds', () => {
    expect(clampExemplarY(200, { min: 480, max: 120 })).toBe(200);
  });
});
