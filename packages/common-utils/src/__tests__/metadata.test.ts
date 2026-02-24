import { ClickhouseClient } from '../clickhouse/node';
import { Metadata, MetadataCache } from '../core/metadata';
import * as renderChartConfigModule from '../core/renderChartConfig';
import { ChartConfigWithDateRange, TSource } from '../types';

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

const source = {
  querySettings: [
    { setting: 'optimize_read_in_order', value: '0' },
    { setting: 'cast_keep_nullable', value: '0' },
  ],
} as TSource;

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
      } catch (e) {
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

      expect(result.partition_key).toEqual('toYYYYMM(timestamp), user_id');
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

      expect(result.partition_key).toEqual('column1');
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
        if (key === 'test_connection.test_db.test_table.metadata') {
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
        'test_connection.test_db.test_table.metadata',
        expect.any(Function),
      );

      // Verify the mockClickhouseClient.query wasn't called since we're using cached data
      expect(mockClickhouseClient.query).not.toHaveBeenCalled();

      // Verify we still get the correct result
      expect(result).toEqual(mockTableMetadata);
    });
  });

  describe('getKeyValues', () => {
    const mockChartConfig: ChartConfigWithDateRange = {
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
    const mockChartConfig: ChartConfigWithDateRange = {
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
      const configWithFilters: ChartConfigWithDateRange = {
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
      expect(actualConfig.filters).toContainEqual({
        type: 'sql',
        condition: "ServiceName IN ('clickhouse')",
      });
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
