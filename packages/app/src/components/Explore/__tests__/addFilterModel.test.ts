import {
  buildFilterUpdate,
  operatorOptions,
  resolveOperator,
  toFilterOperator,
} from '@/components/Explore/addFilterModel';

describe('operatorOptions', () => {
  it('offers comparisons on a numeric field', () => {
    expect(operatorOptions(true).map(o => o.value)).toEqual([
      'include',
      'exclude',
      '>',
      '>=',
      '<',
      '<=',
    ]);
  });

  it('withholds comparisons on a text field, which could not compile', () => {
    expect(operatorOptions(false).map(o => o.value)).toEqual([
      'include',
      'exclude',
    ]);
  });
});

describe('resolveOperator', () => {
  it('drops a comparison when the field can no longer support one', () => {
    expect(resolveOperator('>', false)).toBe('include');
  });

  it('keeps a comparison on a numeric field', () => {
    expect(resolveOperator('>', true)).toBe('>');
  });

  it('leaves membership alone either way', () => {
    expect(resolveOperator('exclude', true)).toBe('exclude');
    expect(resolveOperator('exclude', false)).toBe('exclude');
  });
});

describe('toFilterOperator', () => {
  it('accepts the operators it offers', () => {
    expect(toFilterOperator('>=')).toBe('>=');
    expect(toFilterOperator('include')).toBe('include');
  });

  it('rejects anything else', () => {
    expect(toFilterOperator('LIKE')).toBeNull();
    expect(toFilterOperator(null)).toBeNull();
  });
});

describe('buildFilterUpdate', () => {
  it('adds a lower bound as a range rather than a value', () => {
    expect(buildFilterUpdate({ operator: '>', value: '500' })).toEqual({
      kind: 'range',
      range: { min: 500, minOp: '>' },
    });
  });

  it('narrows an existing lower bound into a two-sided range', () => {
    expect(
      buildFilterUpdate({
        operator: '<=',
        value: '900',
        existingRange: { min: 500, minOp: '>' },
      }),
    ).toEqual({
      kind: 'range',
      range: { min: 500, minOp: '>', max: 900, maxOp: '<=' },
    });
  });

  it('replaces a bound on the same side instead of stacking one', () => {
    expect(
      buildFilterUpdate({
        operator: '>=',
        value: '600',
        existingRange: { min: 500, minOp: '>' },
      }),
    ).toEqual({ kind: 'range', range: { min: 600, minOp: '>=' } });
  });

  it('refuses a bound that is not a number', () => {
    expect(buildFilterUpdate({ operator: '>', value: 'fast' })).toBeNull();
  });

  it('refuses an empty value whatever the operator', () => {
    expect(buildFilterUpdate({ operator: '>', value: '  ' })).toBeNull();
    expect(buildFilterUpdate({ operator: 'include', value: '' })).toBeNull();
  });

  it('still routes plain values through the membership path', () => {
    expect(
      buildFilterUpdate({ operator: 'exclude', value: ' checkout ' }),
    ).toEqual({ kind: 'value', value: 'checkout', exclude: true });
  });

  it('accepts a negative bound, which Number handles but a naive parse would not', () => {
    expect(buildFilterUpdate({ operator: '<', value: '-1' })).toEqual({
      kind: 'range',
      range: { max: -1, maxOp: '<' },
    });
  });
});
