import mongoose from 'mongoose';

import { getConnectionById } from '@/controllers/connection';
import { queryPrometheusRangeFromClickHouse } from '@/controllers/timeseriesEngine';
import type { ISource } from '@/models/source';
import { evaluatePromqlAlert } from '@/tasks/checkAlerts';

jest.mock('@/controllers/connection');
jest.mock('@/controllers/timeseriesEngine', () => {
  const actual = jest.requireActual<
    typeof import('@/controllers/timeseriesEngine')
  >('@/controllers/timeseriesEngine');
  return {
    ...actual,
    // Only mock the function that makes real network calls
    queryPrometheusRangeFromClickHouse: jest.fn(),
  };
});
jest.mock('@/clickhouse');

describe('evaluatePromqlAlert', () => {
  const mockTeamId = new mongoose.Types.ObjectId().toString();
  const mockConnectionId = new mongoose.Types.ObjectId().toString();
  const mockDateRange: [Date, Date] = [
    new Date('2024-01-01T00:00:00Z'),
    new Date('2024-01-01T00:05:00Z'),
  ];
  const mockWindowSizeInMins = 5;

  const mockSavedConfig = {
    configType: 'promql' as const,
    promqlExpression: 'up',
    connection: mockConnectionId,
  };

  const mockSource = {
    from: {
      databaseName: 'default',
      tableName: 'otel_metrics_ts',
    },
  } as unknown as ISource;

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Prometheus endpoint', () => {
    beforeEach(() => {
      (getConnectionById as jest.Mock).mockResolvedValue({
        host: 'http://prometheus:9090',
        isPrometheusEndpoint: true,
      });

      // Mock global fetch
      global.fetch = jest.fn();
    });

    it('should return all time-series values for a single unlabeled series', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'success',
          data: {
            result: [
              {
                metric: {},
                values: [
                  [1704067200, '0'],
                  [1704067500, '42.5'],
                ],
              },
            ],
          },
        }),
      });

      const result = await evaluatePromqlAlert({
        savedConfig: mockSavedConfig,
        connectionId: mockConnectionId,
        teamId: mockTeamId,
        dateRange: mockDateRange,
        windowSizeInMins: mockWindowSizeInMins,
      });

      // Returns full PrometheusMatrixResult[] — all points, not just the last.
      // This enables the caller (processAlert) to evaluate each window bucket
      // individually for backfill support.
      expect(result).toEqual([
        {
          metric: {},
          values: [
            [1704067200, '0'],
            [1704067500, '42.5'],
          ],
        },
      ]);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://prometheus:9090/api/v1/query_range?query=up&start=1704067200&end=1704067500&step=300',
        expect.any(Object),
      );
    });

    it('should return multiple series with all time-points', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'success',
          data: {
            result: [
              {
                metric: { host: 'A' },
                values: [[1704067500, '42.5']],
              },
              {
                metric: { host: 'B' },
                values: [[1704067500, '10.5']],
              },
            ],
          },
        }),
      });

      const result = await evaluatePromqlAlert({
        savedConfig: mockSavedConfig,
        connectionId: mockConnectionId,
        teamId: mockTeamId,
        dateRange: mockDateRange,
        windowSizeInMins: mockWindowSizeInMins,
      });

      expect(result).toEqual([
        { metric: { host: 'A' }, values: [[1704067500, '42.5']] },
        { metric: { host: 'B' }, values: [[1704067500, '10.5']] },
      ]);
    });

    it('should throw on non-success Prometheus status instead of returning null', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'error',
          error: 'query timeout',
          data: { result: [] },
        }),
      });

      await expect(
        evaluatePromqlAlert({
          savedConfig: mockSavedConfig,
          source: mockSource,
          connectionId: mockConnectionId,
          teamId: mockTeamId,
          dateRange: mockDateRange,
          windowSizeInMins: mockWindowSizeInMins,
        }),
      ).rejects.toThrow(
        "Prometheus query_range returned status 'error' for PromQL alert",
      );
    });

    it('should return null when result array is empty', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'success',
          data: { result: [] },
        }),
      });

      const result = await evaluatePromqlAlert({
        savedConfig: mockSavedConfig,
        connectionId: mockConnectionId,
        teamId: mockTeamId,
        dateRange: mockDateRange,
        windowSizeInMins: mockWindowSizeInMins,
      });

      expect(result).toBeNull();
    });
  });

  describe('ClickHouse endpoint', () => {
    beforeEach(() => {
      (getConnectionById as jest.Mock).mockResolvedValue({
        host: 'http://clickhouse:8123',
        username: 'default',
        password: '',
        isPrometheusEndpoint: false,
      });
    });

    it('should return multiple series with all time-points via formatMatrixResponse', async () => {
      // tags is an array of [key, value] tuples — as returned by ClickHouse
      (queryPrometheusRangeFromClickHouse as jest.Mock).mockResolvedValue({
        json: async () => ({
          data: [
            {
              tags: [['host', 'A']],
              time_series: [['2024-01-01 00:05:00', 42.5]],
            },
            {
              tags: [['host', 'B']],
              time_series: [['2024-01-01 00:05:00', 10.5]],
            },
          ],
        }),
      });

      const result = await evaluatePromqlAlert({
        savedConfig: mockSavedConfig,
        source: {
          from: { databaseName: 'my_db', tableName: 'my_table' },
        } as any,
        connectionId: mockConnectionId,
        teamId: mockTeamId,
        dateRange: mockDateRange,
        windowSizeInMins: mockWindowSizeInMins,
      });

      // formatMatrixResponse converts tags tuples to metric dict
      // and time_series to [ts_seconds, string_value] tuples.
      expect(result).toEqual([
        {
          metric: { host: 'A' },
          values: expect.arrayContaining([[expect.any(Number), '42.5']]),
        },
        {
          metric: { host: 'B' },
          values: expect.arrayContaining([[expect.any(Number), '10.5']]),
        },
      ]);

      expect(queryPrometheusRangeFromClickHouse).toHaveBeenCalledWith(
        expect.objectContaining({
          expr: 'up',
          databaseName: 'my_db',
          tableName: 'my_table',
        }),
      );
    });

    it('should have __name__ stripped from metric map', async () => {
      (queryPrometheusRangeFromClickHouse as jest.Mock).mockResolvedValue({
        json: async () => ({
          data: [
            {
              tags: [
                ['__name__', 'up'],
                ['host', 'A'],
              ],
              time_series: [['2024-01-01 00:05:00', 42.5]],
            },
          ],
        }),
      });

      const result = await evaluatePromqlAlert({
        savedConfig: mockSavedConfig,
        source: mockSource,
        connectionId: mockConnectionId,
        teamId: mockTeamId,
        dateRange: mockDateRange,
        windowSizeInMins: mockWindowSizeInMins,
      });

      // formatMatrixResponse includes __name__ in metric — the caller
      // (processAlert) strips __name__ when building the group key.
      expect(result).toEqual([
        {
          metric: { __name__: 'up', host: 'A' },
          values: expect.arrayContaining([[expect.any(Number), '42.5']]),
        },
      ]);
    });

    it('should throw an error when no source tableName is provided', async () => {
      await expect(
        evaluatePromqlAlert({
          savedConfig: mockSavedConfig,
          source: undefined,
          connectionId: mockConnectionId,
          teamId: mockTeamId,
          dateRange: mockDateRange,
          windowSizeInMins: mockWindowSizeInMins,
        }),
      ).rejects.toThrow(
        'A PromQL alert routed to ClickHouse must have a source with a valid TimeSeries table name.',
      );
    });

    it('should throw when source has no databaseName (prevents silently querying wrong DB)', async () => {
      await expect(
        evaluatePromqlAlert({
          savedConfig: mockSavedConfig,
          source: {
            from: { databaseName: '', tableName: 'otel_metrics_ts' },
          } as unknown as ISource,
          connectionId: mockConnectionId,
          teamId: mockTeamId,
          dateRange: mockDateRange,
          windowSizeInMins: mockWindowSizeInMins,
        }),
      ).rejects.toThrow(
        'A PromQL alert routed to ClickHouse must have a source with a valid database name.',
      );
    });

    it('should return null when no data is returned', async () => {
      (queryPrometheusRangeFromClickHouse as jest.Mock).mockResolvedValue({
        json: async () => ({
          data: [],
        }),
      });

      const result = await evaluatePromqlAlert({
        savedConfig: mockSavedConfig,
        source: mockSource,
        connectionId: mockConnectionId,
        teamId: mockTeamId,
        dateRange: mockDateRange,
        windowSizeInMins: mockWindowSizeInMins,
      });

      expect(result).toBeNull();
    });
  });
});
