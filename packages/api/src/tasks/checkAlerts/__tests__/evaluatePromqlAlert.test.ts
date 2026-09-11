import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/node';
import mongoose from 'mongoose';

import { getConnectionById } from '@/controllers/connection';
import { evaluatePromqlAlert } from '@/tasks/checkAlerts';

jest.mock('@/controllers/connection');
jest.mock('@hyperdx/common-utils/dist/clickhouse/node');

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

    it('should query Prometheus API and return the last value', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'success',
          data: {
            result: [
              {
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

      expect(result).toEqual([{ group: '', value: 42.5 }]);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://prometheus:9090/api/v1/query_range?query=up&start=1704067200&end=1704067500&step=300',
        expect.any(Object),
      );
    });


    it('should return multiple series for Prometheus endpoint', async () => {
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
        { group: 'host:"A"', value: 42.5 },
        { group: 'host:"B"', value: 10.5 },
      ]);
    });



    it('should return null when no data is returned', async () => {
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
    let mockQuery: jest.Mock;

    beforeEach(() => {
      (getConnectionById as jest.Mock).mockResolvedValue({
        host: 'http://clickhouse:8123',
        isPrometheusEndpoint: false,
      });

      mockQuery = jest.fn();
      (ClickhouseClient as unknown as jest.Mock).mockImplementation(() => ({
        query: mockQuery,
      }));
    });

    it('should return multiple series for ClickHouse endpoint with proper db/table', async () => {
      mockQuery.mockResolvedValue({
        json: async () => ({
          data: [
            {
              tags: { host: 'A' },
              time_series: [['2024-01-01 00:05:00', 42.5]],
            },
            {
              tags: { host: 'B' },
              time_series: [['2024-01-01 00:05:00', 10.5]],
            },
          ],
        }),
      });

      const result = await evaluatePromqlAlert({
        savedConfig: mockSavedConfig,
        source: { from: { databaseName: 'my_db', tableName: 'my_table' } } as any,
        connectionId: mockConnectionId,
        teamId: mockTeamId,
        dateRange: mockDateRange,
        windowSizeInMins: mockWindowSizeInMins,
      });

      expect(result).toEqual([
        { group: 'host:"A"', value: 42.5 },
        { group: 'host:"B"', value: 10.5 },
      ]);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          query_params: expect.objectContaining({
            expr: 'up',
            db: 'my_db',
            table: 'my_table',
          }),
        }),
      );
    });

    it('should query ClickHouse and return the last value', async () => {
      mockQuery.mockResolvedValue({
        json: async () => ({
          data: [
            {
              time_series: [
                ['2024-01-01 00:00:00', 0],
                ['2024-01-01 00:05:00', 42.5],
              ],
            },
          ],
        }),
      });

      const result = await evaluatePromqlAlert({
        savedConfig: mockSavedConfig,
        connectionId: mockConnectionId,
        teamId: mockTeamId,
        dateRange: mockDateRange,
        windowSizeInMins: mockWindowSizeInMins,
      });

      expect(result).toEqual([{ group: '', value: 42.5 }]);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          query_params: expect.objectContaining({
            expr: 'up',
            startMs: 1704067200000,
            endMs: 1704067500000,
            stepSec: 300,
          }),
        }),
      );
    });

    it('should return null when no data is returned', async () => {
      mockQuery.mockResolvedValue({
        json: async () => ({
          data: [],
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
});
