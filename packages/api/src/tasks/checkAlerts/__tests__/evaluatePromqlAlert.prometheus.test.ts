import mongoose from 'mongoose';

import { getConnectionById } from '@/controllers/connection';
import type { ISource } from '@/models/source';
import { evaluatePromqlAlert } from '@/tasks/checkAlerts';

jest.mock('@/controllers/connection', () => ({
  getConnectionById: jest.fn(),
}));

describe('evaluatePromqlAlert (Prometheus endpoint)', () => {
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
      'http://prometheus:9090/api/v1/query_range?query=up&start=1704067500&end=1704067500&step=300',
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
