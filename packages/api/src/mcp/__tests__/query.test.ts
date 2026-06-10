// Mock heavy dependencies that break in unit-test context (no ClickHouse/Mongo)
jest.mock('@/models/source', () => ({}));
jest.mock('@/controllers/sources', () => ({}));
jest.mock('@/controllers/connection', () => ({}));
jest.mock('@/utils/trimToolResponse', () => ({
  trimToolResponse: (data: unknown) => ({ data, isTrimmed: false }),
}));

import {
  annotateIncreaseTopNHint,
  errorHint,
  INCREASE_TOP_N_CAP,
  mergeWhereIntoSelectItems,
  parseTimeRange,
} from '../tools/query/helpers';
import {
  applyMetricSelectDefaults,
  getMetricSelectIssues,
  validateMetricSelectItems,
} from '../tools/query/schemas';
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
    expect(hint).toContain('too many rows');
    expect(hint).toContain('LIMIT');
  });

  it('should match TOO_MANY_ROWS_OR_BYTES errors', () => {
    const hint = errorHint('Code: 396. DB::Exception: TOO_MANY_ROWS_OR_BYTES');
    expect(hint).not.toBeNull();
    expect(hint).toContain('too many rows');
  });

  it('should match SETTING_CONSTRAINT_VIOLATION errors', () => {
    const hint = errorHint(
      "Setting max_result_rows shouldn't be greater than 1000. (SETTING_CONSTRAINT_VIOLATION)",
    );
    expect(hint).not.toBeNull();
    expect(hint).toContain('profile');
    expect(hint).toContain('constraint');
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

  it('should NOT synthesize for "increase" aggFn (metric-only marker)', () => {
    // increase compiles to a multi-CTE sum(Rate) pipeline in the renderer,
    // not a standalone SQL function. resolveOrderBy must leave bare
    // "increase" alone so the renderer-assigned alias can take over.
    expect(
      resolveOrderBy('increase', [
        { aggFn: 'increase', valueExpression: 'Value' },
      ]),
    ).toBe('increase');
  });
});

// ─── getMetricSelectIssues ───────────────────────────────────────────────────

