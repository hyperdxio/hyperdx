import {
  computeComparisonScore,
  flattenData,
  getPropertyStatistics,
  isDenylisted,
  isHighCardinality,
  rankProperties,
  semanticBoost,
} from '@/core/eventDeltas';

describe('eventDeltas', () => {
  describe('flattenData', () => {
    it('flattens nested objects with dot notation', () => {
      expect(flattenData({ a: { b: { c: 1 } } })).toEqual({ 'a.b.c': 1 });
    });

    it('flattens arrays with bracket notation', () => {
      expect(flattenData({ arr: ['x', 'y'] })).toEqual({
        'arr[0]': 'x',
        'arr[1]': 'y',
      });
    });

    it('preserves empty objects as sentinel entries', () => {
      const out = flattenData({ empty: {} });
      expect(out['empty']).toEqual({});
    });
  });

  describe('getPropertyStatistics', () => {
    it('only counts properties that meet MIN_PROPERTY_OCCURENCES (5)', () => {
      const data = Array.from({ length: 10 }, (_, i) =>
        i < 4 ? { always: 'yes', sometimes: 'present' } : { always: 'yes' },
      );
      const stats = getPropertyStatistics(data);
      expect(stats.valueOccurences.has('always')).toBe(true);
      expect(stats.valueOccurences.has('sometimes')).toBe(false);
    });

    it('computes per-value counts correctly', () => {
      const data = Array.from({ length: 10 }, (_, i) => ({
        kind: i < 6 ? 'A' : 'B',
      }));
      const stats = getPropertyStatistics(data);
      const kindValues = stats.valueOccurences.get('kind')!;
      expect(kindValues.get('A')).toBe(6);
      expect(kindValues.get('B')).toBe(4);
    });
  });

  describe('computeComparisonScore', () => {
    it('returns 0 for identical proportional distributions', () => {
      const target = new Map([
        ['A', 50],
        ['B', 50],
      ]);
      const baseline = new Map([
        ['A', 200],
        ['B', 200],
      ]);
      expect(computeComparisonScore(target, baseline)).toBe(0);
    });

    it('returns the max % delta when distributions differ', () => {
      // target: 100% A, baseline: 100% B → 100 delta on each value
      const target = new Map([['A', 10]]);
      const baseline = new Map([['B', 10]]);
      expect(computeComparisonScore(target, baseline)).toBe(100);
    });

    it('returns 0 for empty groups', () => {
      expect(computeComparisonScore(new Map(), new Map())).toBe(0);
    });
  });

  describe('semanticBoost', () => {
    it('boosts well-known OTel attributes', () => {
      expect(semanticBoost('SpanAttributes.service.name')).toBe(1);
      expect(semanticBoost('ResourceAttributes.http.status_code')).toBe(1);
      expect(semanticBoost('error.type')).toBe(1);
    });

    it('does not boost unrelated keys (segment-aware match)', () => {
      expect(semanticBoost('SpanAttributes.myerror')).toBe(0);
      expect(semanticBoost('SpanAttributes.error_message')).toBe(0);
    });
  });

  describe('isDenylisted', () => {
    const cols = [
      { name: 'TraceId', type: 'String' },
      { name: 'Body', type: 'String' },
      { name: 'Events.Timestamp', type: 'Array(DateTime64(9))' },
    ];
    it('flags top-level Id columns', () => {
      expect(isDenylisted('TraceId', cols)).toBe(true);
    });
    it('does not flag non-Id String columns', () => {
      expect(isDenylisted('Body', cols)).toBe(false);
    });
    it('flags per-index timestamp arrays', () => {
      expect(isDenylisted('Events.Timestamp[0]', cols)).toBe(true);
    });
  });

  describe('isHighCardinality', () => {
    it('flags fields with >0.9 unique ratio and >20 samples', () => {
      const targetValues = new Map<string, Map<string, number>>();
      const targetMap = new Map<string, number>();
      // 30 samples, 30 unique values → 100% unique
      for (let i = 0; i < 30; i++) targetMap.set(`v${i}`, 1);
      targetValues.set('Body', targetMap);

      const baselineValues = new Map<string, Map<string, number>>();
      const baselineMap = new Map<string, number>();
      for (let i = 0; i < 30; i++) baselineMap.set(`v${i + 100}`, 1);
      baselineValues.set('Body', baselineMap);

      const targetProperty = new Map<string, number>([['Body', 30]]);
      const baselineProperty = new Map<string, number>([['Body', 30]]);

      expect(
        isHighCardinality(
          'Body',
          targetValues,
          baselineValues,
          targetProperty,
          baselineProperty,
        ),
      ).toBe(true);
    });

    it('does not flag fields with low cardinality', () => {
      const targetValues = new Map<string, Map<string, number>>();
      targetValues.set(
        'ServiceName',
        new Map([
          ['svc-a', 30],
          ['svc-b', 20],
        ]),
      );
      const baselineValues = new Map<string, Map<string, number>>();
      baselineValues.set(
        'ServiceName',
        new Map([
          ['svc-a', 25],
          ['svc-b', 25],
        ]),
      );
      const targetProperty = new Map<string, number>([['ServiceName', 50]]);
      const baselineProperty = new Map<string, number>([['ServiceName', 50]]);
      expect(
        isHighCardinality(
          'ServiceName',
          targetValues,
          baselineValues,
          targetProperty,
          baselineProperty,
        ),
      ).toBe(false);
    });
  });

  describe('rankProperties', () => {
    it('ranks the most differentiating property first', () => {
      // Target: 100% ERROR. Baseline: 100% INFO. Severity should rank above
      // a uniformly-distributed Region property.
      const targetRows = Array.from({ length: 50 }, (_, i) => ({
        Severity: 'ERROR',
        Region: i % 3 === 0 ? 'us' : i % 3 === 1 ? 'eu' : 'ap',
      }));
      const baselineRows = Array.from({ length: 50 }, (_, i) => ({
        Severity: 'INFO',
        Region: i % 3 === 0 ? 'us' : i % 3 === 1 ? 'eu' : 'ap',
      }));
      const result = rankProperties({
        targetRows,
        baselineRows,
        columnMeta: [
          { name: 'Severity', type: 'String' },
          { name: 'Region', type: 'String' },
        ],
      });
      expect(result.ranked[0].key).toBe('Severity');
      expect(result.ranked[0].score).toBeGreaterThan(50);
    });

    it('marks Id columns hidden via denylist', () => {
      const targetRows = Array.from({ length: 30 }, (_, i) => ({
        TraceId: `t${i}`,
        Service: i % 2 === 0 ? 'a' : 'b',
      }));
      const baselineRows = Array.from({ length: 30 }, (_, i) => ({
        TraceId: `t${100 + i}`,
        Service: i % 4 === 0 ? 'a' : 'b',
      }));
      const result = rankProperties({
        targetRows,
        baselineRows,
        columnMeta: [
          { name: 'TraceId', type: 'String' },
          { name: 'Service', type: 'String' },
        ],
      });
      const traceIdEntry = result.ranked.find(p => p.key === 'TraceId');
      expect(traceIdEntry?.hidden).toBe(true);
      expect(traceIdEntry?.hiddenReason).toBe('denylist');
    });
  });
});
