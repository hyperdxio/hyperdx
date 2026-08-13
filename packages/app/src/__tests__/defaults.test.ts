import type { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/types';

import {
  DEFAULT_MAX_TILE_RESULT_ROWS,
  didResultOverflow,
  hasOuterLimit,
  resolveDidOverflow,
  resolveMaxResultRowsValue,
  resolveResultRowLimitSettings,
  resolveTileMaxResultRows,
} from '@/defaults';

describe('resolveMaxResultRowsValue', () => {
  it('requests one row of headroom above the cap', () => {
    // cap + 1 lets a complete result of exactly `cap` rows come back whole,
    // while anything larger trips the break.
    expect(resolveMaxResultRowsValue(5000)).toBe(5001);
    expect(resolveMaxResultRowsValue(1)).toBe(2);
  });

  it('floors non-integer caps before adding headroom', () => {
    expect(resolveMaxResultRowsValue(99.9)).toBe(100);
  });

  it('returns undefined for a non-positive / absent cap (no limit applied)', () => {
    expect(resolveMaxResultRowsValue(undefined)).toBeUndefined();
    expect(resolveMaxResultRowsValue(0)).toBeUndefined();
    expect(resolveMaxResultRowsValue(-10)).toBeUndefined();
    expect(resolveMaxResultRowsValue(Number.POSITIVE_INFINITY)).toBeUndefined();
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

  it('does not flag a NaN row count', () => {
    // NaN > cap is false, so this is correct today; asserted to lock it in.
    expect(didResultOverflow({ rows: Number.NaN, cap })).toBe(false);
  });

  it('exposes a sane default cap', () => {
    expect(DEFAULT_MAX_TILE_RESULT_ROWS).toBe(5000);
  });
});

describe('resolveTileMaxResultRows', () => {
  const rawSqlConfig = {
    configType: 'sql',
    sqlTemplate: 'SELECT 1',
    connection: 'c',
  } as unknown as ChartConfigWithOptDateRange;
  const builderConfig = {
    connection: 'c',
    from: { databaseName: 'default', tableName: 't' },
    select: [{ aggFn: 'count', valueExpression: '' }],
    where: '',
    groupBy: 'k',
  } as unknown as ChartConfigWithOptDateRange;

  it('caps raw SQL tiles at the default', () => {
    expect(resolveTileMaxResultRows(rawSqlConfig)).toBe(
      DEFAULT_MAX_TILE_RESULT_ROWS,
    );
  });

  it('does NOT cap builder tiles (they bound cardinality elsewhere)', () => {
    expect(resolveTileMaxResultRows(builderConfig)).toBeUndefined();
  });

  it('returns undefined for an absent config', () => {
    expect(resolveTileMaxResultRows(undefined)).toBeUndefined();
    expect(resolveTileMaxResultRows(null)).toBeUndefined();
  });
});

describe('hasOuterLimit', () => {
  it('detects a trailing LIMIT (with optional offset / comma / semicolon / comment)', () => {
    expect(hasOuterLimit('SELECT * FROM t LIMIT 50')).toBe(true);
    expect(hasOuterLimit('SELECT * FROM t ORDER BY c DESC LIMIT 50')).toBe(
      true,
    );
    expect(hasOuterLimit('SELECT * FROM t limit 10')).toBe(true); // case-insensitive
    expect(hasOuterLimit('SELECT * FROM t LIMIT 50;')).toBe(true);
    expect(hasOuterLimit('SELECT * FROM t LIMIT 50  \n  ')).toBe(true);
    expect(hasOuterLimit('SELECT * FROM t LIMIT 10, 50')).toBe(true); // offset,count
    expect(hasOuterLimit('SELECT * FROM t LIMIT 50 OFFSET 10')).toBe(true);
    expect(hasOuterLimit('SELECT * FROM t LIMIT 50 -- trailing comment')).toBe(
      true,
    );
  });

  it('returns false when there is no outer LIMIT', () => {
    expect(hasOuterLimit('SELECT * FROM t')).toBe(false);
    expect(hasOuterLimit('SELECT k, count() FROM t GROUP BY k')).toBe(false);
  });

  it('detects an outer LIMIT followed by trailing SETTINGS / FORMAT / WITH TIES', () => {
    // ClickHouse allows these after LIMIT; missing them would wrongly enable the
    // group-by cap and corrupt the top-N (greptile P1).
    expect(
      hasOuterLimit('SELECT * FROM t LIMIT 50 SETTINGS max_threads=4'),
    ).toBe(true);
    expect(hasOuterLimit('SELECT * FROM t LIMIT 50 SETTINGS a=1, b=2;')).toBe(
      true,
    );
    expect(hasOuterLimit('SELECT * FROM t LIMIT 50 FORMAT JSON')).toBe(true);
    expect(hasOuterLimit('SELECT * FROM t ORDER BY c LIMIT 50 WITH TIES')).toBe(
      true,
    );
    expect(
      hasOuterLimit(
        'SELECT * FROM t LIMIT 50 WITH TIES SETTINGS max_threads=4',
      ),
    ).toBe(true);
    // SETTINGS wrapped onto multiple lines must still be consumed (greptile P1).
    expect(
      hasOuterLimit(
        'SELECT k, count() c FROM t GROUP BY k ORDER BY c DESC LIMIT 50 SETTINGS\n  max_threads=4,\n  max_memory_usage=1000',
      ),
    ).toBe(true);
  });

  it('detects an outer LIMIT followed by a trailing block comment', () => {
    // /* ... */ after the LIMIT must not defeat detection (greptile P1).
    expect(
      hasOuterLimit(
        'SELECT k, count() c FROM t GROUP BY k ORDER BY c DESC LIMIT 50 /* dashboard note */',
      ),
    ).toBe(true);
    expect(hasOuterLimit('SELECT * FROM t LIMIT 50 /* note */;')).toBe(true);
    expect(hasOuterLimit('SELECT * FROM t LIMIT 50\n/* multi\nline */')).toBe(
      true,
    );
  });

  it('detects an outer LIMIT … BY clause', () => {
    expect(hasOuterLimit('SELECT * FROM t ORDER BY c LIMIT 10 BY host')).toBe(
      true,
    );
    expect(hasOuterLimit('SELECT * FROM t LIMIT 2 BY host, region;')).toBe(
      true,
    );
    // `LIMIT … BY … LIMIT m` is caught via the trailing regular LIMIT.
    expect(hasOuterLimit('SELECT * FROM t LIMIT 1 BY host LIMIT 50')).toBe(
      true,
    );
  });

  it('does not treat a LIMIT inside a subquery as an outer LIMIT', () => {
    // Anchored to end-of-string: an inner LIMIT followed by more query is not
    // matched, so the cardinality cap can still apply.
    expect(
      hasOuterLimit('SELECT * FROM (SELECT * FROM t LIMIT 10) GROUP BY k'),
    ).toBe(false);
    expect(
      hasOuterLimit('SELECT * FROM (SELECT * FROM t LIMIT 5 BY h) GROUP BY k'),
    ).toBe(false);
  });

  it('does not treat a trailing SETTINGS / FORMAT without a LIMIT as an outer LIMIT', () => {
    expect(
      hasOuterLimit(
        'SELECT k, count() FROM t GROUP BY k SETTINGS max_threads=4',
      ),
    ).toBe(false);
    expect(hasOuterLimit('SELECT * FROM t FORMAT JSON')).toBe(false);
  });

  it('returns false for empty / non-string input', () => {
    expect(hasOuterLimit('')).toBe(false);
    expect(hasOuterLimit(undefined)).toBe(false);
  });
});

describe('resolveResultRowLimitSettings', () => {
  it('returns undefined for a non-positive / absent cap', () => {
    expect(resolveResultRowLimitSettings(undefined)).toBeUndefined();
    expect(resolveResultRowLimitSettings(0)).toBeUndefined();
    expect(resolveResultRowLimitSettings(-1)).toBeUndefined();
  });

  it('applies both the result-row and cardinality caps when there is no outer LIMIT', () => {
    const res = resolveResultRowLimitSettings(5000, { hasOuterLimit: false });
    expect(res).toEqual({
      cardinalityCapApplied: true,
      settings: {
        max_result_rows: '5001',
        result_overflow_mode: 'break',
        max_rows_to_group_by: '5001',
        // 'break' (deterministic stop), never 'any' (folds keys → corrupts top-N)
        group_by_overflow_mode: 'break',
      },
    });
  });

  it('applies only the order-preserving result-row cap when there is an outer LIMIT', () => {
    const res = resolveResultRowLimitSettings(5000, { hasOuterLimit: true });
    expect(res).toEqual({
      cardinalityCapApplied: false,
      settings: {
        max_result_rows: '5001',
        result_overflow_mode: 'break',
      },
    });
  });

  it('defaults to applying the cardinality cap when the option is omitted', () => {
    expect(resolveResultRowLimitSettings(10)?.cardinalityCapApplied).toBe(true);
  });
});

describe('resolveDidOverflow', () => {
  it('is false until the result is complete (no mid-stream flap)', () => {
    expect(
      resolveDidOverflow({
        isPlaceholderData: false,
        isComplete: false,
        didOverflow: true,
      }),
    ).toBe(false);
  });

  it('is false while showing stale placeholder data (no lingering banner)', () => {
    expect(
      resolveDidOverflow({
        isPlaceholderData: true,
        isComplete: true,
        didOverflow: true,
      }),
    ).toBe(false);
  });

  it('reflects the result once complete and fresh', () => {
    expect(
      resolveDidOverflow({
        isPlaceholderData: false,
        isComplete: true,
        didOverflow: true,
      }),
    ).toBe(true);
    expect(
      resolveDidOverflow({
        isPlaceholderData: false,
        isComplete: true,
        didOverflow: false,
      }),
    ).toBe(false);
  });

  it('treats an undefined didOverflow as false', () => {
    expect(
      resolveDidOverflow({
        isPlaceholderData: false,
        isComplete: true,
        didOverflow: undefined,
      }),
    ).toBe(false);
  });
});
