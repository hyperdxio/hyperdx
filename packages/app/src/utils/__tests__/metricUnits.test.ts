import { metricUnitShort, NO_UNIT } from '@/utils/metricUnits';

describe('metricUnitShort', () => {
  it.each(['By', 'ms', 's', '%', 'By/s'])('keeps the UCUM code %s', unit => {
    expect(metricUnitShort(unit)).toBe(unit);
  });

  it('strips annotation braces', () => {
    expect(metricUnitShort('{request}')).toBe('request');
    expect(metricUnitShort('{connection}')).toBe('connection');
  });

  it('strips braces inside a compound unit but keeps the operator', () => {
    expect(metricUnitShort('{request}/s')).toBe('request/s');
  });

  it('keeps a long annotation intact rather than mangling it', () => {
    // Real catalogs carry these; the column truncates them for display, which
    // is a rendering concern — the helper must not silently shorten the value.
    expect(metricUnitShort('{recommendation}')).toBe('recommendation');
    expect(metricUnitShort('{match_attempts}')).toBe('match_attempts');
  });

  it('renders the dimensionless unit as no unit', () => {
    // "1" would read as a value rather than a unit.
    expect(metricUnitShort('1')).toBe(NO_UNIT);
  });

  it.each([undefined, '', '   '])('renders %p as no unit', unit => {
    expect(metricUnitShort(unit)).toBe(NO_UNIT);
  });

  it('trims surrounding whitespace', () => {
    expect(metricUnitShort('  ms  ')).toBe('ms');
  });
});
