import {
  applyTopNAggregation,
  computeComparisonScore,
  computeDistributionScore,
  computeEffectiveSampleSize,
  computeEntropyScore,
  computeYValue,
  flattenedKeyToFilterKey,
  flattenedKeyToSqlExpression,
  isDenylisted,
  isHighCardinality,
  isIdField,
  isTimestampArrayField,
  MAX_CHART_VALUES,
  MAX_CHART_VALUES_UPPER,
  MAX_SAMPLE_SIZE,
  MIN_SAMPLE_SIZE,
  SAMPLE_RATIO,
  SAMPLE_SIZE,
  semanticBoost,
} from '../deltaChartUtils';

const traceColumnMeta = [
  { name: 'Timestamp', type: 'DateTime64(9)' },
  { name: 'TraceId', type: 'String' },
  { name: 'SpanId', type: 'String' },
  { name: 'ParentSpanId', type: 'String' },
  { name: 'ResourceAttributes', type: 'Map(String, String)' },
  { name: 'SpanAttributes', type: 'Map(String, String)' },
  { name: 'Events.Timestamp', type: 'Array(DateTime64(9))' },
  { name: 'Events.Name', type: 'Array(String)' },
  { name: 'Events.Attributes', type: 'Array(Map(String, String))' },
  { name: 'Links.TraceId', type: 'Array(String)' },
  { name: 'Links.SpanId', type: 'Array(String)' },
  { name: 'Links.Timestamp', type: 'Array(DateTime64(9))' },
  { name: 'Links.Attributes', type: 'Array(Map(String, String))' },
];

describe('flattenedKeyToSqlExpression', () => {
  it('converts Map column dot-notation to bracket notation', () => {
    expect(
      flattenedKeyToSqlExpression('ResourceAttributes.service.name', traceColumnMeta),
    ).toBe("ResourceAttributes['service.name']");
  });

  it('converts SpanAttributes dot-notation to bracket notation', () => {
    expect(
      flattenedKeyToSqlExpression('SpanAttributes.http.method', traceColumnMeta),
    ).toBe("SpanAttributes['http.method']");
  });

  it('converts Array(Map) dot-notation with 0-based index to 1-based bracket notation', () => {
    expect(
      flattenedKeyToSqlExpression('Events.Attributes[0].message.type', traceColumnMeta),
    ).toBe("Events.Attributes[1]['message.type']");
  });

  it('increments the array index from 0-based JS to 1-based ClickHouse', () => {
    expect(
      flattenedKeyToSqlExpression('Events.Attributes[4].key', traceColumnMeta),
    ).toBe("Events.Attributes[5]['key']");
  });

  it('handles Links.Attributes Array(Map) correctly', () => {
    expect(
      flattenedKeyToSqlExpression('Links.Attributes[0].some.key', traceColumnMeta),
    ).toBe("Links.Attributes[1]['some.key']");
  });

  it('returns simple columns unchanged', () => {
    expect(
      flattenedKeyToSqlExpression('TraceId', traceColumnMeta),
    ).toBe('TraceId');
  });

  it('returns non-map nested columns unchanged (e.g., Arrays of primitives)', () => {
    expect(
      flattenedKeyToSqlExpression('Events.Name[0]', traceColumnMeta),
    ).toBe('Events.Name[0]');
  });

  it('returns key unchanged when no matching column found', () => {
    expect(
      flattenedKeyToSqlExpression('SomeUnknownColumn.key', traceColumnMeta),
    ).toBe('SomeUnknownColumn.key');
  });

  it('handles LowCardinality(Map) wrapped types', () => {
    const meta = [
      { name: 'LogAttributes', type: 'LowCardinality(Map(String, String))' },
    ];
    expect(
      flattenedKeyToSqlExpression('LogAttributes.level', meta),
    ).toBe("LogAttributes['level']");
  });

  it('handles Nullable(Map) wrapped types', () => {
    const meta = [{ name: 'Attrs', type: 'Nullable(Map(String, String))' }];
    expect(
      flattenedKeyToSqlExpression('Attrs.some.key', meta),
    ).toBe("Attrs['some.key']");
  });

  it('returns key unchanged for empty columnMeta', () => {
    expect(flattenedKeyToSqlExpression('ResourceAttributes.service.name', [])).toBe(
      'ResourceAttributes.service.name',
    );
  });

  it('escapes single quotes in Map column keys to prevent SQL injection', () => {
    expect(
      flattenedKeyToSqlExpression("ResourceAttributes.it's.key", traceColumnMeta),
    ).toBe("ResourceAttributes['it''s.key']");
  });

  it('escapes single quotes in Array(Map) column keys', () => {
    expect(
      flattenedKeyToSqlExpression("Events.Attributes[0].it's.key", traceColumnMeta),
    ).toBe("Events.Attributes[1]['it''s.key']");
  });
});

