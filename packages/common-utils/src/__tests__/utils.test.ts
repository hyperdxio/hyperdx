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
  findJsonExpressions,
  formatDate,
  getFirstOrderingItem,
  isFirstOrderByAscending,
  isJsonExpression,
  isTimestampExpressionInFirstOrderBy,
  replaceJsonExpressions,
  splitAndTrimCSV,
  splitAndTrimWithBracket,
} from '../utils';

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
});
