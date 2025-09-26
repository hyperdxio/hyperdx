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
  formatDate,
  getFirstOrderingItem,
  isFirstOrderByAscending,
  isTimestampExpressionInFirstOrderBy,
  removeTrailingDirection,
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
});
