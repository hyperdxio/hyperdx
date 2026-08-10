import {
  DEFAULT_MAX_TILE_RESULT_ROWS,
  didResultOverflow,
  resolveResultRowLimitSetting,
} from '@/defaults';

describe('resolveResultRowLimitSetting', () => {
  it('requests one row of headroom above the cap', () => {
    // cap + 1 lets a complete result of exactly `cap` rows come back whole,
    // while anything larger trips the break.
    expect(resolveResultRowLimitSetting(5000)).toBe(5001);
    expect(resolveResultRowLimitSetting(1)).toBe(2);
  });

  it('floors non-integer caps before adding headroom', () => {
    expect(resolveResultRowLimitSetting(99.9)).toBe(100);
  });

  it('returns undefined for a non-positive / absent cap (no limit applied)', () => {
    expect(resolveResultRowLimitSetting(undefined)).toBeUndefined();
    expect(resolveResultRowLimitSetting(0)).toBeUndefined();
    expect(resolveResultRowLimitSetting(-10)).toBeUndefined();
    expect(
      resolveResultRowLimitSetting(Number.POSITIVE_INFINITY),
    ).toBeUndefined();
  });
});

describe('didResultOverflow', () => {
  const cap = 5000;

  it('returns false when no cap is applied', () => {
    expect(didResultOverflow({ rows: 999999, cap: undefined })).toBe(false);
    expect(didResultOverflow({ rows: 999999, cap: 0 })).toBe(false);
    expect(
      didResultOverflow({ rows: 999999, cap: Number.POSITIVE_INFINITY }),
    ).toBe(false);
  });

  it('does NOT flag a complete result of exactly the cap (no truncation)', () => {
    // With cap + 1 headroom, a real result of exactly `cap` rows comes back
    // whole — nothing was dropped, so no banner.
    expect(didResultOverflow({ rows: cap, cap })).toBe(false);
  });

  it('detects overflow when rows exceed the cap', () => {
    // break returns cap + 1 (block-aligned, possibly more) once the underlying
    // result is larger than the cap.
    expect(didResultOverflow({ rows: cap + 1, cap })).toBe(true);
    expect(didResultOverflow({ rows: cap + 500, cap })).toBe(true);
  });

  it('does NOT flag when the query has its own LIMIT that trims a large aggregation', () => {
    // Regression: a raw SQL tile ending in `... LIMIT 50` over a 6,250-group
    // aggregation returns exactly 50 rows. ClickHouse reports
    // rows_before_limit_at_least = 6250, but the tile received only 50 rows —
    // nothing was truncated by our cap, so there must be no banner. We rely on
    // the returned `rows` only, so this is inherently safe.
    expect(didResultOverflow({ rows: 50, cap })).toBe(false);
  });

  it('returns false for a normal under-cap result', () => {
    expect(didResultOverflow({ rows: 42, cap })).toBe(false);
    expect(didResultOverflow({ rows: 0, cap })).toBe(false);
  });

  it('handles a missing row count gracefully', () => {
    expect(didResultOverflow({ rows: undefined, cap })).toBe(false);
  });

  it('exposes a sane default cap', () => {
    expect(DEFAULT_MAX_TILE_RESULT_ROWS).toBe(5000);
  });
});
