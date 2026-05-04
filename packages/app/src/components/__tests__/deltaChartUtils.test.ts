import {
  applyTopNAggregation,
  MAX_CHART_VALUES,
  MAX_CHART_VALUES_UPPER,
} from '../deltaChartUtils';

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
      { name: 'f', outlierCount: 5, inlierCount: 5 }, // kept (10)
      { name: 'g', outlierCount: 4, inlierCount: 4 }, // dropped
      { name: 'h', outlierCount: 3, inlierCount: 3 }, // dropped
      { name: 'i', outlierCount: 3, inlierCount: 2 }, // dropped
      { name: 'j', outlierCount: 1, inlierCount: 1 }, // dropped
      { name: 'k', outlierCount: 0, inlierCount: 1 }, // dropped
      { name: 'l', outlierCount: 0, inlierCount: 0 }, // dropped
    ];
    const result = applyTopNAggregation(data);
    const other = result.find(r => r.isOther);
    expect(other).toBeDefined();
    expect(other!.outlierCount).toBe(11); // 4 + 3 + 3 + 1 + 0 + 0
    expect(other!.inlierCount).toBe(11); // 4 + 3 + 2 + 1 + 1 + 0
  });

  it('Other bucket name shows the count of aggregated values', () => {
    const data = makeData([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
      'j',
      'k',
    ]);
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
