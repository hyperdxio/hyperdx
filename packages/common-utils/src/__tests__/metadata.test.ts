import { ClickhouseClient } from '../clickhouse/node';
import { Metadata, MetadataCache } from '../core/metadata';
import * as renderChartConfigModule from '../core/renderChartConfig';
import { isBuilderChartConfig } from '../guards';
import { BuilderChartConfigWithDateRange, SourceKind, TSource } from '../types';

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
  });

  describe('getAllFields', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should extract LowCardinality(String) type for Map sub-fields when value type is LowCardinality', async () => {
      // Simulate: Map(LowCardinality(String), LowCardinality(String))
      // This is the "working" case — sub-fields get type LowCardinality(String)
      const realCache = new (
        jest.requireActual('../core/metadata') as any
      ).MetadataCache();
      const md = new Metadata(mockClickhouseClient, realCache);

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
        tableName: 'otel_logs',
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
        tableName: 'otel_logs',
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
