import { ClickhouseClient } from '@/clickhouse/node';
import { Metadata, MetadataCache, TableMetadata } from '@/core/metadata';

const mockQuery = jest.fn();
const mockClickhouseClient = {
  query: mockQuery,
} as unknown as ClickhouseClient;

// Stands in for a `BaseResultSet`: one chunk per array, each an array of
// `Row`-alikes. The nesting matters — flattening it would hide loop bugs.
const resultSetOf = (chunks: unknown[][]) => ({
  stream: () =>
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk.map(value => ({ json: () => value })));
        }
        controller.close();
      },
    }),
});

const GAUGE_TABLE_METADATA = {
  engine: 'MergeTree',
  primary_key: 'ServiceName, MetricName, toStartOfHour(TimeUnix)',
  partition_key: 'toDate(TimeUnix)',
} as TableMetadata;

const ARGS = {
  databaseName: 'default',
  tableName: 'otel_metrics_gauge',
  column: 'MetricName',
  connectionId: 'conn-1',
};

function buildMetadata({
  version = [26, 3, 0, 0] as [number, number, number, number],
  tableMetadata = GAUGE_TABLE_METADATA,
}: {
  version?: [number, number, number, number];
  tableMetadata?: TableMetadata | undefined;
} = {}) {
  const metadata = new Metadata(mockClickhouseClient, new MetadataCache());
  jest.spyOn(metadata, 'getServerVersion').mockResolvedValue(version);
  jest.spyOn(metadata, 'getTableMetadata').mockResolvedValue(tableMetadata);
  return metadata;
}

