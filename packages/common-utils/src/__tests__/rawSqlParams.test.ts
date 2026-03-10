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

    describe('DisplayType.Line', () => {
      it('returns undefined params when no dateRange is provided', () => {
        const result = renderRawSqlChartConfig({
          configType: 'sql',
          sqlTemplate: 'SELECT ts, count() FROM logs GROUP BY ts',
          connection: 'conn-1',
          displayType: DisplayType.Line,
        });
        expect(result.params).toEqual({
          startDateMilliseconds: undefined,
          endDateMilliseconds: undefined,
          intervalSeconds: 0,
          intervalMilliseconds: 0,
        });
      });

      it('injects all four params when dateRange is provided', () => {
        const start = new Date('2024-01-01T00:00:00.000Z');
        const end = new Date('2024-01-02T00:00:00.000Z');
        const result = renderRawSqlChartConfig({
          configType: 'sql',
          sqlTemplate:
            'SELECT toStartOfInterval(ts, INTERVAL {intervalSeconds:Int64} SECOND) AS ts, count() FROM logs WHERE ts >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND ts <= fromUnixTimestamp64Milli({endDateMilliseconds:Int64}) GROUP BY ts ORDER BY ts ASC',
          connection: 'conn-1',
          displayType: DisplayType.Line,
          dateRange: [start, end],
        });
        expect(result.params.startDateMilliseconds).toBe(start.getTime());
        expect(result.params.endDateMilliseconds).toBe(end.getTime());
        expect(typeof result.params.intervalSeconds).toBe('number');
        expect(result.params.intervalSeconds).toBeGreaterThan(0);
        expect(result.params.intervalMilliseconds).toBe(
          result.params.intervalSeconds * 1000,
        );
      });

      it('returns the granularity from the config when available', () => {
        // 1-hour range: auto-granularity should be 1 minute (60s) for 60 max buckets
        const start = new Date('2024-01-01T00:00:00.000Z');
        const end = new Date('2024-01-01T01:00:00.000Z');
        const result = renderRawSqlChartConfig({
          configType: 'sql',
          sqlTemplate: 'SELECT ts, count() FROM logs GROUP BY ts',
          connection: 'conn-1',
          displayType: DisplayType.Line,
          dateRange: [start, end],
          granularity: '5 minute',
        });
        expect(result.params.intervalSeconds).toBe(300); // 5 minutes
        expect(result.params.intervalMilliseconds).toBe(300000);
      });

      it('computes intervalSeconds based on the date range duration when granularity is auto', () => {
        // 1-hour range: auto-granularity should be 1 minute (60s) for 60 max buckets
        const start = new Date('2024-01-01T00:00:00.000Z');
        const end = new Date('2024-01-01T01:00:00.000Z');
        const result = renderRawSqlChartConfig({
          configType: 'sql',
          sqlTemplate: 'SELECT ts, count() FROM logs GROUP BY ts',
          connection: 'conn-1',
          granularity: 'auto',
          displayType: DisplayType.Line,
          dateRange: [start, end],
        });
        // 1-hour range / 60 buckets = 60s per bucket → "1 minute" interval → 60 seconds
        expect(result.params.intervalSeconds).toBe(60);
        expect(result.params.intervalMilliseconds).toBe(60000);
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
