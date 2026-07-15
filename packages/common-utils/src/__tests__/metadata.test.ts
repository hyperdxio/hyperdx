import { ClickhouseClient } from '@/clickhouse/node';
import { Metadata, MetadataCache, parseKeyPath } from '@/core/metadata';
import * as renderChartConfigModule from '@/core/renderChartConfig';
import { timeFilterExpr } from '@/core/renderChartConfig';
import { isBuilderChartConfig } from '@/guards';
import { BuilderChartConfigWithDateRange, SourceKind, TSource } from '@/types';

// Mock ClickhouseClient
const mockClickhouseClient = {
  query: jest.fn(),
} as unknown as ClickhouseClient;

const mockCache = {
  get: jest.fn(),
  getOrFetch: jest.fn(),
  set: jest.fn(),
} as any;

jest.mock('../core/renderChartConfig', () => ({
  renderChartConfig: jest
    .fn()
    .mockResolvedValue({ sql: 'SELECT 1', params: {} }),
  timeFilterExpr: jest
    .fn()
    .mockResolvedValue({ sql: '__TIME_FILTER__', params: {} }),
}));

const source: TSource = {
  id: 'test-source',
  name: 'Test',
  kind: SourceKind.Log,
  connection: 'conn-1',
  from: { databaseName: 'default', tableName: 'logs' },
  timestampValueExpression: 'Timestamp',
  defaultTableSelectExpression: '*',
  querySettings: [
    { setting: 'optimize_read_in_order', value: '0' },
    { setting: 'cast_keep_nullable', value: '0' },
  ],
};

// Suppress expected console.warn/error noise from permission checks,
// distributed table fallbacks, and column parsing edge cases
beforeAll(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => {
  jest.restoreAllMocks();
});

describe('MetadataCache', () => {
  let metadataCache: MetadataCache;

  beforeEach(() => {
    metadataCache = new MetadataCache();
    jest.clearAllMocks();
  });

  describe('getOrFetch', () => {
    it('should return cached value if it exists', async () => {
      const key = 'test-key';
      const value = { data: 'test-data' };

      // Set a value in the cache
      metadataCache.set(key, value);

      // Mock query function that should not be called
      const queryFn = jest.fn().mockResolvedValue('new-value');

      const result = await metadataCache.getOrFetch(key, queryFn);

      expect(result).toBe(value);
      expect(queryFn).not.toHaveBeenCalled();
    });

    it('should call query function and store result if no cached value exists', async () => {
      const key = 'test-key';
      const expectedValue = { data: 'fetched-data' };
      const queryFn = jest.fn().mockResolvedValue(expectedValue);

      const result = await metadataCache.getOrFetch(key, queryFn);

      expect(result).toBe(expectedValue);
      expect(queryFn).toHaveBeenCalledTimes(1);
      expect(metadataCache.get(key)).toBe(expectedValue);
    });

    it('should reuse pending promises for the same key', async () => {
      const key = 'test-key';
      let resolvePromise: (value: any) => void;

      // Create a promise that we can control when it resolves
      const pendingPromise = new Promise(resolve => {
        resolvePromise = resolve;
      });

      const queryFn = jest.fn().mockReturnValue(pendingPromise);

      // Start two requests for the same key
      const promise1 = metadataCache.getOrFetch(key, queryFn);
      const promise2 = metadataCache.getOrFetch(key, queryFn);

      // The query function should only be called once
      expect(queryFn).toHaveBeenCalledTimes(1);

      // Now resolve the promise
      resolvePromise!({ data: 'result' });

      // Both promises should resolve to the same value
      const result1 = await promise1;
      const result2 = await promise2;

      expect(result1).toEqual({ data: 'result' });
      expect(result2).toEqual({ data: 'result' });
      expect(result1).toBe(result2); // Should be the same object reference
    });

    it('should clean up pending promise after resolution', async () => {
      const key = 'test-key';
      const value = { data: 'test-data' };
      const queryFn = jest.fn().mockResolvedValue(value);

      // Access the private pendingQueries map using any type assertion
      const pendingQueriesMap = (metadataCache as any).pendingQueries;

      await metadataCache.getOrFetch(key, queryFn);

      // After resolution, the pending query should be removed from the map
      expect(pendingQueriesMap.has(key)).toBe(false);
    });

    it('should clean up pending promise after rejection', async () => {
      const key = 'test-key';
      const error = new Error('Query failed');
      const queryFn = jest.fn().mockRejectedValue(error);

      // Access the private pendingQueries map using any type assertion
      const pendingQueriesMap = (metadataCache as any).pendingQueries;

      try {
        await metadataCache.getOrFetch(key, queryFn);
      } catch {
        // Expected to throw
      }

      // After rejection, the pending query should be removed from the map
      expect(pendingQueriesMap.has(key)).toBe(false);
      // And no value should be stored in the cache
      expect(metadataCache.get(key)).toBeUndefined();
    });
  });
});

