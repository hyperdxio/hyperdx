import {
  chSql,
  ColumnMeta,
  parameterizedQueryToSql,
} from '@/_legacy_chTypes';
import { Metadata } from '@/core/metadata';
import {
  ChartConfigWithOptDateRange,
  DisplayType,
  QuerySettings,
} from '@/types';

import {
  ChartConfigWithOptDateRangeEx,
  renderChartConfig,
  timeFilterExpr,
} from '../core/renderChartConfig';

describe('renderChartConfig', () => {
  let mockMetadata: jest.Mocked<Metadata>;

  // Suppress expected console.warn noise from missing columns / optimization fallbacks
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
      { name: 'value', type: 'Float64' },
      { name: 'TraceId', type: 'String' },
      { name: 'ServiceName', type: 'String' },
    ];
    mockMetadata = {
      // getColumns must return the full column list so the
      // TrinoSchemaSerializer can validate identifiers used in Lucene
      // filters (severity, ServiceName, etc.). Tests append to this list
      // when they need additional fields.
      getColumns: jest.fn().mockResolvedValue([
        { name: 'timestamp', type: 'DateTime' },
        { name: 'value', type: 'Float64' },
        { name: 'TraceId', type: 'String' },
        { name: 'ServiceName', type: 'String' },
        { name: 'severity', type: 'String' },
        { name: 'Duration', type: 'Float64' },
        { name: 'Body', type: 'String' },
      ]),
      getMaterializedColumnsLookupTable: jest.fn().mockResolvedValue(null),
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
    } as unknown as jest.Mocked<Metadata>;
  });

  // SETTINGS-style query options. Trino/Athena ignore these — we still emit
  // them so downstream alert evaluators that re-parse the SQL keep their
  // assertions stable.
  const querySettings: QuerySettings = [
    { setting: 'optimize_read_in_order', value: '0' },
    { setting: 'cast_keep_nullable', value: '1' },
    { setting: 'additional_result_filter', value: 'x != 2' },
    { setting: 'count_distinct_implementation', value: 'uniqCombined64' },
    { setting: 'async_insert_busy_timeout_min_ms', value: '20000' },
  ];

  describe('containing CTE clauses', () => {
    it('should render a ChSql CTE configuration correctly', async () => {
      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        from: {
          databaseName: '',
          tableName: 'TestCte',
        },
        with: [
          { name: 'TestCte', sql: chSql`SELECT TimeUnix, Line FROM otel_logs` },
        ],
        select: [{ valueExpression: 'Line' }],
        where: '',
        whereLanguage: 'sql',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toMatchSnapshot();
    });

    it('should render a chart config CTE configuration correctly', async () => {
      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        with: [
          {
            name: 'Parts',
            chartConfig: {
              connection: 'test-connection',
              timestampValueExpression: '',
              select: '_part, _part_offset',
              from: { databaseName: 'default', tableName: 'some_table' },
              where: '',
              whereLanguage: 'sql',
              filters: [
                {
                  type: 'sql',
                  condition: `FieldA = 'test'`,
                },
              ],
              orderBy: [{ ordering: 'DESC', valueExpression: 'rand()' }],
              limit: { limit: 1000 },
            },
          },
        ],
        select: '*',
        filters: [
          {
            type: 'sql',
            condition: `FieldA = 'test'`,
          },
          {
            type: 'sql',
            condition: `(_part, _part_offset) IN (SELECT (_part, _part_offset) FROM Parts)`,
          },
        ],
        from: {
          databaseName: '',
          tableName: 'Parts',
        },
        where: '',
        whereLanguage: 'sql',
        orderBy: [{ ordering: 'DESC', valueExpression: 'rand()' }],
        limit: { limit: 1000 },
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toMatchSnapshot();
    });

    it('should throw if the CTE is missing both sql and chartConfig', async () => {
      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        with: [
          {
            name: 'InvalidCTE',
            // Intentionally omitting both sql and chartConfig properties
          },
        ],
        select: [{ valueExpression: 'Line' }],
        from: {
          databaseName: 'default',
          tableName: 'some_table',
        },
        where: '',
        whereLanguage: 'sql',
      };

      await expect(
        renderChartConfig(config, mockMetadata, querySettings),
      ).rejects.toThrow(
        "must specify either 'sql' or 'chartConfig' in with clause",
      );
    });

    it('should throw if the CTE sql param is invalid', async () => {
      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        with: [
          {
            name: 'InvalidCTE',
            sql: 'SELECT * FROM some_table' as any, // Intentionally not a ChSql object
          },
        ],
        select: [{ valueExpression: 'Line' }],
        from: {
          databaseName: 'default',
          tableName: 'some_table',
        },
        where: '',
        whereLanguage: 'sql',
      };

      await expect(
        renderChartConfig(config, mockMetadata, querySettings),
      ).rejects.toThrow('non-conforming sql object in CTE');
    });

    it('should throw if the CTE chartConfig param is invalid', async () => {
      const config: ChartConfigWithOptDateRange = {
        connection: 'test-connection',
        with: [
          {
            name: 'InvalidCTE',
            chartConfig: {
              // Missing required properties like select, from, etc.
              connection: 'test-connection',
            } as any, // Intentionally invalid chartConfig
          },
        ],
        select: [{ valueExpression: 'Line' }],
        from: {
          databaseName: 'default',
          tableName: 'some_table',
        },
        where: '',
        whereLanguage: 'sql',
      };

      await expect(
        renderChartConfig(config, mockMetadata, querySettings),
      ).rejects.toThrow('non-conforming chartConfig object in CTE');
    });
  });

  describe('HAVING clause', () => {
    it('should render HAVING clause with SQL language', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'count',
            valueExpression: '*',
            aggCondition: '',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
        having: 'count(*) > 100',
        havingLanguage: 'sql',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('HAVING');
      expect(actual).toContain('count(*) > 100');
      expect(actual).toMatchSnapshot();
    });

    it('should render HAVING clause with multiple conditions', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'metrics',
        },
        select: [
          {
            aggFn: 'avg',
            valueExpression: 'response_time',
            aggCondition: '',
          },
          {
            aggFn: 'count',
            valueExpression: '*',
            aggCondition: '',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'endpoint',
        having: 'avg(response_time) > 500 AND count(*) > 10',
        havingLanguage: 'sql',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('HAVING');
      expect(actual).toContain('avg(response_time) > 500 AND count(*) > 10');
      expect(actual).toMatchSnapshot();
    });

    it('should not render HAVING clause when not provided', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'count',
            valueExpression: '*',
            aggCondition: '',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).not.toContain('HAVING');
      expect(actual).toMatchSnapshot();
    });

    it('should render HAVING clause with granularity and groupBy', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Line,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'events',
        },
        select: [
          {
            aggFn: 'count',
            valueExpression: '*',
            aggCondition: '',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'event_type',
        having: 'count(*) > 50',
        havingLanguage: 'sql',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
        granularity: '5 minute',
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain('HAVING');
      expect(actual).toContain('count(*) > 50');
      expect(actual).toContain('GROUP BY');
      expect(actual).toMatchSnapshot();
    });

    it('should not render HAVING clause when having is empty string', async () => {
      const config: ChartConfigWithOptDateRange = {
        displayType: DisplayType.Table,
        connection: 'test-connection',
        from: {
          databaseName: 'default',
          tableName: 'logs',
        },
        select: [
          {
            aggFn: 'count',
            valueExpression: '*',
            aggCondition: '',
          },
        ],
        where: '',
        whereLanguage: 'sql',
        groupBy: 'severity',
        having: '',
        havingLanguage: 'sql',
        timestampValueExpression: 'timestamp',
        dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
      };

      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );
      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).not.toContain('HAVING');
      expect(actual).toMatchSnapshot();
    });
  });

  describe('timeFilterExpr', () => {
    type TimeFilterExprTestCase = {
      timestampValueExpression: string;
      dateRangeStartInclusive?: boolean;
      dateRangeEndInclusive?: boolean;
      dateRange: [Date, Date];
      includedDataInterval?: string;
      expected: string;
      description: string;
      tableName?: string;
      databaseName?: string;
      primaryKey?: string;
    };

    // Helper: build the Trino time-window expressions used as expected values.
    const fromMs = (d: Date) =>
      `from_unixtime(CAST(${d.getTime()} AS DOUBLE) / 1000.0)`;

    const testCases: TimeFilterExprTestCase[] = [
      {
        description: 'with basic timestampValueExpression',
        timestampValueExpression: 'timestamp',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(timestamp >= ${fromMs(new Date('2025-02-12 00:12:34Z'))} AND timestamp <= ${fromMs(new Date('2025-02-14 00:12:34Z'))})`,
      },
      {
        description: 'with dateRangeEndInclusive=false',
        timestampValueExpression: 'timestamp',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        dateRangeEndInclusive: false,
        expected: `(timestamp >= ${fromMs(new Date('2025-02-12 00:12:34Z'))} AND timestamp < ${fromMs(new Date('2025-02-14 00:12:34Z'))})`,
      },
      {
        description: 'with dateRangeStartInclusive=false',
        timestampValueExpression: 'timestamp',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        dateRangeStartInclusive: false,
        expected: `(timestamp > ${fromMs(new Date('2025-02-12 00:12:34Z'))} AND timestamp <= ${fromMs(new Date('2025-02-14 00:12:34Z'))})`,
      },
      {
        description: 'with date type timestampValueExpression',
        timestampValueExpression: 'date',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(date >= CAST(${fromMs(new Date('2025-02-12 00:12:34Z'))} AS DATE) AND date <= CAST(${fromMs(new Date('2025-02-14 00:12:34Z'))} AS DATE))`,
      },
      {
        description: 'with multiple timestampValueExpression parts',
        timestampValueExpression: 'timestamp, date',
        dateRange: [
          new Date('2025-02-12 00:12:34Z'),
          new Date('2025-02-14 00:12:34Z'),
        ],
        expected: `(timestamp >= ${fromMs(new Date('2025-02-12 00:12:34Z'))} AND timestamp <= ${fromMs(new Date('2025-02-14 00:12:34Z'))})AND(date >= CAST(${fromMs(new Date('2025-02-12 00:12:34Z'))} AS DATE) AND date <= CAST(${fromMs(new Date('2025-02-14 00:12:34Z'))} AS DATE))`,
      },
      {
        description: 'stays inclusive with date-type column',
        timestampValueExpression: 'date',
        dateRange: [
          new Date('2025-02-12 03:53:38Z'),
          new Date('2025-02-12 04:08:38Z'),
        ],
        dateRangeStartInclusive: false,
        dateRangeEndInclusive: false,
        expected: `(date >= CAST(${fromMs(new Date('2025-02-12 03:53:38Z'))} AS DATE) AND date <= CAST(${fromMs(new Date('2025-02-12 04:08:38Z'))} AS DATE))`,
      },
    ];

    beforeEach(() => {
      mockMetadata.getColumn.mockImplementation(async ({ column }) =>
        column === 'date'
          ? ({ type: 'Date' } as ColumnMeta)
          : ({ type: 'DateTime' } as ColumnMeta),
      );
    });

    it.each(testCases)(
      'should generate a time filter expression $description',
      async ({
        timestampValueExpression,
        dateRangeEndInclusive = true,
        dateRangeStartInclusive = true,
        dateRange,
        expected,
        includedDataInterval,
        tableName = 'target_table',
        databaseName = 'default',
        primaryKey,
      }) => {
        if (primaryKey) {
          mockMetadata.getTableMetadata.mockResolvedValue({
            primary_key: primaryKey,
          } as any);
        }

        const actual = await timeFilterExpr({
          timestampValueExpression,
          dateRangeEndInclusive,
          dateRangeStartInclusive,
          dateRange,
          connectionId: 'test-connection',
          databaseName,
          tableName,
          metadata: mockMetadata,
          includedDataInterval,
        });

        const actualSql = parameterizedQueryToSql(actual);
        expect(actualSql).toBe(expected);
      },
    );
  });

  it('should not generate invalid SQL when primary key wraps toStartOfInterval', async () => {
    // Even with a CH-style primary-key expression carried over from imported
    // configs, the Trino emitter should produce plain `timestamp BETWEEN ...`.
    mockMetadata.getTableMetadata.mockResolvedValue({
      primary_key:
        'proxy_tier, status, is_customer_content, -toInt64(toStartOfInterval(timestamp, toIntervalMinute(15))), service_id',
    } as any);

    const config: ChartConfigWithOptDateRange = {
      displayType: DisplayType.Table,
      connection: 'test-connection',
      from: {
        databaseName: 'default',
        tableName: 'http_request_logs',
      },
      select: 'timestamp, cluster_id, service_id',
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: 'timestamp',
      dateRange: [
        new Date('2025-02-12 00:12:34Z'),
        new Date('2025-02-14 00:12:34Z'),
      ],
      limit: { limit: 200, offset: 0 },
    };

    const generatedSql = await renderChartConfig(
      config,
      mockMetadata,
      querySettings,
    );
    const actual = parameterizedQueryToSql(generatedSql);
    expect(actual).not.toContain('toStartOfInterval');
    expect(actual).not.toContain('fromUnixTimestamp64Milli');
    expect(actual).toMatchSnapshot();
  });

  describe('SETTINGS clause', () => {
    const config: ChartConfigWithOptDateRangeEx = {
      displayType: DisplayType.Table,
      connection: 'test-connection',
      from: {
        databaseName: 'default',
        tableName: 'logs',
      },
      select: [
        {
          aggFn: 'count',
          valueExpression: '*',
          aggCondition: '',
        },
      ],
      where: '',
      whereLanguage: 'sql',
      groupBy: 'severity',
      timestampValueExpression: 'timestamp',
      dateRange: [new Date('2025-02-12'), new Date('2025-02-14')],
    };

    test('should apply the "query settings" settings to the query', async () => {
      const generatedSql = await renderChartConfig(
        config,
        mockMetadata,
        querySettings,
      );

      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        "SETTINGS optimize_read_in_order = 0, cast_keep_nullable = 1, additional_result_filter = 'x != 2', count_distinct_implementation = 'uniqCombined64', async_insert_busy_timeout_min_ms = 20000",
      );
      expect(actual).toMatchSnapshot();
    });

    test('should apply the "chart config" settings to the query', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...config,
          settings: chSql`short_circuit_function_evaluation = 'force_enable'`,
        },
        mockMetadata,
        querySettings,
      );

      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        "SETTINGS short_circuit_function_evaluation = 'force_enable'",
      );
      expect(actual).toMatchSnapshot();
    });

    test('should concat the "chart config" and "query setting" settings and apply them to the query', async () => {
      const generatedSql = await renderChartConfig(
        {
          ...config,
          settings: chSql`short_circuit_function_evaluation = 'force_enable'`,
        },
        mockMetadata,
        querySettings,
      );

      const actual = parameterizedQueryToSql(generatedSql);
      expect(actual).toContain(
        "SETTINGS short_circuit_function_evaluation = 'force_enable', optimize_read_in_order = 0, cast_keep_nullable = 1, additional_result_filter = 'x != 2', count_distinct_implementation = 'uniqCombined64', async_insert_busy_timeout_min_ms = 20000",
      );
      expect(actual).toMatchSnapshot();
    });
  });

  it('returns sqlTemplate verbatim for raw sql config', async () => {
    const rawSqlConfig: ChartConfigWithOptDateRangeEx = {
      configType: 'sql',
      sqlTemplate: 'SELECT count() FROM logs WHERE level = {level:String}',
      connection: 'conn-1',
    };
    const result = await renderChartConfig(
      rawSqlConfig,
      mockMetadata,
      undefined,
    );
    expect(result.sql).toBe(
      'SELECT count() FROM logs WHERE level = {level:String}',
    );
    expect(result.params).toEqual({
      startDateMilliseconds: undefined,
      endDateMilliseconds: undefined,
    });
  });

  it('injects startDateMilliseconds and endDateMilliseconds params for raw sql config with dateRange', async () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const end = new Date('2024-01-02T00:00:00.000Z');
    const rawSqlConfig: ChartConfigWithOptDateRangeEx = {
      configType: 'sql',
      sqlTemplate:
        'SELECT count() FROM logs WHERE ts BETWEEN {startDateMilliseconds:Int64} AND {endDateMilliseconds:Int64}',
      connection: 'conn-1',
      dateRange: [start, end],
    };
    const result = await renderChartConfig(
      rawSqlConfig,
      mockMetadata,
      undefined,
    );
    expect(result.sql).toBe(
      'SELECT count() FROM logs WHERE ts BETWEEN {startDateMilliseconds:Int64} AND {endDateMilliseconds:Int64}',
    );
    expect(result.params).toEqual({
      startDateMilliseconds: start.getTime(),
      endDateMilliseconds: end.getTime(),
    });
  });

  // Raw-SQL macro replacement tests.
  //
  // The `replaceMacros` helper used by `renderRawSqlChartConfig` carries over
  // ClickHouse-style time conversions (`toDateTime`, `fromUnixTimestamp64Milli`,
  // etc.) verbatim. Those are emitted only into Raw SQL configs that
  // explicitly use macros — Athena rejects them at execution time, but they
  // remain as useful authoring sugar for the Raw SQL editor (Phase 1.3 will
  // either port them to Trino-flavored output or drop them).
  describe('raw sql macro replacement', () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const end = new Date('2024-01-02T00:00:00.000Z');

    it('replaces $__filters with 1 = 1 when no filters provided', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE (1=1 /** no filters applied */)',
      );
    });

    it('replaces $__filters with 1 = 1 when source and from are defined but filters is empty', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
          source: 'source-1',
          from: { databaseName: 'default', tableName: 'logs' },
          filters: [],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE (1=1 /** no filters applied */)',
      );
    });

    it('renders sql filters raw when source has no tableName (metric source)', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
          source: 'source-1',
          from: { databaseName: 'default', tableName: '' },
          filters: [
            { type: 'sql', condition: 'duration > 100' },
            { type: 'sql_ast', operator: '=', left: 'status', right: "'ok'" },
          ],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        "SELECT * FROM logs WHERE ((duration > 100) AND (status = 'ok'))",
      );
    });

    it('skips empty sql filters when source has no tableName (metric source)', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
          source: 'source-1',
          from: { databaseName: 'default', tableName: '' },
          filters: [{ type: 'sql', condition: '' }],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE (1=1 /** no filters applied */)',
      );
    });

    it('skips filters without source metadata (no from)', async () => {
      const result = await renderChartConfig(
        {
          configType: 'sql',
          sqlTemplate: 'SELECT * FROM logs WHERE $__filters',
          connection: 'conn-1',
          dateRange: [start, end],
          filters: [
            { type: 'lucene', condition: 'ServiceName:api' },
            { type: 'sql', condition: 'duration > 100' },
          ],
        },
        mockMetadata,
        undefined,
      );
      expect(result.sql).toBe(
        'SELECT * FROM logs WHERE (1=1 /** no filters applied */)',
      );
    });
  });
});
