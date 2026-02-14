import { z } from 'zod';

import {
  ChartConfigWithDateRange,
  DashboardSchema,
  MetricsDataType,
  SourceKind,
  TSourceUnion,
} from '@/types';

import {
  convertToDashboardTemplate,
  extractSettingsClauseFromEnd,
  findJsonExpressions,
  formatDate,
  getAlignedDateRange,
  getFirstOrderingItem,
  isFirstOrderByAscending,
  isJsonExpression,
  isTimestampExpressionInFirstOrderBy,
  joinQuerySettings,
  optimizeTimestampValueExpression,
  parseTokenizerFromTextIndex,
  parseToNumber,
  parseToStartOfFunction,
  replaceJsonExpressions,
  splitAndTrimCSV,
  splitAndTrimWithBracket,
  TextIndexTokenizer,
} from '../core/utils';

describe('utils', () => {
  describe('formatDate', () => {
    it('12h utc', () => {
      const date = new Date('2021-01-01T12:00:00Z');
      expect(
        formatDate(date, {
          clock: '12h',
          isUTC: true,
        }),
      ).toEqual('Jan 1 12:00:00 PM');
    });

    it('24h utc', () => {
      const date = new Date('2021-01-01T12:00:00Z');
      expect(
        formatDate(date, {
          clock: '24h',
          isUTC: true,
          format: 'withMs',
        }),
      ).toEqual('Jan 1 12:00:00.000');
    });

    it('12h local', () => {
      const date = new Date('2021-01-01T12:00:00');
      expect(
        formatDate(date, {
          clock: '12h',
          isUTC: false,
        }),
      ).toEqual('Jan 1 12:00:00 PM');
    });

    it('24h local', () => {
      const date = new Date('2021-01-01T12:00:00');
      expect(
        formatDate(date, {
          clock: '24h',
          isUTC: false,
          format: 'withMs',
        }),
      ).toEqual('Jan 1 12:00:00.000');
    });
  });

  describe('splitAndTrimCSV', () => {
    it('should split a comma-separated string and trim whitespace', () => {
      expect(splitAndTrimCSV('a, b, c')).toEqual(['a', 'b', 'c']);
    });

    it('should handle strings with no spaces', () => {
      expect(splitAndTrimCSV('a,b,c')).toEqual(['a', 'b', 'c']);
    });

    it('should filter out empty values', () => {
      expect(splitAndTrimCSV('a,b,,c,')).toEqual(['a', 'b', 'c']);
    });

    it('should handle strings with extra whitespace', () => {
      expect(splitAndTrimCSV('  a  ,  b  ,  c  ')).toEqual(['a', 'b', 'c']);
    });

    it('should return an empty array for an empty string', () => {
      expect(splitAndTrimCSV('')).toEqual([]);
    });

    it('should handle a string with only commas and whitespace', () => {
      expect(splitAndTrimCSV(',,  ,,')).toEqual([]);
    });
  });

  describe('splitAndTrimWithBracket', () => {
    it('should split a simple comma-separated string', () => {
      const input = 'column1, column2, column3';
      const expected = ['column1', 'column2', 'column3'];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle function calls with commas in parameters', () => {
      const input =
        "Timestamp, ServiceName, JSONExtractString(Body, 'c'), JSONExtractString(Body, 'msg')";
      const expected = [
        'Timestamp',
        'ServiceName',
        "JSONExtractString(Body, 'c')",
        "JSONExtractString(Body, 'msg')",
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle nested function calls', () => {
      const input = 'col1, func1(a, b), col2, func2(c, func3(d, e)), col3';
      const expected = [
        'col1',
        'func1(a, b)',
        'col2',
        'func2(c, func3(d, e))',
        'col3',
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle square brackets in column expressions', () => {
      const input = "col1, array[1, 2, 3], jsonb_path_query(data, '$[*]')";
      const expected = [
        'col1',
        'array[1, 2, 3]',
        "jsonb_path_query(data, '$[*]')",
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle mixed parentheses and square brackets', () => {
      const input = "col1, func(array[1, 2], obj['key']), col2['nested'][0]";
      const expected = [
        'col1',
        "func(array[1, 2], obj['key'])",
        "col2['nested'][0]",
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should trim whitespace from resulting columns', () => {
      const input = '  col1  ,   func(a, b)  ,  col2  ';
      const expected = ['col1', 'func(a, b)', 'col2'];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle empty input', () => {
      expect(splitAndTrimWithBracket('')).toEqual([]);
    });

    it('should handle input with only spaces', () => {
      expect(splitAndTrimWithBracket('   ')).toEqual([]);
    });

    it('should skip empty elements', () => {
      const input = 'col1,,col2, ,col3';
      const expected = ['col1', 'col2', 'col3'];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle quoted strings with commas', () => {
      const input = "col1, concat('Hello, World!'), col2";
      const expected = ['col1', "concat('Hello, World!')", 'col2'];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle double quoted strings with commas', () => {
      const input = 'col1, "quoted, string", col3';
      const expected = ['col1', '"quoted, string"', 'col3'];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle single quoted strings with commas', () => {
      const input = `col1, 'quoted, string', col3`;
      const expected = ['col1', `'quoted, string'`, 'col3'];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle mixed quotes with commas', () => {
      const input = `col1, "double, quoted", col2, 'single, quoted', col3`;
      const expected = [
        'col1',
        `"double, quoted"`,
        'col2',
        `'single, quoted'`,
        'col3',
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle quotes inside function calls', () => {
      const input = 'col1, func("text with , comma", \'another, text\'), col2';
      const expected = [
        'col1',
        'func("text with , comma", \'another, text\')',
        'col2',
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle brackets inside quoted strings', () => {
      const input =
        'col1, "string with (brackets, inside)", col2, \'string with [brackets, inside]\', col3';
      const expected = [
        'col1',
        '"string with (brackets, inside)"',
        'col2',
        "'string with [brackets, inside]'",
        'col3',
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle real-world SQL column list example', () => {
      const input =
        "Timestamp, ServiceName, JSONExtractString(Body, 'c'), JSONExtractString(Body, 'msg'), Timestamp, \"foo, bar\"";
      const expected = [
        'Timestamp',
        'ServiceName',
        "JSONExtractString(Body, 'c')",
        "JSONExtractString(Body, 'msg')",
        'Timestamp',
        '"foo, bar"',
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });

    it('should handle order-by clauses with order directions', () => {
      const input = 'toDate(Timestamp) ASC, Time ASC, ServiceName DESC';
      const expected = [
        'toDate(Timestamp) ASC',
        'Time ASC',
        'ServiceName DESC',
      ];
      expect(splitAndTrimWithBracket(input)).toEqual(expected);
    });
  });

  describe('getFirstOrderingItem', () => {
    it('should return undefined for undefined input', () => {
      expect(getFirstOrderingItem(undefined)).toBeUndefined();
    });

    it('should return the first column name for a single column string input', () => {
      expect(getFirstOrderingItem('column1 DESC')).toBe('column1 DESC');
    });

    it('should return the first column name for a simple string input', () => {
      expect(getFirstOrderingItem('column1, column2 DESC, column3 ASC')).toBe(
        'column1',
      );
    });

    it('should return the first column name for a simple string input', () => {
      expect(
        getFirstOrderingItem('column1 ASC, column2 DESC, column3 ASC'),
      ).toBe('column1 ASC');
    });

    it('should return the first column name for an array of objects input', () => {
      const orderBy: Exclude<ChartConfigWithDateRange['orderBy'], string> = [
        { valueExpression: 'column1', ordering: 'ASC' },
        { valueExpression: 'column2', ordering: 'ASC' },
      ];
      expect(getFirstOrderingItem(orderBy)).toEqual({
        valueExpression: 'column1',
        ordering: 'ASC',
      });
    });
  });

  describe('isFirstOrderingOnTimestampExpression', () => {
    it('should return false if no orderBy is provided', () => {
      const config = {
        timestampValueExpression: 'Timestamp',
        orderBy: undefined,
      } as ChartConfigWithDateRange;

      expect(isTimestampExpressionInFirstOrderBy(config)).toBe(false);
    });

    it('should return false if empty orderBy is provided', () => {
      const config = {
        timestampValueExpression: 'Timestamp',
        orderBy: '',
      } as ChartConfigWithDateRange;

      expect(isTimestampExpressionInFirstOrderBy(config)).toBe(false);
    });

    it('should return false if the first ordering column is not in the timestampValueExpression', () => {
      const config = {
        timestampValueExpression: 'Timestamp',
        orderBy: 'ServiceName',
      } as ChartConfigWithDateRange;

      expect(isTimestampExpressionInFirstOrderBy(config)).toBe(false);
    });

    it('should return false if the second ordering column is in the timestampValueExpression but the first is not', () => {
      const config = {
        timestampValueExpression: 'Timestamp',
        orderBy: 'ServiceName ASC, Timestamp',
      } as ChartConfigWithDateRange;

      expect(isTimestampExpressionInFirstOrderBy(config)).toBe(false);
    });

    it('should return true if the first ordering column is the timestampValueExpression', () => {
      const config = {
        timestampValueExpression: 'Timestamp',
        orderBy: 'Timestamp',
      } as ChartConfigWithDateRange;

      expect(isTimestampExpressionInFirstOrderBy(config)).toBe(true);
    });

    it('should return true if the first ordering column is a string and has a direction', () => {
      const config = {
        timestampValueExpression: 'Timestamp',
        orderBy: 'Timestamp DESC, ServiceName',
      } as ChartConfigWithDateRange;

      expect(isTimestampExpressionInFirstOrderBy(config)).toBe(true);
    });

    it('should return true if the first ordering column is a string and has a lowercase direction', () => {
      const config = {
        timestampValueExpression: 'Timestamp',
        orderBy: 'Timestamp desc, ServiceName',
      } as ChartConfigWithDateRange;

      expect(isTimestampExpressionInFirstOrderBy(config)).toBe(true);
    });

    it('should return true if the first ordering column is an object and is in the timestampValueExpression', () => {
      const config = {
        timestampValueExpression: 'Timestamp',
        orderBy: [
          { valueExpression: 'Timestamp', ordering: 'ASC' },
          { valueExpression: 'ServiceName', ordering: 'ASC' },
        ],
      } as ChartConfigWithDateRange;

      expect(isTimestampExpressionInFirstOrderBy(config)).toBe(true);
    });

    it('should support toStartOf() timestampValueExpressions', () => {
      const config = {
        timestampValueExpression: 'toStartOfDay(Timestamp), Timestamp',
        orderBy: '(toStartOfDay(Timestamp)) DESC, Timestamp',
      } as ChartConfigWithDateRange;

      expect(isTimestampExpressionInFirstOrderBy(config)).toBe(true);
    });

    it('should support toStartOf() timestampValueExpressions in tuples', () => {
      const config = {
        timestampValueExpression: 'toStartOfDay(Timestamp), Timestamp',
        orderBy: '(toStartOfHour(TimestampTime), TimestampTime) DESC',
      } as ChartConfigWithDateRange;

      expect(isTimestampExpressionInFirstOrderBy(config)).toBe(true);
    });

    it('should support functions with multiple parameters in the order by', () => {
      const config = {
        timestampValueExpression:
          'toStartOfInterval(TimestampTime, INTERVAL 1 DAY)',
        orderBy: 'toStartOfInterval(TimestampTime, INTERVAL 1 DAY) DESC',
      } as ChartConfigWithDateRange;

      expect(isTimestampExpressionInFirstOrderBy(config)).toBe(true);
    });
  });

  describe('isFirstOrderingAscending', () => {
    it('should return true for ascending order in string input', () => {
      expect(isFirstOrderByAscending('column1 ASC, column2 DESC')).toBe(true);
    });

    it('should return true for lowercase, non-trimmed ascending order in string input', () => {
      expect(isFirstOrderByAscending(' column1 asc , column2 DESC')).toBe(true);
    });

    it('should return true for ascending order without explicit direction in string input', () => {
      expect(isFirstOrderByAscending('column1, column2 DESC')).toBe(true);
    });

    it('should return false for descending order in string input', () => {
      expect(isFirstOrderByAscending('column1 DESC, column2 ASC')).toBe(false);
    });

    it('should return false for lowercase, non-trimmed descending order in string input', () => {
      expect(isFirstOrderByAscending(' column1 desc , column2 ASC')).toBe(
        false,
      );
    });

    it('should return true for ascending order in object input', () => {
      const orderBy: Exclude<ChartConfigWithDateRange['orderBy'], string> = [
        { valueExpression: 'column1', ordering: 'ASC' },
        { valueExpression: 'column2', ordering: 'DESC' },
      ];
      expect(isFirstOrderByAscending(orderBy)).toBe(true);
    });

    it('should return false for descending order in object input', () => {
      const orderBy: Exclude<ChartConfigWithDateRange['orderBy'], string> = [
        { valueExpression: 'column1', ordering: 'DESC' },
        { valueExpression: 'column2', ordering: 'ASC' },
      ];
      expect(isFirstOrderByAscending(orderBy)).toBe(false);
    });

    it('should return false if no orderBy is provided', () => {
      expect(isFirstOrderByAscending(undefined)).toBe(false);
    });

    it('should support toStartOf() timestampValueExpressions in tuples', () => {
      const orderBy = '(toStartOfHour(TimestampTime), TimestampTime) DESC';
      expect(isFirstOrderByAscending(orderBy)).toBe(false);
    });

    it('should support toStartOf() timestampValueExpressions in tuples', () => {
      const orderBy = '(toStartOfHour(TimestampTime), TimestampTime) ASC';
      expect(isFirstOrderByAscending(orderBy)).toBe(true);
    });
  });

  describe('convertToDashboardTemplate', () => {
    it('should convert a dashboard to a dashboard template', () => {
      const dashboard: z.infer<typeof DashboardSchema> = {
        id: 'dashboard1',
        name: 'My Dashboard',
        tags: ['tag1', 'tag2'],
        tiles: [
          {
            id: 'tile1',
            config: {
              name: 'Log Tile',
              source: 'source1',
              select: '',
              where: '',
            },
            x: 0,
            y: 0,
            w: 6,
            h: 6,
          },
          {
            id: 'tile2',
            config: {
              name: 'Metric Tile',
              source: 'source2',
              select: '',
              where: '',
            },
            x: 6,
            y: 6,
            w: 6,
            h: 6,
          },
        ],
        filters: [
          {
            id: 'filter1',
            type: 'QUERY_EXPRESSION',
            name: 'SeverityFilter',
            expression: 'Severity',
            source: 'source1',
          },
          {
            id: 'filter2',
            type: 'QUERY_EXPRESSION',
            name: 'ServiceNameFilter',
            expression: 'ServiceName',
            source: 'source2',
            sourceMetricType: MetricsDataType.Gauge,
          },
        ],
      };

      const sources: TSourceUnion[] = [
        {
          id: 'source1',
          name: 'Logs',
          connection: 'connection1',
          kind: SourceKind.Log,
          from: {
            databaseName: 'db1',
            tableName: 'logs_table',
          },
          timestampValueExpression: 'Timestamp',
          defaultTableSelectExpression: '',
        },
        {
          id: 'source2',
          name: 'Metrics',
          connection: 'connection1',
          kind: SourceKind.Metric,
          from: {
            databaseName: 'db1',
            tableName: '',
          },
          metricTables: {
            gauge: 'gauge_table',
            sum: 'sum_table',
            histogram: 'histogram_table',
            'exponential histogram': '',
            summary: '',
          },
          timestampValueExpression: 'Timestamp',
          resourceAttributesExpression: 'ResourceAttributes',
        },
      ];

      const template = convertToDashboardTemplate(dashboard, sources);
      expect(template).toEqual({
        name: 'My Dashboard',
        version: '0.1.0',
        tiles: [
          {
            id: 'tile1',
            config: {
              name: 'Log Tile',
              source: 'Logs',
              select: '',
              where: '',
            },
            x: 0,
            y: 0,
            w: 6,
            h: 6,
          },
          {
            id: 'tile2',
            config: {
              name: 'Metric Tile',
              source: 'Metrics',
              select: '',
              where: '',
            },
            x: 6,
            y: 6,
            w: 6,
            h: 6,
          },
        ],
        filters: [
          {
            id: 'filter1',
            type: 'QUERY_EXPRESSION',
            name: 'SeverityFilter',
            expression: 'Severity',
            source: 'Logs',
          },
          {
            id: 'filter2',
            type: 'QUERY_EXPRESSION',
            name: 'ServiceNameFilter',
            expression: 'ServiceName',
            source: 'Metrics',
            sourceMetricType: MetricsDataType.Gauge,
          },
        ],
      });
    });

    it('should convert a dashboard without filters to a dashboard template', () => {
      const dashboard: z.infer<typeof DashboardSchema> = {
        id: 'dashboard1',
        name: 'My Dashboard',
        tags: ['tag1', 'tag2'],
        tiles: [
          {
            id: 'tile1',
            config: {
              name: 'Log Tile',
              source: 'source1',
              select: '',
              where: '',
            },
            x: 0,
            y: 0,
            w: 6,
            h: 6,
          },
          {
            id: 'tile2',
            config: {
              name: 'Metric Tile',
              source: 'source2',
              select: '',
              where: '',
            },
            x: 6,
            y: 6,
            w: 6,
            h: 6,
          },
        ],
      };

      const sources: TSourceUnion[] = [
        {
          id: 'source1',
          name: 'Logs',
          connection: 'connection1',
          kind: SourceKind.Log,
          from: {
            databaseName: 'db1',
            tableName: 'logs_table',
          },
          timestampValueExpression: 'Timestamp',
          defaultTableSelectExpression: '',
        },
        {
          id: 'source2',
          name: 'Metrics',
          connection: 'connection1',
          kind: SourceKind.Metric,
          from: {
            databaseName: 'db1',
            tableName: '',
          },
          metricTables: {
            gauge: 'gauge_table',
            sum: 'sum_table',
            histogram: 'histogram_table',
            'exponential histogram': '',
            summary: '',
          },
          timestampValueExpression: 'Timestamp',
          resourceAttributesExpression: 'ResourceAttributes',
        },
      ];

      const template = convertToDashboardTemplate(dashboard, sources);
      expect(template).toEqual({
        name: 'My Dashboard',
        version: '0.1.0',
        tiles: [
          {
            id: 'tile1',
            config: {
              name: 'Log Tile',
              source: 'Logs',
              select: '',
              where: '',
            },
            x: 0,
            y: 0,
            w: 6,
            h: 6,
          },
          {
            id: 'tile2',
            config: {
              name: 'Metric Tile',
              source: 'Metrics',
              select: '',
              where: '',
            },
            x: 6,
            y: 6,
            w: 6,
            h: 6,
          },
        ],
      });
    });

    it('should preserve level property for quantile aggFn in select', () => {
      const dashboard: z.infer<typeof DashboardSchema> = {
        id: 'dashboard1',
        name: 'Quantile Dashboard',
        tags: [],
        tiles: [
          {
            id: 'tile1',
            config: {
              name: 'P95 Latency',
              source: 'source1',
              select: [
                {
                  aggFn: 'quantile',
                  level: 0.95,
                  aggCondition: '',
                  aggConditionLanguage: 'lucene',
                  valueExpression: 'Duration',
                },
              ],
              where: '',
            },
            x: 0,
            y: 0,
            w: 6,
            h: 6,
          },
        ],
      };

      const sources: TSourceUnion[] = [
        {
          id: 'source1',
          name: 'Logs',
          connection: 'connection1',
          kind: SourceKind.Log,
          from: {
            databaseName: 'db1',
            tableName: 'logs_table',
          },
          timestampValueExpression: 'Timestamp',
          defaultTableSelectExpression: '',
        },
      ];

      const template = convertToDashboardTemplate(dashboard, sources);
      const selectList = template.tiles[0].config.select;
      expect(Array.isArray(selectList)).toBe(true);
      expect((selectList as any[])[0]).toMatchObject({
        aggFn: 'quantile',
        level: 0.95,
      });
    });
  });

  describe('isJsonExpression', () => {
    it('should return false for expressions without dots', () => {
      expect(isJsonExpression('col')).toBe(false);
      expect(isJsonExpression('columnName')).toBe(false);
      expect(isJsonExpression('column_name')).toBe(false);
    });

    it('should return true for simple JSON expressions', () => {
      expect(isJsonExpression('col.key')).toBe(true);
      expect(isJsonExpression('column.property')).toBe(true);
    });

    it('should return true for nested JSON expressions', () => {
      expect(isJsonExpression('col.key.nestedKey')).toBe(true);
      expect(isJsonExpression('a.b.c')).toBe(true);
      expect(isJsonExpression('json_col.col3.c')).toBe(true);
    });

    it('should return true for JSON expressions with double quotes', () => {
      expect(isJsonExpression('"json_col"."key"')).toBe(true);
      expect(isJsonExpression('"a"."b"."cde"')).toBe(true);
      expect(isJsonExpression('"a_b.2c".b."c."')).toBe(true);
    });

    it('should return true for JSON expressions with backticks', () => {
      expect(isJsonExpression('`a`.`b`.`cde`')).toBe(true);
      expect(isJsonExpression('`col`.`key`')).toBe(true);
    });

    it('should return true for mixed quoting styles', () => {
      expect(isJsonExpression('"a".b.`c`')).toBe(true);
      expect(isJsonExpression('a."b".c')).toBe(true);
    });

    it('should return false for expressions with only one non-numeric part', () => {
      expect(isJsonExpression('col.')).toBe(false);
      expect(isJsonExpression('.col')).toBe(false);
    });

    it('should return false for decimal numbers', () => {
      expect(isJsonExpression('10.50')).toBe(false);
      expect(isJsonExpression('2.3')).toBe(false);
      expect(isJsonExpression('1.5')).toBe(false);
    });

    it('should return false for table.column references with numeric column', () => {
      expect(isJsonExpression('table.1')).toBe(false);
    });

    it('should return false for expressions with empty parts', () => {
      expect(isJsonExpression('.')).toBe(false);
      expect(isJsonExpression('..')).toBe(false);
      expect(isJsonExpression('a..')).toBe(false);
    });

    it('should handle dots inside double quotes correctly', () => {
      expect(isJsonExpression('"a.b.c"')).toBe(false);
      expect(isJsonExpression('"a.b"."c.d"')).toBe(true);
    });

    it('should handle dots inside backticks correctly', () => {
      expect(isJsonExpression('`a.b.c`')).toBe(false);
      expect(isJsonExpression('`a.b`.`c.d`')).toBe(true);
    });

    it('should return true for mixed quoted and unquoted parts', () => {
      expect(isJsonExpression('"col.with.dots".key')).toBe(true);
      expect(isJsonExpression('col."key.with.dots"')).toBe(true);
    });

    it('should handle complex quoted identifiers', () => {
      expect(isJsonExpression('"table.name"."column.name"."nested"')).toBe(
        true,
      );
    });

    it('should handle expressions with underscores and numbers', () => {
      expect(isJsonExpression('col_1.key_2.nested_3')).toBe(true);
      expect(isJsonExpression('table123.column456')).toBe(true);
    });

    it('should return false for single quoted identifier', () => {
      expect(isJsonExpression('"singleColumn"')).toBe(false);
      expect(isJsonExpression('`singleColumn`')).toBe(false);
    });

    it('should handle type specifiers', () => {
      expect(isJsonExpression('a.b.:UInt64')).toBe(true);
      expect(isJsonExpression('col.key.:String')).toBe(true);
    });

    it('should handle whitespace in parts', () => {
      expect(isJsonExpression('a . b')).toBe(true);
      expect(isJsonExpression('a.b. c')).toBe(true);
    });

    it('should handle leading whitespace', () => {
      expect(isJsonExpression(' a.b.c')).toBe(true);
      expect(isJsonExpression('  col.key')).toBe(true);
      expect(isJsonExpression('\ta.b')).toBe(true);
    });

    it('should handle trailing whitespace', () => {
      expect(isJsonExpression('a.b.c ')).toBe(true);
      expect(isJsonExpression('col.key  ')).toBe(true);
      expect(isJsonExpression('a.b\t')).toBe(true);
    });

    it('should handle leading and trailing whitespace', () => {
      expect(isJsonExpression(' a.b.c ')).toBe(true);
      expect(isJsonExpression('  col.key  ')).toBe(true);
      expect(isJsonExpression('\ta.b\t')).toBe(true);
    });

    it('should correctly handle single quoted strings', () => {
      expect(isJsonExpression("'a'.b.c")).toBe(false);
      expect(isJsonExpression("'a'.'b'")).toBe(false);
      expect(isJsonExpression("'a' . 'b'")).toBe(false);
      expect(isJsonExpression("'")).toBe(false);
      expect(isJsonExpression("''")).toBe(false);
      expect(isJsonExpression("`'a'`.b")).toBe(true);
      expect(isJsonExpression("`'a`.b")).toBe(true);
    });
  });

  describe('findJsonExpressions', () => {
    it('should handle empty expression', () => {
      const sql = '';
      const actual = findJsonExpressions(sql);
      const expected = [];
      expect(actual).toEqual(expected);
    });

    it('should find a single JSON expression', () => {
      const sql = 'SELECT a.b.c as alias1, col2 as alias2 FROM table';
      const actual = findJsonExpressions(sql);
      const expected = [{ index: 7, expr: 'a.b.c' }];
      expect(actual).toEqual(expected);
    });

    it('should find multiple JSON expression', () => {
      const sql = 'SELECT a.b.c, d.e, col2 FROM table';
      const actual = findJsonExpressions(sql);
      const expected = [
        { index: 7, expr: 'a.b.c' },
        { index: 14, expr: 'd.e' },
      ];
      expect(actual).toEqual(expected);
    });

    it('should find JSON expression with type specifier', () => {
      const sql = 'SELECT a.b.:UInt64, col2 FROM table';
      const actual = findJsonExpressions(sql);
      const expected = [{ index: 7, expr: 'a.b.:UInt64' }];
      expect(actual).toEqual(expected);
    });

    it('should find JSON expression with complex type specifier', () => {
      const sql = 'SELECT a.b.:Array(String)  , col2 FROM table';
      const actual = findJsonExpressions(sql);
      const expected = [{ index: 7, expr: 'a.b.:Array(String)' }];
      expect(actual).toEqual(expected);
    });

    it('should find JSON expressions in WHERE clause ', () => {
      const sql =
        'SELECT col2 FROM table WHERE a.b.:UInt64 = 1 AND toStartOfDay(a.date) = today()';
      const actual = findJsonExpressions(sql);
      const expected = [
        { index: 29, expr: 'a.b.:UInt64' },
        { index: 62, expr: 'a.date' },
      ];
      expect(actual).toEqual(expected);
    });

    it('should find JSON expressions in function calls', () => {
      const sql = "SELECT JSONExtractString(a.b.c, 'key') FROM table";
      const actual = findJsonExpressions(sql);
      const expected = [{ index: 25, expr: 'a.b.c' }];
      expect(actual).toEqual(expected);
    });

    it('should not find JSON expressions in quoted strings', () => {
      const sql =
        "SELECT a.b.c, ResourceAttributes['key.key2'], 'a.b.c' FROM table";
      const actual = findJsonExpressions(sql);
      const expected = [
        {
          index: 7,
          expr: 'a.b.c',
        },
      ];
      expect(actual).toEqual(expected);
    });

    it('should find JSON expressions in math expression', () => {
      const sql =
        'SELECT toStartOfDay(a.date + INTERVAL 1 DAY), toStartOfDay(a.date+INTERVAL 1 DAY)';
      const actual = findJsonExpressions(sql);
      const expected = [
        { index: 20, expr: 'a.date' },
        { index: 59, expr: 'a.date' },
      ];
      expect(actual).toEqual(expected);
    });

    it('should not infinite loop due to unterminated strings', () => {
      const sql = 'SELECT "';
      const actual = findJsonExpressions(sql);
      const expected = [];
      expect(actual).toEqual(expected);
    });

    it('should not infinite loop due to trailing whitespace', () => {
      const sql = 'SELECT ';
      const actual = findJsonExpressions(sql);
      const expected = [];
      expect(actual).toEqual(expected);
    });

    it('should not infinite loop due to mismatched parenthesis', () => {
      const sql = 'SELECT (';
      const actual = findJsonExpressions(sql);
      const expected = [];
      expect(actual).toEqual(expected);
    });

    it('should not infinite loop due to trailing json type specifier', () => {
      const sql = 'SELECT a.b.:UInt64';
      const actual = findJsonExpressions(sql);
      const expected = [{ index: 7, expr: 'a.b.:UInt64' }];
      expect(actual).toEqual(expected);
    });

    it('should not find JSON expressions in string that has escaped single quote', () => {
      const sql = "SELECT 'a.b''''a.b.:UInt64', col2, c.d FROM table";
      const actual = findJsonExpressions(sql);
      const expected = [{ index: 35, expr: 'c.d' }];
      expect(actual).toEqual(expected);
    });

    it('should not find JSON expressions in string that has escaped single quote 2', () => {
      const sql = "SELECT '\\'a.b', col2, c.d FROM table";
      const actual = findJsonExpressions(sql);
      const expected = [{ index: 22, expr: 'c.d' }];
      expect(actual).toEqual(expected);
    });

    it('should find JSON expressions with underscores and numbers', () => {
      const sql = 'SELECT json_col.col3.c FROM table';
      const actual = findJsonExpressions(sql);
      const expected = [{ index: 7, expr: 'json_col.col3.c' }];
      expect(actual).toEqual(expected);
    });

    it('should find JSON expressions with backticks', () => {
      const sql = 'SELECT `a`.`b`.`cde` FROM table';
      const actual = findJsonExpressions(sql);
      const expected = [{ index: 7, expr: '`a`.`b`.`cde`' }];
      expect(actual).toEqual(expected);
    });

    it('should find JSON expressions with double quotes', () => {
      const sql = 'SELECT "a"."b"."cde" FROM table';
      const actual = findJsonExpressions(sql);
      const expected = [{ index: 7, expr: '"a"."b"."cde"' }];
      expect(actual).toEqual(expected);
    });

    it('should find JSON expressions in tuple', () => {
      const sql = 'SELECT (a.b, c.d.e) FROM table';
      const actual = findJsonExpressions(sql);
      const expected = [
        { index: 8, expr: 'a.b' },
        { index: 13, expr: 'c.d.e' },
      ];
      expect(actual).toEqual(expected);
    });

    it('should not find JSON expressions inside identifiers', () => {
      const sql = 'SELECT "a.b.c" FROM table';
      const actual = findJsonExpressions(sql);
      const expected = [];
      expect(actual).toEqual(expected);
    });

    it('should find JSON expressions with weird identifier quoting', () => {
      const sql = 'SELECT "a_b.2c".b."c." FROM table';
      const actual = findJsonExpressions(sql);
      const expected = [{ index: 7, expr: '"a_b.2c".b."c."' }];
      expect(actual).toEqual(expected);
    });

    it('should find JSON expressions after *', () => {
      const sql = 'SELECT *, a.b.c FROM table';
      const actual = findJsonExpressions(sql);
      const expected = [{ index: 10, expr: 'a.b.c' }];
      expect(actual).toEqual(expected);
    });

    it('should not find a decimal number expression', () => {
      const sql = 'SELECT 10.50, 2.3, 2, 1.5 - a.b FROM table';
      const actual = findJsonExpressions(sql);
      const expected = [{ index: 28, expr: 'a.b' }];
      expect(actual).toEqual(expected);
    });

    it('should not find a . as a JSON expression', () => {
      const sql = 'SELECT . FROM table';
      const actual = findJsonExpressions(sql);
      const expected = [];
      expect(actual).toEqual(expected);
    });

    it('should find a JSON expression with an identifier containing a single-quote', () => {
      const sql = `SELECT Timestamp,ServiceName,SeverityText,Body,ResourceAttributes.hyperdx.distro."version'" FROM default.otel_logs WHERE (Timestamp >= fromUnixTimestamp64Milli(1759756098000) AND Timestamp <= fromUnixTimestamp64Milli(1759756998000)) ORDER BY Timestamp DESC`;
      const actual = findJsonExpressions(sql);
      const expected = [
        { index: 47, expr: `ResourceAttributes.hyperdx.distro."version'"` },
        { index: 97, expr: `default.otel_logs` },
      ];
      expect(actual).toEqual(expected);
    });

    it('should find a JSON expression with an identifier containing a double-quote', () => {
      const sql =
        'SELECT Timestamp,ServiceName,SeverityText,Body,ResourceAttributes.hyperdx.distro.`"version"`';
      const actual = findJsonExpressions(sql);
      const expected = [
        { index: 47, expr: 'ResourceAttributes.hyperdx.distro.`"version"`' },
      ];
      expect(actual).toEqual(expected);
    });

    it('should find a JSON expression with an identifier containing a backtick', () => {
      const sql =
        'SELECT Timestamp,ServiceName,SeverityText,Body,ResourceAttributes.hyperdx.distro."`version`"';
      const actual = findJsonExpressions(sql);
      const expected = [
        { index: 47, expr: 'ResourceAttributes.hyperdx.distro."`version`"' },
      ];
      expect(actual).toEqual(expected);
    });
  });

  describe('replaceJsonAccesses', () => {
    it('should handle empty expression', () => {
      const sql = '';
      const actual = replaceJsonExpressions(sql);
      const expected = { replacements: new Map(), sqlWithReplacements: '' };
      expect(actual).toEqual(expected);
    });

    it('should replace a single JSON access', () => {
      const sql = 'SELECT a.b.c as alias1, col2 as alias2 FROM table';
      const actual = replaceJsonExpressions(sql);
      const expected = {
        replacements: new Map([['__hdx_json_replacement_0', 'a.b.c']]),
        sqlWithReplacements:
          'SELECT __hdx_json_replacement_0 as alias1, col2 as alias2 FROM table',
      };
      expect(actual).toEqual(expected);
    });

    it('should replace multiple JSON access', () => {
      const sql = 'SELECT a.b.c, d.e, col2 FROM table';
      const actual = replaceJsonExpressions(sql);
      const expected = {
        replacements: new Map([
          ['__hdx_json_replacement_0', 'a.b.c'],
          ['__hdx_json_replacement_1', 'd.e'],
        ]),
        sqlWithReplacements:
          'SELECT __hdx_json_replacement_0, __hdx_json_replacement_1, col2 FROM table',
      };
      expect(actual).toEqual(expected);
    });

    it('should replace JSON access with type specifier', () => {
      const sql = 'SELECT a.b.:UInt64, col2 FROM table';
      const actual = replaceJsonExpressions(sql);
      const expected = {
        replacements: new Map([['__hdx_json_replacement_0', 'a.b.:UInt64']]),
        sqlWithReplacements: 'SELECT __hdx_json_replacement_0, col2 FROM table',
      };
      expect(actual).toEqual(expected);
    });

    it('should replace JSON access with complex type specifier', () => {
      const sql = 'SELECT a.b.:Array(String), col2 FROM table';
      const actual = replaceJsonExpressions(sql);
      const expected = {
        replacements: new Map([
          ['__hdx_json_replacement_0', 'a.b.:Array(String)'],
        ]),
        sqlWithReplacements: 'SELECT __hdx_json_replacement_0, col2 FROM table',
      };
      expect(actual).toEqual(expected);
    });

    it('should replace JSON expressions in WHERE clause ', () => {
      const sql =
        'SELECT col2 FROM table WHERE a.b.:UInt64 = 1 AND toStartOfDay(a.date) = today()';
      const actual = replaceJsonExpressions(sql);
      const expected = {
        replacements: new Map([
          ['__hdx_json_replacement_0', 'a.b.:UInt64'],
          ['__hdx_json_replacement_1', 'a.date'],
        ]),
        sqlWithReplacements:
          'SELECT col2 FROM table WHERE __hdx_json_replacement_0 = 1 AND toStartOfDay(__hdx_json_replacement_1) = today()',
      };
      expect(actual).toEqual(expected);
    });

    it('should replace JSON expressions in function calls', () => {
      const sql = "SELECT JSONExtractString(a.b.c, 'key') FROM table";
      const actual = replaceJsonExpressions(sql);
      const expected = {
        replacements: new Map([['__hdx_json_replacement_0', 'a.b.c']]),
        sqlWithReplacements:
          "SELECT JSONExtractString(__hdx_json_replacement_0, 'key') FROM table",
      };
      expect(actual).toEqual(expected);
    });

    it('should not replace JSON expressions in quoted strings', () => {
      const sql =
        "SELECT a.b.c, ResourceAttributes['key.key2'], 'a.b.c' FROM table";
      const actual = replaceJsonExpressions(sql);
      const expected = {
        replacements: new Map([['__hdx_json_replacement_0', 'a.b.c']]),
        sqlWithReplacements:
          "SELECT __hdx_json_replacement_0, ResourceAttributes['key.key2'], 'a.b.c' FROM table",
      };
      expect(actual).toEqual(expected);
    });
  });

  describe('parseToStartOfFunction', () => {
    it.each([
      {
        expr: 'toStartOfDay(a.date)',
        expected: {
          function: 'toStartOfDay',
          columnArgument: 'a.date',
          formattedRemainingArgs: '',
        },
      },
      {
        expr: "toStartOfMinute(toDate(ResourceAttributes['timestamp']))",
        expected: {
          function: 'toStartOfMinute',
          columnArgument: "toDate(ResourceAttributes['timestamp'])",
          formattedRemainingArgs: '',
        },
      },
      {
        expr: "toStartOfMonth(timestamp, 'America/Los_Angeles')",
        expected: {
          function: 'toStartOfMonth',
          columnArgument: 'timestamp',
          formattedRemainingArgs: ", 'America/Los_Angeles'",
        },
      },
      {
        expr: 'toStartOfMonth(`time stamp`)',
        expected: {
          function: 'toStartOfMonth',
          columnArgument: '`time stamp`',
          formattedRemainingArgs: '',
        },
      },
      {
        expr: 'toStartOfInterval(timestamp, INTERVAL 1 DAY)',
        expected: {
          function: 'toStartOfInterval',
          columnArgument: 'timestamp',
          formattedRemainingArgs: ', INTERVAL 1 DAY',
        },
      },
      {
        expr: "toStartOfInterval(timestamp, INTERVAL 1 DAY, toDateTime('2025-01-01'), 'America/Los_Angeles')",
        expected: {
          function: 'toStartOfInterval',
          columnArgument: 'timestamp',
          formattedRemainingArgs:
            ", INTERVAL 1 DAY, toDateTime('2025-01-01'), 'America/Los_Angeles'",
        },
      },
      {
        expr: "    toStartOfInterval ( timestamp,   INTERVAL  10 DAY,   toDateTime('2025-01-01' ),  'America/Los_Angeles' )   ",
        expected: {
          function: 'toStartOfInterval',
          columnArgument: 'timestamp',
          formattedRemainingArgs:
            ", INTERVAL  10 DAY, toDateTime('2025-01-01' ), 'America/Los_Angeles'",
        },
      },
      {
        expr: 'timestamp',
        expected: undefined,
      },
      {
        expr: 'toDate(timestamp)',
        expected: undefined,
      },
      {
        expr: 'toDate(toStartOfDay(timestamp))',
        expected: undefined,
      },
      {
        expr: 'toStartOfDay(timestamp), toDate(timestamp)',
        expected: undefined,
      },
      {
        expr: 'toDate(timestamp), toStartOfDay(timestamp)',
        expected: undefined,
      },
      {
        expr: '',
        expected: undefined,
      },
      {
        expr: '(toStartOfDay(timestamp))',
        expected: undefined,
      },
      {
        expr: 'toStartOfDay(',
        expected: undefined,
      },
    ])('Should parse $expr', ({ expr, expected }) => {
      expect(parseToStartOfFunction(expr)).toEqual(expected);
    });
  });

  describe('optimizeTimestampValueExpression', () => {
    const testCases = [
      {
        timestampValueExpression: 'Timestamp',
        primaryKey: 'Timestamp',
        expected: 'Timestamp',
      },
      {
        timestampValueExpression: 'Timestamp',
        primaryKey: undefined,
        expected: 'Timestamp',
      },
      {
        timestampValueExpression: 'Timestamp',
        primaryKey: '',
        expected: 'Timestamp',
      },
      {
        // Traces Table
        timestampValueExpression: 'Timestamp',
        primaryKey: 'ServiceName, SpanName, toDateTime(Timestamp)',
        expected: 'Timestamp',
      },
      {
        // Optimized Traces Table
        timestampValueExpression: 'Timestamp',
        primaryKey:
          'toStartOfHour(Timestamp), ServiceName, SpanName, toDateTime(Timestamp)',
        expected: 'Timestamp, toStartOfHour(Timestamp)',
      },
      {
        // Unsupported for now as it's not a great primary key, want to just
        // use default behavior for this
        timestampValueExpression: 'Timestamp',
        primaryKey: 'toDateTime(Timestamp), ServiceName, SpanName, Timestamp',
        expected: 'Timestamp',
      },
      {
        // Inverted primary key order, we should not try to optimize this
        timestampValueExpression: 'Timestamp',
        primaryKey:
          'ServiceName, toDateTime(Timestamp), SeverityText, toStartOfHour(Timestamp)',
        expected: 'Timestamp',
      },
      {
        timestampValueExpression: 'Timestamp',
        primaryKey: 'toStartOfHour(Timestamp), other_column, Timestamp',
        expected: 'Timestamp, toStartOfHour(Timestamp)',
      },
      {
        // When the user has already manually configured an optimized timestamp value expression
        timestampValueExpression: ' toStartOfHour(Timestamp), Timestamp',
        primaryKey: 'toStartOfHour(Timestamp), other_column, Timestamp',
        expected: ' toStartOfHour(Timestamp), Timestamp',
      },
      {
        timestampValueExpression: 'Timestamp',
        primaryKey:
          'toStartOfInterval(Timestamp, INTERVAL 1 HOUR), other_column, Timestamp',
        expected: 'Timestamp, toStartOfInterval(Timestamp, INTERVAL 1 HOUR)',
      },
      {
        // test variation of toUnixTimestamp
        timestampValueExpression: 'Timestamp',
        primaryKey:
          'toStartOfMinute(Timestamp), user_id, status, toUnixTimestamp64Nano(Timestamp)',
        expected: 'Timestamp, toStartOfMinute(Timestamp)',
      },
      {
        // TimestampTime is not matched since it is not in the timestampValueExpression
        timestampValueExpression: 'Timestamp',
        primaryKey:
          'toStartOfMinute(TimestampTime), user_id, status, Timestamp',
        expected: 'Timestamp',
      },
      {
        timestampValueExpression: 'Timestamp',
        primaryKey:
          '909]`23`9082eh[928e1p92e81hp92, d81p92d817h1p-93287dh129d7812hgpd91832h, toStartOfMinute(Timestamp), other_column, Timestamp',
        expected: 'Timestamp, toStartOfMinute(Timestamp)',
      },
      {
        timestampValueExpression: '`Time stamp`',
        primaryKey: 'toStartOfMinute(`Time stamp`), other_column, `Time stamp`',
        expected: '`Time stamp`, toStartOfMinute(`Time stamp`)',
      },
    ] as const;

    it.each(testCases)(
      'should return optimized expression $expected for original expression $timestampValueExpression and primary key $primaryKey',
      ({ timestampValueExpression, primaryKey, expected }) => {
        const actual = optimizeTimestampValueExpression(
          timestampValueExpression,
          primaryKey,
        );

        expect(actual).toBe(expected);
      },
    );
  });

  describe('getAlignedDateRange', () => {
    it('should align start time down to the previous minute boundary', () => {
      const dateRange: [Date, Date] = [
        new Date('2025-11-26T12:23:37Z'), // 37 seconds
        new Date('2025-11-26T12:25:00Z'),
      ];

      const [alignedStart, alignedEnd] = getAlignedDateRange(
        dateRange,
        '1 minute',
      );

      expect(alignedStart.toISOString()).toBe('2025-11-26T12:23:00.000Z');
      expect(alignedEnd.toISOString()).toBe('2025-11-26T12:25:00.000Z');
    });

    it('should align end time up to the next minute boundary', () => {
      const dateRange: [Date, Date] = [
        new Date('2025-11-26T12:23:00Z'),
        new Date('2025-11-26T12:25:42Z'), // 42 seconds
      ];

      const [alignedStart, alignedEnd] = getAlignedDateRange(
        dateRange,
        '1 minute',
      );

      expect(alignedStart.toISOString()).toBe('2025-11-26T12:23:00.000Z');
      expect(alignedEnd.toISOString()).toBe('2025-11-26T12:26:00.000Z');
    });

    it('should align both start and end times with 5 minute granularity', () => {
      const dateRange: [Date, Date] = [
        new Date('2025-11-26T12:23:17Z'), // Should round down to 12:20:00
        new Date('2025-11-26T12:27:42Z'), // Should round up to 12:30:00
      ];

      const [alignedStart, alignedEnd] = getAlignedDateRange(
        dateRange,
        '5 minute',
      );

      expect(alignedStart.toISOString()).toBe('2025-11-26T12:20:00.000Z');
      expect(alignedEnd.toISOString()).toBe('2025-11-26T12:30:00.000Z');
    });

    it('should align with 30 second granularity', () => {
      const dateRange: [Date, Date] = [
        new Date('2025-11-26T12:23:17Z'), // Should round down to 12:23:00
        new Date('2025-11-26T12:25:42Z'), // Should round up to 12:26:00
      ];

      const [alignedStart, alignedEnd] = getAlignedDateRange(
        dateRange,
        '30 second',
      );

      expect(alignedStart.toISOString()).toBe('2025-11-26T12:23:00.000Z');
      expect(alignedEnd.toISOString()).toBe('2025-11-26T12:26:00.000Z');
    });

    it('should align with 1 day granularity', () => {
      const dateRange: [Date, Date] = [
        new Date('2025-11-26T12:23:17Z'), // Should round down to start of day
        new Date('2025-11-28T08:15:00Z'), // Should round up to start of next day
      ];

      const [alignedStart, alignedEnd] = getAlignedDateRange(
        dateRange,
        '1 day',
      );

      expect(alignedStart.toISOString()).toBe('2025-11-26T00:00:00.000Z');
      expect(alignedEnd.toISOString()).toBe('2025-11-29T00:00:00.000Z');
    });

    it('should not change range when already aligned to the interval', () => {
      const dateRange: [Date, Date] = [
        new Date('2025-11-26T12:23:00Z'), // Already aligned
        new Date('2025-11-26T12:25:00Z'), // Already aligned
      ];

      const [alignedStart, alignedEnd] = getAlignedDateRange(
        dateRange,
        '1 minute',
      );

      expect(alignedStart.toISOString()).toBe('2025-11-26T12:23:00.000Z');
      expect(alignedEnd.toISOString()).toBe('2025-11-26T12:25:00.000Z');
    });

    it('should align with 15 minute granularity', () => {
      const dateRange: [Date, Date] = [
        new Date('2025-11-26T12:23:17Z'), // Should round down to 12:15:00
        new Date('2025-11-26T12:47:42Z'), // Should round up to 13:00:00
      ];

      const [alignedStart, alignedEnd] = getAlignedDateRange(
        dateRange,
        '15 minute',
      );

      expect(alignedStart.toISOString()).toBe('2025-11-26T12:15:00.000Z');
      expect(alignedEnd.toISOString()).toBe('2025-11-26T13:00:00.000Z');
    });
  });

  describe('extractSettingsClauseFromEnd', () => {
    test.each([
      {
        label: 'no settings clause',
        sql: 'SELECT * FROM table',
        withoutSettingsClause: 'SELECT * FROM table',
        settingsClause: undefined,
      },
      {
        label: 'basic',
        sql: 'SELECT * FROM table SETTINGS opt=1, cast=1',
        withoutSettingsClause: 'SELECT * FROM table',
        settingsClause: 'SETTINGS opt=1, cast=1',
      },
      {
        label: 'basic with semicolon',
        sql: 'SELECT * FROM table SETTINGS opt = 1, cast = 1;',
        withoutSettingsClause: 'SELECT * FROM table',
        settingsClause: 'SETTINGS opt = 1, cast = 1',
      },
      {
        label: 'with WHERE clause',
        sql: 'SELECT * FROM table WHERE col=Value SETTINGS opt = 1, cast = 1;',
        withoutSettingsClause: 'SELECT * FROM table WHERE col=Value',
        settingsClause: 'SETTINGS opt = 1, cast = 1',
      },
      {
        label: 'SETTINGS not at end',
        sql: 'SELECT * FROM table WHERE col=Value SETTINGS opt = 1, cast = 1 FORMAT json;',
        withoutSettingsClause: 'SELECT * FROM table WHERE col=Value',
        // This test case illustrates that subsequent clauses will also be extracted.
        settingsClause: 'SETTINGS opt = 1, cast = 1 FORMAT json',
      },
    ])(
      'Extracts SETTINGS clause from: "$label" query',
      ({ sql, settingsClause, withoutSettingsClause }) => {
        const [remaining, extractedSettingsClause] =
          extractSettingsClauseFromEnd(sql);
        expect(remaining).toBe(withoutSettingsClause);
        expect(extractedSettingsClause).toBe(settingsClause);
      },
    );
  });

  describe('parseToNumber', () => {
    it('returns `undefined` for an empty string', () => {
      expect(parseToNumber('')).toBe(undefined);
    });

    it('returns `undefined` for a whitespace string', () => {
      expect(parseToNumber(' ')).toBe(undefined);
    });

    it('returns `undefined` for a non-numeric string', () => {
      expect(parseToNumber(' . ? / ')).toBe(undefined);
      expect(parseToNumber('  some string value ')).toBe(undefined);
      expect(parseToNumber('5678abc')).toBe(undefined);
    });

    it('returns `undefined` for an infinite number', () => {
      expect(parseToNumber('Infinity')).toBe(undefined);
      expect(parseToNumber('-Infinity')).toBe(undefined);
    });

    it('returns the number value for a parseable number', () => {
      expect(parseToNumber('123')).toBe(123);
      expect(parseToNumber('0.123')).toBe(0.123);
      expect(parseToNumber('1.123')).toBe(1.123);
      expect(parseToNumber('10000000')).toBe(10000000);
    });
  });

  describe('joinQuerySettings', () => {
    test('returns `undefined` if the querySettings are `undefined` or empty', () => {
      expect(joinQuerySettings(undefined)).toBe(undefined);
      expect(joinQuerySettings([])).toBe(undefined);
    });

    test('filters out items whose `setting` or `value` field is empty', () => {
      expect(
        joinQuerySettings([
          { setting: '', value: '1' },
          { setting: 'async_insert', value: '' },
          { setting: 'async_insert_busy_timeout_min_ms', value: '20000' },
        ]),
      ).toEqual('async_insert_busy_timeout_min_ms = 20000');
    });

    test('joins the values into key value pairs', () => {
      const result = joinQuerySettings([
        { setting: 'additional_result_filter', value: 'x != 2' },
        { setting: 'async_insert', value: '0' },
        { setting: 'async_insert_busy_timeout_min_ms', value: '20000' },
      ]);

      expect(result).toContain("additional_result_filter = 'x != 2'");
      expect(result).toContain('async_insert = 0');
      expect(result).toContain('async_insert_busy_timeout_min_ms = 20000');
    });

    test('joins the result into a comma separated string', () => {
      expect(
        joinQuerySettings([
          { setting: 'additional_result_filter', value: 'x != 2' },
          { setting: 'async_insert', value: '0' },
          { setting: 'async_insert_busy_timeout_min_ms', value: '20000' },
        ]),
      ).toEqual(
        "additional_result_filter = 'x != 2', async_insert = 0, async_insert_busy_timeout_min_ms = 20000",
      );
    });

    test('wraps non-numeric and infinite numeric values in quotes', () => {
      expect(
        joinQuerySettings([{ setting: 'setting_name', value: 'x != 2' }]),
      ).toEqual("setting_name = 'x != 2'");

      expect(
        joinQuerySettings([{ setting: 'setting_name', value: 'string value' }]),
      ).toEqual("setting_name = 'string value'");

      expect(
        joinQuerySettings([{ setting: 'setting_name', value: '1000' }]),
      ).toEqual('setting_name = 1000');

      expect(
        joinQuerySettings([{ setting: 'setting_name', value: 'Infinity' }]),
      ).toEqual("setting_name = 'Infinity'");
    });
  });
  describe('parseTokenizerFromTextIndex', () => {
    it.each([
      {
        type: 'text',
        expected: undefined,
      },
      {
        type: 'text()',
        expected: undefined,
      },
      {
        type: ' text ( tokenizer= array ) ',
        expected: { type: 'array' },
      },
      {
        type: 'text(tokenizer=splitByNonAlpha)',
        expected: { type: 'splitByNonAlpha' },
      },
      {
        type: 'text( tokenizer = splitByNonAlpha )',
        expected: { type: 'splitByNonAlpha' },
      },
      {
        type: 'text(tokenizer = splitByString())',
        expected: { type: 'splitByString', separators: [' '] },
      },
      {
        type: `text(tokenizer = splitByString([', ', '; ', '\\n', '" ', '\\\\', '\\t', '(', ')']))`,
        expected: {
          type: 'splitByString',
          separators: [', ', '; ', '\n', '" ', '\\', '\t', '(', ')'],
        },
      },
      {
        type: 'text(preprocessor=lower(s), tokenizer=sparseGrams(2, 5, 10))',
        expected: {
          type: 'sparseGrams',
          minLength: 2,
          maxLength: 5,
          minCutoffLength: 10,
        },
      },
      {
        type: 'text(preprocessor=lower(s), tokenizer=sparseGrams(2, 5))',
        expected: {
          type: 'sparseGrams',
          minLength: 2,
          maxLength: 5,
          minCutoffLength: undefined,
        },
      },
      {
        type: 'text(preprocessor=lower(s), tokenizer=sparseGrams(2))',
        expected: {
          type: 'sparseGrams',
          minLength: 2,
          maxLength: 10,
          minCutoffLength: undefined,
        },
      },
      {
        type: 'text(preprocessor=lower(s), tokenizer=sparseGrams)',
        expected: {
          type: 'sparseGrams',
          minLength: 3,
          maxLength: 10,
          minCutoffLength: undefined,
        },
      },
      {
        type: 'text(preprocessor=lower(s), tokenizer= sparseGrams ())',
        expected: {
          type: 'sparseGrams',
          minLength: 3,
          maxLength: 10,
          minCutoffLength: undefined,
        },
      },
      {
        type: 'text(preprocessor=lower(s), tokenizer=unknown)',
        expected: undefined,
      },
      {
        type: '',
        expected: undefined,
      },
      {
        type: 'text(preprocessor=lower(s), tokenizer=array)',
        expected: { type: 'array' },
      },
      {
        type: 'text(preprocessor=lower(s), tokenizer=ngrams)',
        expected: { type: 'ngrams', n: 3 },
      },
      {
        type: 'text(tokenizer=ngrams())',
        expected: { type: 'ngrams', n: 3 },
      },
      {
        type: 'text(tokenizer=ngrams(20))',
        expected: { type: 'ngrams', n: 20 },
      },
    ])('should correctly parse tokenizer from: $type', ({ type, expected }) => {
      const result = parseTokenizerFromTextIndex({
        type: 'text',
        typeFull: type,
        name: 'text_idx',
        expression: 'Body',
        granularity: 1000,
      });
      expect(result).toEqual(expected);
    });
  });
});
