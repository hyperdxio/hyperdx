import { ClickHouseQueryError } from '@hyperdx/common-utils/dist/clickhouse';
import { ClickhouseClient } from '@hyperdx/common-utils/dist/clickhouse/browser';
import { Metadata } from '@hyperdx/common-utils/dist/core/metadata';
import { ChartConfigWithOptDateRange } from '@hyperdx/common-utils/dist/types';

jest.mock('@hyperdx/common-utils/dist/core/renderChartConfig', () => ({
  ...jest.requireActual('@hyperdx/common-utils/dist/core/renderChartConfig'),
  renderChartConfig: jest.fn(),
}));

import { renderChartConfig } from '@hyperdx/common-utils/dist/core/renderChartConfig';

import { queryChartConfigWithProgress } from '@/hooks/useChartConfig/queryChartConfigWithProgress';

const CONFIG: ChartConfigWithOptDateRange = {
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  select: [{ aggFn: 'count' as const, valueExpression: '' }],
  where: '',
  whereLanguage: 'sql' as const,
  timestampValueExpression: 'Timestamp',
  dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
};

function streamOf(batches: unknown[][]) {
  const queue = batches.map(batch =>
    batch.map(event => ({ json: () => event })),
  );
  let i = 0;
  return {
    getReader: () => ({
      read: async () =>
        i < queue.length
          ? { done: false, value: queue[i++] }
          : { done: true, value: undefined },
    }),
  };
}

function createClient({
  serverVersion,
  batches = [],
}: {
  serverVersion: number[] | undefined;
  batches?: unknown[][];
}) {
  const query = jest
    .fn()
    .mockResolvedValue({ stream: () => streamOf(batches) });
  const queryChartConfig = jest
    .fn()
    .mockResolvedValue({ data: [{ n: 1 }], meta: [], rows: 1 });
  const metadata = {
    getServerVersion: jest.fn().mockResolvedValue(serverVersion),
  };
  return {
    query,
    queryChartConfig,
    // Only the handful of members the function under test reaches for.
    client: { query, queryChartConfig } as unknown as ClickhouseClient,
    metadata: metadata as unknown as Metadata,
  };
}

describe('queryChartConfigWithProgress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(renderChartConfig)
      .mockResolvedValue({ sql: 'SELECT 1', params: {} });
  });

  it('streams and reports progress on ClickHouse >= 25.1', async () => {
    const onProgress = jest.fn();
    const { client, metadata } = createClient({
      serverVersion: [25, 1, 0, 0],
      batches: [
        [
          { meta: [{ name: 'count', type: 'UInt64' }] },
          { row: { count: 7 } },
          {
            progress: {
              read_rows: '10',
              read_bytes: '80',
              total_rows_to_read: '20',
              elapsed_ns: '5',
            },
          },
        ],
        [{ row: { count: 8 } }],
      ],
    });

    const result = await queryChartConfigWithProgress({
      config: CONFIG,
      clickhouseClient: client,
      metadata,
      querySettings: undefined,
      onProgress,
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'JSONEachRowWithProgress' }),
    );
    expect(client.queryChartConfig).not.toHaveBeenCalled();
    expect(result).toEqual({
      data: [{ count: 7 }, { count: 8 }],
      meta: [{ name: 'count', type: 'UInt64' }],
      rows: 2,
    });
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ read_rows: '10' }),
    );
  });

  it('falls back to the non-streaming query on ClickHouse < 25.1', async () => {
    const onProgress = jest.fn();
    const { client, metadata } = createClient({
      serverVersion: [24, 12, 0, 0],
    });

    const result = await queryChartConfigWithProgress({
      config: CONFIG,
      clickhouseClient: client,
      metadata,
      querySettings: undefined,
      onProgress,
    });

    expect(client.queryChartConfig).toHaveBeenCalledTimes(1);
    expect(client.query).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    expect(result).toEqual({ data: [{ n: 1 }], meta: [], rows: 1 });
  });

  it('falls back when the server version is unknown', async () => {
    const { client, metadata } = createClient({ serverVersion: undefined });

    await queryChartConfigWithProgress({
      config: CONFIG,
      clickhouseClient: client,
      metadata,
      querySettings: undefined,
      onProgress: jest.fn(),
    });

    expect(client.queryChartConfig).toHaveBeenCalledTimes(1);
  });

  it('does not probe the server version when no progress listener is given', async () => {
    const { client, metadata } = createClient({ serverVersion: [26, 5, 0, 0] });

    await queryChartConfigWithProgress({
      config: CONFIG,
      clickhouseClient: client,
      metadata,
      querySettings: undefined,
    });

    expect(metadata.getServerVersion).not.toHaveBeenCalled();
    expect(client.queryChartConfig).toHaveBeenCalledTimes(1);
  });

  it('surfaces a mid-stream exception as a query error', async () => {
    const { client, metadata } = createClient({
      serverVersion: [26, 5, 0, 0],
      batches: [[{ exception: 'Code: 241. Memory limit exceeded' }]],
    });

    await expect(
      queryChartConfigWithProgress({
        config: CONFIG,
        clickhouseClient: client,
        metadata,
        querySettings: undefined,
        onProgress: jest.fn(),
      }),
    ).rejects.toThrow(ClickHouseQueryError);
  });

  it('passes the abort signal and settings through the streaming path', async () => {
    const controller = new AbortController();
    const { client, metadata } = createClient({
      serverVersion: [26, 5, 0, 0],
      batches: [[{ meta: [] }]],
    });

    await queryChartConfigWithProgress({
      config: CONFIG,
      clickhouseClient: client,
      metadata,
      querySettings: undefined,
      signal: controller.signal,
      clickhouseSettings: { readonly: '2' },
      onProgress: jest.fn(),
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.objectContaining({
        abort_signal: controller.signal,
        clickhouse_settings: { readonly: '2' },
        connectionId: 'conn-1',
      }),
    );
  });
});
