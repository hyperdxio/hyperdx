import { renderFiltersToSql, replaceMacros } from '../macros';
import type { RawSqlChartConfig } from '../types';

/** Helper to create a minimal RawSqlChartConfig for testing */
function config(
  sqlTemplate: string,
  overrides?: Partial<RawSqlChartConfig>,
): RawSqlChartConfig {
  return {
    configType: 'sql',
    sqlTemplate,
    connection: 'test',
    ...overrides,
  };
}

describe('renderFiltersToSql', () => {
  it('should render sql_ast filters', () => {
    expect(
      renderFiltersToSql([
        { type: 'sql_ast', operator: '=', left: 'col', right: "'val'" },
      ]),
    ).toBe("(col = 'val')");
  });

  it('should render sql filters', () => {
    expect(
      renderFiltersToSql([{ type: 'sql', condition: "name = 'test'" }]),
    ).toBe("(name = 'test')");
  });

  it('should join multiple filters with AND', () => {
    expect(
      renderFiltersToSql([
        { type: 'sql', condition: 'a = 1' },
        { type: 'sql_ast', operator: '>', left: 'b', right: '2' },
      ]),
    ).toBe('(a = 1) AND (b > 2)');
  });

  it('should skip empty sql conditions', () => {
    expect(renderFiltersToSql([{ type: 'sql', condition: '' }])).toBe(
      '(1=1 /** no filters applied */)',
    );
  });

  it('should skip lucene filters', () => {
    expect(
      renderFiltersToSql([{ type: 'lucene', condition: 'field:value' }]),
    ).toBe('(1=1 /** no filters applied */)');
  });

  it('should return fallback for empty array', () => {
    expect(renderFiltersToSql([])).toBe('(1=1 /** no filters applied */)');
  });
});

describe('replaceMacros', () => {
  it('should replace $__fromTime with seconds-precision DateTime', () => {
    expect(replaceMacros(config('SELECT $__fromTime'))).toBe(
      'SELECT toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64}))',
    );
  });

  it('should replace $__toTime with seconds-precision DateTime', () => {
    expect(replaceMacros(config('SELECT $__toTime'))).toBe(
      'SELECT toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))',
    );
  });

  it('should replace $__fromTime_ms with millisecond-precision DateTime64', () => {
    expect(replaceMacros(config('SELECT $__fromTime_ms'))).toBe(
      'SELECT fromUnixTimestamp64Milli({startDateMilliseconds:Int64})',
    );
  });

  it('should replace $__toTime_ms with millisecond-precision DateTime64', () => {
    expect(replaceMacros(config('SELECT $__toTime_ms'))).toBe(
      'SELECT fromUnixTimestamp64Milli({endDateMilliseconds:Int64})',
    );
  });

  it('should replace $__timeFilter with seconds-precision range filter', () => {
    const result = replaceMacros(config('WHERE $__timeFilter(ts)'));
    expect(result).toBe(
      'WHERE ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))',
    );
  });

  it('should replace $__timeFilter_ms with millisecond-precision range filter', () => {
    const result = replaceMacros(config('WHERE $__timeFilter_ms(ts)'));
    expect(result).toBe(
      'WHERE ts >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND ts <= fromUnixTimestamp64Milli({endDateMilliseconds:Int64})',
    );
  });

  it('should replace $__dateFilter with date-only range filter', () => {
    const result = replaceMacros(config('WHERE $__dateFilter(d)'));
    expect(result).toBe(
      'WHERE d >= toDate(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND d <= toDate(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))',
    );
  });

  it('should replace $__dateTimeFilter with combined date and time filter', () => {
    const result = replaceMacros(config('WHERE $__dateTimeFilter(d, ts)'));
    expect(result).toBe(
      'WHERE (d >= toDate(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND d <= toDate(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))) AND (ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64})))',
    );
  });

  it('should replace $__dt as an alias for dateTimeFilter', () => {
    const result = replaceMacros(config('WHERE $__dt(d, ts)'));
    expect(result).toBe(
      'WHERE (d >= toDate(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND d <= toDate(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))) AND (ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64})))',
    );
  });

  it('should replace $__timeInterval with interval bucketing expression', () => {
    const result = replaceMacros(config('SELECT $__timeInterval(ts)'));
    expect(result).toBe(
      'SELECT toStartOfInterval(toDateTime(ts), INTERVAL {intervalSeconds:Int64} second)',
    );
  });

  it('should replace $__timeInterval_ms with millisecond interval bucketing', () => {
    const result = replaceMacros(config('SELECT $__timeInterval_ms(ts)'));
    expect(result).toBe(
      'SELECT toStartOfInterval(toDateTime64(ts, 3), INTERVAL {intervalMilliseconds:Int64} millisecond)',
    );
  });

  it('should replace $__interval_s with interval seconds param', () => {
    expect(replaceMacros(config('INTERVAL $__interval_s second'))).toBe(
      'INTERVAL {intervalSeconds:Int64} second',
    );
  });

  it('should replace multiple macros in one query', () => {
    const result = replaceMacros(
      config(
        'SELECT $__timeInterval(ts), count() FROM t WHERE $__timeFilter(ts) GROUP BY 1',
      ),
    );
    expect(result).toContain('toStartOfInterval');
    expect(result).toContain(
      'ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64}))',
    );
  });

  it('should throw on wrong argument count', () => {
    expect(() => replaceMacros(config('$__timeFilter(a, b)'))).toThrow(
      'expects 1 argument(s), but got 2',
    );
  });

  it('should throw on missing close bracket', () => {
    expect(() => replaceMacros(config('$__timeFilter(col'))).toThrow(
      'Failed to parse macro arguments',
    );
  });

  it('should replace $__filters with rendered filter conditions', () => {
    const result = replaceMacros(
      config('WHERE $__filters', {
        filters: [
          { type: 'sql', condition: "col = 'val'" },
          { type: 'sql_ast', operator: '>', left: 'x', right: '1' },
        ],
      }),
    );
    expect(result).toBe("WHERE (col = 'val') AND (x > 1)");
  });

  it('should replace $__filters with fallback when no filters provided', () => {
    expect(replaceMacros(config('WHERE $__filters'))).toBe(
      'WHERE (1=1 /** no filters applied */)',
    );
  });

  it('should replace $__filters with fallback when filters is empty', () => {
    expect(replaceMacros(config('WHERE $__filters', { filters: [] }))).toBe(
      'WHERE (1=1 /** no filters applied */)',
    );
  });
});
