import { DisplayType } from '@/types';

import { renderRawSqlChartConfig } from '../rawSqlParams';

describe('renderRawSqlChartConfig', () => {
  describe('DisplayType.Table', () => {
    it('returns the sqlTemplate with no params when no dateRange provided', () => {
      const result = renderRawSqlChartConfig({
        configType: 'sql',
        sqlTemplate: 'SELECT count() FROM logs',
        connection: 'conn-1',
        displayType: DisplayType.Table,
      });
      expect(result.sql).toBe('SELECT count() FROM logs');
      expect(result.params).toEqual({
        startDateMilliseconds: undefined,
        endDateMilliseconds: undefined,
      });
    });

    it('injects startDateMilliseconds and endDateMilliseconds when dateRange provided', () => {
      const start = new Date('2024-01-01T00:00:00.000Z');
      const end = new Date('2024-01-02T00:00:00.000Z');
      const result = renderRawSqlChartConfig({
        configType: 'sql',
        sqlTemplate:
          'SELECT count() FROM logs WHERE ts BETWEEN {startDateMilliseconds:Int64} AND {endDateMilliseconds:Int64}',
        connection: 'conn-1',
        displayType: DisplayType.Table,
        dateRange: [start, end],
      });
      expect(result.sql).toBe(
        'SELECT count() FROM logs WHERE ts BETWEEN {startDateMilliseconds:Int64} AND {endDateMilliseconds:Int64}',
      );
      expect(result.params).toEqual({
        startDateMilliseconds: start.getTime(),
        endDateMilliseconds: end.getTime(),
      });
    });

    it('defaults to Table display type when displayType is not specified', () => {
      const start = new Date('2024-06-15T12:00:00.000Z');
      const end = new Date('2024-06-15T13:00:00.000Z');
      const result = renderRawSqlChartConfig({
        configType: 'sql',
        sqlTemplate: 'SELECT * FROM events',
        connection: 'conn-1',
        dateRange: [start, end],
      });
      expect(result.params).toEqual({
        startDateMilliseconds: start.getTime(),
        endDateMilliseconds: end.getTime(),
      });
    });
  });
});