describe('Metadata', () => {
  let metadata: Metadata;

  beforeEach(() => {
    metadata = new Metadata(mockClickhouseClient, mockCache);
    jest.clearAllMocks();
  });

  describe('getTableMetadata', () => {
    beforeEach(() => {
      mockCache.getOrFetch.mockImplementation((key, queryFn) => queryFn());
    });

    it('should normalize partition_key format by removing parentheses', async () => {
      const mockTableMetadata = {
        database: 'test_db',
        name: 'test_table',
        partition_key: '(toYYYYMM(timestamp), user_id)',
        sorting_key: 'column2',
        primary_key: 'column3',
      };

      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: [mockTableMetadata],
        }),
      });

      const result = await metadata.getTableMetadata({
        databaseName: 'test_db',
        tableName: 'test_table',
        connectionId: 'test_connection',
      });

      expect(result!.partition_key).toEqual('toYYYYMM(timestamp), user_id');
    });

    it('should not modify partition_key if it does not have parentheses', async () => {
      const mockTableMetadata = {
        database: 'test_db',
        name: 'test_table',
        partition_key: 'column1',
        sorting_key: 'column2',
        primary_key: 'column3',
      };

      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: [mockTableMetadata],
        }),
      });

      const result = await metadata.getTableMetadata({
        databaseName: 'test_db',
        tableName: 'test_table',
        connectionId: 'test_connection',
      });

      expect(result!.partition_key).toEqual('column1');
    });

    it('does not set isPointerTable for tables that hold their own data', async () => {
      const mockTableMetadata = {
        database: 'test_db',
        name: 'test_table',
        engine: 'MergeTree',
        engine_full: 'MergeTree() ORDER BY id',
        partition_key: 'column1',
        sorting_key: 'column2',
        primary_key: 'column3',
      };

      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: [mockTableMetadata],
        }),
      });

      const result = await metadata.getTableMetadata({
        databaseName: 'test_db',
        tableName: 'test_table',
        connectionId: 'test_connection',
      });

      expect(result!.isPointerTable).toBeFalsy();
    });

    it('sets isPointerTable for a Merge table', async () => {
      const mockTableMetadata = {
        database: 'test_db',
        name: 'merge_table',
        engine: 'Merge',
        engine_full: "Merge('test_db', '^events_')",
        partition_key: '',
        sorting_key: '',
        primary_key: '',
      };

      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: [mockTableMetadata],
        }),
      });

      const result = await metadata.getTableMetadata({
        databaseName: 'test_db',
        tableName: 'merge_table',
        connectionId: 'test_connection',
      });

      expect(result!.isPointerTable).toBe(true);
    });

    it('should query via cluster() for Distributed table underlying metadata', async () => {
      const distributedMetadata = {
        database: 'test_db',
        name: 'dist_table',
        engine: 'Distributed',
        engine_full:
          "Distributed('my_cluster', 'test_db', 'local_table', rand())",
        partition_key: '',
        sorting_key: '',
        primary_key: '',
        sampling_key: '',
        create_table_query: 'CREATE TABLE test_db.dist_table ...',
      };

      const localMetadata = {
        database: 'test_db',
        name: 'local_table',
        engine: 'MergeTree',
        engine_full: 'MergeTree() ORDER BY id',
        partition_key: 'toYYYYMM(timestamp)',
        sorting_key: 'id, timestamp',
        primary_key: 'id',
        sampling_key: '',
        create_table_query: 'CREATE TABLE test_db.local_table ...',
      };

      let callCount = 0;
      (mockClickhouseClient.query as jest.Mock).mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          json: jest.fn().mockResolvedValue({
            data: [callCount === 1 ? distributedMetadata : localMetadata],
          }),
        });
      });

      const result = await metadata.getTableMetadata({
        databaseName: 'test_db',
        tableName: 'dist_table',
        connectionId: 'test_connection',
      });

      // Two queries: one for the distributed table, one via cluster() for the local table
      expect(callCount).toBe(2);
      expect(result!.engine).toBe('MergeTree');
      expect(result!.sorting_key).toBe('id, timestamp');
      expect(result!.create_local_table_query).toBe(
        'CREATE TABLE test_db.local_table ...',
      );
      // The second query should use cluster() - verify it references system.tables via cluster
      const secondQuery = (mockClickhouseClient.query as jest.Mock).mock
        .calls[1][0].query;
      expect(secondQuery).toContain('cluster(');
      expect(secondQuery).toContain('system.tables');
    });

    it('should use the cache when retrieving table metadata', async () => {
      // Setup the mock implementation
      mockCache.getOrFetch.mockReset();

      const mockTableMetadata = {
        database: 'test_db',
        name: 'test_table',
        partition_key: 'column1',
        sorting_key: 'column2',
        primary_key: 'column3',
      };

      // Setup the cache to return the mock data
      mockCache.getOrFetch.mockImplementation((key, queryFn) => {
        if (key === 'test_connection.test_db.test_table.undefined.metadata') {
          return Promise.resolve(mockTableMetadata);
        }
        return queryFn();
      });

      const result = await metadata.getTableMetadata({
        databaseName: 'test_db',
        tableName: 'test_table',
        connectionId: 'test_connection',
      });

      // Verify the cache was called with the right key
      expect(mockCache.getOrFetch).toHaveBeenCalledWith(
        'test_connection.test_db.test_table.undefined.metadata',
        expect.any(Function),
      );

      // Verify the mockClickhouseClient.query wasn't called since we're using cached data
      expect(mockClickhouseClient.query).not.toHaveBeenCalled();

      // Verify we still get the correct result
      expect(result).toEqual(mockTableMetadata);
    });
  });

  describe('isClickHouseCloud', () => {
    beforeEach(() => {
      mockCache.getOrFetch.mockImplementation((key, queryFn) => queryFn());
    });

    it('returns true when SharedMergeTree is registered in system.table_engines', async () => {
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: [{ is_cloud: true }],
        }),
      });

      const result = await metadata.isClickHouseCloud({
        connectionId: 'test_connection',
      });

      expect(result).toBe(true);
    });

    it('returns false when SharedMergeTree is absent from system.table_engines', async () => {
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: [],
        }),
      });

      const result = await metadata.isClickHouseCloud({
        connectionId: 'test_connection',
      });

      expect(result).toBe(false);
    });

    it('re-probes after a transient failure instead of caching false', async () => {
      const realCache = new MetadataCache();
      const realMetadata = new Metadata(mockClickhouseClient, realCache);

      (mockClickhouseClient.query as jest.Mock)
        .mockRejectedValueOnce(new Error('connection refused'))
        .mockResolvedValueOnce({
          json: jest.fn().mockResolvedValue({ data: [{ is_cloud: true }] }),
        });

      const first = await realMetadata.isClickHouseCloud({
        connectionId: 'test_connection',
      });
      expect(first).toBe(false);

      const second = await realMetadata.isClickHouseCloud({
        connectionId: 'test_connection',
      });
      expect(second).toBe(true);

      expect(mockClickhouseClient.query).toHaveBeenCalledTimes(2);
    });

    it('caches a successful negative result and does not re-query', async () => {
      const realCache = new MetadataCache();
      const realMetadata = new Metadata(mockClickhouseClient, realCache);

      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({ data: [] }),
      });

      const first = await realMetadata.isClickHouseCloud({
        connectionId: 'test_connection',
      });
      const second = await realMetadata.isClickHouseCloud({
        connectionId: 'test_connection',
      });

      expect(first).toBe(false);
      expect(second).toBe(false);
      expect(mockClickhouseClient.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSkipIndices', () => {
    beforeEach(() => {
      mockCache.getOrFetch.mockImplementation((key, queryFn) => queryFn());
    });

    it('should query via cluster() for Distributed table skip indices', async () => {
      const distributedMetadata = {
        database: 'test_db',
        name: 'dist_table',
        engine: 'Distributed',
        engine_full:
          "Distributed('my_cluster', 'test_db', 'local_table', rand())",
        create_table_query: 'CREATE TABLE test_db.dist_table ...',
      };

      const skipIndicesData = [
        {
          name: 'idx_body',
          type: 'tokenbf_v1',
          typeFull: "tokenbf_v1(tokenizer='splitByNonAlpha')",
          expression: 'tokens(lower(Body))',
          granularity: '1',
        },
      ];

      let callCount = 0;
      (mockClickhouseClient.query as jest.Mock).mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          json: jest.fn().mockResolvedValue({
            data: callCount === 1 ? [distributedMetadata] : skipIndicesData,
          }),
        });
      });

      const result = await metadata.getSkipIndices({
        databaseName: 'test_db',
        tableName: 'dist_table',
        connectionId: 'test_connection',
      });

      // Two queries: one for table metadata, one via cluster() for skip indices
      expect(callCount).toBe(2);
      expect(result).toEqual([
        {
          name: 'idx_body',
          type: 'tokenbf_v1',
          typeFull: "tokenbf_v1(tokenizer='splitByNonAlpha')",
          expression: 'tokens(lower(Body))',
          granularity: 1,
        },
      ]);
      // The second query should use cluster() for system.data_skipping_indices
      const secondQuery = (mockClickhouseClient.query as jest.Mock).mock
        .calls[1][0].query;
      expect(secondQuery).toContain('cluster(');
      expect(secondQuery).toContain('system.data_skipping_indices');
    });

    it('should query local system.data_skipping_indices for non-Distributed tables', async () => {
      const mergeTreeMetadata = {
        database: 'test_db',
        name: 'local_table',
        engine: 'MergeTree',
        engine_full: 'MergeTree() ORDER BY id',
      };

      const skipIndicesData = [
        {
          name: 'idx_body',
          type: 'tokenbf_v1',
          typeFull: "tokenbf_v1(tokenizer='splitByNonAlpha')",
          expression: 'tokens(lower(Body))',
          granularity: '1',
        },
      ];

      let callCount = 0;
      (mockClickhouseClient.query as jest.Mock).mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          json: jest.fn().mockResolvedValue({
            data: callCount === 1 ? [mergeTreeMetadata] : skipIndicesData,
          }),
        });
      });

      const result = await metadata.getSkipIndices({
        databaseName: 'test_db',
        tableName: 'local_table',
        connectionId: 'test_connection',
      });

      expect(callCount).toBe(2);
      expect(result).toEqual([
        {
          name: 'idx_body',
          type: 'tokenbf_v1',
          typeFull: "tokenbf_v1(tokenizer='splitByNonAlpha')",
          expression: 'tokens(lower(Body))',
          granularity: 1,
        },
      ]);
      // Should NOT use cluster() for non-Distributed tables
      const secondQuery = (mockClickhouseClient.query as jest.Mock).mock
        .calls[1][0].query;
      expect(secondQuery).not.toContain('cluster(');
      expect(secondQuery).toContain('system.data_skipping_indices');
    });
  });

  describe('getKeyValues', () => {
    const mockChartConfig: BuilderChartConfigWithDateRange = {
      from: {
        databaseName: 'test_db',
        tableName: 'test_table',
      },
      select: '',
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: '',
      connection: 'test_connection',
      dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
    };

    beforeEach(() => {
      // Mock the renderChartConfig result
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: () =>
          Promise.resolve({
            data: [
              {
                param0: ['value1', 'value2'],
                param1: ['type1', 'type2'],
              },
            ],
          }),
      });
    });

    it('should apply row limit when disableRowLimit is false', async () => {
      await metadata.getKeyValues({
        chartConfig: mockChartConfig,
        keys: ['column1', 'column2'],
        limit: 10,
        disableRowLimit: false,
        source,
      });

      expect(mockClickhouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          clickhouse_settings: {
            max_rows_to_read: '0',
            timeout_overflow_mode: 'break',
            max_execution_time: 15,
          },
        }),
      );
    });

    it('should not apply row limit when disableRowLimit is true', async () => {
      await metadata.getKeyValues({
        chartConfig: mockChartConfig,
        keys: ['column1', 'column2'],
        limit: 10,
        disableRowLimit: true,
        source,
      });

      expect(mockClickhouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          clickhouse_settings: undefined,
        }),
      );
    });

    it('should apply row limit by default when disableRowLimit is not specified', async () => {
      await metadata.getKeyValues({
        chartConfig: mockChartConfig,
        keys: ['column1', 'column2'],
        limit: 10,
        source,
      });

      expect(mockClickhouseClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          clickhouse_settings: {
            max_rows_to_read: '0',
            timeout_overflow_mode: 'break',
            max_execution_time: 15,
          },
        }),
      );
    });

    it('should correctly transform the response data', async () => {
      const result = await metadata.getKeyValues({
        chartConfig: mockChartConfig,
        keys: ['column1', 'column2'],
        limit: 10,
        source,
      });

      expect(result).toEqual([
        { key: 'column1', value: ['value1', 'value2'] },
        { key: 'column2', value: ['type1', 'type2'] },
      ]);
    });

    it('should filter out empty and nullish values from the response', async () => {
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: () =>
          Promise.resolve({
            data: [
              {
                param0: ['value1', null, '', 'value2', undefined, 0, 10],
              },
            ],
          }),
      });

      const result = await metadata.getKeyValues({
        chartConfig: mockChartConfig,
        keys: ['column1'],
        limit: 10,
        source,
      });

      expect(result).toEqual([
        { key: 'column1', value: ['value1', 'value2', 0, 10] },
      ]);
    });

    it('should return an empty list when no keys are provided', async () => {
      const renderChartConfigSpy = jest.spyOn(
        renderChartConfigModule,
        'renderChartConfig',
      );

      const results = await metadata.getKeyValues({
        chartConfig: mockChartConfig,
        keys: [],
        limit: 10,
        source,
      });

      expect(results).toEqual([]);
      expect(renderChartConfigSpy).not.toHaveBeenCalled();
    });

    it('renders JSON attribute keys as typed subcolumns', async () => {
      jest.spyOn(metadata, 'getColumn').mockImplementation(({ column }) =>
        Promise.resolve(
          column === 'ResourceAttributes'
            ? ({
                name: 'ResourceAttributes',
                type: 'JSON(max_dynamic_types=8, max_dynamic_paths=64)',
              } as any)
            : undefined,
        ),
      );
      const renderChartConfigSpy = jest.spyOn(
        renderChartConfigModule,
        'renderChartConfig',
      );

      await metadata.getKeyValues({
        chartConfig: mockChartConfig,
        keys: ["ResourceAttributes['k8s.namespace.name']"],
        limit: 10,
        source,
      });

      const actualConfig = renderChartConfigSpy.mock.calls[0][0];
      if (!isBuilderChartConfig(actualConfig))
        throw new Error('Expected builder config');
      expect(actualConfig.with?.[0]).toMatchObject({
        chartConfig: {
          select:
            'ResourceAttributes.`k8s`.`namespace`.`name`.:String as param0',
        },
      });
    });

    it('quotes typed-looking bracket JSON keys instead of passing them through', async () => {
      jest.spyOn(metadata, 'getColumn').mockImplementation(({ column }) =>
        Promise.resolve(
          column === 'ResourceAttributes'
            ? ({
                name: 'ResourceAttributes',
                type: 'JSON(max_dynamic_types=8, max_dynamic_paths=64)',
              } as any)
            : undefined,
        ),
      );
      const renderChartConfigSpy = jest.spyOn(
        renderChartConfigModule,
        'renderChartConfig',
      );

      await metadata.getKeyValues({
        chartConfig: mockChartConfig,
        keys: ["ResourceAttributes['foo.:String, count() AS injected']"],
        limit: 10,
        source,
      });

      const actualConfig = renderChartConfigSpy.mock.calls[0][0];
      if (!isBuilderChartConfig(actualConfig))
        throw new Error('Expected builder config');
      expect(actualConfig.with?.[0]).toMatchObject({
        chartConfig: {
          select:
            'ResourceAttributes.`foo`.`:String, count() AS injected`.:String as param0',
        },
      });
    });

    it('keeps map attribute keys in bracket form', async () => {
      jest.spyOn(metadata, 'getColumn').mockImplementation(({ column }) =>
        Promise.resolve(
          column === 'LogAttributes'
            ? ({
                name: 'LogAttributes',
                type: 'Map(LowCardinality(String), String)',
              } as any)
            : undefined,
        ),
      );
      const renderChartConfigSpy = jest.spyOn(
        renderChartConfigModule,
        'renderChartConfig',
      );

      await metadata.getKeyValues({
        chartConfig: mockChartConfig,
        keys: ["LogAttributes['k8s.namespace.name']"],
        limit: 10,
        source,
      });

      const actualConfig = renderChartConfigSpy.mock.calls[0][0];
      if (!isBuilderChartConfig(actualConfig))
        throw new Error('Expected builder config');
      expect(actualConfig.with?.[0]).toMatchObject({
        chartConfig: {
          select: "LogAttributes['k8s.namespace.name'] as param0",
        },
      });
    });
  });

  // Each of the four fetch strategies emits a distinct SQL shape (map-text-
  // index, native-text-index, metadata-MV, raw-table). We assert against
  // those shapes rather than exposing the private methods.
  describe('getAllKeyValues (router)', () => {
    const dateRange: [Date, Date] = [
      new Date('2024-01-01'),
      new Date('2024-01-02'),
    ];
    const baseArgs = {
      databaseName: 'default',
      tableName: 'otel_logs',
      connectionId: 'test_connection',
      dateRange,
      timestampValueExpression: 'Timestamp',
      metadataMVs: {
        keyRollupTable: 'otel_logs_key_rollup_15m',
        kvRollupTable: 'otel_logs_kv_rollup_15m',
        granularity: '15 minute' as const,
      },
    };

    const setupDefaultLogsSchema = () => {
      mockCache.getOrFetch.mockImplementation((_key: string, fn: () => any) =>
        fn(),
      );
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: () => Promise.resolve({ data: [{}] }),
      });

      jest.spyOn(metadata, 'getColumns').mockResolvedValue([
        { name: 'Timestamp', type: 'DateTime64(9)' },
        { name: 'TraceId', type: 'String' },
        { name: 'SpanId', type: 'String' },
        { name: 'ServiceName', type: 'LowCardinality(String)' },
        { name: 'SeverityText', type: 'LowCardinality(String)' },
        { name: 'Body', type: 'String' },
        { name: 'LogAttributes', type: 'Map(LowCardinality(String), String)' },
        {
          name: 'ResourceAttributes',
          type: 'Map(LowCardinality(String), String)',
        },
      ] as any);

      jest.spyOn(metadata, 'getMapColumnTextIndexes').mockResolvedValue(
        new Map([
          [
            'LogAttributes',
            {
              kv: {
                columnName: 'LogAttributes',
                mapColumn: 'LogAttributes',
                indexName: 'idx_log_attr_items',
                separator: '=',
                useHasAny: false,
              },
            },
          ],
        ]) as any,
      );

      jest.spyOn(metadata, 'getNativeArrayColumnTextIndexes').mockResolvedValue(
        new Map([
          [
            'TraceId',
            {
              name: 'idx_trace_id',
              type: 'text',
              typeFull: "text(tokenizer = 'array')",
              expression: 'TraceId',
              granularity: 1,
            },
          ],
        ]),
      );

      jest
        .spyOn(metadata as any, 'doMetadataMVsAggregateColumn')
        .mockImplementation((...args: any[]) => {
          const columnName = args[1] as string;
          return Promise.resolve(
            columnName === 'ServiceName' || columnName === 'SeverityText',
          );
        });
    };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('routes TraceId through getTextIndexKeyValues (native text index path)', async () => {
      setupDefaultLogsSchema();

      await metadata.getAllKeyValues({
        ...baseArgs,
        keyExpressions: ['TraceId'],
      });

      const calls = (mockClickhouseClient.query as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const sql = calls[calls.length - 1][0].query as string;

      expect(sql).toContain('mergeTreeTextIndex(');
      expect(sql).toContain('groupUniqArray(');
      expect(sql).toContain('GROUP BY key');
      expect(sql).not.toContain('startsWith(token,');
    });

    it("routes LogAttributes['requestId'] through getMapTextIndexKeyValues (map KV text index path)", async () => {
      setupDefaultLogsSchema();

      await metadata.getAllKeyValues({
        ...baseArgs,
        keyExpressions: ["LogAttributes['requestId']"],
      });

      const calls = (mockClickhouseClient.query as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const sql = calls[calls.length - 1][0].query as string;

      expect(sql).toContain('mergeTreeTextIndex(');
      expect(sql).toContain('startsWith(token,');
      expect(sql).toContain('substring(token, position(token,');
      expect(sql).toContain('GROUP BY column, key');
    });

    it('routes ServiceName and SeverityText through getMetadataMVKeyValues (KV rollup MV path)', async () => {
      setupDefaultLogsSchema();

      await metadata.getAllKeyValues({
        ...baseArgs,
        keyExpressions: ['ServiceName', 'SeverityText'],
      });

      const calls = (mockClickhouseClient.query as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1][0];
      const sql = lastCall.query as string;
      const params = lastCall.query_params as Record<string, string>;

      expect(sql).toContain('ColumnIdentifier = ');
      expect(sql).toContain('Key IN (');
      expect(sql).toContain('BY ColumnIdentifier, Key');
      expect(sql).not.toContain('mergeTreeTextIndex(');
      expect(Object.values(params)).toContain('otel_logs_kv_rollup_15m');
      expect(Object.values(params)).toContain('ServiceName');
      expect(Object.values(params)).toContain('SeverityText');
    });

    it('routes columns without any index or MV entry through the getKeyValues fallback (raw table scan)', async () => {
      setupDefaultLogsSchema();
      const renderChartConfigSpy = jest.spyOn(
        renderChartConfigModule,
        'renderChartConfig',
      );

      await metadata.getAllKeyValues({
        ...baseArgs,
        keyExpressions: ['Body'],
      });

      expect(renderChartConfigSpy).toHaveBeenCalled();
      const configArg = renderChartConfigSpy.mock.calls[
        renderChartConfigSpy.mock.calls.length - 1
      ][0] as any;
      expect(configArg.select).toContain('groupUniqArray(');
      expect(configArg.select).toContain('param0');
    });

    it('fans out across all four fetch paths in a single mixed call', async () => {
      setupDefaultLogsSchema();
      const renderChartConfigSpy = jest.spyOn(
        renderChartConfigModule,
        'renderChartConfig',
      );

      await metadata.getAllKeyValues({
        ...baseArgs,
        keyExpressions: [
          'TraceId',
          'ServiceName',
          "LogAttributes['requestId']",
          'Body',
        ],
      });

      const queries = (mockClickhouseClient.query as jest.Mock).mock.calls.map(
        (c: any[]) => c[0].query as string,
      );

      expect(
        queries.some(
          (s: string) =>
            s.includes('mergeTreeTextIndex(') &&
            s.includes('startsWith(token,'),
        ),
      ).toBe(true);
      expect(
        queries.some(
          (s: string) =>
            s.includes('mergeTreeTextIndex(') &&
            !s.includes('startsWith(token,'),
        ),
      ).toBe(true);
      const paramValues = (
        mockClickhouseClient.query as jest.Mock
      ).mock.calls.flatMap((c: any[]) =>
        Object.values(c[0].query_params ?? {}),
      );
      expect(paramValues).toContain('otel_logs_kv_rollup_15m');
      expect(renderChartConfigSpy).toHaveBeenCalled();
    });

    it('returns [] immediately when keyExpressions is empty', async () => {
      setupDefaultLogsSchema();

      const result = await metadata.getAllKeyValues({
        ...baseArgs,
        keyExpressions: [],
      });

      expect(result).toEqual([]);
      expect(mockClickhouseClient.query).not.toHaveBeenCalled();
    });

    it('skips the Timestamp column when discovering strategies', async () => {
      setupDefaultLogsSchema();
      const renderChartConfigSpy = jest.spyOn(
        renderChartConfigModule,
        'renderChartConfig',
      );

      await metadata.getAllKeyValues({
        ...baseArgs,
        keyExpressions: ['Timestamp'],
      });

      expect(mockClickhouseClient.query).not.toHaveBeenCalled();
      expect(renderChartConfigSpy).not.toHaveBeenCalled();
    });

    // Without metadataMVs, ServiceName must remain servable via the raw
    // table scan. Regression guard for commit 612bb2f9a which removed the
    // recommended key/map MV branches from default log/trace rollup schemas.
    it('falls back to raw table scan when metadataMVs is undefined', async () => {
      setupDefaultLogsSchema();
      const renderChartConfigSpy = jest.spyOn(
        renderChartConfigModule,
        'renderChartConfig',
      );

      await metadata.getAllKeyValues({
        ...baseArgs,
        metadataMVs: undefined,
        keyExpressions: ['ServiceName'],
      });

      expect(renderChartConfigSpy).toHaveBeenCalled();
      const configArg = renderChartConfigSpy.mock.calls[
        renderChartConfigSpy.mock.calls.length - 1
      ][0] as any;
      expect(configArg.select).toContain('groupUniqArray(');
    });

    it('routes ResourceAttributes["k8s.pod.name"] to the raw table when its map has no KV text index', async () => {
      setupDefaultLogsSchema();
      const renderChartConfigSpy = jest.spyOn(
        renderChartConfigModule,
        'renderChartConfig',
      );

      await metadata.getAllKeyValues({
        ...baseArgs,
        keyExpressions: ["ResourceAttributes['k8s.pod.name']"],
      });

      expect(renderChartConfigSpy).toHaveBeenCalled();
      const configArg = renderChartConfigSpy.mock.calls[
        renderChartConfigSpy.mock.calls.length - 1
      ][0] as any;
      expect(configArg.select).toContain('groupUniqArray(');
      expect(configArg.select).toContain('param0');
    });

    // Guards against HTTP 431 from too many URL-encoded query_params. Passes
    // more keys than the private GET_ALL_KEY_VALUES_CHUNK_SIZE (currently 40)
    // so the recursion has to fire at least two chunks; if someone removes
    // the chunking this test flags it before the ClickHouse HTTP request
    // goes over the wire. Bump the key count if that constant ever exceeds 49.
    it('splits keyExpressions into multiple ClickHouse queries when count exceeds the internal chunk size', async () => {
      setupDefaultLogsSchema();

      const keyExpressions = Array.from(
        { length: 50 },
        (_, i) => `LogAttributes['k${i}']`,
      );

      await metadata.getAllKeyValues({
        ...baseArgs,
        keyExpressions,
      });

      const mapTextIndexCalls = (
        mockClickhouseClient.query as jest.Mock
      ).mock.calls.filter(
        (c: any[]) =>
          typeof c[0].query === 'string' &&
          c[0].query.includes('startsWith(token,'),
      );

      expect(mapTextIndexCalls.length).toBeGreaterThanOrEqual(2);

      const allParamValues = mapTextIndexCalls.flatMap((c: any[]) =>
        Object.values(c[0].query_params ?? {}),
      );
      for (let i = 0; i < 50; i++) {
        expect(allParamValues).toContain(`k${i}=`);
      }
    });

    // Regression guard: prior to this fix, the text-index and raw-table
    // branches hardcoded `limit: 20`, silently capping `loadMoreFacetsForKey`
    // (which requests 10000 values) at 20. Only the MV branch honored
    // `maxValuesPerKey`, so "Load More" was a no-op for any column resolved
    // via text index or raw scan.
    describe('maxValuesPerKey threading', () => {
      // Pick a value that (a) isn't ambient in the test setup (like 20,
      // dates, or granularity numbers) and (b) is easy to spot in a param
      // dump when a test fails. Int32 chSql params render as numbers, so
      // assertions compare against the numeric literal.
      const MAX_VALUES = 7777;

      it('threads maxValuesPerKey into the map text-index query', async () => {
        setupDefaultLogsSchema();

        await metadata.getAllKeyValues({
          ...baseArgs,
          keyExpressions: ["LogAttributes['requestId']"],
          maxValuesPerKey: MAX_VALUES,
        });

        const mapTextIndexCall = (
          mockClickhouseClient.query as jest.Mock
        ).mock.calls.find(
          (c: any[]) =>
            typeof c[0].query === 'string' &&
            c[0].query.includes('startsWith(token,'),
        );
        expect(mapTextIndexCall).toBeDefined();
        const params = mapTextIndexCall![0].query_params as Record<
          string,
          unknown
        >;
        expect(Object.values(params)).toContain(MAX_VALUES);
      });

      it('threads maxValuesPerKey into the native text-index query', async () => {
        setupDefaultLogsSchema();

        await metadata.getAllKeyValues({
          ...baseArgs,
          keyExpressions: ['TraceId'],
          maxValuesPerKey: MAX_VALUES,
        });

        const nativeTextIndexCall = (
          mockClickhouseClient.query as jest.Mock
        ).mock.calls.find(
          (c: any[]) =>
            typeof c[0].query === 'string' &&
            c[0].query.includes('mergeTreeTextIndex(') &&
            !c[0].query.includes('startsWith(token,'),
        );
        expect(nativeTextIndexCall).toBeDefined();
        const params = nativeTextIndexCall![0].query_params as Record<
          string,
          unknown
        >;
        expect(Object.values(params)).toContain(MAX_VALUES);
      });

      it('threads maxValuesPerKey into the raw-table getKeyValues fallback', async () => {
        setupDefaultLogsSchema();
        const renderChartConfigSpy = jest.spyOn(
          renderChartConfigModule,
          'renderChartConfig',
        );

        await metadata.getAllKeyValues({
          ...baseArgs,
          keyExpressions: ['Body'],
          maxValuesPerKey: MAX_VALUES,
        });

        expect(renderChartConfigSpy).toHaveBeenCalled();
        const configArg = renderChartConfigSpy.mock.calls[
          renderChartConfigSpy.mock.calls.length - 1
        ][0] as any;
        expect(configArg.select).toContain(`groupUniqArray(${MAX_VALUES})`);
      });
    });

    // Text-index queries can fail transiently (e.g. an index part merged
    // between plan and read, or an older server that doesn't support
    // `mergeTreeTextIndex`). Prior to this fix, one rejection propagated
    // through `Promise.all` and wiped filter values for every column in
    // the batch — regardless of which strategy served each column.
    describe('text-index failure isolation', () => {
      // Match each strategy to the response shape its own parser expects.
      // Text-index returns rows like { key, value }; the MV rollup parses
      // { ColumnIdentifier, Key, Values } (see `getMetadataMVKeyValues`,
      // which maps NativeColumn rows back to { key: Key, value: Values }).
      // The raw-table fallback aliases columns as paramN and returns a single
      // row like { param0: [...], param1: [...] } (see `getKeyValues`).
      function mockQueryByStrategy(strategies: {
        onMapTextIndex?: () => Promise<any>;
        onNativeTextIndex?: () => Promise<any>;
        onMVRollup?: () => Promise<any>;
        onRawTable?: () => Promise<any>;
      }) {
        (mockClickhouseClient.query as jest.Mock).mockImplementation(
          ({ query }: any) => {
            const q = typeof query === 'string' ? query : '';
            if (q.includes('startsWith(token,')) {
              return (
                strategies.onMapTextIndex?.() ??
                Promise.resolve({ json: () => Promise.resolve({ data: [] }) })
              );
            }
            if (q.includes('mergeTreeTextIndex(')) {
              return (
                strategies.onNativeTextIndex?.() ??
                Promise.resolve({ json: () => Promise.resolve({ data: [] }) })
              );
            }
            if (q.includes('ColumnIdentifier =')) {
              return (
                strategies.onMVRollup?.() ??
                Promise.resolve({ json: () => Promise.resolve({ data: [] }) })
              );
            }
            if (q.includes('AS param')) {
              return (
                strategies.onRawTable?.() ??
                Promise.resolve({ json: () => Promise.resolve({ data: [] }) })
              );
            }
            return Promise.resolve({
              json: () => Promise.resolve({ data: [] }),
            });
          },
        );
      }

      it('returns results from other strategies when the native text-index query throws', async () => {
        setupDefaultLogsSchema();
        const consoleWarnSpy = jest
          .spyOn(console, 'warn')
          .mockImplementation(() => undefined);

        mockQueryByStrategy({
          onNativeTextIndex: () =>
            Promise.reject(new Error('text index unavailable')),
          onMVRollup: () =>
            Promise.resolve({
              json: () =>
                Promise.resolve({
                  data: [
                    {
                      ColumnIdentifier: 'NativeColumn',
                      Key: 'ServiceName',
                      Values: ['api', 'web'],
                      total_count: 42,
                    },
                  ],
                }),
            }),
        });

        const result = await metadata.getAllKeyValues({
          ...baseArgs,
          keyExpressions: ['TraceId', 'ServiceName'],
        });

        expect(result).toEqual([{ key: 'ServiceName', value: ['api', 'web'] }]);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('getTextIndexKeyValues failed'),
          expect.any(Error),
        );

        consoleWarnSpy.mockRestore();
      });

      it('returns results from other strategies when the map text-index query throws', async () => {
        setupDefaultLogsSchema();
        const consoleWarnSpy = jest
          .spyOn(console, 'warn')
          .mockImplementation(() => undefined);

        mockQueryByStrategy({
          onMapTextIndex: () =>
            Promise.reject(new Error('map text index unavailable')),
          onMVRollup: () =>
            Promise.resolve({
              json: () =>
                Promise.resolve({
                  data: [
                    {
                      ColumnIdentifier: 'NativeColumn',
                      Key: 'ServiceName',
                      Values: ['api'],
                      total_count: 7,
                    },
                  ],
                }),
            }),
        });

        const result = await metadata.getAllKeyValues({
          ...baseArgs,
          keyExpressions: ["LogAttributes['requestId']", 'ServiceName'],
        });

        expect(result).toEqual([{ key: 'ServiceName', value: ['api'] }]);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('getMapTextIndexKeyValues failed'),
          expect.any(Error),
        );

        consoleWarnSpy.mockRestore();
      });

      it('returns results from other strategies when the raw-table getKeyValues fallback throws', async () => {
        setupDefaultLogsSchema();
        const consoleWarnSpy = jest
          .spyOn(console, 'warn')
          .mockImplementation(() => undefined);

        mockQueryByStrategy({
          onRawTable: () =>
            Promise.reject(new Error('raw table query timed out')),
          onMVRollup: () =>
            Promise.resolve({
              json: () =>
                Promise.resolve({
                  data: [
                    {
                      ColumnIdentifier: 'NativeColumn',
                      Key: 'ServiceName',
                      Values: ['api', 'web'],
                      total_count: 42,
                    },
                  ],
                }),
            }),
        });

        const result = await metadata.getAllKeyValues({
          ...baseArgs,
          keyExpressions: ['Body', 'ServiceName'],
        });

        expect(result).toEqual([{ key: 'ServiceName', value: ['api', 'web'] }]);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('getKeyValues (raw table) failed'),
          expect.any(Error),
        );

        consoleWarnSpy.mockRestore();
      });
    });
  });

  describe('getValuesDistribution', () => {
    const mockChartConfig: BuilderChartConfigWithDateRange = {
      from: {
        databaseName: 'test_db',
        tableName: 'test_table',
      },
      select: '',
      where: '',
      whereLanguage: 'sql',
      timestampValueExpression: '',
      connection: 'test_connection',
      dateRange: [new Date('2024-01-01'), new Date('2024-01-02')],
    };

    beforeEach(() => {
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: () =>
          Promise.resolve({
            data: [
              {
                __hdx_value: 'info',
                __hdx_percentage: '85.9',
              },
              {
                __hdx_value: 'debug',
                __hdx_percentage: '3.0',
              },
              {
                __hdx_value: 'warn',
                __hdx_percentage: '6.5',
              },
              {
                __hdx_value: 'error',
                __hdx_percentage: '4.1',
              },
            ],
          }),
      });
    });

    it('should fetch and return values distribution for severity', async () => {
      const result = await metadata.getValuesDistribution({
        chartConfig: mockChartConfig,
        key: 'severity',
        source,
      });

      expect(result).toEqual(
        new Map([
          ['info', Number(85.9)],
          ['debug', Number(3.0)],
          ['warn', Number(6.5)],
          ['error', Number(4.1)],
        ]),
      );
    });

    it('should include alias CTEs when provided in the config', async () => {
      const configWithAliases = {
        ...mockChartConfig,
        with: [
          {
            name: 'service',
            sql: {
              sql: 'ServiceName',
              params: {},
            },
          },
          {
            name: 'severity',
            sql: {
              sql: 'SeverityText',
              params: {},
            },
          },
        ],
        where: "severity = 'info'",
      };

      const renderChartConfigSpy = jest.spyOn(
        renderChartConfigModule,
        'renderChartConfig',
      );

      await metadata.getValuesDistribution({
        chartConfig: configWithAliases,
        key: 'severity',
        source,
      });

      const actualConfig = renderChartConfigSpy.mock.calls[0][0];
      if (!isBuilderChartConfig(actualConfig))
        throw new Error('Expected builder config');
      expect(actualConfig.with).toContainEqual({
        name: 'service',
        sql: {
          sql: 'ServiceName',
          params: {},
        },
      });
      expect(actualConfig.with).toContainEqual({
        name: 'severity',
        sql: {
          sql: 'SeverityText',
          params: {},
        },
      });
      expect(actualConfig.where).toBe("severity = 'info'");
    });

    it('should include filters from the config in the query', async () => {
      const configWithFilters: BuilderChartConfigWithDateRange = {
        ...mockChartConfig,
        filters: [
          {
            type: 'sql',
            condition: "ServiceName IN ('clickhouse')",
          },
        ],
      };

      const renderChartConfigSpy = jest.spyOn(
        renderChartConfigModule,
        'renderChartConfig',
      );

      await metadata.getValuesDistribution({
        chartConfig: configWithFilters,
        key: 'severity',
        source,
      });

      const actualConfig = renderChartConfigSpy.mock.calls[0][0];
      if (!isBuilderChartConfig(actualConfig))
        throw new Error('Expected builder config');
      expect(actualConfig.filters).toContainEqual({
        type: 'sql',
        condition: "ServiceName IN ('clickhouse')",
      });
    });

    it('renders JSON distribution keys as typed subcolumns', async () => {
      jest.spyOn(metadata, 'getColumn').mockImplementation(({ column }) =>
        Promise.resolve(
          column === 'ResourceAttributes'
            ? ({
                name: 'ResourceAttributes',
                type: 'JSON(max_dynamic_types=8, max_dynamic_paths=64)',
              } as any)
            : undefined,
        ),
      );
      const renderChartConfigSpy = jest.spyOn(
        renderChartConfigModule,
        'renderChartConfig',
      );

      await metadata.getValuesDistribution({
        chartConfig: mockChartConfig,
        key: 'ResourceAttributes.k8s.namespace.name',
        source,
      });

      const actualConfig = renderChartConfigSpy.mock.calls[0][0];
      if (!isBuilderChartConfig(actualConfig))
        throw new Error('Expected builder config');
      expect(actualConfig.select).toBe(
        'ResourceAttributes.`k8s`.`namespace`.`name`.:String AS __hdx_value, count() as __hdx_count, __hdx_count / (sum(__hdx_count) OVER ()) * 100 AS __hdx_percentage',
      );
      expect(actualConfig.groupBy).toBe('__hdx_value');
    });

    it('normalizes typed dot-form JSON distribution keys safely', async () => {
      jest.spyOn(metadata, 'getColumn').mockImplementation(({ column }) =>
        Promise.resolve(
          column === 'ResourceAttributes'
            ? ({
                name: 'ResourceAttributes',
                type: 'JSON(max_dynamic_types=8, max_dynamic_paths=64)',
              } as any)
            : undefined,
        ),
      );
      const renderChartConfigSpy = jest.spyOn(
        renderChartConfigModule,
        'renderChartConfig',
      );

      await metadata.getValuesDistribution({
        chartConfig: mockChartConfig,
        key: 'ResourceAttributes.k8s.namespace.name.:String',
        source,
      });

      const actualConfig = renderChartConfigSpy.mock.calls[0][0];
      if (!isBuilderChartConfig(actualConfig))
        throw new Error('Expected builder config');
      expect(actualConfig.select).toBe(
        'ResourceAttributes.`k8s`.`namespace`.`name`.:String AS __hdx_value, count() as __hdx_count, __hdx_count / (sum(__hdx_count) OVER ()) * 100 AS __hdx_percentage',
      );
    });
  });

  describe('getMapKeys', () => {
    // Fresh real cache so cache-key assertions are meaningful per test.
    // Also stub out getMapColumnTextIndexes — these tests exercise the
    // raw-table sampledKeys path and don't set up a text index, so we don't
    // want its underlying (getServerVersion / getColumns / getSkipIndices /
    // isClickHouseCloud) queries consuming slots in the mockResolvedValueOnce
    // chain each test carefully composes.
    const buildMetadata = () => {
      const realCache = new (
        jest.requireActual('../core/metadata') as any
      ).MetadataCache();
      const md = new Metadata(mockClickhouseClient, realCache);
      jest
        .spyOn(md, 'getMapColumnTextIndexes')
        .mockResolvedValue(new Map() as any);
      return md;
    };

    const lowCardinalityMapColumn = {
      name: 'LogAttributes',
      type: 'Map(LowCardinality(String), String)',
      default_type: '',
      default_expression: '',
      comment: '',
      codec_expression: '',
      ttl_expression: '',
    };

    beforeEach(() => {
      // Full reset (not just clear) so leftover mockResolvedValueOnce chains
      // from prior tests don't leak in and starve our own assertions.
      (mockClickhouseClient.query as jest.Mock).mockReset();
      (timeFilterExpr as jest.Mock).mockClear();
      (timeFilterExpr as jest.Mock).mockResolvedValue({
        sql: '__TIME_FILTER__',
        params: {},
      });
    });

    it('emits a sampledKeys SQL with no time-filter or source-filter clause when neither is provided', async () => {
      const md = buildMetadata();

      (mockClickhouseClient.query as jest.Mock)
        .mockResolvedValueOnce({
          // DESCRIBE TABLE
          json: () => Promise.resolve({ data: [lowCardinalityMapColumn] }),
        })
        .mockResolvedValueOnce({
          // sampledKeys query
          json: () => Promise.resolve({ data: [] }),
        });

      await md.getMapKeys({
        databaseName: 'otel',
        tableName: 'generic_logs',
        column: 'LogAttributes',
        connectionId: 'conn-1',
      });

      expect(timeFilterExpr).not.toHaveBeenCalled();

      // Find the sampledKeys query (the second call, after DESCRIBE)
      const sampledKeysCall = (mockClickhouseClient.query as jest.Mock).mock
        .calls[1][0];
      expect(sampledKeysCall.query).not.toContain('WHERE');
      expect(sampledKeysCall.query).not.toContain('__TIME_FILTER__');
    });

    it('injects the time filter into the sampledKeys WHERE clause when dateRange and timestampValueExpression are provided', async () => {
      const md = buildMetadata();

      (mockClickhouseClient.query as jest.Mock)
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ data: [lowCardinalityMapColumn] }),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ data: [] }),
        });

      const dateRange: [Date, Date] = [
        new Date('2026-05-11T16:00:00Z'),
        new Date('2026-05-11T17:00:00Z'),
      ];

      await md.getMapKeys({
        databaseName: 'otel',
        tableName: 'generic_logs',
        column: 'LogAttributes',
        connectionId: 'conn-1',
        dateRange,
        timestampValueExpression: 'EventTime, EventDate',
      });

      expect(timeFilterExpr).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'conn-1',
          databaseName: 'otel',
          tableName: 'generic_logs',
          dateRange,
          timestampValueExpression: 'EventTime, EventDate',
        }),
      );

      const sampledKeysCall = (mockClickhouseClient.query as jest.Mock).mock
        .calls[1][0];
      expect(sampledKeysCall.query).toContain('WHERE');
      expect(sampledKeysCall.query).toContain('__TIME_FILTER__');
    });

    // We read the Map keys via getSubcolumn(col, 'keys') rather than the
    // `col.keys` dot form: on a multi-shard Distributed read of a Map subcolumn,
    // some ClickHouse builds name the dot form inconsistently across the hop
    // (`col.keys` vs `getSubcolumn(col,'keys')`), failing the query with
    // NOT_FOUND_COLUMN_IN_BLOCK / THERE_IS_NO_COLUMN. The explicit function call
    // serializes to one consistent name.
    it('reads keys via getSubcolumn (not the .keys dot form) for LowCardinality maps', async () => {
      const md = buildMetadata();

      (mockClickhouseClient.query as jest.Mock)
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ data: [lowCardinalityMapColumn] }),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ data: [] }),
        });

      await md.getMapKeys({
        databaseName: 'otel',
        tableName: 'generic_logs',
        column: 'LogAttributes',
        connectionId: 'conn-1',
      });

      const sampledKeysCall = (mockClickhouseClient.query as jest.Mock).mock
        .calls[1][0];
      // The column is passed as an Identifier param, so the SQL reads
      // getSubcolumn({<hash>:Identifier}, 'keys') and the old `<col>.keys`
      // dot form must not appear.
      expect(sampledKeysCall.query).toMatch(
        /getSubcolumn\(\{[^}]+:Identifier\}, 'keys'\)/,
      );
      expect(sampledKeysCall.query).not.toMatch(/:Identifier\}\.keys/);
      expect(Object.values(sampledKeysCall.query_params)).toContain(
        'LogAttributes',
      );
    });

    it('reads keys via getSubcolumn (not the .keys dot form) for plain String maps', async () => {
      const md = buildMetadata();

      (mockClickhouseClient.query as jest.Mock)
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve({
              // Plain-String-key map -> groupUniqArrayArray strategy
              data: [
                { ...lowCardinalityMapColumn, type: 'Map(String, String)' },
              ],
            }),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ data: [{ keysArr: [] }] }),
        });

      await md.getMapKeys({
        databaseName: 'otel',
        tableName: 'generic_logs',
        column: 'LogAttributes',
        connectionId: 'conn-1',
      });

      const sampledKeysCall = (mockClickhouseClient.query as jest.Mock).mock
        .calls[1][0];
      expect(sampledKeysCall.query).toMatch(
        /getSubcolumn\(\{[^}]+:Identifier\}, 'keys'\)/,
      );
      expect(sampledKeysCall.query).not.toMatch(/:Identifier\}\.keys/);
      expect(Object.values(sampledKeysCall.query_params)).toContain(
        'LogAttributes',
      );
    });

    it('caches keys distinctly for different dateRange values', async () => {
      const md = buildMetadata();

      // DESCRIBE runs once (getColumns is internally cached on the same md);
      // sampledKeys runs twice with different cache keys due to dateRange suffix.
      (mockClickhouseClient.query as jest.Mock)
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ data: [lowCardinalityMapColumn] }),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ data: [{ key: 'a' }] }),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ data: [{ key: 'b' }] }),
        });

      const baseArgs = {
        databaseName: 'otel',
        tableName: 'generic_logs',
        column: 'LogAttributes',
        connectionId: 'conn-1',
        timestampValueExpression: 'EventTime, EventDate',
      };

      const keysA = await md.getMapKeys({
        ...baseArgs,
        dateRange: [
          new Date('2026-05-11T16:00:00Z'),
          new Date('2026-05-11T17:00:00Z'),
        ],
      });
      const keysB = await md.getMapKeys({
        ...baseArgs,
        dateRange: [
          new Date('2026-05-11T18:00:00Z'),
          new Date('2026-05-11T19:00:00Z'),
        ],
      });

      // Distinct cache entries => distinct fetched results, not a single shared cached value
      expect(keysA).toEqual(['a']);
      expect(keysB).toEqual(['b']);
    });
  });

  // Regression guard for commit 612bb2f9a: the `keyRollupTable` MV is no
  // longer in the recommended log/trace schemas, but users who still have
  // the MV configured must be able to query it.
  describe('getMapKeys (key rollup table path)', () => {
    const buildMetadata = () => {
      const realCache = new (
        jest.requireActual('../core/metadata') as any
      ).MetadataCache();
      return new Metadata(mockClickhouseClient, realCache);
    };

    const dateRange: [Date, Date] = [
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-01T01:00:00Z'),
    ];
    const baseArgs = {
      databaseName: 'default',
      tableName: 'otel_logs',
      column: 'LogAttributes',
      connectionId: 'test_connection',
      dateRange,
      timestampValueExpression: 'Timestamp',
      metadataMVs: {
        keyRollupTable: 'otel_logs_key_rollup_15m',
        kvRollupTable: 'otel_logs_kv_rollup_15m',
        granularity: '15 minute' as const,
      },
    };

    afterEach(() => {
      jest.restoreAllMocks();
      (mockClickhouseClient.query as jest.Mock).mockReset();
    });

    it('queries the key rollup table when metadataMVs is configured and no text index exists', async () => {
      const md = buildMetadata();
      jest
        .spyOn(md, 'getMapColumnTextIndexes')
        .mockResolvedValue(new Map() as any);
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: () =>
          Promise.resolve({
            data: [{ Key: 'user.id' }, { Key: 'request.path' }],
          }),
      });

      const keys = await md.getMapKeys({ ...baseArgs });

      expect(keys).toEqual(['user.id', 'request.path']);
      expect(mockClickhouseClient.query).toHaveBeenCalledTimes(1);
      const call = (mockClickhouseClient.query as jest.Mock).mock.calls[0][0];
      expect(call.query).toContain('ColumnIdentifier = ');
      expect(call.query).toContain('GROUP BY Key');
      expect(call.query).toContain('ORDER BY sum(count) DESC');
      expect(Object.values(call.query_params)).toContain(
        'otel_logs_key_rollup_15m',
      );
      expect(Object.values(call.query_params)).toContain('LogAttributes');
    });

    it('buckets the time filter to the configured MV granularity', async () => {
      const md = buildMetadata();
      jest
        .spyOn(md, 'getMapColumnTextIndexes')
        .mockResolvedValue(new Map() as any);
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: () => Promise.resolve({ data: [{ Key: 'user.id' }] }),
      });

      await md.getMapKeys({ ...baseArgs });

      const call = (mockClickhouseClient.query as jest.Mock).mock.calls[0][0];
      expect(call.query).toContain('toStartOfFifteenMinutes(');
      expect(call.query).toContain('Timestamp >=');
      expect(call.query).toContain('Timestamp <=');
    });

    it('filters empty keys from the rollup response', async () => {
      const md = buildMetadata();
      jest
        .spyOn(md, 'getMapColumnTextIndexes')
        .mockResolvedValue(new Map() as any);
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: () =>
          Promise.resolve({
            data: [{ Key: 'user.id' }, { Key: '' }, { Key: 'request.path' }],
          }),
      });

      const keys = await md.getMapKeys({ ...baseArgs });

      expect(keys).toEqual(['user.id', 'request.path']);
    });

    it('respects the maxKeys limit as a query LIMIT parameter', async () => {
      const md = buildMetadata();
      jest
        .spyOn(md, 'getMapColumnTextIndexes')
        .mockResolvedValue(new Map() as any);
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: () => Promise.resolve({ data: [{ Key: 'k' }] }),
      });

      await md.getMapKeys({ ...baseArgs, maxKeys: 42 });

      const call = (mockClickhouseClient.query as jest.Mock).mock.calls[0][0];
      expect(Object.values(call.query_params)).toContain(42);
    });

    it('skips the rollup query entirely when metadataMVs is not provided', async () => {
      const md = buildMetadata();
      jest
        .spyOn(md, 'getMapColumnTextIndexes')
        .mockResolvedValue(new Map() as any);
      jest.spyOn(md, 'getColumn').mockResolvedValue({
        name: 'LogAttributes',
        type: 'Map(LowCardinality(String), String)',
      } as any);
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: () => Promise.resolve({ data: [{ keysArr: ['k'] }] }),
      });

      await md.getMapKeys({
        ...baseArgs,
        metadataMVs: undefined,
      });

      const queries = (mockClickhouseClient.query as jest.Mock).mock.calls.map(
        (c: any[]) => c[0].query as string,
      );
      expect(
        queries.some((s: string) => s.includes('otel_logs_key_rollup_15m')),
      ).toBe(false);
    });

    it('caches rollup keys by aligned date range', async () => {
      const md = buildMetadata();
      jest
        .spyOn(md, 'getMapColumnTextIndexes')
        .mockResolvedValue(new Map() as any);
      (mockClickhouseClient.query as jest.Mock)
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ data: [{ Key: 'first' }] }),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ data: [{ Key: 'second' }] }),
        });

      const keysA = await md.getMapKeys({ ...baseArgs });
      const keysARepeat = await md.getMapKeys({ ...baseArgs });
      const keysB = await md.getMapKeys({
        ...baseArgs,
        dateRange: [
          new Date('2024-01-02T00:00:00Z'),
          new Date('2024-01-02T01:00:00Z'),
        ],
      });

      expect(keysA).toEqual(['first']);
      expect(keysARepeat).toEqual(['first']);
      expect(keysB).toEqual(['second']);
      expect(mockClickhouseClient.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('getMapValues', () => {
    const buildMetadata = () => {
      const realCache = new (
        jest.requireActual('../core/metadata') as any
      ).MetadataCache();
      return new Metadata(mockClickhouseClient, realCache);
    };

    beforeEach(() => {
      (mockClickhouseClient.query as jest.Mock).mockReset();
      (timeFilterExpr as jest.Mock).mockClear();
      (timeFilterExpr as jest.Mock).mockResolvedValue({
        sql: '__TIME_FILTER__',
        params: {},
      });
    });

    it("emits only the existing value != '' predicate when dateRange not provided", async () => {
      const md = buildMetadata();
      jest.spyOn(md, 'getColumn').mockResolvedValue({
        name: 'LogAttributes',
        type: 'Map(LowCardinality(String), String)',
      } as any);

      (mockClickhouseClient.query as jest.Mock).mockResolvedValueOnce({
        json: () => Promise.resolve({ data: [] }),
      });

      await md.getMapValues({
        databaseName: 'otel',
        tableName: 'generic_logs',
        column: 'LogAttributes',
        key: 'service.name',
        connectionId: 'conn-1',
      });

      expect(timeFilterExpr).not.toHaveBeenCalled();

      const valuesCall = (mockClickhouseClient.query as jest.Mock).mock
        .calls[0][0];
      expect(valuesCall.query).toContain("value != ''");
      expect(valuesCall.query).not.toContain('__TIME_FILTER__');
    });

    it('injects the time filter clause when dateRange and timestampValueExpression are provided', async () => {
      const md = buildMetadata();
      jest.spyOn(md, 'getColumn').mockResolvedValue({
        name: 'LogAttributes',
        type: 'Map(LowCardinality(String), String)',
      } as any);

      (mockClickhouseClient.query as jest.Mock).mockResolvedValueOnce({
        json: () => Promise.resolve({ data: [] }),
      });

      const dateRange: [Date, Date] = [
        new Date('2026-05-11T16:00:00Z'),
        new Date('2026-05-11T17:00:00Z'),
      ];

      await md.getMapValues({
        databaseName: 'otel',
        tableName: 'generic_logs',
        column: 'LogAttributes',
        key: 'service.name',
        connectionId: 'conn-1',
        dateRange,
        timestampValueExpression: 'EventTime, EventDate',
      });

      expect(timeFilterExpr).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'conn-1',
          databaseName: 'otel',
          tableName: 'generic_logs',
          dateRange,
          timestampValueExpression: 'EventTime, EventDate',
        }),
      );

      const valuesCall = (mockClickhouseClient.query as jest.Mock).mock
        .calls[0][0];
      expect(valuesCall.query).toContain("value != ''");
      expect(valuesCall.query).toContain('__TIME_FILTER__');
    });

    it('uses typed JSON subcolumns for JSON attribute values', async () => {
      const md = buildMetadata();
      jest.spyOn(md, 'getColumn').mockResolvedValue({
        name: 'ResourceAttributes',
        type: 'JSON(max_dynamic_types=8, max_dynamic_paths=64)',
      } as any);

      (mockClickhouseClient.query as jest.Mock).mockResolvedValueOnce({
        json: () => Promise.resolve({ data: [] }),
      });

      await md.getMapValues({
        databaseName: 'otel',
        tableName: 'generic_logs',
        column: 'ResourceAttributes',
        key: 'k8s.namespace.name',
        connectionId: 'conn-1',
      });

      const valuesCall = (mockClickhouseClient.query as jest.Mock).mock
        .calls[0][0];
      expect(valuesCall.query).toContain(
        'ResourceAttributes.`k8s`.`namespace`.`name`.:String as value',
      );
      expect(valuesCall.query).not.toContain('ResourceAttributes[');
    });

    it('caches values distinctly for different dateRange values', async () => {
      const md = buildMetadata();
      jest.spyOn(md, 'getColumn').mockResolvedValue({
        name: 'LogAttributes',
        type: 'Map(LowCardinality(String), String)',
      } as any);

      (mockClickhouseClient.query as jest.Mock)
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ data: [{ value: 'morning' }] }),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ data: [{ value: 'afternoon' }] }),
        });

      const baseArgs = {
        databaseName: 'otel',
        tableName: 'generic_logs',
        column: 'LogAttributes',
        key: 'service.name',
        connectionId: 'conn-1',
        timestampValueExpression: 'EventTime, EventDate',
      };

      const valuesA = await md.getMapValues({
        ...baseArgs,
        dateRange: [
          new Date('2026-05-11T16:00:00Z'),
          new Date('2026-05-11T17:00:00Z'),
        ],
      });
      const valuesB = await md.getMapValues({
        ...baseArgs,
        dateRange: [
          new Date('2026-05-11T18:00:00Z'),
          new Date('2026-05-11T19:00:00Z'),
        ],
      });

      expect(valuesA).toEqual(['morning']);
      expect(valuesB).toEqual(['afternoon']);
    });
  });

  describe('getAllFields', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('threads dateRange and timestampValueExpression through to getMapKeys', async () => {
      const realCache = new (
        jest.requireActual('../core/metadata') as any
      ).MetadataCache();
      const md = new Metadata(mockClickhouseClient, realCache);
      const getMapKeysSpy = jest
        .spyOn(md, 'getMapKeys')
        .mockResolvedValue(['http.method']);

      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: () =>
          Promise.resolve({
            data: [
              {
                name: 'LogAttributes',
                type: 'Map(LowCardinality(String), String)',
                default_type: '',
                default_expression: '',
                comment: '',
                codec_expression: '',
                ttl_expression: '',
              },
            ],
          }),
      });

      const dateRange: [Date, Date] = [
        new Date('2026-05-11T16:00:00Z'),
        new Date('2026-05-11T17:00:00Z'),
      ];

      await md.getAllFields({
        databaseName: 'otel',
        tableName: 'otel_logs',
        connectionId: 'conn-1',
        dateRange,
        timestampValueExpression: 'EventTime, EventDate',
      });

      expect(getMapKeysSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          dateRange,
          timestampValueExpression: 'EventTime, EventDate',
        }),
      );
    });

    it('should extract LowCardinality(String) type for Map sub-fields when value type is LowCardinality', async () => {
      // Simulate: Map(LowCardinality(String), LowCardinality(String))
      // This is the "working" case — sub-fields get type LowCardinality(String)
      const realCache = new (
        jest.requireActual('../core/metadata') as any
      ).MetadataCache();
      const md = new Metadata(mockClickhouseClient, realCache);
      jest
        .spyOn(md, 'getMapColumnTextIndexes')
        .mockResolvedValue(new Map() as any);

      // Mock getColumns → returns one Map column
      (mockClickhouseClient.query as jest.Mock)
        .mockResolvedValueOnce({
          // DESCRIBE TABLE
          json: () =>
            Promise.resolve({
              data: [
                {
                  name: 'LogAttributes',
                  type: 'Map(LowCardinality(String), LowCardinality(String))',
                  default_type: '',
                  default_expression: '',
                  comment: '',
                  codec_expression: '',
                  ttl_expression: '',
                },
              ],
            }),
        })
        .mockResolvedValueOnce({
          // lowCardinalityKeys query for LogAttributes
          json: () =>
            Promise.resolve({
              data: [{ key: 'http.method' }, { key: 'http.status_code' }],
            }),
        });

      const fields = await md.getAllFields({
        databaseName: 'otel',
        tableName: 'test_logs',
        connectionId: 'conn-1',
      });

      // The Map column itself should be present
      const mapField = fields.find(
        f => f.path.length === 1 && f.path[0] === 'LogAttributes',
      );
      expect(mapField).toBeDefined();
      expect(mapField!.type).toBe(
        'Map(LowCardinality(String), LowCardinality(String))',
      );

      // Sub-fields should have LowCardinality(String) as their type
      const httpMethod = fields.find(
        f =>
          f.path.length === 2 &&
          f.path[0] === 'LogAttributes' &&
          f.path[1] === 'http.method',
      );
      expect(httpMethod).toBeDefined();
      expect(httpMethod!.type).toBe('LowCardinality(String)');
      // This type includes 'LowCardinality', so the UI filter check passes
      expect(httpMethod!.type.includes('LowCardinality')).toBe(true);
    });

    it('should extract String type for Map sub-fields when value type is plain String — BUG: fields excluded from default filters', async () => {
      // Simulate: Map(LowCardinality(String), String)
      // This is the customer's schema (Constructor.io) — sub-fields get type "String"
      // which causes them to be filtered out of the default facet panel
      const realCache = new (
        jest.requireActual('../core/metadata') as any
      ).MetadataCache();
      const md = new Metadata(mockClickhouseClient, realCache);
      jest
        .spyOn(md, 'getMapColumnTextIndexes')
        .mockResolvedValue(new Map() as any);

      (mockClickhouseClient.query as jest.Mock)
        .mockResolvedValueOnce({
          // DESCRIBE TABLE
          json: () =>
            Promise.resolve({
              data: [
                {
                  name: 'LogAttributes',
                  type: 'Map(LowCardinality(String), String)',
                  default_type: '',
                  default_expression: '',
                  comment: '',
                  codec_expression: '',
                  ttl_expression: '',
                },
                {
                  name: 'ResourceAttributes',
                  type: 'Map(LowCardinality(String), String)',
                  default_type: '',
                  default_expression: '',
                  comment: '',
                  codec_expression: '',
                  ttl_expression: '',
                },
              ],
            }),
        })
        .mockResolvedValueOnce({
          // lowCardinalityKeys query for LogAttributes
          json: () =>
            Promise.resolve({
              data: [{ key: 'io.constructor.message' }, { key: 'severity' }],
            }),
        })
        .mockResolvedValueOnce({
          // lowCardinalityKeys query for ResourceAttributes
          json: () =>
            Promise.resolve({
              data: [{ key: 'log.index' }, { key: 'service.name' }],
            }),
        });

      const fields = await md.getAllFields({
        databaseName: 'otel',
        tableName: 'test_logs',
        connectionId: 'conn-1',
      });

      // Sub-fields for LogAttributes
      const logAttrField = fields.find(
        f =>
          f.path[0] === 'LogAttributes' &&
          f.path[1] === 'io.constructor.message',
      );
      expect(logAttrField).toBeDefined();
      // BUG: The extracted type is "String" (the Map VALUE type), NOT "LowCardinality(String)"
      expect(logAttrField!.type).toBe('String');
      // This means the UI's LowCardinality check FAILS, hiding the field by default
      expect(logAttrField!.type.includes('LowCardinality')).toBe(false);

      // Same issue for ResourceAttributes
      const resAttrField = fields.find(
        f => f.path[0] === 'ResourceAttributes' && f.path[1] === 'log.index',
      );
      expect(resAttrField).toBeDefined();
      expect(resAttrField!.type).toBe('String');
      expect(resAttrField!.type.includes('LowCardinality')).toBe(false);
    });

    it('demonstrates that Map sub-fields with plain String type are included via isMapSubField check', async () => {
      // This test simulates the fixed keysToFetch filtering logic from DBSearchPageFilters.tsx
      const fields = [
        // Regular LowCardinality column — always shown
        {
          path: ['SeverityText'],
          type: 'LowCardinality(String)',
          jsType: 'string' as const,
        },
        {
          path: ['ServiceName'],
          type: 'LowCardinality(String)',
          jsType: 'string' as const,
        },
        // Map(LowCardinality(String), LowCardinality(String)) sub-fields — shown (type has LowCardinality)
        {
          path: ['SpanAttributes', 'http.method'],
          type: 'LowCardinality(String)',
          jsType: 'string' as const,
        },
        // Map(LowCardinality(String), String) sub-fields — now shown via isMapSubField
        {
          path: ['LogAttributes', 'io.constructor.message'],
          type: 'String',
          jsType: 'string' as const,
        },
        {
          path: ['ResourceAttributes', 'log.index'],
          type: 'String',
          jsType: 'string' as const,
        },
        // Regular String column (not a Map sub-field) — still hidden by default
        { path: ['Body'], type: 'String', jsType: 'string' as const },
      ];

      // Simulate the fixed filter logic from DBSearchPageFilters.tsx
      const showMoreFields = false; // default state
      const filterState: Record<string, unknown> = {};
      const isFieldPinned = () => false;

      const keysToFetch = fields
        .filter(field => field.jsType && ['string'].includes(field.jsType))
        .map(({ path, type }) => ({
          type,
          path: path.join('.'),
          isMapSubField: path.length > 1,
        }))
        .filter(
          field =>
            showMoreFields ||
            field.type.includes('LowCardinality') ||
            field.isMapSubField || // Fix: always include Map/JSON sub-fields
            Object.keys(filterState).includes(field.path) ||
            isFieldPinned(),
        )
        .map(f => f.path);

      // LowCardinality columns still shown
      expect(keysToFetch).toContain('SeverityText');
      expect(keysToFetch).toContain('ServiceName');
      expect(keysToFetch).toContain('SpanAttributes.http.method');

      // Map(LowCardinality(String), String) sub-fields NOW included
      expect(keysToFetch).toContain('LogAttributes.io.constructor.message');
      expect(keysToFetch).toContain('ResourceAttributes.log.index');

      // Regular non-LowCardinality columns still hidden by default
      expect(keysToFetch).not.toContain('Body');
    });
  });

  describe('parseTokensExpression', () => {
    it.each([
      // Test cases without tokens
      {
        expression: 'lower(Body)',
        expected: { hasTokens: false },
      },
      {
        expression: '',
        expected: { hasTokens: false },
      },
      // Test cases with tokens
      {
        expression: 'tokens(Body)',
        expected: { hasTokens: true, innerExpression: 'Body' },
      },
      {
        expression: 'tokens(lower(Body))',
        expected: { hasTokens: true, innerExpression: 'lower(Body)' },
      },
      {
        expression: "tokens(lower(concatWithSeparator(';',Body,Message)))",
        expected: {
          hasTokens: true,
          innerExpression: "lower(concatWithSeparator(';',Body,Message))",
        },
      },
      // Extra whitespace
      {
        expression: 'tokens( Body )',
        expected: { hasTokens: true, innerExpression: 'Body' },
      },
      {
        expression: ' tokens( Body ) ',
        expected: { hasTokens: true, innerExpression: 'Body' },
      },
      {
        expression: 'tokens ( Body )',
        expected: { hasTokens: true, innerExpression: 'Body' },
      },
    ])(
      'should correctly parse tokens from: $expression',
      ({ expression, expected }) => {
        const result = Metadata.parseTokensExpression(expression);
        expect(result).toEqual(expected);
      },
    );
  });

  describe('getOtelTables', () => {
    beforeEach(() => {
      mockCache.getOrFetch.mockImplementation((key, queryFn) => queryFn());
    });

    it('should return null when no OTEL tables are found', async () => {
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: [],
        }),
      });

      const result = await metadata.getOtelTables({
        connectionId: 'test_connection',
      });

      expect(result).toBeNull();
    });

    it('should return a coherent set of tables from a single database', async () => {
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: [
            { database: 'default', name: 'otel_logs' },
            { database: 'default', name: 'otel_traces' },
            { database: 'default', name: 'hyperdx_sessions' },
            { database: 'default', name: 'otel_metrics_gauge' },
            { database: 'default', name: 'otel_metrics_sum' },
            { database: 'default', name: 'otel_metrics_histogram' },
          ],
        }),
      });

      const result = await metadata.getOtelTables({
        connectionId: 'test_connection',
      });

      expect(result).toEqual({
        database: 'default',
        tables: {
          logs: 'otel_logs',
          traces: 'otel_traces',
          sessions: 'hyperdx_sessions',
          metrics: {
            gauge: 'otel_metrics_gauge',
            sum: 'otel_metrics_sum',
            histogram: 'otel_metrics_histogram',
            summary: undefined,
            expHistogram: undefined,
          },
        },
      });
    });

    it('should select the database with the most complete set when multiple databases exist', async () => {
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: [
            { database: 'default', name: 'hyperdx_sessions' },
            { database: 'default', name: 'otel_logs' },
            { database: 'default', name: 'otel_metrics_gauge' },
            { database: 'default', name: 'otel_metrics_histogram' },
            { database: 'default', name: 'otel_metrics_sum' },
            { database: 'default', name: 'otel_metrics_summary' },
            { database: 'default', name: 'otel_traces' },
            { database: 'otel_json', name: 'hyperdx_sessions' },
            { database: 'otel_json', name: 'otel_logs' },
            { database: 'otel_json', name: 'otel_metrics_gauge' },
            { database: 'otel_json', name: 'otel_metrics_histogram' },
            { database: 'otel_json', name: 'otel_metrics_sum' },
            { database: 'otel_json', name: 'otel_metrics_summary' },
            { database: 'otel_json', name: 'otel_traces' },
          ],
        }),
      });

      const result = await metadata.getOtelTables({
        connectionId: 'test_connection',
      });

      expect(result).toBeDefined();
      expect(result?.database).toBe('default'); // Both have same score, first one wins
      expect(result?.tables.logs).toBe('otel_logs');
      expect(result?.tables.traces).toBe('otel_traces');
      expect(result?.tables.sessions).toBe('hyperdx_sessions');
    });

    it('should prioritize database with logs and traces over one with only metrics', async () => {
      (mockClickhouseClient.query as jest.Mock).mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          data: [
            { database: 'metrics_db', name: 'otel_metrics_gauge' },
            { database: 'metrics_db', name: 'otel_metrics_sum' },
            { database: 'full_db', name: 'otel_logs' },
            { database: 'full_db', name: 'otel_traces' },
          ],
        }),
      });

      const result = await metadata.getOtelTables({
        connectionId: 'test_connection',
      });

      expect(result?.database).toBe('full_db');
    });

    it('should use cache when retrieving OTEL tables', async () => {
      mockCache.getOrFetch.mockReset();

      const mockResult = {
        database: 'default',
        tables: {
          logs: 'otel_logs',
          traces: 'otel_traces',
          sessions: 'hyperdx_sessions',
          metrics: {
            gauge: 'otel_metrics_gauge',
            sum: undefined,
            histogram: undefined,
            summary: undefined,
            expHistogram: undefined,
          },
        },
      };

      mockCache.getOrFetch.mockImplementation((key, queryFn) => {
        if (key === 'test_connection.otelTables') {
          return Promise.resolve(mockResult);
        }
        return queryFn();
      });

      const result = await metadata.getOtelTables({
        connectionId: 'test_connection',
      });

      expect(mockCache.getOrFetch).toHaveBeenCalledWith(
        'test_connection.otelTables',
        expect.any(Function),
      );
      expect(mockClickhouseClient.query).not.toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });

    it('should return null when permissions error occurs', async () => {
      (mockClickhouseClient.query as jest.Mock).mockRejectedValue(
        new Error('Not enough privileges'),
      );

      const result = await metadata.getOtelTables({
        connectionId: 'test_connection',
      });

      expect(result).toBeNull();
    });
  });
});