async function drain(iterable: AsyncIterable<string[]>) {
  const chunks: string[][] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Metadata.streamDistinctIndexValues', () => {
  it('yields a chunk per stream chunk rather than buffering the whole result', async () => {
    const metadata = buildMetadata();
    mockQuery.mockResolvedValue(
      resultSetOf([
        [{ value: 'system.cpu.time' }, { value: 'system.memory.usage' }],
        [{ value: 'http.server.duration' }],
      ]),
    );

    expect(await drain(metadata.streamDistinctIndexValues(ARGS))).toEqual([
      ['system.cpu.time', 'system.memory.usage'],
      ['http.server.duration'],
    ]);
  });

  it('reads a node-style Readable as well as a web ReadableStream', async () => {
    // The node client's `stream()` returns a Node Readable, which has no
    // `getReader`; only the web client returns a WHATWG ReadableStream.
    const metadata = buildMetadata();
    mockQuery.mockResolvedValue({
      stream: () => ({
        async *[Symbol.asyncIterator]() {
          yield [{ json: () => ({ value: 'from.node.stream' }) }];
        },
      }),
    });

    expect(await drain(metadata.streamDistinctIndexValues(ARGS))).toEqual([
      ['from.node.stream'],
    ]);
  });

  it('reads the primary index with DISTINCT and no ORDER BY', async () => {
    const metadata = buildMetadata();
    mockQuery.mockResolvedValue(resultSetOf([]));

    await drain(metadata.streamDistinctIndexValues(ARGS));

    const { query, format } = mockQuery.mock.calls[0][0];
    expect(query).toContain('SELECT DISTINCT');
    expect(query).toContain('mergeTreeIndex(');
    // ORDER BY would have to finish before the first row, killing streaming.
    expect(query).not.toContain('ORDER BY');
    expect(format).toBe('JSONEachRow');
  });

  it('prunes to overlapping parts when given a date range', async () => {
    const metadata = buildMetadata();
    mockQuery.mockResolvedValue(resultSetOf([]));

    await drain(
      metadata.streamDistinctIndexValues({
        ...ARGS,
        dateRange: [new Date('2026-08-01'), new Date('2026-08-02')],
        timestampValueExpression: 'TimeUnix',
      }),
    );

    expect(mockQuery.mock.calls[0][0].query).toContain('part_name IN');
  });

  it('skips part pruning when the partition key is not time-based', async () => {
    // ClickHouse leaves system.parts.min_time at the epoch unless the partition
    // key derives from a time column, so the overlap predicate would exclude
    // every part and return an empty list without failing.
    const metadata = buildMetadata({
      tableMetadata: {
        ...GAUGE_TABLE_METADATA,
        partition_key: 'ServiceName',
      } as TableMetadata,
    });
    mockQuery.mockResolvedValue(resultSetOf([]));

    await drain(
      metadata.streamDistinctIndexValues({
        ...ARGS,
        dateRange: [new Date('2026-08-01'), new Date('2026-08-02')],
        timestampValueExpression: 'TimeUnix',
      }),
    );

    expect(mockQuery.mock.calls[0][0].query).not.toContain('part_name IN');
  });

  it('prunes by part when the partition key derives from the timestamp', async () => {
    const metadata = buildMetadata({
      tableMetadata: {
        ...GAUGE_TABLE_METADATA,
        partition_key: 'toDate(TimeUnix)',
      } as TableMetadata,
    });
    mockQuery.mockResolvedValue(resultSetOf([]));

    await drain(
      metadata.streamDistinctIndexValues({
        ...ARGS,
        dateRange: [new Date('2026-08-01'), new Date('2026-08-02')],
        timestampValueExpression: 'TimeUnix',
      }),
    );

    expect(mockQuery.mock.calls[0][0].query).toContain('part_name IN');
  });

  it('drops empty and non-string values', async () => {
    const metadata = buildMetadata();
    mockQuery.mockResolvedValue(
      resultSetOf([[{ value: 'ok' }, { value: '' }, { value: null }]]),
    );

    expect(await drain(metadata.streamDistinctIndexValues(ARGS))).toEqual([
      ['ok'],
    ]);
  });

  it('skips chunks that are empty after filtering instead of yielding []', async () => {
    const metadata = buildMetadata();
    mockQuery.mockResolvedValue(
      resultSetOf([[{ value: '' }], [{ value: 'ok' }]]),
    );

    expect(await drain(metadata.streamDistinctIndexValues(ARGS))).toEqual([
      ['ok'],
    ]);
  });

  describe('unsupported tables', () => {
    it('rejects a server without the mergeTreeIndex table function', async () => {
      const metadata = buildMetadata({ version: [24, 1, 0, 0] });

      await expect(
        drain(metadata.streamDistinctIndexValues(ARGS)),
      ).rejects.toThrow(/predates the mergeTreeIndex table function/);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('rejects a Distributed table, which has no index of its own', async () => {
      const metadata = buildMetadata({
        tableMetadata: {
          ...GAUGE_TABLE_METADATA,
          engine: 'Distributed',
          isPointerTable: true,
        } as TableMetadata,
      });

      await expect(
        drain(metadata.streamDistinctIndexValues(ARGS)),
      ).rejects.toThrow(/no primary index of their own/);
    });

    it('rejects a non-MergeTree engine', async () => {
      const metadata = buildMetadata({
        tableMetadata: {
          ...GAUGE_TABLE_METADATA,
          engine: 'Log',
        } as TableMetadata,
      });

      await expect(
        drain(metadata.streamDistinctIndexValues(ARGS)),
      ).rejects.toThrow(/not a MergeTree/);
    });

    it('rejects a column outside the primary key', async () => {
      const metadata = buildMetadata();

      await expect(
        drain(
          metadata.streamDistinctIndexValues({ ...ARGS, column: 'MetricUnit' }),
        ),
      ).rejects.toThrow(/not in the primary key/);
    });

    it('accepts a primary key column wrapped in backticks', async () => {
      const metadata = buildMetadata({
        tableMetadata: {
          ...GAUGE_TABLE_METADATA,
          primary_key: '`ServiceName`, `MetricName`',
        } as TableMetadata,
      });
      mockQuery.mockResolvedValue(resultSetOf([[{ value: 'ok' }]]));

      expect(await drain(metadata.streamDistinctIndexValues(ARGS))).toEqual([
        ['ok'],
      ]);
    });

    it('does not mistake a column nested in a key expression for a top-level one', async () => {
      const metadata = buildMetadata({
        tableMetadata: {
          ...GAUGE_TABLE_METADATA,
          // TimeUnix only appears nested, so it is not an index column.
          primary_key: 'ServiceName, toStartOfHour(TimeUnix)',
        } as TableMetadata,
      });

      await expect(
        drain(
          metadata.streamDistinctIndexValues({ ...ARGS, column: 'TimeUnix' }),
        ),
      ).rejects.toThrow(/not in the primary key/);
    });
  });
});
