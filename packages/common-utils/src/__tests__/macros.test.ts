import { MalformedMacroArgsError } from '@/macroErrors';
import {
  getSourceDependentMacrosUsed,
  hasMacro,
  replaceMacros,
} from '@/macros';
import type { MetricTable } from '@/types';

const ALL_METRIC_TABLES: MetricTable = {
  gauge: 'otel_metrics_gauge',
  histogram: 'otel_metrics_histogram',
  sum: 'otel_metrics_sum',
  summary: 'otel_metrics_summary',
  'exponential histogram': 'otel_metrics_exponential_histogram',
};

describe('hasMacro', () => {
  it('detects a $__filters macro', () => {
    expect(hasMacro('SELECT * WHERE $__filters', 'filters')).toBe(true);
  });

  it('returns false when the macro is absent', () => {
    expect(hasMacro('SELECT * WHERE $__timeFilter(ts)', 'filters')).toBe(false);
  });

  it('matches on a word boundary (does not match a longer token)', () => {
    expect(hasMacro('SELECT $__filtersExtra', 'filters')).toBe(false);
  });

  it('detects macros that take arguments', () => {
    expect(hasMacro('WHERE $__timeFilter(ts)', 'timeFilter')).toBe(true);
  });
});

describe('getSourceDependentMacrosUsed', () => {
  it('returns an empty array when no source-dependent macros are used', () => {
    expect(
      getSourceDependentMacrosUsed('SELECT * WHERE $__timeFilter(ts)'),
    ).toEqual([]);
  });

  it('detects $__filters', () => {
    expect(getSourceDependentMacrosUsed('SELECT * WHERE $__filters')).toEqual([
      'filters',
    ]);
  });

  it('detects $__sourceTable', () => {
    expect(
      getSourceDependentMacrosUsed('SELECT * FROM $__sourceTable'),
    ).toEqual(['sourceTable']);
  });

  it('detects both when used together', () => {
    expect(
      getSourceDependentMacrosUsed(
        'SELECT * FROM $__sourceTable WHERE $__filters',
      ),
    ).toEqual(['filters', 'sourceTable']);
  });
});

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
      MalformedMacroArgsError,
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

  it('should keep an unknown macro verbatim', () => {
    expect(replaceMacros({ sqlTemplate: 'SELECT $__notAMacro(x)' })).toBe(
      'SELECT $__notAMacro(x)',
    );
  });

  it('should parse macro arguments containing quoted parens and commas', () => {
    const result = replaceMacros({
      sqlTemplate: "WHERE $__timeFilter(if(c = 'a),b', ts, ts2))",
    });
    expect(result).toBe(
      "WHERE if(c = 'a),b', ts, ts2) >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND if(c = 'a),b', ts, ts2) <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64}))",
    );
  });

  it('should not re-expand macros that appear in the filters SQL', () => {
    expect(
      replaceMacros(
        { sqlTemplate: 'WHERE $__filters' },
        "(msg IN ('$__fromTime', '$service'))",
      ),
    ).toBe("WHERE (msg IN ('$__fromTime', '$service'))");
  });
});

describe('replaceMacros with variables', () => {
  const variables = [
    { name: 'service', expression: 'ServiceName', values: ['api', 'web'] },
    { name: 'env', expression: 'Env', values: [] },
  ];

  describe('without a variables context', () => {
    it('leaves variable references verbatim', () => {
      expect(
        replaceMacros({
          sqlTemplate: 'WHERE svc = $service AND env = ${env:csv}',
        }),
      ).toBe('WHERE svc = $service AND env = ${env:csv}');
    });

    it('leaves the variable macros verbatim, arguments and all', () => {
      const sqlTemplate =
        "WHERE $__filter(ServiceName, service) AND $__conditionalAll(x = 'a)b', env)";
      expect(replaceMacros({ sqlTemplate })).toBe(sqlTemplate);
    });

    it('still expands standard macros alongside untouched references', () => {
      expect(
        replaceMacros({ sqlTemplate: 'WHERE $__timeFilter(ts) AND $service' }),
      ).toBe(
        'WHERE ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64})) AND $service',
      );
    });
  });

  describe('with a variables context', () => {
    it('expands references, variable macros and standard macros in one pass', () => {
      const result = replaceMacros(
        {
          sqlTemplate:
            'SELECT $__timeInterval(ts) FROM $__sourceTable ' +
            'WHERE $__timeFilter(ts) AND $__filters AND $__filter(service) ' +
            'AND svc IN ($service) AND $__conditionalAll(Env != $service, service)',
          from: { databaseName: 'otel', tableName: 'otel_logs' },
          variables,
        },
        "(toString(Env) IN ('prod'))",
      );

      expect(result).toBe(
        'SELECT toStartOfInterval(toDateTime(ts), INTERVAL {intervalSeconds:Int64} second) ' +
          'FROM `otel`.`otel_logs` ' +
          'WHERE ts >= toDateTime(fromUnixTimestamp64Milli({startDateMilliseconds:Int64})) ' +
          'AND ts <= toDateTime(fromUnixTimestamp64Milli({endDateMilliseconds:Int64})) ' +
          "AND (toString(Env) IN ('prod')) " +
          "AND (toString(ServiceName) IN ('api', 'web')) " +
          "AND svc IN ('api', 'web') " +
          "AND (Env != 'api', 'web')",
      );
    });

    it('distinguishes $__filters from $__filter(', () => {
      expect(
        replaceMacros(
          {
            sqlTemplate: 'WHERE $__filters AND $__filter(ServiceName, service)',
            variables,
          },
          '(1=2)',
        ),
      ).toBe("WHERE (1=2) AND (ServiceName IN ('api', 'web'))");
    });

    it('expands an unselected variable to a no-op predicate', () => {
      expect(
        replaceMacros({
          sqlTemplate: 'WHERE $__filter(env)',
          variables,
        }),
      ).toBe("WHERE (1=1 /** no values selected for variable 'env' */)");
    });

    it('does not expand references that appear in the filters SQL', () => {
      expect(
        replaceMacros(
          { sqlTemplate: 'WHERE $__filters', variables },
          "(msg IN ('$service'))",
        ),
      ).toBe("WHERE (msg IN ('$service'))");
    });

    it('does not re-expand a selected value that looks like a macro', () => {
      expect(
        replaceMacros({
          sqlTemplate: 'WHERE msg = $service',
          variables: [{ name: 'service', values: ['$__fromTime'] }],
        }),
      ).toBe("WHERE msg = '$__fromTime'");
    });

    it('throws when a variable macro names an unknown variable', () => {
      expect(() =>
        replaceMacros({
          sqlTemplate: 'WHERE $__filter(ServiceName, nope)',
          variables,
        }),
      ).toThrow("references unknown variable 'nope'");
    });

    it('leaves an unknown bare reference verbatim', () => {
      expect(
        replaceMacros({ sqlTemplate: "SELECT '$100 $nope'", variables }),
      ).toBe("SELECT '$100 $nope'");
    });

    it('treats an empty variables array as a provided context', () => {
      expect(() =>
        replaceMacros({
          sqlTemplate: 'WHERE $__filter(ServiceName, service)',
          variables: [],
        }),
      ).toThrow("references unknown variable 'service'");
    });
  });
});