describe('flattenedKeyToFilterKey', () => {
  it('converts Map column dot-notation to toString with backtick-quoted segments', () => {
    expect(
      flattenedKeyToFilterKey('ResourceAttributes.service.name', traceColumnMeta),
    ).toBe("toString(ResourceAttributes.`service`.`name`)");
  });

  it('converts SpanAttributes Map keys to toString format', () => {
    expect(
      flattenedKeyToFilterKey('SpanAttributes.http.method', traceColumnMeta),
    ).toBe("toString(SpanAttributes.`http`.`method`)");
  });

  it('returns simple columns unchanged', () => {
    expect(
      flattenedKeyToFilterKey('TraceId', traceColumnMeta),
    ).toBe('TraceId');
  });

  it('returns simple columns unchanged for non-Map types', () => {
    expect(
      flattenedKeyToFilterKey('Timestamp', traceColumnMeta),
    ).toBe('Timestamp');
  });

  it('falls back to SQL expression for Array(Map) columns', () => {
    // Array(Map) sub-keys don't have sidebar facets, so use SQL expression
    expect(
      flattenedKeyToFilterKey('Events.Attributes[0].message.type', traceColumnMeta),
    ).toBe("Events.Attributes[1]['message.type']");
  });

  it('returns unknown column keys unchanged', () => {
    expect(
      flattenedKeyToFilterKey('SomeUnknownColumn.key', traceColumnMeta),
    ).toBe('SomeUnknownColumn.key');
  });
});

describe('isIdField', () => {
  it('identifies top-level String columns ending in Id', () => {
    expect(isIdField('TraceId', traceColumnMeta)).toBe(true);
    expect(isIdField('SpanId', traceColumnMeta)).toBe(true);
    expect(isIdField('ParentSpanId', traceColumnMeta)).toBe(true);
  });

  it('identifies Array(String) column elements whose name ends in Id', () => {
    expect(isIdField('Links.TraceId[0]', traceColumnMeta)).toBe(true);
    expect(isIdField('Links.SpanId[0]', traceColumnMeta)).toBe(true);
    expect(isIdField('Links.TraceId[5]', traceColumnMeta)).toBe(true);
  });

  it('identifies plain Array(String) column reference ending in Id', () => {
    expect(isIdField('Links.TraceId', traceColumnMeta)).toBe(true);
    expect(isIdField('Links.SpanId', traceColumnMeta)).toBe(true);
  });

  it('does not match non-ID String columns', () => {
    expect(isIdField('Timestamp', traceColumnMeta)).toBe(false);
    expect(isIdField('Events.Name[0]', traceColumnMeta)).toBe(false);
  });

  it('does not match Map or Array(Map) columns even if name ends in Id', () => {
    const meta = [{ name: 'MyMapId', type: 'Map(String, String)' }];
    expect(isIdField('MyMapId', meta)).toBe(false);
  });

  it('does not match keys with sub-keys after array index (Array(Map) paths)', () => {
    expect(isIdField('Events.Attributes[0].spanId', traceColumnMeta)).toBe(false);
  });

  it('returns false for unknown columns', () => {
    expect(isIdField('UnknownId', traceColumnMeta)).toBe(false);
  });

  it('returns false for empty columnMeta', () => {
    expect(isIdField('TraceId', [])).toBe(false);
  });
});

describe('isTimestampArrayField', () => {
  it('identifies Array(DateTime64) column elements by index', () => {
    expect(isTimestampArrayField('Events.Timestamp[0]', traceColumnMeta)).toBe(true);
    expect(isTimestampArrayField('Events.Timestamp[23]', traceColumnMeta)).toBe(true);
    expect(isTimestampArrayField('Links.Timestamp[0]', traceColumnMeta)).toBe(true);
  });

  it('identifies plain Array(DateTime64) column reference', () => {
    expect(isTimestampArrayField('Events.Timestamp', traceColumnMeta)).toBe(true);
    expect(isTimestampArrayField('Links.Timestamp', traceColumnMeta)).toBe(true);
  });

  it('does not match non-DateTime64 array columns', () => {
    expect(isTimestampArrayField('Events.Name[0]', traceColumnMeta)).toBe(false);
    expect(isTimestampArrayField('Links.TraceId[0]', traceColumnMeta)).toBe(false);
    expect(isTimestampArrayField('Events.Attributes[0]', traceColumnMeta)).toBe(false);
  });

  it('does not match non-array DateTime64 columns', () => {
    expect(isTimestampArrayField('Timestamp', traceColumnMeta)).toBe(false);
  });

  it('does not match Array(Map) sub-key paths', () => {
    expect(isTimestampArrayField('Events.Attributes[0].timestamp', traceColumnMeta)).toBe(false);
  });

  it('returns false for unknown columns', () => {
    expect(isTimestampArrayField('Unknown.Timestamp[0]', traceColumnMeta)).toBe(false);
  });

  it('handles Array(DateTime64) with timezone parameter', () => {
    const meta = [{ name: 'MyTimestamps', type: "Array(DateTime64(9, 'UTC'))" }];
    expect(isTimestampArrayField('MyTimestamps[0]', meta)).toBe(true);
  });
});

