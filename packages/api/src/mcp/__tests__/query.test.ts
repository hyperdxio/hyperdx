// Mock heavy dependencies that break in unit-test context (no ClickHouse/Mongo)
jest.mock('@/models/source', () => ({}));
jest.mock('@/controllers/sources', () => ({}));
jest.mock('@/controllers/connection', () => ({}));
jest.mock('@/utils/trimToolResponse', () => ({
  trimToolResponse: (data: unknown) => ({ data, isTrimmed: false }),
}));

import {
  errorHint,
  mergeWhereIntoSelectItems,
  parseTimeRange,
} from '../tools/query/helpers';
import { resolveOrderBy } from '../tools/query/table';

describe('parseTimeRange', () => {
  it('should return default range (last 15 minutes) when no arguments provided', () => {
    const before = Date.now();
    const result = parseTimeRange();
    const after = Date.now();

    expect(result).not.toHaveProperty('error');
    if ('error' in result) return;

    // endDate should be approximately now
    expect(result.endDate.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.endDate.getTime()).toBeLessThanOrEqual(after);
    // startDate should be ~15 minutes before endDate
    const diffMs = result.endDate.getTime() - result.startDate.getTime();
    expect(diffMs).toBe(15 * 60 * 1000);
  });

  it('should use provided startTime and endTime', () => {
    const result = parseTimeRange(
      '2025-01-01T00:00:00Z',
      '2025-01-02T00:00:00Z',
    );
    expect(result).not.toHaveProperty('error');
    if ('error' in result) return;

    expect(result.startDate.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(result.endDate.toISOString()).toBe('2025-01-02T00:00:00.000Z');
  });

  it('should default startTime to 15 minutes before endTime', () => {
    const result = parseTimeRange(undefined, '2025-06-15T10:00:00Z');
    expect(result).not.toHaveProperty('error');
    if ('error' in result) return;

    expect(result.endDate.toISOString()).toBe('2025-06-15T10:00:00.000Z');
    expect(result.startDate.toISOString()).toBe('2025-06-15T09:45:00.000Z');
  });

  it('should default endTime to now', () => {
    const before = Date.now();
    const result = parseTimeRange('2025-06-15T11:00:00Z');
    const after = Date.now();

    expect(result).not.toHaveProperty('error');
    if ('error' in result) return;

    expect(result.startDate.toISOString()).toBe('2025-06-15T11:00:00.000Z');
    expect(result.endDate.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.endDate.getTime()).toBeLessThanOrEqual(after);
  });

  it('should return error for invalid startTime', () => {
    const result = parseTimeRange('not-a-date', '2025-01-01T00:00:00Z');
    expect(result).toHaveProperty('error');
    if (!('error' in result)) return;

    expect(result.error).toContain('Invalid');
  });

  it('should return error for invalid endTime', () => {
    const result = parseTimeRange('2025-01-01T00:00:00Z', 'garbage');
    expect(result).toHaveProperty('error');
    if (!('error' in result)) return;

    expect(result.error).toContain('Invalid');
  });

  it('should return error when both times are invalid', () => {
    const result = parseTimeRange('bad', 'also-bad');
    expect(result).toHaveProperty('error');
  });
});

// ─── mergeWhereIntoSelectItems ───────────────────────────────────────────────

describe('mergeWhereIntoSelectItems', () => {
  it('should return items unchanged when topWhere is empty', () => {
    const items = [{ where: 'level:error', whereLanguage: 'lucene' as const }];
    const { items: result, warnings } = mergeWhereIntoSelectItems(
      items,
      '',
      'lucene',
    );
    expect(result).toBe(items); // same reference, not a copy
    expect(warnings).toHaveLength(0);
  });

  it('should inject top-level where when item has no where', () => {
    const items = [{ where: '', whereLanguage: 'lucene' as const }];
    const { items: result, warnings } = mergeWhereIntoSelectItems(
      items,
      'service:api',
      'lucene',
    );
    expect(result[0].where).toBe('service:api');
    expect(result[0].whereLanguage).toBe('lucene');
    expect(warnings).toHaveLength(0);
  });

  it('should AND-combine when languages match', () => {
    const items = [{ where: 'level:error', whereLanguage: 'lucene' as const }];
    const { items: result, warnings } = mergeWhereIntoSelectItems(
      items,
      'service:api',
      'lucene',
    );
    expect(result[0].where).toBe('(service:api) AND (level:error)');
    expect(result[0].whereLanguage).toBe('lucene');
    expect(warnings).toHaveLength(0);
  });

  it('should AND-combine SQL filters when both use sql', () => {
    const items = [
      { where: 'StatusCode >= 500', whereLanguage: 'sql' as const },
    ];
    const { items: result, warnings } = mergeWhereIntoSelectItems(
      items,
      "ServiceName = 'api'",
      'sql',
    );
    expect(result[0].where).toBe(
      "(ServiceName = 'api') AND (StatusCode >= 500)",
    );
    expect(result[0].whereLanguage).toBe('sql');
    expect(warnings).toHaveLength(0);
  });

  it('should skip item and emit warning when languages differ', () => {
    const items = [
      { where: 'StatusCode >= 500', whereLanguage: 'sql' as const },
    ];
    const { items: result, warnings } = mergeWhereIntoSelectItems(
      items,
      'service:api',
      'lucene',
    );
    // Item's own where is kept unchanged
    expect(result[0].where).toBe('StatusCode >= 500');
    expect(result[0].whereLanguage).toBe('sql');
    // A warning is emitted
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('select[0]');
    expect(warnings[0]).toContain('was NOT applied');
  });

  it('should handle mixed items — some merged, some skipped', () => {
    const items = [
      { where: 'level:error', whereLanguage: 'lucene' as const },
      { where: 'StatusCode >= 500', whereLanguage: 'sql' as const },
      { where: '', whereLanguage: 'lucene' as const },
    ];
    const { items: result, warnings } = mergeWhereIntoSelectItems(
      items,
      'service:api',
      'lucene',
    );
    // Item 0: merged (both lucene)
    expect(result[0].where).toBe('(service:api) AND (level:error)');
    // Item 1: skipped (sql vs lucene)
    expect(result[1].where).toBe('StatusCode >= 500');
    // Item 2: injected (empty where)
    expect(result[2].where).toBe('service:api');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('select[1]');
  });
});

// ─── errorHint ───────────────────────────────────────────────────────────────

describe('errorHint', () => {
  it('should match DateTime64 conversion errors', () => {
    const hint = errorHint(
      "Cannot convert string '2025-01-01T00:00:00Z' to type DateTime64(9)",
    );
    expect(hint).not.toBeNull();
    expect(hint).toContain('parseDateTime64BestEffort');
  });

  it('should match DateTime64 parse errors', () => {
    const hint = errorHint(
      "Cannot parse string '2025-01-01' as type DateTime64",
    );
    expect(hint).not.toBeNull();
    expect(hint).toContain('parseDateTime64BestEffort');
  });

  it('should match AS alias syntax errors with word boundary', () => {
    const hint = errorHint('Syntax error: unexpected token AS');
    expect(hint).not.toBeNull();
    expect(hint).toContain('alias');
  });

  it('should NOT match AS embedded in other words like DATABASE', () => {
    const hint = errorHint("Syntax error: Unknown database 'FOOBAR'");
    expect(hint).toBeNull();
  });

  it('should NOT match lowercase "as" in cast expressions', () => {
    const hint = errorHint(
      'Syntax error: cannot cast as Float64 near token...',
    );
    expect(hint).toBeNull();
  });

  it('should match V8 string length overflow', () => {
    const hint = errorHint(
      'response length exceeds the maximum allowed size of V8 String',
    );
    expect(hint).not.toBeNull();
    expect(hint).toContain('LIMIT');
  });

  it('should match RESULT_IS_TOO_LARGE errors', () => {
    const hint = errorHint('Code: 396. DB::Exception: RESULT_IS_TOO_LARGE');
    expect(hint).not.toBeNull();
    expect(hint).toContain('100,000 rows');
    expect(hint).toContain('LIMIT');
  });

  it('should match TOO_MANY_ROWS_OR_BYTES errors', () => {
    const hint = errorHint('Code: 396. DB::Exception: TOO_MANY_ROWS_OR_BYTES');
    expect(hint).not.toBeNull();
    expect(hint).toContain('100,000 rows');
  });

  it('should return null for unrecognized errors', () => {
    const hint = errorHint('Connection refused');
    expect(hint).toBeNull();
  });
});

// ─── resolveOrderBy ──────────────────────────────────────────────────────────

describe('resolveOrderBy', () => {
  it('should return undefined when orderBy is undefined', () => {
    expect(resolveOrderBy(undefined, [{ aggFn: 'count' }])).toBeUndefined();
  });

  it('should pass through non-aggFn values unchanged', () => {
    expect(resolveOrderBy('SpanName', [{ aggFn: 'count' }])).toBe('SpanName');
  });

  it('should keep orderBy when it matches an alias', () => {
    expect(resolveOrderBy('Total', [{ aggFn: 'count', alias: 'Total' }])).toBe(
      'Total',
    );
  });

  it('should return canonical alias case for case-insensitive match', () => {
    expect(resolveOrderBy('total', [{ aggFn: 'count', alias: 'Total' }])).toBe(
      'Total',
    );
    expect(
      resolveOrderBy('TOTAL DESC', [{ aggFn: 'count', alias: 'Total' }]),
    ).toBe('Total DESC');
  });

  it('should synthesize count()', () => {
    expect(resolveOrderBy('count', [{ aggFn: 'count' }])).toBe('count()');
  });

  it('should synthesize avg(Duration)', () => {
    expect(
      resolveOrderBy('avg', [{ aggFn: 'avg', valueExpression: 'Duration' }]),
    ).toBe('avg(Duration)');
  });

  it('should synthesize quantile with level', () => {
    expect(
      resolveOrderBy('quantile', [
        { aggFn: 'quantile', valueExpression: 'Duration', level: 0.99 },
      ]),
    ).toBe('quantile(0.99)(Duration)');
  });

  it('should prefer alias over synthesized expression', () => {
    expect(
      resolveOrderBy('count', [{ aggFn: 'count', alias: 'Total Rows' }]),
    ).toBe('Total Rows');
  });

  it('should be case-insensitive for aggFn matching', () => {
    expect(resolveOrderBy('Count', [{ aggFn: 'count' }])).toBe('count()');
    expect(
      resolveOrderBy('AVG', [{ aggFn: 'avg', valueExpression: 'Duration' }]),
    ).toBe('avg(Duration)');
  });

  it('should synthesize count(DISTINCT ...) for count_distinct', () => {
    expect(
      resolveOrderBy('count_distinct', [
        { aggFn: 'count_distinct', valueExpression: 'UserId' },
      ]),
    ).toBe('count(DISTINCT UserId)');
  });

  it('should synthesize count(DISTINCT ...) with direction', () => {
    expect(
      resolveOrderBy('count_distinct DESC', [
        { aggFn: 'count_distinct', valueExpression: 'UserId' },
      ]),
    ).toBe('count(DISTINCT UserId) DESC');
  });

  it('should NOT synthesize for "none" aggFn', () => {
    expect(
      resolveOrderBy('none', [
        { aggFn: 'none', valueExpression: 'Duration / 1e6' },
      ]),
    ).toBe('none');
  });

  it('should handle trailing ASC/DESC', () => {
    expect(resolveOrderBy('count DESC', [{ aggFn: 'count' }])).toBe(
      'count() DESC',
    );
    expect(
      resolveOrderBy('avg ASC', [
        { aggFn: 'avg', valueExpression: 'Duration' },
      ]),
    ).toBe('avg(Duration) ASC');
  });

  it('should pass through quantile without level unchanged', () => {
    expect(
      resolveOrderBy('quantile', [
        { aggFn: 'quantile', valueExpression: 'Duration' },
      ]),
    ).toBe('quantile');
  });
});
