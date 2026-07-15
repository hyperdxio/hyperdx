import { renderBuilderConfigAsSqlTemplate } from '@/core/builderToRawSql';
import { Metadata } from '@/core/metadata';
import {
  convertRawSqlToBuilderConfig,
  replaceMacrosWithSentinels,
  SqlToBuilderError,
} from '@/core/rawSqlToBuilder';
import { ChartConfigWithOptDateRange, DisplayType } from '@/types';

describe('convertRawSqlToBuilderConfig', () => {
  let mockMetadata: jest.Mocked<Metadata>;

  beforeAll(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    const columns = [
      { name: 'timestamp', type: 'DateTime' },
      { name: 'date', type: 'Date' },
      { name: 'Duration', type: 'Float64' },
      { name: 'ServiceName', type: 'String' },
    ];
    mockMetadata = {
      getColumns: jest.fn().mockResolvedValue(columns),
      getMaterializedColumnsLookupTable: jest.fn().mockResolvedValue(new Map()),
      getColumn: jest
        .fn()
        .mockImplementation(async ({ column }) =>
          columns.find(col => col.name === column),
        ),
      getTableMetadata: jest
        .fn()
        .mockResolvedValue({ primary_key: 'timestamp' }),
      getSkipIndices: jest.fn().mockResolvedValue([]),
      getSetting: jest.fn().mockResolvedValue(undefined),
      isClickHouseCloud: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<Metadata>;
  });

  const from = { databaseName: 'default', tableName: 'otel_logs' };

  describe('replaceMacrosWithSentinels', () => {
    it('rewrites macro heads while preserving arguments', () => {
      expect(
        replaceMacrosWithSentinels(
          'SELECT $__timeInterval(timestamp) FROM $__sourceTable WHERE $__filters AND x >= $__fromTime_ms',
        ),
      ).toBe(
        'SELECT hdx_macro_timeInterval(timestamp) FROM hdx_macro_sourceTable WHERE hdx_macro_filters AND x >= hdx_macro_fromTime_ms',
      );
    });
  });

  describe('source table validation', () => {
    it('accepts the source-table macro', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate: 'SELECT count() FROM $__sourceTable',
          displayType: DisplayType.Number,
          from,
        }),
      ).not.toThrow();
    });

    it.each([
      'SELECT count() FROM otel_logs',
      'SELECT count() FROM default.otel_logs',
      'SELECT count() FROM `default`.`otel_logs`',
    ])('accepts a matching literal source table: %s', sqlTemplate => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate,
          displayType: DisplayType.Number,
          from,
        }),
      ).not.toThrow();
    });

    it.each([
      'SELECT count() FROM other_table',
      'SELECT count() FROM other_database.otel_logs',
    ])('rejects a different literal source table: %s', sqlTemplate => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate,
          displayType: DisplayType.Number,
          from,
        }),
      ).toThrow(SqlToBuilderError);
    });

    it('rejects a source alias because the builder cannot preserve it', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate: 'SELECT count(logs.Duration) FROM otel_logs AS logs',
          displayType: DisplayType.Number,
          from,
        }),
      ).toThrow(SqlToBuilderError);
    });

    it('rejects a parameterized source table', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate: 'SELECT count() FROM {table:Identifier}',
          displayType: DisplayType.Number,
          from,
        }),
      ).toThrow(SqlToBuilderError);
    });

    it('rejects conversion when no builder source is selected', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate: 'SELECT count() FROM $__sourceTable',
          displayType: DisplayType.Number,
        }),
      ).toThrow(SqlToBuilderError);
    });
  });

  describe('round-trips builder-generated SQL', () => {
    const baseLineConfig: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Line,
      connection: 'test-connection',
      from,
      select: [
        { aggFn: 'count', aggCondition: '', valueExpression: '' },
        { aggFn: 'avg', aggCondition: '', valueExpression: 'Duration' },
      ],
      groupBy: [{ aggCondition: '', valueExpression: 'ServiceName' }],
      where: 'ServiceName:api',
      whereLanguage: 'lucene',
      timestampValueExpression: 'timestamp',
      granularity: '1 minute',
    };

    it('recovers a line chart config with group-by and where', async () => {
      const rendered = await renderBuilderConfigAsSqlTemplate(
        baseLineConfig,
        mockMetadata,
      );
      if (rendered.isError) {
        throw new Error(rendered.error);
      }

      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: rendered.sql,
        displayType: DisplayType.Line,
        from,
        timestampValueExpression: baseLineConfig.timestampValueExpression,
      });

      // The top-level WHERE is broadcast into each series' aggCondition (these
      // display types have no top-level WHERE input in the builder).
      expect(result.select).toEqual([
        {
          aggFn: 'count',
          aggCondition: "ServiceName ILIKE '%api%'",
          aggConditionLanguage: 'sql',
          valueExpression: '',
        },
        {
          aggFn: 'avg',
          aggCondition: "ServiceName ILIKE '%api%'",
          aggConditionLanguage: 'sql',
          valueExpression: 'Duration',
        },
      ]);
      expect(result.groupBy).toBe('ServiceName');
      expect(result.where).toBe('');
      expect(result.whereLanguage).toBe('sql');
      expect(result.granularity).toBe('auto');
    });

    it('recovers a table chart with having, order by and limit', async () => {
      const rendered = await renderBuilderConfigAsSqlTemplate(
        {
          ...baseLineConfig,
          displayType: DisplayType.Table,
          granularity: undefined,
          having: 'count() > 5',
          havingLanguage: 'sql',
          orderBy: 'count() DESC',
          limit: { limit: 100 },
        },
        mockMetadata,
      );
      if (rendered.isError) {
        throw new Error(rendered.error);
      }

      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: rendered.sql,
        displayType: DisplayType.Table,
        from,
        timestampValueExpression: baseLineConfig.timestampValueExpression,
      });

      expect(result.groupBy).toBe('ServiceName');
      expect(result.having).toBe('count() > 5');
      expect(result.havingLanguage).toBe('sql');
      expect(result.orderBy).toBe('count() DESC');
      expect(result.limit).toEqual({ limit: 100, offset: undefined });
      expect(result.granularity).toBeUndefined();
    });

    it('recovers a number chart with a single aggregation and no group by', async () => {
      const rendered = await renderBuilderConfigAsSqlTemplate(
        {
          ...baseLineConfig,
          displayType: DisplayType.Number,
          select: [{ aggFn: 'count', aggCondition: '', valueExpression: '' }],
          groupBy: undefined,
          granularity: undefined,
        },
        mockMetadata,
      );
      if (rendered.isError) {
        throw new Error(rendered.error);
      }

      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: rendered.sql,
        displayType: DisplayType.Number,
        from,
        timestampValueExpression: baseLineConfig.timestampValueExpression,
      });

      expect(result.select).toHaveLength(1);
      expect(result.select[0].aggFn).toBe('count');
      expect(result.groupBy).toBe('');
      expect(result.granularity).toBeUndefined();
    });
  });

  describe('aggregation recognition', () => {
    const parse = (select: string) =>
      convertRawSqlToBuilderConfig({
        sqlTemplate: `SELECT ${select} FROM $__sourceTable`,
        displayType: DisplayType.Table,
        from,
      }).select;

    it('recognizes count and countIf', () => {
      expect(parse('count()')[0]).toMatchObject({
        aggFn: 'count',
        valueExpression: '',
      });
      expect(parse("countIf(ServiceName = 'api')")[0]).toMatchObject({
        aggFn: 'count',
        valueExpression: '',
        aggCondition: "ServiceName = 'api'",
      });
    });

    it('recognizes count(*) and is case-insensitive', () => {
      expect(parse('count(*)')[0]).toMatchObject({
        aggFn: 'count',
        valueExpression: '',
      });
      expect(parse('COUNT(*)')[0]).toMatchObject({
        aggFn: 'count',
        valueExpression: '',
      });
    });

    it('recognizes count_distinct', () => {
      expect(parse('count(DISTINCT UserId)')[0]).toMatchObject({
        aggFn: 'count_distinct',
        valueExpression: 'UserId',
      });
    });

    it('recognizes uniqExact as count_distinct', () => {
      expect(parse('uniqExact(ServiceName)')[0]).toMatchObject({
        aggFn: 'count_distinct',
        valueExpression: 'ServiceName',
      });
    });

    it('recognizes numeric aggregations, unwrapping the numeric coercion', () => {
      expect(
        parse('avg(toFloat64OrDefault(toString(Duration)))')[0],
      ).toMatchObject({ aggFn: 'avg', valueExpression: 'Duration' });
      expect(
        parse('sum(toFloat64OrDefault(toString(Duration)))')[0],
      ).toMatchObject({ aggFn: 'sum', valueExpression: 'Duration' });
    });

    it('recognizes a numeric aggregation without a coercion wrapper', () => {
      expect(parse('avg(Duration)')[0]).toMatchObject({
        aggFn: 'avg',
        valueExpression: 'Duration',
      });
    });

    it('unwraps a plain toFloat64 coercion', () => {
      expect(parse('sum(toFloat64(Duration))')[0]).toMatchObject({
        aggFn: 'sum',
        valueExpression: 'Duration',
      });
    });

    it('unwraps toFloat64OrDefault without an inner toString', () => {
      expect(parse('sum(toFloat64OrDefault(Duration))')[0]).toMatchObject({
        aggFn: 'sum',
        valueExpression: 'Duration',
      });
    });

    it('unwraps toFloat64 with an inner toString', () => {
      expect(parse('sum(toFloat64(toString(Duration)))')[0]).toMatchObject({
        aggFn: 'sum',
        valueExpression: 'Duration',
      });
    });

    it('does not unwrap toFloat64OrDefault when it has an explicit default', () => {
      expect(
        parse('sum(toFloat64OrDefault(toString(Duration), 0))')[0],
      ).toMatchObject({
        aggFn: 'sum',
        valueExpression: 'toFloat64OrDefault(toString(Duration), 0)',
      });
    });

    it('recognizes min, max, any and last_value', () => {
      expect(parse('min(Duration)')[0]).toMatchObject({
        aggFn: 'min',
        valueExpression: 'Duration',
      });
      expect(parse('max(Duration)')[0]).toMatchObject({
        aggFn: 'max',
        valueExpression: 'Duration',
      });
      expect(parse('any(ServiceName)')[0]).toMatchObject({
        aggFn: 'any',
        valueExpression: 'ServiceName',
      });
      expect(parse('last_value(Duration)')[0]).toMatchObject({
        aggFn: 'last_value',
        valueExpression: 'Duration',
      });
    });

    it('recognizes an If aggregation and strips the null guard', () => {
      const col = parse(
        "avgIf(toFloat64OrDefault(toString(Duration)), (ServiceName = 'api') AND toFloat64OrDefault(toString(Duration)) IS NOT NULL)",
      )[0];
      expect(col).toMatchObject({
        aggFn: 'avg',
        valueExpression: 'Duration',
        aggCondition: "ServiceName = 'api'",
      });
    });

    it('recognizes an If aggregation without a null guard', () => {
      expect(parse('sumIf(Duration, StatusCode = 500)')[0]).toMatchObject({
        aggFn: 'sum',
        valueExpression: 'Duration',
        aggCondition: 'StatusCode = 500',
      });
    });

    it('recognizes quantile at builder-supported levels (p50/p90/p95/p99)', () => {
      expect(
        parse('quantile(0.95)(toFloat64OrDefault(toString(Duration)))')[0],
      ).toMatchObject({
        aggFn: 'quantile',
        level: 0.95,
        valueExpression: 'Duration',
      });
      for (const level of [0.5, 0.9, 0.95, 0.99]) {
        expect(parse(`quantile(${level})(Duration)`)[0]).toMatchObject({
          aggFn: 'quantile',
          level,
        });
      }
    });

    it('recognizes median as quantile at level 0.5', () => {
      expect(parse('median(Duration)')[0]).toMatchObject({
        aggFn: 'quantile',
        level: 0.5,
        valueExpression: 'Duration',
      });
    });

    it('recognizes quantileIf with a condition', () => {
      expect(
        parse('quantileIf(0.95)(Duration, StatusCode = 500)')[0],
      ).toMatchObject({
        aggFn: 'quantile',
        level: 0.95,
        valueExpression: 'Duration',
        aggCondition: 'StatusCode = 500',
      });
    });

    it('maps an unsupported quantile level to a custom (none) expression', () => {
      expect(parse('quantile(0.98)(Duration)')[0]).toMatchObject({
        aggFn: 'none',
        valueExpression: 'quantile(0.98)(Duration)',
      });
    });

    it('maps arbitrary aggregation functions to a custom (none) expression', () => {
      expect(parse('quantileTDigest(0.98)(Duration)')[0]).toMatchObject({
        aggFn: 'none',
        valueExpression: 'quantileTDigest(0.98)(Duration)',
      });
    });

    it('captures a series alias', () => {
      expect(parse('count() AS total')[0]).toMatchObject({
        aggFn: 'count',
        alias: 'total',
      });
    });

    it('falls back to none for a raw expression', () => {
      expect(parse('Duration + 1')[0]).toMatchObject({
        aggFn: 'none',
        valueExpression: 'Duration + 1',
      });
    });

    it('recognizes ratio (divide) selects', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT divide(count(), sum(toFloat64OrDefault(toString(Duration)))) FROM $__sourceTable',
        displayType: DisplayType.Number,
        from,
      });
      expect(result.seriesReturnType).toBe('ratio');
      expect(result.select).toHaveLength(2);
      expect(result.select[0].aggFn).toBe('count');
      expect(result.select[1].aggFn).toBe('sum');
    });

    it('recognizes a ratio written with the / operator', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: 'SELECT count() / sum(Duration) FROM $__sourceTable',
        displayType: DisplayType.Number,
        from,
      });
      expect(result.seriesReturnType).toBe('ratio');
      expect(result.select).toHaveLength(2);
      expect(result.select[0]).toMatchObject({ aggFn: 'count' });
      expect(result.select[1]).toMatchObject({
        aggFn: 'sum',
        valueExpression: 'Duration',
      });
    });

    it('recovers per-leg conditions in a ratio', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT countIf(StatusCode = 500) / countIf(StatusCode < 500) FROM $__sourceTable',
        displayType: DisplayType.Number,
        from,
      });
      expect(result.seriesReturnType).toBe('ratio');
      expect(result.select.map(s => s.aggCondition)).toEqual([
        'StatusCode = 500',
        'StatusCode < 500',
      ]);
    });
  });

  describe('shared WHERE broadcasting', () => {
    it('broadcasts a top-level WHERE into every aggregation series and clears it', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          "SELECT count(), sum(toFloat64OrDefault(toString(Duration))) FROM $__sourceTable WHERE ServiceName = 'api'",
        displayType: DisplayType.Table,
        from,
      });
      expect(result.where).toBe('');
      expect(result.select.map(s => s.aggCondition)).toEqual([
        "ServiceName = 'api'",
        "ServiceName = 'api'",
      ]);
    });

    it('broadcasts a WHERE ... IN (...) into the aggregation', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          "SELECT count() FROM $__sourceTable WHERE ServiceName IN ('api', 'web')",
        displayType: DisplayType.Table,
        from,
      });
      expect(result.where).toBe('');
      expect(result.select[0].aggCondition).toBe(
        "ServiceName IN ('api', 'web')",
      );
    });

    it('ANDs the broadcast WHERE with an existing -If condition', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          "SELECT countIf(StatusCode = 500) FROM $__sourceTable WHERE ServiceName = 'api'",
        displayType: DisplayType.Number,
        from,
      });
      expect(result.where).toBe('');
      expect(result.select[0].aggCondition).toBe(
        "(StatusCode = 500) AND (ServiceName = 'api')",
      );
    });

    it('broadcasts a compound WHERE (multiple conjuncts) into each series', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          "SELECT count() FROM $__sourceTable WHERE ServiceName = 'api' AND StatusCode >= 500",
        displayType: DisplayType.Number,
        from,
      });
      expect(result.where).toBe('');
      expect(result.select[0].aggCondition).toBe(
        "(ServiceName = 'api') AND (StatusCode >= 500)",
      );
    });

    it('keeps the WHERE at the top level when a raw (none) column is present', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          "SELECT count(), SpanId FROM $__sourceTable WHERE ServiceName = 'api'",
        displayType: DisplayType.Table,
        from,
      });
      // SpanId is a raw `none` column that can't carry an aggCondition, so the
      // shared WHERE is not broadcast.
      expect(result.where).toBe("ServiceName = 'api'");
      expect(result.select.every(s => s.aggCondition === '')).toBe(true);
    });

    it('does not surface the builder aggCondition OR-group as an extra WHERE', async () => {
      const orGroupConfig: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from,
        select: [
          {
            aggFn: 'count',
            aggCondition: "ServiceName = 'a'",
            aggConditionLanguage: 'sql',
            valueExpression: '',
          },
          {
            aggFn: 'sum',
            aggCondition: "ServiceName = 'b'",
            aggConditionLanguage: 'sql',
            valueExpression: 'Duration',
          },
        ],
        where: '',
        timestampValueExpression: 'timestamp',
      };
      const rendered = await renderBuilderConfigAsSqlTemplate(
        orGroupConfig,
        mockMetadata,
      );
      if (rendered.isError) {
        throw new Error(rendered.error);
      }

      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: rendered.sql,
        displayType: DisplayType.Table,
        from,
        timestampValueExpression: orGroupConfig.timestampValueExpression,
      });
      // The `(ServiceName = 'a' OR ServiceName = 'b')` index hint is stripped,
      // leaving each series' own aggCondition and no residual WHERE.
      expect(result.where).toBe('');
      expect(result.select.map(s => s.aggCondition)).toEqual([
        "ServiceName = 'a'",
        "ServiceName = 'b'",
      ]);
    });
  });

  describe('query parameter recognition', () => {
    it('strips a time-range WHERE written with query params directly', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: `SELECT count()
          FROM $__sourceTable
          WHERE timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})
            AND timestamp < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})`,
        displayType: DisplayType.Number,
        from,
        timestampValueExpression: 'timestamp',
      });
      // The time-range predicate is derived from the dashboard range, so it is
      // dropped rather than surfaced as a user WHERE / aggCondition.
      expect(result.where).toBe('');
      expect(result.select).toHaveLength(1);
      expect(result.select[0]).toMatchObject({ aggFn: 'count' });
      expect(result.select[0].aggCondition).toBe('');
    });

    it('keeps a genuine WHERE alongside a query-param time range', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: `SELECT count()
          FROM $__sourceTable
          WHERE timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})
            AND timestamp < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})
            AND ServiceName = 'api'`,
        displayType: DisplayType.Number,
        from,
        timestampValueExpression: 'timestamp',
      });
      // Only the user's predicate survives; it broadcasts into the aggregation.
      expect(result.where).toBe('');
      expect(result.select[0].aggCondition).toBe("ServiceName = 'api'");
    });

    it('rejects an arbitrary use of a time-range query parameter', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate: `SELECT count()
            FROM $__sourceTable
            WHERE price > {startDateMilliseconds:Int64}`,
          displayType: DisplayType.Number,
          from,
          timestampValueExpression: 'timestamp',
        }),
      ).toThrow(SqlToBuilderError);
    });

    it('rejects a time bound wrapped differently from the timestamp expression', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate: `SELECT count()
            FROM $__sourceTable
            WHERE timestamp >= toStartOfHour($__fromTime_ms)
              AND timestamp <= toStartOfHour($__toTime_ms)`,
          displayType: DisplayType.Number,
          from,
          timestampValueExpression: 'timestamp',
        }),
      ).toThrow(SqlToBuilderError);
    });

    it('rejects wrappers that the renderer does not use for time bounds', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate: `SELECT count()
            FROM $__sourceTable
            WHERE timestamp >= toDateTime($__fromTime_ms)
              AND timestamp <= toDateTime($__toTime_ms)`,
          displayType: DisplayType.Number,
          from,
          timestampValueExpression: 'timestamp',
        }),
      ).toThrow(SqlToBuilderError);
    });

    it('rejects a malformed included-data-interval expansion', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate: `SELECT count()
            FROM $__sourceTable
            WHERE timestamp >= toStartOfInterval($__fromTime_ms, INTERVAL $__interval_s second) - INTERVAL 1 minute
              AND timestamp <= toStartOfInterval($__toTime_ms, INTERVAL $__interval_s second) + INTERVAL 1 minute`,
          displayType: DisplayType.Number,
          from,
          timestampValueExpression: 'timestamp',
        }),
      ).toThrow(SqlToBuilderError);
    });

    it('rejects a one-sided time range', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate:
            'SELECT count() FROM $__sourceTable WHERE timestamp >= $__fromTime_ms',
          displayType: DisplayType.Number,
          from,
          timestampValueExpression: 'timestamp',
        }),
      ).toThrow(SqlToBuilderError);
    });

    it('rejects a complete range on a different timestamp expression', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate: `SELECT count()
            FROM $__sourceTable
            WHERE other_timestamp >= $__fromTime_ms
              AND other_timestamp <= $__toTime_ms`,
          displayType: DisplayType.Number,
          from,
          timestampValueExpression: 'timestamp',
        }),
      ).toThrow(
        new SqlToBuilderError(
          'The SQL time filter uses timestamp expression "other_timestamp", but the selected source uses "timestamp". Update the SQL time filter or select a matching source.',
        ),
      );
    });

    it('explains a timestamp mismatch in a time-filter macro', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate:
            'SELECT count() FROM $__sourceTable WHERE $__timeFilter(other_timestamp)',
          displayType: DisplayType.Number,
          from,
          timestampValueExpression: 'timestamp',
        }),
      ).toThrow(
        new SqlToBuilderError(
          'The SQL time filter uses timestamp expression "other_timestamp", but the selected source uses "timestamp". Update the SQL time filter or select a matching source.',
        ),
      );
    });

    it('consumes every pair in a multi-column timestamp range', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: `SELECT count()
          FROM $__sourceTable
          WHERE date >= toDate($__fromTime_ms)
            AND date <= toDate($__toTime_ms)
            AND timestamp >= $__fromTime_ms
            AND timestamp <= $__toTime_ms
            AND ServiceName = 'api'`,
        displayType: DisplayType.Number,
        from,
        timestampValueExpression: 'date, timestamp',
      });

      expect(result.where).toBe('');
      expect(result.select[0].aggCondition).toBe("ServiceName = 'api'");
    });

    it('splits multi-column timestamp expressions without splitting nested commas', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: `SELECT count()
          FROM $__sourceTable
          WHERE ResourceAttributes['date,time'] >= $__fromTime_ms
            AND ResourceAttributes['date,time'] <= $__toTime_ms
            AND toDateTime64(timestamp, 3) >= $__fromTime_ms
            AND toDateTime64(timestamp, 3) <= $__toTime_ms`,
        displayType: DisplayType.Number,
        from,
        timestampValueExpression:
          "ResourceAttributes['date,time'], toDateTime64(timestamp, 3)",
      });
      expect(result.where).toBe('');
    });

    it('recognizes renderer-expanded included-data-interval bounds', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: `SELECT count()
          FROM $__sourceTable
          WHERE timestamp >= toStartOfInterval($__fromTime_ms, INTERVAL $__interval_s second) - INTERVAL $__interval_s second
            AND timestamp <= toStartOfInterval($__toTime_ms, INTERVAL $__interval_s second) + INTERVAL $__interval_s second`,
        displayType: DisplayType.Number,
        from,
        timestampValueExpression: 'timestamp',
      });
      expect(result.where).toBe('');
    });

    it('rejects partial coverage of a multi-column timestamp expression', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate: `SELECT count()
            FROM $__sourceTable
            WHERE timestamp >= $__fromTime_ms
              AND timestamp <= $__toTime_ms`,
          displayType: DisplayType.Number,
          from,
          timestampValueExpression: 'date, timestamp',
        }),
      ).toThrow(SqlToBuilderError);
    });

    it('rejects time-range parameters nested in OR', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate: `SELECT count()
            FROM $__sourceTable
            WHERE timestamp >= $__fromTime_ms OR ServiceName = 'api'`,
          displayType: DisplayType.Number,
          from,
          timestampValueExpression: 'timestamp',
        }),
      ).toThrow(SqlToBuilderError);
    });

    it('accepts a complete time-filter macro for the configured timestamp', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT count() FROM $__sourceTable WHERE $__timeFilter(timestamp)',
        displayType: DisplayType.Number,
        from,
        timestampValueExpression: 'timestamp',
      });
      expect(result.where).toBe('');
      expect(result.select[0].aggCondition).toBe('');
    });

    it('accepts a complete two-column time-filter macro', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT count() FROM $__sourceTable WHERE $__dateTimeFilter(date, timestamp)',
        displayType: DisplayType.Number,
        from,
        timestampValueExpression: 'date, timestamp',
      });
      expect(result.where).toBe('');
      expect(result.select[0].aggCondition).toBe('');
    });

    it('rejects a time range when timestamp context is unavailable', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate: `SELECT count()
            FROM $__sourceTable
            WHERE timestamp >= $__fromTime_ms
              AND timestamp <= $__toTime_ms`,
          displayType: DisplayType.Number,
          from,
        }),
      ).toThrow(SqlToBuilderError);
    });

    it('round-trips renderer-added primary-key time filters', async () => {
      mockMetadata.getTableMetadata.mockResolvedValue({
        primary_key: 'toStartOfHour(timestamp), timestamp',
      } as any);
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        from,
        select: [{ aggFn: 'count', aggCondition: '', valueExpression: '' }],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'timestamp',
        granularity: '1 minute',
      };
      const rendered = await renderBuilderConfigAsSqlTemplate(
        config,
        mockMetadata,
      );
      if (rendered.isError) throw new Error(rendered.error);

      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate: rendered.sql,
          displayType: DisplayType.Line,
          from,
          timestampValueExpression: 'timestamp',
        }),
      ).not.toThrow();
    });

    it('round-trips a renderer-generated multi-column timestamp range', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        from,
        select: [{ aggFn: 'count', aggCondition: '', valueExpression: '' }],
        where: '',
        whereLanguage: 'sql',
        timestampValueExpression: 'date, timestamp',
        granularity: '1 minute',
      };
      const rendered = await renderBuilderConfigAsSqlTemplate(
        config,
        mockMetadata,
      );
      if (rendered.isError) throw new Error(rendered.error);

      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: rendered.sql,
        displayType: DisplayType.Line,
        from,
        timestampValueExpression: config.timestampValueExpression,
      });

      expect(result.granularity).toBe('auto');
      expect(result).not.toHaveProperty('timestampValueExpression');
    });

    it('recognizes a time bucket written as toStartOfInterval over intervalSeconds', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: `SELECT
            toStartOfInterval(timestamp, INTERVAL {intervalSeconds:Int64} second) AS ts,
            ServiceName,
            count()
          FROM $__sourceTable
          WHERE timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})
            AND timestamp < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})
          GROUP BY ServiceName, ts`,
        displayType: DisplayType.Line,
        from,
        timestampValueExpression: 'timestamp',
      });
      // The bucket (referenced by its `ts` alias in GROUP BY) is dropped and
      // maps to auto granularity, leaving ServiceName as the only grouping.
      expect(result.granularity).toBe('auto');
      expect(result.groupBy).toBe('ServiceName');
      expect(result.select).toHaveLength(1);
      expect(result.select[0]).toMatchObject({ aggFn: 'count' });
    });

    it('recognizes a millisecond time bucket over intervalMilliseconds', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: `SELECT
            toStartOfInterval(toDateTime64(timestamp, 3), INTERVAL {intervalMilliseconds:Int64} millisecond) AS ts,
            count()
          FROM $__sourceTable
          GROUP BY ts`,
        displayType: DisplayType.Line,
        from,
        timestampValueExpression: 'timestamp',
      });
      expect(result.granularity).toBe('auto');
      expect(result.groupBy).toBe('');
      expect(result.select).toHaveLength(1);
    });

    it('drops ORDER BY that references the query-param time bucket alias', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: `SELECT
            toStartOfInterval(timestamp, INTERVAL {intervalSeconds:Int64} second) AS ts,
            count()
          FROM $__sourceTable
          GROUP BY ts
          ORDER BY ts ASC`,
        displayType: DisplayType.Line,
        from,
        timestampValueExpression: 'timestamp',
      });
      // Line charts reject ORDER BY; dropping the implicit bucket ordering keeps
      // the conversion valid.
      expect(result.orderBy).toBeUndefined();
      expect(result.granularity).toBe('auto');
    });
  });

  describe('table charts', () => {
    it('recovers a single grouping column', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT count(), ServiceName FROM $__sourceTable GROUP BY ServiceName',
        displayType: DisplayType.Table,
        from,
      });
      expect(result.groupBy).toBe('ServiceName');
      expect(result.select).toHaveLength(1);
      expect(result.select[0]).toMatchObject({ aggFn: 'count' });
    });

    it('resolves positional GROUP BY references to the selected columns', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT ServiceName, StatusCode, count() FROM $__sourceTable GROUP BY 1, 2',
        displayType: DisplayType.Table,
        from,
      });
      expect(result.groupBy).toBe('ServiceName, StatusCode');
      expect(result.select).toHaveLength(1);
      expect(result.select[0]).toMatchObject({ aggFn: 'count' });
    });

    it('resolves a GROUP BY that references a select alias', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT ServiceName AS svc, count() FROM $__sourceTable GROUP BY svc',
        displayType: DisplayType.Table,
        from,
      });
      expect(result.groupBy).toBe('ServiceName');
      expect(result.select).toHaveLength(1);
      expect(result.select[0]).toMatchObject({ aggFn: 'count' });
    });

    it('recovers HAVING', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT count(), ServiceName FROM $__sourceTable GROUP BY ServiceName HAVING count(*) > 5',
        displayType: DisplayType.Table,
        from,
      });
      expect(result.having).toBe('count(*) > 5');
      expect(result.havingLanguage).toBe('sql');
    });

    it('recovers a multi-column ORDER BY', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT count(), ServiceName FROM $__sourceTable GROUP BY ServiceName ORDER BY count() DESC, ServiceName ASC',
        displayType: DisplayType.Table,
        from,
      });
      expect(result.orderBy).toBe('count() DESC, ServiceName ASC');
    });

    it('recovers the comma form of LIMIT (offset, count)', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT count(), ServiceName FROM $__sourceTable GROUP BY ServiceName LIMIT 5, 10',
        displayType: DisplayType.Table,
        from,
      });
      expect(result.limit).toEqual({ limit: 10, offset: 5 });
    });
  });

  describe('time series charts', () => {
    it('recovers auto granularity with multiple grouping columns', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: `SELECT
            toStartOfInterval(timestamp, INTERVAL {intervalSeconds:Int64} second) AS ts,
            ServiceName,
            StatusCode,
            count()
          FROM $__sourceTable
          GROUP BY ServiceName, StatusCode, ts`,
        displayType: DisplayType.Line,
        from,
        timestampValueExpression: 'timestamp',
      });
      expect(result.granularity).toBe('auto');
      expect(result.groupBy).toBe('ServiceName, StatusCode');
      expect(result.select).toHaveLength(1);
    });

    it('recovers a stacked bar chart time bucket', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: `SELECT
            toStartOfInterval(timestamp, INTERVAL {intervalSeconds:Int64} second) AS ts,
            ServiceName,
            count()
          FROM $__sourceTable
          GROUP BY ServiceName, ts`,
        displayType: DisplayType.StackedBar,
        from,
        timestampValueExpression: 'timestamp',
      });
      expect(result.granularity).toBe('auto');
      expect(result.groupBy).toBe('ServiceName');
      expect(result.select).toHaveLength(1);
    });

    it('maps toStartOfMinute to a 1 minute granularity', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT toStartOfMinute(timestamp) AS ts, count() FROM $__sourceTable GROUP BY ts',
        displayType: DisplayType.Line,
        from,
        timestampValueExpression: 'timestamp',
      });
      expect(result.granularity).toBe('1 minute');
      expect(result.groupBy).toBe('');
      expect(result.select).toHaveLength(1);
      expect(result.select[0]).toMatchObject({ aggFn: 'count' });
    });

    it('maps a literal INTERVAL time bucket to a granularity', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT toStartOfInterval(timestamp, INTERVAL 1 MINUTE) AS ts, count() FROM $__sourceTable GROUP BY ts',
        displayType: DisplayType.Line,
        from,
        timestampValueExpression: 'timestamp',
      });
      expect(result.granularity).toBe('1 minute');
      expect(result.groupBy).toBe('');
      expect(result.select).toHaveLength(1);
    });

    it('maps toStartOfHour to a 1 hour granularity', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT toStartOfHour(timestamp) AS ts, count() FROM $__sourceTable GROUP BY ts',
        displayType: DisplayType.Line,
        from,
        timestampValueExpression: 'timestamp',
      });
      expect(result.granularity).toBe('1 hour');
      expect(result.groupBy).toBe('');
      expect(result.select).toHaveLength(1);
    });

    it('rejects a bucket on a timestamp not configured by the source', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate:
            'SELECT toStartOfMinute(created_at) AS ts, count() FROM $__sourceTable GROUP BY ts',
          displayType: DisplayType.Line,
          from,
          timestampValueExpression: 'timestamp',
        }),
      ).toThrow(SqlToBuilderError);
    });

    it('rejects a bucket without source timestamp context', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate:
            'SELECT toStartOfMinute(timestamp) AS ts, count() FROM $__sourceTable GROUP BY ts',
          displayType: DisplayType.Line,
          from,
        }),
      ).toThrow(SqlToBuilderError);
    });

    it('rejects a bucket expression even when the source time filters match', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate: `SELECT toStartOfMinute(created_at) AS ts, count()
            FROM $__sourceTable
            WHERE timestamp >= $__fromTime_ms
              AND timestamp <= $__toTime_ms
            GROUP BY ts`,
          displayType: DisplayType.Line,
          from,
          timestampValueExpression: 'timestamp',
        }),
      ).toThrow(SqlToBuilderError);
    });

    it('does not treat the fixed bucket alias as proof of time bucketing', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: `SELECT ServiceName AS __hdx_time_bucket, count()
          FROM $__sourceTable
          GROUP BY __hdx_time_bucket`,
        displayType: DisplayType.Line,
        from,
      });

      expect(result.granularity).toBeUndefined();
      expect(result.groupBy).toBe('ServiceName');
      expect(result.select).toHaveLength(1);
    });
  });

  describe('pie and bar charts', () => {
    it('recovers a single pie series with group by and order by', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT count(), ServiceName FROM $__sourceTable GROUP BY ServiceName ORDER BY count() DESC',
        displayType: DisplayType.Pie,
        from,
      });
      expect(result.groupBy).toBe('ServiceName');
      expect(result.orderBy).toBe('count() DESC');
      expect(result.select).toHaveLength(1);
    });

    it('maps a uniqExact pie series to count_distinct', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT uniqExact(ServiceName) AS uv, StatusCode FROM $__sourceTable GROUP BY StatusCode',
        displayType: DisplayType.Pie,
        from,
      });
      expect(result.groupBy).toBe('StatusCode');
      expect(result.select).toHaveLength(1);
      expect(result.select[0]).toMatchObject({
        aggFn: 'count_distinct',
        valueExpression: 'ServiceName',
        alias: 'uv',
      });
    });

    it('recovers a single bar series with group by and order by', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT avg(Duration), ServiceName FROM $__sourceTable GROUP BY ServiceName ORDER BY avg(Duration) DESC',
        displayType: DisplayType.Bar,
        from,
      });
      expect(result.groupBy).toBe('ServiceName');
      expect(result.orderBy).toBe('avg(Duration) DESC');
      expect(result.select).toHaveLength(1);
      expect(result.select[0]).toMatchObject({
        aggFn: 'avg',
        valueExpression: 'Duration',
      });
    });

    it('maps a median bar series to quantile 0.5', () => {
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate:
          'SELECT median(Duration), ServiceName FROM $__sourceTable GROUP BY ServiceName',
        displayType: DisplayType.Bar,
        from,
      });
      expect(result.groupBy).toBe('ServiceName');
      expect(result.select).toHaveLength(1);
      expect(result.select[0]).toMatchObject({
        aggFn: 'quantile',
        level: 0.5,
        valueExpression: 'Duration',
      });
    });
  });

  describe('rejects leaked macros', () => {
    const expectMacroRejected = (
      sqlTemplate: string,
      displayType: DisplayType = DisplayType.Table,
    ) =>
      expect(() =>
        convertRawSqlToBuilderConfig({ sqlTemplate, displayType, from }),
      ).toThrow(SqlToBuilderError);

    it('rejects a macro in a raw (none) select column', () => {
      expectMacroRejected('SELECT $__fromTime FROM $__sourceTable');
    });

    it('rejects a macro nested inside a raw select expression', () => {
      expectMacroRejected('SELECT toDateTime($__fromTime) FROM $__sourceTable');
    });

    it('rejects a macro in an aggregation value expression', () => {
      expectMacroRejected('SELECT max($__fromTime) FROM $__sourceTable');
    });

    it('rejects a macro in GROUP BY', () => {
      expectMacroRejected(
        'SELECT count(), $__fromTime FROM $__sourceTable GROUP BY $__fromTime',
      );
    });

    it('rejects a macro in ORDER BY', () => {
      expectMacroRejected(
        'SELECT SpanId FROM $__sourceTable ORDER BY $__fromTime',
      );
    });

    it('rejects a leaked macro even on time series charts', () => {
      expectMacroRejected(
        'SELECT $__timeInterval(timestamp) + 1 FROM $__sourceTable',
        DisplayType.Line,
      );
    });

    it('names the offending macro in the error message', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate: 'SELECT toDateTime($__fromTime) FROM $__sourceTable',
          displayType: DisplayType.Table,
          from,
        }),
      ).toThrow('$__fromTime');
    });

    it('converts a query whose macros are all recognized and consumed', () => {
      // $__sourceTable (FROM), $__timeInterval (time bucket) and $__filters are
      // all consumed during conversion, so nothing leaks.
      const result = convertRawSqlToBuilderConfig({
        sqlTemplate: `SELECT $__timeInterval(timestamp) AS ts, count()
          FROM $__sourceTable
          WHERE $__filters
          GROUP BY ts`,
        displayType: DisplayType.Line,
        from,
        timestampValueExpression: 'timestamp',
      });
      expect(result.granularity).toBe('auto');
      expect(result.select).toHaveLength(1);
      expect(result.select[0]).toMatchObject({ aggFn: 'count' });
    });
  });

  describe('interval query parameter on non-time-series charts', () => {
    const intervalSql =
      'SELECT toStartOfInterval(timestamp, INTERVAL {intervalSeconds:Int64} second) + 1 AS x FROM $__sourceTable';

    it('rejects an interval query parameter in a raw column', () => {
      expect(() =>
        convertRawSqlToBuilderConfig({
          sqlTemplate: intervalSql,
          displayType: DisplayType.Table,
          from,
        }),
      ).toThrow(SqlToBuilderError);
    });
  });

  describe('unsupported patterns', () => {
    const expectError = (
      sqlTemplate: string,
      displayType: DisplayType = DisplayType.Table,
    ) =>
      expect(() =>
        convertRawSqlToBuilderConfig({ sqlTemplate, displayType, from }),
      ).toThrow(SqlToBuilderError);

    it('rejects empty SQL', () => {
      expectError('   ');
    });

    it('rejects unparseable SQL', () => {
      expectError('SELECT ??? FROM');
    });

    it('rejects UNION queries', () => {
      expectError(
        'SELECT count() FROM $__sourceTable UNION ALL SELECT count() FROM $__sourceTable',
      );
    });

    it('rejects joins / multiple tables', () => {
      expectError('SELECT count() FROM a JOIN b ON a.id = b.id');
    });

    it('rejects subquery FROM', () => {
      expectError('SELECT count() FROM (SELECT 1)');
    });

    it('rejects user CTEs', () => {
      expectError('WITH x AS (SELECT 1) SELECT count() FROM $__sourceTable');
    });

    it('rejects SELECT DISTINCT', () => {
      expectError('SELECT DISTINCT ServiceName FROM $__sourceTable');
    });

    it('rejects GROUP BY on a number chart', () => {
      expectError(
        'SELECT count(), ServiceName FROM $__sourceTable GROUP BY ServiceName',
        DisplayType.Number,
      );
    });

    it('rejects a time bucket on a table chart', () => {
      expectError(
        'SELECT count(), $__timeInterval(timestamp) AS `__hdx_time_bucket` FROM $__sourceTable GROUP BY $__timeInterval(timestamp) AS `__hdx_time_bucket`',
        DisplayType.Table,
      );
    });

    it('rejects multiple series on a pie chart', () => {
      expectError(
        'SELECT count(), sum(toFloat64OrDefault(toString(Duration))), ServiceName FROM $__sourceTable GROUP BY ServiceName',
        DisplayType.Pie,
      );
    });
  });
});