describe('isDenylisted', () => {
  it('denylists ID fields', () => {
    expect(isDenylisted('TraceId', traceColumnMeta)).toBe(true);
    expect(isDenylisted('SpanId', traceColumnMeta)).toBe(true);
    expect(isDenylisted('ParentSpanId', traceColumnMeta)).toBe(true);
    expect(isDenylisted('Links.TraceId[0]', traceColumnMeta)).toBe(true);
  });

  it('denylists timestamp array fields', () => {
    expect(isDenylisted('Events.Timestamp[0]', traceColumnMeta)).toBe(true);
    expect(isDenylisted('Links.Timestamp[3]', traceColumnMeta)).toBe(true);
  });

  it('does not denylist useful fields', () => {
    expect(isDenylisted('ResourceAttributes.service.name', traceColumnMeta)).toBe(false);
    expect(isDenylisted('SpanAttributes.http.method', traceColumnMeta)).toBe(false);
    expect(isDenylisted('Events.Name[0]', traceColumnMeta)).toBe(false);
  });
});

describe('isHighCardinality', () => {
  it('identifies high cardinality fields (all unique values)', () => {
    // 1000 unique values out of 1000 total occurrences
    const outlierValues = new Map<string, number>();
    for (let i = 0; i < 1000; i++) {
      outlierValues.set(`value-${i}`, 0.1);
    }
    const outlierValueOccurences = new Map([['TraceId', outlierValues]]);
    const outlierPropertyOccurences = new Map([['TraceId', 1000]]);

    expect(
      isHighCardinality(
        'TraceId',
        outlierValueOccurences,
        new Map(),
        outlierPropertyOccurences,
        new Map(),
      ),
    ).toBe(true);
  });

  it('keeps low cardinality fields visible (few distinct values)', () => {
    const outlierValues = new Map([['GET', 80], ['POST', 20]]);
    const outlierValueOccurences = new Map([['http.method', outlierValues]]);
    const outlierPropertyOccurences = new Map([['http.method', 1000]]);

    expect(
      isHighCardinality(
        'http.method',
        outlierValueOccurences,
        new Map(),
        outlierPropertyOccurences,
        new Map(),
      ),
    ).toBe(false);
  });

  it('uses min of both groups — keeps visible if either group has low cardinality', () => {
    // Outliers: 2 unique values (low cardinality)
    const outlierValues = new Map([['GET', 80], ['POST', 20]]);
    const outlierValueOccurences = new Map([['method', outlierValues]]);
    const outlierPropertyOccurences = new Map([['method', 1000]]);

    // Inliers: 500 unique values (high cardinality)
    const inlierValues = new Map<string, number>();
    for (let i = 0; i < 500; i++) inlierValues.set(`v${i}`, 0.2);
    const inlierValueOccurences = new Map([['method', inlierValues]]);
    const inlierPropertyOccurences = new Map([['method', 500]]);

    // outlierUniqueness = 2/1000 = 0.002, inlierUniqueness = 500/500 = 1.0
    // min = 0.002 < 0.9 → field is visible
    expect(
      isHighCardinality(
        'method',
        outlierValueOccurences,
        inlierValueOccurences,
        outlierPropertyOccurences,
        inlierPropertyOccurences,
      ),
    ).toBe(false);
  });

  it('hides field when BOTH groups have high cardinality', () => {
    const makeHighCardinalityMap = (n: number) => {
      const m = new Map<string, number>();
      for (let i = 0; i < n; i++) m.set(`v${i}`, 100 / n);
      return m;
    };

    const outlierValues = makeHighCardinalityMap(500);
    const inlierValues = makeHighCardinalityMap(400);
    const outlierValueOccurences = new Map([['url', outlierValues]]);
    const inlierValueOccurences = new Map([['url', inlierValues]]);
    const outlierPropertyOccurences = new Map([['url', 500]]);
    const inlierPropertyOccurences = new Map([['url', 400]]);

    // min(500/500, 400/400) = 1.0 > 0.9 → hidden
    expect(
      isHighCardinality(
        'url',
        outlierValueOccurences,
        inlierValueOccurences,
        outlierPropertyOccurences,
        inlierPropertyOccurences,
      ),
    ).toBe(true);
  });

  it('keeps visible when combined sample size is <= 20', () => {
    const outlierValues = new Map<string, number>();
    for (let i = 0; i < 10; i++) outlierValues.set(`v${i}`, 10);
    const outlierValueOccurences = new Map([['field', outlierValues]]);
    const outlierPropertyOccurences = new Map([['field', 10]]);
    const inlierPropertyOccurences = new Map([['field', 10]]);

    // combined = 10 + 10 = 20, threshold is > 20
    expect(
      isHighCardinality(
        'field',
        outlierValueOccurences,
        new Map(),
        outlierPropertyOccurences,
        inlierPropertyOccurences,
      ),
    ).toBe(false);
  });

  it('uses single group uniqueness when other group has no data', () => {
    // Only outlier data, high cardinality
    const outlierValues = new Map<string, number>();
    for (let i = 0; i < 100; i++) outlierValues.set(`v${i}`, 1);
    const outlierValueOccurences = new Map([['id', outlierValues]]);
    const outlierPropertyOccurences = new Map([['id', 100]]);

    expect(
      isHighCardinality(
        'id',
        outlierValueOccurences,
        new Map(),
        outlierPropertyOccurences,
        new Map(),
      ),
    ).toBe(true);
  });

  it('returns false for field not present in either group', () => {
    expect(
      isHighCardinality(
        'unknownField',
        new Map(),
        new Map(),
        new Map(),
        new Map(),
      ),
    ).toBe(false);
  });
});