describe('parseKeyPath', () => {
  it('parses single-quoted bracket notation', () => {
    expect(parseKeyPath("ResourceAttributes['service.name']")).toEqual([
      'ResourceAttributes',
      'service.name',
    ]);
  });

  it('parses double-quoted bracket notation', () => {
    expect(parseKeyPath('ResourceAttributes["service.name"]')).toEqual([
      'ResourceAttributes',
      'service.name',
    ]);
  });

  it('returns single-element path for native columns', () => {
    expect(parseKeyPath('ServiceName')).toEqual(['ServiceName']);
  });

  it('handles keys with dots in the map key', () => {
    expect(parseKeyPath("SpanAttributes['http.request.method']")).toEqual([
      'SpanAttributes',
      'http.request.method',
    ]);
  });

  it('returns single-element path for empty string', () => {
    expect(parseKeyPath('')).toEqual(['']);
  });

  it('does not parse incomplete bracket notation', () => {
    expect(parseKeyPath("ResourceAttributes['service.name")).toEqual([
      "ResourceAttributes['service.name",
    ]);
  });
});

describe('parametric aggregate arguments are inlined as literals', () => {
  const buildMetadata = () => {
    const realCache = new (
      jest.requireActual('../core/metadata') as any
    ).MetadataCache();
    const md = new Metadata(mockClickhouseClient, realCache);
    jest
      .spyOn(md, 'getMapColumnTextIndexes')
      .mockResolvedValue(new Map() as any);
    return md;
  };

  beforeEach(() => {
    (mockClickhouseClient.query as jest.Mock).mockReset();
  });

  it('emits groupUniqArrayArray(N)(keys) with a literal N in the sampledKeys query', async () => {
    const md = buildMetadata();

    (mockClickhouseClient.query as jest.Mock)
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            data: [
              {
                name: 'LogAttributes',
                type: 'Map(String, String)',
                default_type: '',
                default_expression: '',
                comment: '',
                codec_expression: '',
                ttl_expression: '',
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ data: [{ keysArr: [] }] }),
      });

    await md.getMapKeys({
      databaseName: 'otel',
      tableName: 'generic_logs',
      column: 'LogAttributes',
      connectionId: 'conn-1',
      maxKeys: 500,
    });

    const sampledKeysCall = (mockClickhouseClient.query as jest.Mock).mock
      .calls[1][0];
    expect(sampledKeysCall.query).toContain('groupUniqArrayArray(500)(keys)');
    expect(sampledKeysCall.query).not.toMatch(
      /groupUniqArrayArray\(\{[^}]+:Int32\}\)\(keys\)/,
    );
  });

  describe('rejects bad values supplied for the parametric aggregate N argument', () => {
    const badValues: Array<[string, unknown]> = [
      ['null', null],
      ['string', '20'],
      ['NaN', Number.NaN],
      ['object', {}],
      ['boolean', true],
      ['negative integer', -1],
      ['float', 1.5],
      ['Infinity', Number.POSITIVE_INFINITY],
    ];

    it.each(badValues)(
      'getMapKeys throws when maxKeys is %s and never runs any ClickHouse query',
      async (_label, badValue) => {
        const md = buildMetadata();

        await expect(
          md.getMapKeys({
            databaseName: 'otel',
            tableName: 'generic_logs',
            column: 'LogAttributes',
            connectionId: 'conn-1',
            maxKeys: badValue as number,
          }),
        ).rejects.toThrow(/maxKeys must be a non-negative integer/);

        // Validation happens synchronously at the top of getMapKeys before
        // any of the text-index / rollup / raw-scan paths fire, so no
        // ClickHouse round-trip is wasted on a value we already know is bad.
        expect(mockClickhouseClient.query).not.toHaveBeenCalled();
      },
    );
  });
});
