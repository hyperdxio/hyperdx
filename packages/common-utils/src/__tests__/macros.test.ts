import { replaceMacros } from '../macros';
import type { MetricTable } from '../types';

const ALL_METRIC_TABLES: MetricTable = {
  gauge: 'otel_metrics_gauge',
  histogram: 'otel_metrics_histogram',
  sum: 'otel_metrics_sum',
  summary: 'otel_metrics_summary',
  'exponential histogram': 'otel_metrics_exponential_histogram',
};

describe('replaceMacros', () => {
  it('should replace $__fromTime with seconds-precision DateTime', () => {
    expect(replaceMacros({ sqlTemplate: 'SELECT $__fromTime' })).toBe(
      'SELECT toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64}))',
    );
  });

  it('should replace $__toTime with seconds-precision DateTime', () => {
    expect(replaceMacros({ sqlTemplate: 'SELECT $__toTime' })).toBe(
      'SELECT toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))',
    );
  });

  it('should replace $__fromTime_ms with millisecond-precision DateTime64', () => {
    expect(replaceMacros({ sqlTemplate: 'SELECT $__fromTime_ms' })).toBe(
      'SELECT fromUnixTimestamp64Milli({startDateMilliseconds:Int64})',
    );
  });

  it('should replace $__toTime_ms with millisecond-precision DateTime64', () => {
    expect(replaceMacros({ sqlTemplate: 'SELECT $__toTime_ms' })).toBe(
      'SELECT fromUnixTimestamp64Milli({endDateMilliseconds:Int64})',
    );
  });

  it('should replace $__timeFilter with seconds-precision range filter', () => {
    const result = replaceMacros({
      sqlTemplate: 'WHERE $__timeFilter(ts)',
    });
    expect(result).toBe(
      'WHERE ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))',
    );
  });

  it('should replace $__timeFilter_ms with millisecond-precision range filter', () => {
    const result = replaceMacros({
      sqlTemplate: 'WHERE $__timeFilter_ms(ts)',
    });
    expect(result).toBe(
      'WHERE ts >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND ts <= fromUnixTimestamp64Milli({endDateMilliseconds:Int64})',
    );
  });

  it('should replace $__dateFilter with date-only range filter', () => {
    const result = replaceMacros({
      sqlTemplate: 'WHERE $__dateFilter(d)',
    });
    expect(result).toBe(
      'WHERE d >= toDate(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND d <= toDate(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))',
    );
  });

  it('should replace $__dateTimeFilter with combined date and time filter', () => {
    const result = replaceMacros({
      sqlTemplate: 'WHERE $__dateTimeFilter(d, ts)',
    });
    expect(result).toBe(
      'WHERE (d >= toDate(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND d <= toDate(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))) AND (ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64})))',
    );
  });

  it('should replace $__dt as an alias for dateTimeFilter', () => {
    const result = replaceMacros({
      sqlTemplate: 'WHERE $__dt(d, ts)',
    });
    expect(result).toBe(
      'WHERE (d >= toDate(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND d <= toDate(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))) AND (ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64})))',
    );
  });

  it('should replace $__timeInterval with interval bucketing expression', () => {
    const result = replaceMacros({
      sqlTemplate: 'SELECT $__timeInterval(ts)',
    });
    expect(result).toBe(
      'SELECT toStartOfInterval(toDateTime(ts), INTERVAL {intervalSeconds:Int64} second)',
    );
  });

  it('should replace $__timeInterval_ms with millisecond interval bucketing', () => {
    const result = replaceMacros({
      sqlTemplate: 'SELECT $__timeInterval_ms(ts)',
    });
    expect(result).toBe(
      'SELECT toStartOfInterval(toDateTime64(ts, 3), INTERVAL {intervalMilliseconds:Int64} millisecond)',
    );
  });

  it('should replace $__interval_s with interval seconds param', () => {
    expect(
      replaceMacros({ sqlTemplate: 'INTERVAL $__interval_s second' }),
    ).toBe('INTERVAL {intervalSeconds:Int64} second');
  });

  it('should replace multiple macros in one query', () => {
    const result = replaceMacros({
      sqlTemplate:
        'SELECT $__timeInterval(ts), count() FROM t WHERE $__timeFilter(ts) GROUP BY 1',
    });
    expect(result).toContain('toStartOfInterval');
    expect(result).toContain(
      'ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64}))',
    );
  });

  it('should throw on wrong argument count', () => {
    expect(() => replaceMacros({ sqlTemplate: '$__timeFilter(a, b)' })).toThrow(
      'expects 1 argument(s), but got 2',
    );
  });

  it('should throw on missing close bracket', () => {
    expect(() => replaceMacros({ sqlTemplate: '$__timeFilter(col' })).toThrow(
      'Failed to parse macro arguments',
    );
  });

  it('should replace $__filters with provided filtersSQL', () => {
    const result = replaceMacros(
      { sqlTemplate: 'WHERE $__filters' },
      "(col = 'val') AND (x > 1)",
    );
    expect(result).toBe("WHERE (col = 'val') AND (x > 1)");
  });

  it('should replace $__filters with fallback when no filtersSQL provided', () => {
    expect(replaceMacros({ sqlTemplate: 'WHERE $__filters' })).toBe(
      'WHERE (1=1 /** no filters applied */)',
    );
  });

  it('should replace $__filters with fallback when filtersSQL is empty', () => {
    expect(replaceMacros({ sqlTemplate: 'WHERE $__filters' }, '')).toBe(
      'WHERE (1=1 /** no filters applied */)',
    );
  });

  it('should replace $__sourceTable with databaseName.tableName', () => {
    const result = replaceMacros({
      sqlTemplate: 'SELECT * FROM $__sourceTable',
      from: { databaseName: 'otel', tableName: 'otel_logs' },
    });
    expect(result).toBe('SELECT * FROM `otel`.`otel_logs`');
  });

  it('should replace $__sourceTable in a complex query', () => {
    const result = replaceMacros({
      sqlTemplate: 'SELECT count() FROM $__sourceTable WHERE $__timeFilter(ts)',
      from: { databaseName: 'default', tableName: 'my_table' },
    });
    expect(result).toContain('FROM `default`.`my_table`');
    expect(result).toContain('ts >=');
  });

  it('should throw when $__sourceTable is used without a source', () => {
    expect(() =>
      replaceMacros({ sqlTemplate: 'SELECT * FROM $__sourceTable' }),
    ).toThrow("Macro '$__sourceTable' requires a source to be selected");
  });

  it('should replace $__sourceTable(gauge) with the gauge metric table', () => {
    const result = replaceMacros({
      sqlTemplate: 'SELECT * FROM $__sourceTable(gauge)',
      from: { databaseName: 'otel', tableName: 'otel_logs' },
      metricTables: ALL_METRIC_TABLES,
    });
    expect(result).toBe('SELECT * FROM `otel`.`otel_metrics_gauge`');
  });

  it('should replace $__sourceTable(sum) with the sum metric table', () => {
    const result = replaceMacros({
      sqlTemplate: 'SELECT * FROM $__sourceTable(sum)',
      from: { databaseName: 'otel', tableName: 'otel_logs' },
      metricTables: ALL_METRIC_TABLES,
    });
    expect(result).toBe('SELECT * FROM `otel`.`otel_metrics_sum`');
  });

  it('should replace $__sourceTable(histogram) with the histogram metric table', () => {
    const result = replaceMacros({
      sqlTemplate: 'SELECT * FROM $__sourceTable(histogram)',
      from: { databaseName: 'otel', tableName: 'otel_logs' },
      metricTables: ALL_METRIC_TABLES,
    });
    expect(result).toBe('SELECT * FROM `otel`.`otel_metrics_histogram`');
  });

  it('should throw when $__sourceTable is called with an invalid metric type', () => {
    expect(() =>
      replaceMacros({
        sqlTemplate: 'SELECT * FROM $__sourceTable(invalid)',
        from: { databaseName: 'otel', tableName: 'otel_logs' },
        metricTables: ALL_METRIC_TABLES,
      }),
    ).toThrow('Expected a valid metrics data type');
  });

  it('should throw when $__sourceTable is called with a metric type that has no table', () => {
    expect(() =>
      replaceMacros({
        sqlTemplate: 'SELECT * FROM $__sourceTable(gauge)',
        from: { databaseName: 'otel', tableName: 'otel_logs' },
        metricTables: {} as MetricTable,
      }),
    ).toThrow("No table configured for metric type 'gauge'");
  });

  it('should throw when $__sourceTable is called with a metric type but no metricTables', () => {
    expect(() =>
      replaceMacros({
        sqlTemplate: 'SELECT * FROM $__sourceTable(gauge)',
        from: { databaseName: 'otel', tableName: 'otel_logs' },
      }),
    ).toThrow(
      'with a metric type argument requires a metrics source to be selected',
    );
  });

  it('should throw when $__sourceTable is used without a metricType but metricTables is set', () => {
    expect(() =>
      replaceMacros({
        sqlTemplate: 'SELECT * FROM $__sourceTable',
        from: { databaseName: 'otel', tableName: 'otel_logs' },
        metricTables: ALL_METRIC_TABLES,
      }),
    ).toThrow('requires a metricType when a metrics source is selected');
  });

  it('should throw when $__sourceTable is called with too many arguments', () => {
    expect(() =>
      replaceMacros({
        sqlTemplate: 'SELECT * FROM $__sourceTable(gauge, sum)',
        from: { databaseName: 'otel', tableName: 'otel_logs' },
        metricTables: ALL_METRIC_TABLES,
      }),
    ).toThrow('expects 0-1 argument(s), but got 2');
  });
});