describe('applyTopNAggregation', () => {
  const makeData = (names: string[]) =>
    names.map((name, i) => ({
      name,
      outlierCount: 100 - i, // descending counts so order is deterministic
      inlierCount: 5,
    }));

  it('returns data unchanged when at or below MAX_CHART_VALUES', () => {
    const data = makeData(['a', 'b', 'c']);
    expect(applyTopNAggregation(data)).toEqual(data);
  });

  it('returns data unchanged when exactly MAX_CHART_VALUES entries', () => {
    const data = makeData(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(data.length).toBe(MAX_CHART_VALUES);
    const result = applyTopNAggregation(data);
    expect(result.length).toBe(MAX_CHART_VALUES);
    expect(result.some(r => r.isOther)).toBe(false);
  });

  it('returns data unchanged when between MAX_CHART_VALUES and MAX_CHART_VALUES_UPPER (adaptive)', () => {
    // 7 and 8 values should be shown in full — no "Other" bucket
    const data7 = makeData(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(data7.length).toBeGreaterThan(MAX_CHART_VALUES);
    expect(data7.length).toBeLessThanOrEqual(MAX_CHART_VALUES_UPPER);
    expect(applyTopNAggregation(data7)).toEqual(data7);

    const data8 = makeData(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(data8.length).toBe(MAX_CHART_VALUES_UPPER);
    const result8 = applyTopNAggregation(data8);
    expect(result8.some(r => r.isOther)).toBe(false);
  });

  it('collapses values beyond MAX_CHART_VALUES_UPPER into an Other bucket', () => {
    const data = makeData(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    expect(data.length).toBeGreaterThan(MAX_CHART_VALUES_UPPER);
    const result = applyTopNAggregation(data);
    expect(result.length).toBe(MAX_CHART_VALUES + 1);
    const other = result[result.length - 1];
    expect(other.isOther).toBe(true);
    expect(other.name).toBe('Other (3)');
  });

  it('keeps top N entries by combined count', () => {
    const data = makeData(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
    const result = applyTopNAggregation(data);
    const topNames = result.slice(0, MAX_CHART_VALUES).map(r => r.name);
    expect(topNames).toContain('a');
    expect(topNames).toContain('b');
    expect(topNames).not.toContain('i');
    expect(topNames).not.toContain('j');
  });

  it('Other bucket accumulates outlierCount and inlierCount from dropped values', () => {
    // 12 items > MAX_CHART_VALUES_UPPER(8) → top 6 kept, bottom 6 collapsed
    const data = [
      { name: 'a', outlierCount: 50, inlierCount: 50 }, // kept (100)
      { name: 'b', outlierCount: 40, inlierCount: 40 }, // kept (80)
      { name: 'c', outlierCount: 30, inlierCount: 30 }, // kept (60)
      { name: 'd', outlierCount: 20, inlierCount: 20 }, // kept (40)
      { name: 'e', outlierCount: 10, inlierCount: 10 }, // kept (20)
      { name: 'f', outlierCount: 5, inlierCount: 5 },   // kept (10)
      { name: 'g', outlierCount: 4, inlierCount: 4 },   // dropped
      { name: 'h', outlierCount: 3, inlierCount: 3 },   // dropped
      { name: 'i', outlierCount: 3, inlierCount: 2 },   // dropped
      { name: 'j', outlierCount: 1, inlierCount: 1 },   // dropped
      { name: 'k', outlierCount: 0, inlierCount: 1 },   // dropped
      { name: 'l', outlierCount: 0, inlierCount: 0 },   // dropped
    ];
    const result = applyTopNAggregation(data);
    const other = result.find(r => r.isOther);
    expect(other).toBeDefined();
    expect(other!.outlierCount).toBe(11); // 4 + 3 + 3 + 1 + 0 + 0
    expect(other!.inlierCount).toBe(11); // 4 + 3 + 2 + 1 + 1 + 0
  });

  it('Other bucket name shows the count of aggregated values', () => {
    const data = makeData(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']);
    const result = applyTopNAggregation(data);
    const other = result.find(r => r.isOther);
    expect(other?.name).toBe('Other (5)');
  });

  it('non-Other entries do not have isOther set', () => {
    const data = makeData(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    const result = applyTopNAggregation(data);
    result.slice(0, MAX_CHART_VALUES).forEach(entry => {
      expect(entry.isOther).toBeFalsy();
    });
  });
});

describe('computeComparisonScore', () => {
  it('returns 0 when both groups have identical single-value proportions', () => {
    // Events.Name[3] = "message" at different coverage rates but same proportion
    // Outlier: 80% coverage, Inlier: 27% coverage — but both are 100% "message"
    const outlier = new Map([['message', 80]]);
    const inlier = new Map([['message', 27]]);
    expect(computeComparisonScore(outlier, inlier)).toBeCloseTo(0);
  });

  it('returns 0 when both groups have identical multi-value proportions', () => {
    // Same 60/40 split in both groups, different total coverage
    const outlier = new Map([['GET', 48], ['POST', 32]]);
    const inlier = new Map([['GET', 18], ['POST', 12]]);
    expect(computeComparisonScore(outlier, inlier)).toBeCloseTo(0);
  });

  it('returns high score for genuinely different distributions', () => {
    // Selection has mostly errors, background has mostly successes
    const outlier = new Map([['error', 70], ['success', 10]]);
    const inlier = new Map([['error', 5], ['success', 80]]);
    expect(computeComparisonScore(outlier, inlier)).toBeGreaterThan(50);
  });

  it('returns high score when a value exists in one group but not the other', () => {
    const outlier = new Map([['error', 50]]);
    const inlier = new Map([['success', 80]]);
    expect(computeComparisonScore(outlier, inlier)).toBeGreaterThan(50);
  });

  it('returns 0 when both groups are empty', () => {
    expect(computeComparisonScore(new Map(), new Map())).toBe(0);
  });

  it('uses raw delta as fallback when one group has no data', () => {
    const outlier = new Map([['error', 50]]);
    expect(computeComparisonScore(outlier, new Map())).toBe(50);
  });

  it('ranks genuinely different fields above same-proportion fields', () => {
    // Same proportion (100% "message" at different rates)
    const sameScore = computeComparisonScore(
      new Map([['message', 80]]),
      new Map([['message', 27]]),
    );
    // Different distribution (90% error in selection vs 10% in background)
    const diffScore = computeComparisonScore(
      new Map([['error', 90], ['ok', 10]]),
      new Map([['error', 10], ['ok', 90]]),
    );
    expect(diffScore).toBeGreaterThan(sameScore);
  });
});

describe('computeDistributionScore', () => {
  it('returns 0 for empty map', () => {
    expect(computeDistributionScore(new Map())).toBe(0);
  });

  it('returns 0 for a single-value field (all spans have same value)', () => {
    // 1 value at 100% — boring, not useful for filtering
    expect(computeDistributionScore(new Map([['production', 100]]))).toBe(0);
  });

  it('returns 0 for a perfectly uniform 2-value field', () => {
    // 50% / 50% — uniform, nothing stands out
    expect(
      computeDistributionScore(new Map([['GET', 50], ['POST', 50]])),
    ).toBe(0);
  });

  it('returns high score for a skewed 2-value field', () => {
    // 90% / 10% → score = 90 - 50 = 40
    const score = computeDistributionScore(
      new Map([['fraud-detection', 90], ['auth', 10]]),
    );
    expect(score).toBeCloseTo(40);
  });

  it('ranks more-skewed fields higher than less-skewed fields', () => {
    // 80%/20% → score = 80 - 50 = 30
    const scoreA = computeDistributionScore(
      new Map([['a', 80], ['b', 20]]),
    );
    // 60%/40% → score = 60 - 50 = 10
    const scoreB = computeDistributionScore(
      new Map([['a', 60], ['b', 40]]),
    );
    expect(scoreA).toBeGreaterThan(scoreB);
  });

  it('returns 0 for a perfectly uniform 3-value field', () => {
    // 33%/33%/33% → score = 33 - 33 = 0
    const score = computeDistributionScore(
      new Map([['a', 33.33], ['b', 33.33], ['c', 33.33]]),
    );
    expect(score).toBeCloseTo(0, 1);
  });

  it('returns positive score for a skewed 3-value field', () => {
    // 70%/20%/10% → score = 70 - 33.3 ≈ 36.7
    const score = computeDistributionScore(
      new Map([['a', 70], ['b', 20], ['c', 10]]),
    );
    expect(score).toBeCloseTo(36.67, 1);
  });

  it('single-value field scores lower than two-value skewed field', () => {
    const singleValue = computeDistributionScore(new Map([['only', 100]]));
    const skewed = computeDistributionScore(
      new Map([['dominant', 95], ['other', 5]]),
    );
    expect(skewed).toBeGreaterThan(singleValue);
  });

  it('works correctly when percentages do not sum to 100 (all-spans mode)', () => {
    // After the percentage fix, values represent % of ALL spans.
    // Property "env" appears in 60% of spans: prod=40%, staging=20%.
    // Score should be positive (skewed), not zero.
    const score = computeDistributionScore(new Map([['prod', 40], ['staging', 20]]));
    // mean = 30, max = 40, score = 10
    expect(score).toBeCloseTo(10);
  });

  it('returns 0 for a single-valued property that appears in only 30% of spans', () => {
    // 1 value at 30% (of all spans) — nValues=1, returns 0 regardless
    expect(computeDistributionScore(new Map([['production', 30]]))).toBe(0);
  });
});

describe('computeEntropyScore', () => {
  it('returns 0 for empty map', () => {
    expect(computeEntropyScore(new Map())).toBe(0);
  });

  it('returns 0 for a single-value field', () => {
    expect(computeEntropyScore(new Map([['production', 100]]))).toBe(0);
  });

  it('returns 0 for a perfectly uniform 2-value field', () => {
    // H = log2(2) = 1, maxH = log2(2) = 1 → 1 - 1/1 = 0
    expect(computeEntropyScore(new Map([['GET', 50], ['POST', 50]]))).toBeCloseTo(0);
  });

  it('returns high score for a skewed 2-value field', () => {
    const score = computeEntropyScore(new Map([['ok', 99], ['error', 1]]));
    // Very skewed → low entropy → high score (close to 1)
    expect(score).toBeGreaterThan(0.5);
  });

  it('ranks more-skewed fields higher than less-skewed fields', () => {
    const scoreA = computeEntropyScore(new Map([['a', 95], ['b', 5]]));
    const scoreB = computeEntropyScore(new Map([['a', 60], ['b', 40]]));
    expect(scoreA).toBeGreaterThan(scoreB);
  });

  it('returns 0 for a perfectly uniform 3-value field', () => {
    const score = computeEntropyScore(
      new Map([['a', 33.33], ['b', 33.33], ['c', 33.34]]),
    );
    expect(score).toBeCloseTo(0, 2);
  });

  it('returns positive score for a skewed 3-value field', () => {
    const score = computeEntropyScore(
      new Map([['a', 90], ['b', 5], ['c', 5]]),
    );
    expect(score).toBeGreaterThan(0.3);
  });

  it('handles power-law distributions better than skewness scorer', () => {
    // Power-law: 50, 25, 12, 6, 4, 2, 1 — entropy captures this spread
    const powerLaw = new Map([
      ['v1', 50], ['v2', 25], ['v3', 12], ['v4', 6],
      ['v5', 4], ['v6', 2], ['v7', 1],
    ]);
    const score = computeEntropyScore(powerLaw);
    expect(score).toBeGreaterThan(0.1);
    expect(score).toBeLessThan(1);
  });

  it('works when percentages do not sum to 100', () => {
    // Property appears in 60% of spans: prod=40%, staging=20%
    const score = computeEntropyScore(new Map([['prod', 40], ['staging', 20]]));
    // Normalized by sum, so this is really 67%/33% — moderate skew
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.5);
  });
});

describe('semanticBoost', () => {
  it('boosts well-known OTel attributes', () => {
    expect(semanticBoost('ResourceAttributes.service.name')).toBe(1);
    expect(semanticBoost('SpanAttributes.http.method')).toBe(1);
    expect(semanticBoost('SpanAttributes.http.status_code')).toBe(1);
    expect(semanticBoost('SpanAttributes.error')).toBe(1);
    expect(semanticBoost('ResourceAttributes.deployment.environment')).toBe(1);
  });

  it('boosts new OTel semconv attribute names', () => {
    expect(semanticBoost('SpanAttributes.http.request.method')).toBe(1);
    expect(semanticBoost('SpanAttributes.http.response.status_code')).toBe(1);
  });

  it('returns 0 for non-boosted attributes', () => {
    expect(semanticBoost('SpanAttributes.custom.field')).toBe(0);
    expect(semanticBoost('ResourceAttributes.host.name')).toBe(0);
    expect(semanticBoost('TraceId')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(semanticBoost('ResourceAttributes.Service.Name')).toBe(1);
    expect(semanticBoost('SpanAttributes.HTTP.METHOD')).toBe(1);
  });
});

describe('scoring integration: entropy + semantic boost as tiebreaker', () => {
  // These tests verify the intended scoring behavior in DBDeltaChart:
  // sortScore = baseScore > 0 ? baseScore + semanticBoost(key) * 0.1 : 0
  const computeSortScore = (key: string, valuePercentages: Map<string, number>) => {
    const baseScore = computeEntropyScore(valuePercentages);
    const boost = baseScore > 0 ? semanticBoost(key) * 0.1 : 0;
    return baseScore + boost;
  };

  it('single-value boosted attribute scores 0 (not boosted above multi-value fields)', () => {
    // service.name with 100% "payment" — completely useless for outlier detection
    const score = computeSortScore(
      'ResourceAttributes.service.name',
      new Map([['payment', 100]]),
    );
    expect(score).toBe(0);
  });

  it('multi-value non-boosted field with unequal distribution beats single-value boosted field', () => {
    const boostedSingleValue = computeSortScore(
      'ResourceAttributes.service.name',
      new Map([['payment', 100]]),
    );
    const nonBoostedSkewed = computeSortScore(
      'SpanAttributes.loyalty.level',
      new Map([['bronze', 60], ['silver', 20], ['gold', 15], ['platinum', 5]]),
    );
    expect(nonBoostedSkewed).toBeGreaterThan(boostedSingleValue);
  });

  it('among fields with similar variance, boosted attribute ranks higher', () => {
    const skewedValues = new Map([['Error', 80], ['Unset', 20]]);
    const boostedScore = computeSortScore('SpanAttributes.error', skewedValues);
    const nonBoostedScore = computeSortScore('SpanAttributes.custom.flag', skewedValues);
    expect(boostedScore).toBeGreaterThan(nonBoostedScore);
    // But the difference is small (tiebreaker only)
    expect(boostedScore - nonBoostedScore).toBeCloseTo(0.1, 1);
  });

  it('boost never overrides a genuinely more interesting distribution', () => {
    // Boosted but mildly skewed
    const boostedMild = computeSortScore(
      'SpanAttributes.http.method',
      new Map([['GET', 55], ['POST', 45]]),
    );
    // Non-boosted but highly skewed
    const nonBoostedStrong = computeSortScore(
      'SpanAttributes.custom.field',
      new Map([['dominant', 95], ['rare', 5]]),
    );
    expect(nonBoostedStrong).toBeGreaterThan(boostedMild);
  });
});

describe('computeEffectiveSampleSize', () => {
  it('returns SAMPLE_SIZE when totalCount is 0 (fallback)', () => {
    expect(computeEffectiveSampleSize(0)).toBe(SAMPLE_SIZE);
  });

  it('returns SAMPLE_SIZE when totalCount is negative', () => {
    expect(computeEffectiveSampleSize(-1)).toBe(SAMPLE_SIZE);
  });

  it('returns MIN_SAMPLE_SIZE for small datasets', () => {
    // 100 rows * 0.01 = 1 → clamped to MIN_SAMPLE_SIZE
    expect(computeEffectiveSampleSize(100)).toBe(MIN_SAMPLE_SIZE);
  });

  it('returns SAMPLE_RATIO * totalCount for mid-size datasets', () => {
    // 200,000 * 0.01 = 2000 → between MIN and MAX
    const result = computeEffectiveSampleSize(200_000);
    expect(result).toBe(Math.ceil(200_000 * SAMPLE_RATIO));
    expect(result).toBeGreaterThan(MIN_SAMPLE_SIZE);
    expect(result).toBeLessThan(MAX_SAMPLE_SIZE);
  });

  it('caps at MAX_SAMPLE_SIZE for very large datasets', () => {
    // 10,000,000 * 0.01 = 100,000 → capped to MAX_SAMPLE_SIZE
    expect(computeEffectiveSampleSize(10_000_000)).toBe(MAX_SAMPLE_SIZE);
  });

  it('returns exact 1% for datasets where 1% falls in the valid range', () => {
    // 100,000 * 0.01 = 1000 → between MIN(500) and MAX(5000)
    expect(computeEffectiveSampleSize(100_000)).toBe(1000);
  });
});

describe('computeYValue', () => {
  it('returns value for simple column reference', () => {
    expect(computeYValue('Duration', { Duration: 5000000 })).toBe(5000000);
  });

  it('handles string-encoded numbers (ClickHouse UInt64)', () => {
    expect(computeYValue('Duration', { Duration: '5000000' })).toBe(5000000);
  });

  it('handles division expression "Col / N"', () => {
    expect(computeYValue('Duration / 1000000', { Duration: 5000000 })).toBeCloseTo(5);
  });

  it('handles parenthesized column in division "(Col)/N" (getDurationMsExpression format)', () => {
    expect(computeYValue('(Duration)/1e6', { Duration: 5000000 })).toBeCloseTo(5);
    expect(computeYValue('(Duration) / 1e6', { Duration: 5000000 })).toBeCloseTo(5);
    expect(computeYValue('(Duration)/1000000', { Duration: 5000000 })).toBeCloseTo(5);
  });

  it('handles simple parenthesized column reference "(Col)"', () => {
    expect(computeYValue('(Duration)', { Duration: 5000000 })).toBe(5000000);
  });

  it('handles multiplication expression "Col * N"', () => {
    expect(computeYValue('Duration * 0.001', { Duration: 5000000 })).toBeCloseTo(5000);
  });

  it('handles parenthesized column in multiplication "(Col) * N"', () => {
    expect(computeYValue('(Duration) * 0.001', { Duration: 5000000 })).toBeCloseTo(5000);
    expect(computeYValue('(Duration)*0.001', { Duration: 5000000 })).toBeCloseTo(5000);
  });

  it('handles scientific notation divisor', () => {
    expect(computeYValue('Duration / 1e6', { Duration: 5000000 })).toBeCloseTo(5);
  });

  it('returns null when column is missing', () => {
    expect(computeYValue('Duration / 1000000', { OtherCol: 42 })).toBeNull();
  });

  it('returns null for complex expressions it cannot parse', () => {
    expect(computeYValue('count()', {})).toBeNull();
    expect(computeYValue('toUnixTimestamp(Timestamp)', {})).toBeNull();
  });

  it('returns null when divisor is zero', () => {
    expect(computeYValue('Duration / 0', { Duration: 5000 })).toBeNull();
  });
});

describe('field split logic (visible vs hidden)', () => {
  it('correctly classifies a mix of ID, timestamp, cardinality, and useful fields', () => {
    // TraceId → denylist (ID field, String)
    expect(isDenylisted('TraceId', traceColumnMeta)).toBe(true);

    // Events.Timestamp[0] → denylist (timestamp array)
    expect(isDenylisted('Events.Timestamp[0]', traceColumnMeta)).toBe(true);

    // ResourceAttributes.service.name → not denylisted
    expect(isDenylisted('ResourceAttributes.service.name', traceColumnMeta)).toBe(false);

    // High cardinality field with 1000 unique values in 1000 rows → hidden
    const hcValues = new Map<string, number>();
    for (let i = 0; i < 1000; i++) hcValues.set(`trace-${i}`, 0.1);
    expect(
      isHighCardinality(
        'trace.id',
        new Map([['trace.id', hcValues]]),
        new Map(),
        new Map([['trace.id', 1000]]),
        new Map(),
      ),
    ).toBe(true);

    // Low cardinality field → visible
    const lcValues = new Map([['production', 70], ['staging', 30]]);
    expect(
      isHighCardinality(
        'deployment.env',
        new Map([['deployment.env', lcValues]]),
        new Map(),
        new Map([['deployment.env', 1000]]),
        new Map(),
      ),
    ).toBe(false);
  });
});
