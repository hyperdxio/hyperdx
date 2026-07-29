import { Exemplar } from '@hyperdx/common-utils/dist/types';

import {
  clampExemplarX,
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

const MINUTE = 60_000;

describe('computeExemplarPoints', () => {
  const opts = { maxExemplars: 12, granularity: '1 minute' };

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

  it('skips exemplars with a non-finite timestamp', () => {
    // timestamp feeds both the bucket key and the x coordinate, so a non-finite
    // one collapses every affected exemplar into a single "@NaN" bucket and
    // reaches recharts as a NaN x, rendering an invalid SVG path.
    const points = computeExemplarPoints(
      [
        ex({ timestamp: NaN, value: 5 }),
        ex({ timestamp: Infinity, value: 6 }),
        ex({ timestamp: 2000, value: 3 }),
      ],
      { ...opts, maxExemplars: 0 },
    );
    expect(points).toHaveLength(1);
    expect(points[0].x).toBe(2);
    expect(Number.isFinite(points[0].x)).toBe(true);
  });

  it('keeps the highest-value exemplar of a bucket', () => {
    // Two exemplars in the same bucket, values too close to be separate
    // samples -> only the max is plotted.
    const points = computeExemplarPoints(
      [
        ex({ traceId: 'low', timestamp: 1000, value: 8 }),
        ex({ traceId: 'high', timestamp: 1000, value: 9 }),
      ],
      opts,
    );
    expect(points).toHaveLength(1);
    expect(points[0].y).toBe(9);
  });

  it('also keeps a value more than 2σ below the bucket max', () => {
    // A bucket holding a cluster of typical traces plus one big outlier should
    // surface both ends, so the overlay shows the spread and not just a max
    // envelope. Values within the cluster stay collapsed to one marker.
    const typical = Array.from({ length: 10 }, (_, i) =>
      ex({ traceId: `typical-${i}`, timestamp: 1000, value: 10 + i }),
    );
    const points = computeExemplarPoints(
      [ex({ traceId: 'slow', timestamp: 1000, value: 1000 }), ...typical],
      opts,
    );
    expect(points.map(p => p.y)).toEqual([1000, 19]);
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

  it('buckets at the chart granularity, not at a budget-derived width', () => {
    // Adjacent minutes are distinct buckets even though the budget is far from
    // exhausted, so a marker always lands in the bucket it explains.
    const points = computeExemplarPoints(
      [
        ex({ traceId: 'a', timestamp: 0, value: 1 }),
        ex({ traceId: 'b', timestamp: MINUTE, value: 2 }),
        ex({ traceId: 'c', timestamp: 2 * MINUTE, value: 3 }),
      ],
      opts,
    );
    expect(points).toHaveLength(3);
  });

  it('spreads the marker budget across the range instead of over the spikes', () => {
    // 20 buckets, budget of 4. The slowest traces are all bunched at the start;
    // a value-ranked cut would return only those and leave the rest empty.
    const exemplars = Array.from({ length: 20 }, (_, i) =>
      ex({
        traceId: `t${i}`,
        timestamp: i * MINUTE,
        value: i < 5 ? 1000 + i : 1,
      }),
    );
    const points = computeExemplarPoints(exemplars, {
      ...opts,
      maxExemplars: 4,
    });
    expect(points.length).toBeLessThanOrEqual(4);
    const times = points.map(p => p.x).sort((a, b) => a - b);
    // Markers reach the far end of the range, not just the leading spike.
    expect(times[times.length - 1]).toBeGreaterThanOrEqual(
      (15 * MINUTE) / 1000,
    );
  });

  it('renders 2σ companions instead of spending the whole budget on rank 0', () => {
    // The regression this guards: taking one window per budget slot fills the
    // budget on every bucket's maximum, so the 2σ sampling never places a
    // second marker and the overlay is the max envelope it exists to replace.
    // 30 buckets, budget 12 — the ordinary case (more buckets than budget).
    // A realistic latency shape: mostly fast requests with one slow outlier per
    // bucket. (σ is measured across the whole set, so a 50/50 bimodal split
    // would push 2σ above the in-bucket gap and legitimately keep one marker.)
    const exemplars = Array.from({ length: 30 }, (_, i) => [
      ex({ traceId: `slow-${i}`, timestamp: i * MINUTE, value: 5000 }),
      ...Array.from({ length: 10 }, (_, j) =>
        ex({
          traceId: `typical-${i}-${j}`,
          timestamp: i * MINUTE + j + 1,
          value: 10 + j,
        }),
      ),
    ]).flat();

    const points = computeExemplarPoints(exemplars, opts);

    // At least one bucket contributed both its peak and its typical trace.
    const byBucket = new Map<number, number>();
    for (const p of points) {
      const bucket = Math.floor(p.exemplar.timestamp / MINUTE);
      byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + 1);
    }
    expect(Math.max(...byBucket.values())).toBeGreaterThan(1);
    // A typical trace made it onto the chart, not just the bucket maxima.
    expect(points.some(p => p.y < 100)).toBe(true);
    expect(points.length).toBeLessThanOrEqual(12);
  });

  it('picks the peak of each window, not a fixed stride', () => {
    // Spikes sit at minutes 3 and 8. A stride of 5 would sample minutes 0 and 5
    // and miss both — on a latency chart those are the only markers worth
    // having.
    const exemplars = Array.from({ length: 10 }, (_, i) =>
      ex({
        traceId: `t${i}`,
        timestamp: i * MINUTE,
        value: i === 3 || i === 8 ? 5000 : 10,
      }),
    );
    const points = computeExemplarPoints(exemplars, {
      ...opts,
      maxExemplars: 2,
    });
    expect(points.map(p => p.x)).toEqual([
      (3 * MINUTE) / 1000,
      (8 * MINUTE) / 1000,
    ]);
  });

  it('never returns more than the marker budget', () => {
    const exemplars = Array.from({ length: 50 }, (_, i) =>
      ex({ traceId: `t${i}`, timestamp: i * MINUTE, value: i * 100 }),
    );
    expect(
      computeExemplarPoints(exemplars, { ...opts, maxExemplars: 7 }).length,
    ).toBeLessThanOrEqual(7);
  });

  it('treats a fractional or non-finite budget as a usable one', () => {
    // maxExemplars comes from a team setting; a value below 1 used to produce
    // zero windows and silently empty the overlay.
    const exemplars = Array.from({ length: 5 }, (_, i) =>
      ex({ traceId: `t${i}`, timestamp: i * MINUTE, value: i + 1 }),
    );
    expect(
      computeExemplarPoints(exemplars, { ...opts, maxExemplars: 0.5 }).length,
    ).toBeGreaterThan(0);
    expect(
      computeExemplarPoints(exemplars, { ...opts, maxExemplars: NaN }).length,
    ).toBeGreaterThan(0);
  });

  it('drops non-finite values so one Infinity cannot disable 2σ sampling', () => {
    // Infinity used to pass the filter, make the standard deviation NaN, and
    // switch the spread rule off for the entire chart.
    const points = computeExemplarPoints(
      [
        ex({ traceId: 'inf', timestamp: 1000, value: Infinity }),
        ex({ traceId: 'ok', timestamp: 1000, value: 5 }),
      ],
      opts,
    );
    expect(points.map(p => p.y)).toEqual([5]);
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

describe('clampExemplarX', () => {
  // The domain's upper bound is the last *bucket start* when
  // dateRangeEndInclusive is false, so an exemplar inside that final bucket sits
  // past it and recharts' ifOverflow="discard" drops it — losing the newest
  // window, which is the one a live investigation is watching.
  it('pins a marker past the domain end onto the last bucket', () => {
    expect(clampExemplarX(1_700_000_120, [1_700_000_000, 1_700_000_060])).toBe(
      1_700_000_060,
    );
  });

  it('pins a marker before the domain start onto the first bucket', () => {
    expect(clampExemplarX(1_699_999_900, [1_700_000_000, 1_700_000_060])).toBe(
      1_700_000_000,
    );
  });

  it('leaves an in-domain marker exactly where it is', () => {
    expect(clampExemplarX(1_700_000_030, [1_700_000_000, 1_700_000_060])).toBe(
      1_700_000_030,
    );
  });

  it('leaves x untouched for a degenerate or inverted domain', () => {
    // Better an occasionally-discarded marker than one pinned to a meaningless
    // position — same rule as clampExemplarY.
    expect(clampExemplarX(42, [NaN, 100])).toBe(42);
    expect(clampExemplarX(42, [100, NaN])).toBe(42);
    expect(clampExemplarX(42, [100, 0])).toBe(42);
  });
});
