import { numericRowSortingFn } from '@/components/DBTable/sorting';

function makeRow(value: unknown) {
  return { getValue: (_key: string) => value } as any;
}

describe('numericRowSortingFn', () => {
  const key = 'col';

  it('sorts numbers in ascending order', () => {
    expect(numericRowSortingFn(makeRow(1), makeRow(2), key)).toBeLessThan(0);
    expect(numericRowSortingFn(makeRow(2), makeRow(1), key)).toBeGreaterThan(0);
    expect(numericRowSortingFn(makeRow(5), makeRow(5), key)).toBe(0);
  });

  it('treats numeric strings as numbers', () => {
    expect(
      numericRowSortingFn(makeRow('10'), makeRow('9'), key),
    ).toBeGreaterThan(0);
    expect(numericRowSortingFn(makeRow('3'), makeRow('20'), key)).toBeLessThan(
      0,
    );
  });

  it('sorts null as greater than any number (pushes to end)', () => {
    expect(numericRowSortingFn(makeRow(null), makeRow(1), key)).toBeGreaterThan(
      0,
    );
    expect(numericRowSortingFn(makeRow(1), makeRow(null), key)).toBeLessThan(0);
  });

  it('sorts NaN strings as greater than any number (pushes to end)', () => {
    expect(
      numericRowSortingFn(makeRow('abc'), makeRow(1), key),
    ).toBeGreaterThan(0);
    expect(numericRowSortingFn(makeRow(1), makeRow('abc'), key)).toBeLessThan(
      0,
    );
  });

  it('handles negative numbers', () => {
    expect(numericRowSortingFn(makeRow(-5), makeRow(0), key)).toBeLessThan(0);
    expect(numericRowSortingFn(makeRow(0), makeRow(-5), key)).toBeGreaterThan(
      0,
    );
  });

  it('treats two null/NaN values as equal', () => {
    expect(numericRowSortingFn(makeRow(null), makeRow(null), key)).toBe(0);
    expect(numericRowSortingFn(makeRow('abc'), makeRow('xyz'), key)).toBe(0);
    expect(numericRowSortingFn(makeRow(null), makeRow('abc'), key)).toBe(0);
  });

  it('handles floating point numbers', () => {
    expect(numericRowSortingFn(makeRow(1.5), makeRow(1.6), key)).toBeLessThan(
      0,
    );
    expect(
      numericRowSortingFn(makeRow(1.6), makeRow(1.5), key),
    ).toBeGreaterThan(0);
  });
});