describe('getMetricSelectIssues', () => {
  it('returns no issues for a plain non-metric count', () => {
    expect(getMetricSelectIssues({ aggFn: 'count' })).toEqual([]);
  });

  it('returns no issues for a plain non-metric avg with valueExpression', () => {
    expect(
      getMetricSelectIssues({ aggFn: 'avg', valueExpression: 'Duration' }),
    ).toEqual([]);
  });

  it('requires valueExpression for non-count non-metric aggregations', () => {
    const issues = getMetricSelectIssues({ aggFn: 'avg' });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['valueExpression']);
    expect(issues[0].message).toContain('required for non-count');
  });

  it('does NOT require valueExpression when metricType is set', () => {
    // valueExpression defaults to "Value" for metric sources
    expect(
      getMetricSelectIssues({
        aggFn: 'avg',
        metricType: 'gauge',
        metricName: 'system.cpu.utilization',
      }),
    ).toEqual([]);
  });

  it('rejects valueExpression on aggFn:"count"', () => {
    const issues = getMetricSelectIssues({
      aggFn: 'count',
      valueExpression: 'Duration',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['valueExpression']);
  });

  it('rejects metricType without metricName', () => {
    const issues = getMetricSelectIssues({
      aggFn: 'avg',
      metricType: 'gauge',
    });
    expect(issues.find(i => i.path[0] === 'metricName')).toBeDefined();
  });

  it('rejects metricName without metricType', () => {
    const issues = getMetricSelectIssues({
      aggFn: 'avg',
      metricName: 'system.cpu.utilization',
    });
    expect(issues.find(i => i.path[0] === 'metricType')).toBeDefined();
  });

  it('rejects aggFn:"increase" on a gauge metric', () => {
    const issues = getMetricSelectIssues({
      aggFn: 'increase',
      metricType: 'gauge',
      metricName: 'system.cpu.utilization',
    });
    expect(issues.find(i => i.path[0] === 'aggFn')).toBeDefined();
  });

  it('accepts aggFn:"increase" on a sum metric', () => {
    expect(
      getMetricSelectIssues({
        aggFn: 'increase',
        metricType: 'sum',
        metricName: 'http.server.request.count',
      }),
    ).toEqual([]);
  });

  it('rejects aggFn:"avg" on a histogram metric', () => {
    const issues = getMetricSelectIssues({
      aggFn: 'avg',
      metricType: 'histogram',
      metricName: 'http.server.request.duration',
    });
    expect(issues.find(i => i.path[0] === 'aggFn')).toBeDefined();
  });

  it('accepts aggFn:"count" on a histogram metric (no level required)', () => {
    expect(
      getMetricSelectIssues({
        aggFn: 'count',
        metricType: 'histogram',
        metricName: 'http.server.request.duration',
      }),
    ).toEqual([]);
  });

  it('requires level for aggFn:"quantile" on a histogram metric', () => {
    const issues = getMetricSelectIssues({
      aggFn: 'quantile',
      metricType: 'histogram',
      metricName: 'http.server.request.duration',
    });
    expect(issues.find(i => i.path[0] === 'level')).toBeDefined();
  });

  it('accepts aggFn:"quantile" with level on a histogram metric', () => {
    expect(
      getMetricSelectIssues({
        aggFn: 'quantile',
        level: 0.95,
        metricType: 'histogram',
        metricName: 'http.server.request.duration',
      }),
    ).toEqual([]);
  });

  it('rejects isDelta on a non-gauge metric', () => {
    const issues = getMetricSelectIssues({
      aggFn: 'sum',
      metricType: 'sum',
      metricName: 'http.request.count',
      isDelta: true,
    });
    expect(issues.find(i => i.path[0] === 'isDelta')).toBeDefined();
  });

  it('accepts isDelta on a gauge metric', () => {
    expect(
      getMetricSelectIssues({
        aggFn: 'avg',
        metricType: 'gauge',
        metricName: 'system.cpu.utilization',
        isDelta: true,
      }),
    ).toEqual([]);
  });

  it('rejects level when aggFn is not quantile', () => {
    const issues = getMetricSelectIssues({
      aggFn: 'avg',
      valueExpression: 'Duration',
      level: 0.95,
    });
    expect(issues.find(i => i.path[0] === 'level')).toBeDefined();
  });
});

// ─── validateMetricSelectItems ───────────────────────────────────────────────

describe('validateMetricSelectItems', () => {
  it('returns null for a valid items array', () => {
    expect(
      validateMetricSelectItems([
        { aggFn: 'count' },
        { aggFn: 'avg', valueExpression: 'Duration' },
      ]),
    ).toBeNull();
  });

  it('returns an error envelope and labels each item by index', () => {
    const result = validateMetricSelectItems([
      { aggFn: 'avg' }, // missing valueExpression
      { aggFn: 'increase', metricType: 'gauge', metricName: 'x' }, // increase requires sum
    ]);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    const text = result.content[0].text;
    expect(text).toContain('select[0].valueExpression');
    expect(text).toContain('select[1].aggFn');
  });

  it('returns an error envelope for a single bad item', () => {
    const result = validateMetricSelectItems([
      {
        aggFn: 'quantile',
        metricType: 'histogram',
        metricName: 'http.server.request.duration',
      }, // missing level
    ]);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.content[0].text).toContain('select[0].level');
  });
});

// ─── applyMetricSelectDefaults ───────────────────────────────────────────────

// Typed as McpSelectItem so the inferred generic preserves the
// optional valueExpression field. Otherwise structural inference
// narrows away `valueExpression` and the assertions below stop
// type-checking.
type SelectItem = {
  aggFn: string;
  metricType?: 'gauge' | 'sum' | 'histogram';
  metricName?: string;
  valueExpression?: string;
};

