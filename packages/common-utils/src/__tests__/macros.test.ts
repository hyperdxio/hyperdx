import { replaceMacros } from '../macros';

describe('replaceMacros', () => {
  it('should replace $__fromTime with seconds-precision DateTime', () => {
    expect(replaceMacros('SELECT $__fromTime')).toBe(
      'SELECT toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64}))',
    );
  });

  it('should replace $__toTime with seconds-precision DateTime', () => {
    expect(replaceMacros('SELECT $__toTime')).toBe(
      'SELECT toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))',
    );
  });

  it('should replace $__fromTime_ms with millisecond-precision DateTime64', () => {
    expect(replaceMacros('SELECT $__fromTime_ms')).toBe(
      'SELECT fromUnixTimestamp64Milli({startDateMilliseconds:Int64})',
    );
  });

  it('should replace $__toTime_ms with millisecond-precision DateTime64', () => {
    expect(replaceMacros('SELECT $__toTime_ms')).toBe(
      'SELECT fromUnixTimestamp64Milli({endDateMilliseconds:Int64})',
    );
  });

  it('should replace $__timeFilter with seconds-precision range filter', () => {
    const result = replaceMacros('WHERE $__timeFilter(ts)');
    expect(result).toBe(
      'WHERE ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))',
    );
  });

  it('should replace $__timeFilter_ms with millisecond-precision range filter', () => {
    const result = replaceMacros('WHERE $__timeFilter_ms(ts)');
    expect(result).toBe(
      'WHERE ts >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND ts <= fromUnixTimestamp64Milli({endDateMilliseconds:Int64})',
    );
  });

  it('should replace $__dateFilter with date-only range filter', () => {
    const result = replaceMacros('WHERE $__dateFilter(d)');
    expect(result).toBe(
      'WHERE d >= toDate(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND d <= toDate(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))',
    );
  });

  it('should replace $__dateTimeFilter with combined date and time filter', () => {
    const result = replaceMacros('WHERE $__dateTimeFilter(d, ts)');
    expect(result).toBe(
      'WHERE (d >= toDate(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND d <= toDate(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))) AND (ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64})))',
    );
  });

  it('should replace $__dt as an alias for dateTimeFilter', () => {
    const result = replaceMacros('WHERE $__dt(d, ts)');
    expect(result).toBe(
      'WHERE (d >= toDate(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND d <= toDate(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))) AND (ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64})))',
    );
  });

  it('should replace $__timeInterval with interval bucketing expression', () => {
    const result = replaceMacros('SELECT $__timeInterval(ts)');
    expect(result).toBe(
      'SELECT toStartOfInterval(toDateTime(ts), INTERVAL {intervalSeconds:Int64} second)',
    );
  });

  it('should replace $__timeInterval_ms with millisecond interval bucketing', () => {
    const result = replaceMacros('SELECT $__timeInterval_ms(ts)');
    expect(result).toBe(
      'SELECT toStartOfInterval(toDateTime64(ts, 3), INTERVAL {intervalMilliseconds:Int64} millisecond)',
    );
  });

  it('should replace $__interval_s with interval seconds param', () => {
    expect(replaceMacros('INTERVAL $__interval_s second')).toBe(
      'INTERVAL {intervalSeconds:Int64} second',
    );
  });

  it('should replace multiple macros in one query', () => {
    const result = replaceMacros(
      'SELECT $__timeInterval(ts), count() FROM t WHERE $__timeFilter(ts) GROUP BY 1',
    );
    expect(result).toContain('toStartOfInterval');
    expect(result).toContain(
      'ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64}))',
    );
  });

  it('should throw on wrong argument count', () => {
    expect(() => replaceMacros('$__timeFilter(a, b)')).toThrow(
      'expects 1 argument(s), but got 2',
    );
  });

  it('should throw on missing close bracket', () => {
    expect(() => replaceMacros('$__timeFilter(col')).toThrow(
      'Failed to parse macro arguments',
    );
  });

  it('should replace $__filters with provided filtersSQL', () => {
    const result = replaceMacros(
      'WHERE $__filters',
      "(col = 'val') AND (x > 1)",
    );
    expect(result).toBe("WHERE (col = 'val') AND (x > 1)");
  });

  it('should replace $__filters with fallback when no filtersSQL provided', () => {
    expect(replaceMacros('WHERE $__filters')).toBe(
      'WHERE (1=1 /** no filters applied */)',
    );
  });

  it('should replace $__filters with fallback when filtersSQL is empty', () => {
    expect(replaceMacros('WHERE $__filters', '')).toBe(
      'WHERE (1=1 /** no filters applied */)',
    );
  });
});
