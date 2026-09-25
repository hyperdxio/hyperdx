import mongoose from 'mongoose';

import { getConnectionById } from '@/controllers/connection';
import { queryRangeViaTableFunction } from '@/controllers/timeseriesEngine';
import type { IConnection } from '@/models/connection';
import type { ISource } from '@/models/source';
import { evaluatePromqlAlert } from '@/tasks/checkAlerts';

function mock<T>(obj: Partial<T>): T {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return obj as unknown as T;
}

jest.mock('@/controllers/connection');
jest.mock('@/controllers/timeseriesEngine', () => {
  const actual = jest.requireActual<
    typeof import('@/controllers/timeseriesEngine')
  >('@/controllers/timeseriesEngine');
  return {
    ...actual,
    // Only mock the function that makes real network calls
    queryRangeViaTableFunction: jest.fn(),
  };
});
jest.mock('@/clickhouse');

describe('evaluatePromqlAlert (ClickHouse endpoint)', () => {
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

  const mockSource = mock<ISource>({
    from: {
      databaseName: 'default',
      tableName: 'otel_metrics_ts',
    },
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  beforeEach(() => {
    (getConnectionById as jest.Mock).mockResolvedValue({
      host: 'http://clickhouse:8123',
      username: 'default',
      password: '',
      isPrometheusEndpoint: false,
    });
  });

  it('should return multiple series with all time-points via formatMatrixResponse', async () => {
    (queryRangeViaTableFunction as jest.Mock).mockResolvedValue([
      {
        metric: { host: 'A' },
        values: [[1704067500, '42.5']],
      },
      {
        metric: { host: 'B' },
        values: [[1704067500, '10.5']],
      },
    ]);

    const result = await evaluatePromqlAlert({
      savedConfig: mockSavedConfig,
      source: {
        from: { databaseName: 'my_db', tableName: 'my_table' },
      } as unknown as ISource,
      connection: mock<IConnection>({
        id: mockConnectionId,
        host: 'http://clickhouse:8123',
        isPrometheusEndpoint: false,
      }),
      clickhouseClient: {} as any,
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

    expect(queryRangeViaTableFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        expr: 'up',
        databaseName: 'my_db',
        tableName: 'my_table',
      }),
    );
  });

  it('should have __name__ stripped from metric map', async () => {
    (queryRangeViaTableFunction as jest.Mock).mockResolvedValue([
      {
        metric: { __name__: 'up', host: 'A' },
        values: [[1704067500, '42.5']],
      },
    ]);

    const result = await evaluatePromqlAlert({
      savedConfig: mockSavedConfig,
      source: mockSource,
      connection: mock<IConnection>({
        id: mockConnectionId,
        host: 'http://clickhouse:8123',
        isPrometheusEndpoint: false,
      }),
      clickhouseClient: {} as any,
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
        connection: mock<IConnection>({
          id: mockConnectionId,
          host: 'http://clickhouse:8123',
          isPrometheusEndpoint: false,
        }),
        clickhouseClient: {} as any,
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
        connection: mock<IConnection>({
          id: mockConnectionId,
          host: 'http://clickhouse:8123',
          isPrometheusEndpoint: false,
        }),
        clickhouseClient: {} as any,
        dateRange: mockDateRange,
        windowSizeInMins: mockWindowSizeInMins,
      }),
    ).rejects.toThrow(
      'A PromQL alert routed to ClickHouse must have a source with a valid database name.',
    );
  });

  it('should return null when no data is returned', async () => {
    (queryRangeViaTableFunction as jest.Mock).mockResolvedValue([]);

    const result = await evaluatePromqlAlert({
      savedConfig: mockSavedConfig,
      source: mockSource,
      connection: mock<IConnection>({
        id: mockConnectionId,
        host: 'http://clickhouse:8123',
        isPrometheusEndpoint: false,
      }),
      clickhouseClient: {} as any,
      dateRange: mockDateRange,
      windowSizeInMins: mockWindowSizeInMins,
    });

    expect(result).toBeNull();
  });
});