describe('applyMetricSelectDefaults', () => {
  it('defaults valueExpression to "Value" when metricType is set', () => {
    const input: SelectItem[] = [
      {
        aggFn: 'avg',
        metricType: 'gauge',
        metricName: 'system.cpu.utilization',
      },
    ];
    const out = applyMetricSelectDefaults(input);
    expect(out[0].valueExpression).toBe('Value');
  });

  it('preserves an explicit valueExpression on metric items', () => {
    const input: SelectItem[] = [
      {
        aggFn: 'avg',
        metricType: 'gauge',
        metricName: 'x',
        valueExpression: 'Value * 100',
      },
    ];
    const out = applyMetricSelectDefaults(input);
    expect(out[0].valueExpression).toBe('Value * 100');
  });

  it('leaves non-metric items untouched', () => {
    const input: SelectItem[] = [{ aggFn: 'count' }];
    const out = applyMetricSelectDefaults(input);
    expect(out[0]).toEqual({ aggFn: 'count' });
    expect(out[0].valueExpression).toBeUndefined();
  });

  it('returns new objects only for the items it mutates', () => {
    const input: SelectItem[] = [
      { aggFn: 'count' },
      { aggFn: 'avg', metricType: 'gauge', metricName: 'x' },
    ];
    const out = applyMetricSelectDefaults(input);
    expect(out[0]).toBe(input[0]); // unchanged item is the same reference
    expect(out[1]).not.toBe(input[1]); // mutated item is a new object
  });
});

// ─── annotateIncreaseTopNHint ────────────────────────────────────────────────

function buildResult(data: unknown[]) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ result: { data } }),
      },
    ],
    isError: false,
  };
}

describe('annotateIncreaseTopNHint', () => {
  it('exposes the renderer cap as a constant', () => {
    expect(INCREASE_TOP_N_CAP).toBe(20);
  });

  it('appends a hint when increase + groupBy is used and result is non-empty', () => {
    const result = buildResult([{ x: 1 }, { x: 2 }]);
    annotateIncreaseTopNHint(result, [{ aggFn: 'increase' }], 'ServiceName');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.hint).toContain('top 20');
    expect(parsed.hint).toContain('aggFn:"increase"');
  });

  it('does NOT annotate when increase is used WITHOUT a groupBy', () => {
    const result = buildResult([{ x: 1 }]);
    annotateIncreaseTopNHint(result, [{ aggFn: 'increase' }], undefined);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.hint).toBeUndefined();
  });

  it('does NOT annotate when groupBy is an empty string', () => {
    const result = buildResult([{ x: 1 }]);
    annotateIncreaseTopNHint(result, [{ aggFn: 'increase' }], '   ');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.hint).toBeUndefined();
  });

  it('does NOT annotate when no select item uses increase', () => {
    const result = buildResult([{ x: 1 }]);
    annotateIncreaseTopNHint(
      result,
      [{ aggFn: 'sum' }, { aggFn: 'avg' }],
      'ServiceName',
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.hint).toBeUndefined();
  });

  it('does NOT annotate empty results (already labelled by formatQueryResult)', () => {
    const result = buildResult([]);
    annotateIncreaseTopNHint(result, [{ aggFn: 'increase' }], 'ServiceName');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.hint).toBeUndefined();
  });

  it('does NOT annotate error results', () => {
    const result = {
      content: [{ type: 'text', text: 'an error message' }],
      isError: true,
    };
    annotateIncreaseTopNHint(result, [{ aggFn: 'increase' }], 'ServiceName');
    expect(result.content[0].text).toBe('an error message');
  });

  it('leaves unparseable text content unchanged', () => {
    const result = {
      content: [{ type: 'text', text: 'not json' }],
      isError: false,
    };
    annotateIncreaseTopNHint(result, [{ aggFn: 'increase' }], 'ServiceName');
    expect(result.content[0].text).toBe('not json');
  });

  it('is a no-op when content is missing', () => {
    const result = {} as Parameters<typeof annotateIncreaseTopNHint>[0];
    expect(() =>
      annotateIncreaseTopNHint(result, [{ aggFn: 'increase' }], 'ServiceName'),
    ).not.toThrow();
  });
});
