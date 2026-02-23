import { ResponseJSON } from '@clickhouse/client-common';

import {
  ChSql,
  chSqlToAliasMap,
  computeRatio,
  computeResultSetRatio,
  convertCHDataTypeToJSType,
  JSDataType,
} from '@/clickhouse';
import { ClickhouseClient } from '@/clickhouse/node';
import { Metadata, MetadataCache } from '@/core/metadata';

describe('convertCHDataTypeToJSType - unit - type', () => {
  it('Date type', () => {
    const dataType = 'Date';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Date);
  });

  it('Map type', () => {
    const dataType = 'Map';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Map);
  });

  it('Array type', () => {
    const dataType = 'Array';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Array);
  });

  it('Number type - Int', () => {
    const dataType = 'Int';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Number);
  });

  it('Number type - UInt', () => {
    const dataType = 'UInt';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Number);
  });

  it('Number type - Float', () => {
    const dataType = 'Float';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Number);
  });

  it('Number type - Nullable(Int', () => {
    const dataType = 'Nullable(Int';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Number);
  });

  it('Number type - Nullable(UInt', () => {
    const dataType = 'Nullable(UInt';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Number);
  });

  it('Number type - Nullable(Float', () => {
    const dataType = 'Nullable(Float';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Number);
  });

  it('String type - String', () => {
    const dataType = 'String';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.String);
  });

  it('String type - FixedString', () => {
    const dataType = 'FixedString';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.String);
  });

  it('String type - Enum', () => {
    const dataType = 'Enum';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.String);
  });

  it('String type - UUID', () => {
    const dataType = 'UUID';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.String);
  });

  it('String type - IPv4', () => {
    const dataType = 'IPv4';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.String);
  });

  it('String type - IPv6', () => {
    const dataType = 'IPv6';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.String);
  });

  it('Bool type', () => {
    const dataType = 'Bool';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Bool);
  });

  it('JSON type', () => {
    const dataType = 'JSON';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.JSON);
  });

  it('Dynamic type', () => {
    const dataType = 'Dynamic';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Dynamic);
  });

  it('LowCardinality type - Date', () => {
    const dataType = 'LowCardinality(Date)';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Date);
  });

  it('LowCardinality type - Number', () => {
    const dataType = 'LowCardinality(Int)';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.Number);
  });

  it('LowCardinality type - String', () => {
    const dataType = 'LowCardinality(String)';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBe(JSDataType.String);
  });

  it('Unknown type', () => {
    const dataType = ')@#D)#Q$J)($*()@random type should not pass';
    const res = convertCHDataTypeToJSType(dataType);
    expect(res).toBeNull();
  });
});

describe('chSqlToAliasMap - alias unit test', () => {
  it('No alias', () => {
    const chSqlInput: ChSql = {
      sql: 'SELECT Timestamp,TimestampTime,ServiceName,TimestampTime FROM {HYPERDX_PARAM_1544803905:Identifier}.{HYPERDX_PARAM_129845054:Identifier} WHERE (TimestampTime >= fromUnixTimestamp64Milli({HYPERDX_PARAM_1456399765:Int64}) AND TimestampTime <= fromUnixTimestamp64Milli({HYPERDX_PARAM_1719057412:Int64})) ORDER BY TimestampTime DESC LIMIT {HYPERDX_PARAM_49586:Int32} OFFSET {HYPERDX_PARAM_48:Int32}',
      params: {
        HYPERDX_PARAM_1544803905: 'default',
        HYPERDX_PARAM_129845054: 'otel_logs',
        HYPERDX_PARAM_1456399765: 1743038742000,
        HYPERDX_PARAM_1719057412: 1743040542000,
        HYPERDX_PARAM_49586: 200,
        HYPERDX_PARAM_48: 0,
      },
    };
    const res = chSqlToAliasMap(chSqlInput);
    const aliasMap = {};
    expect(res).toEqual(aliasMap);
  });

  it('Normal alias, no brackets', () => {
    const chSqlInput: ChSql = {
      sql: 'SELECT Timestamp as time,Body as bodyTest,TimestampTime,ServiceName,TimestampTime FROM {HYPERDX_PARAM_1544803905:Identifier}.{HYPERDX_PARAM_129845054:Identifier} WHERE (TimestampTime >= fromUnixTimestamp64Milli({HYPERDX_PARAM_1456399765:Int64}) AND TimestampTime <= fromUnixTimestamp64Milli({HYPERDX_PARAM_1719057412:Int64})) ORDER BY TimestampTime DESC LIMIT {HYPERDX_PARAM_49586:Int32} OFFSET {HYPERDX_PARAM_48:Int32}',
      params: {
        HYPERDX_PARAM_1544803905: 'default',
        HYPERDX_PARAM_129845054: 'otel_logs',
        HYPERDX_PARAM_1456399765: 1743038742000,
        HYPERDX_PARAM_1719057412: 1743040542000,
        HYPERDX_PARAM_49586: 200,
        HYPERDX_PARAM_48: 0,
      },
    };
    const res = chSqlToAliasMap(chSqlInput);
    const aliasMap = {
      time: 'Timestamp',
      bodyTest: 'Body',
    };
    expect(res).toEqual(aliasMap);
  });

  it('Normal alias, with brackets', () => {
    const chSqlInput: ChSql = {
      sql: "SELECT Timestamp as ts,ResourceAttributes['service.name'] as serviceTest,Body,TimestampTime,ServiceName,TimestampTime FROM {HYPERDX_PARAM_1544803905:Identifier}.{HYPERDX_PARAM_129845054:Identifier} WHERE (TimestampTime >= fromUnixTimestamp64Milli({HYPERDX_PARAM_1456399765:Int64}) AND TimestampTime <= fromUnixTimestamp64Milli({HYPERDX_PARAM_1719057412:Int64})) ORDER BY TimestampTime DESC LIMIT {HYPERDX_PARAM_49586:Int32} OFFSET {HYPERDX_PARAM_48:Int32}",
      params: {
        HYPERDX_PARAM_1544803905: 'default',
        HYPERDX_PARAM_129845054: 'otel_logs',
        HYPERDX_PARAM_1456399765: 1743038742000,
        HYPERDX_PARAM_1719057412: 1743040542000,
        HYPERDX_PARAM_49586: 200,
        HYPERDX_PARAM_48: 0,
      },
    };
    const res = chSqlToAliasMap(chSqlInput);
    const aliasMap = {
      ts: 'Timestamp',
      serviceTest: "ResourceAttributes['service.name']",
    };
    expect(res).toEqual(aliasMap);
  });

  it('Alias, with JSON expressions', () => {
    const chSqlInput: ChSql = {
      sql: "SELECT Timestamp as ts,ResourceAttributes.service.name as service,toStartOfDay(LogAttributes.start.`time`) as start_time,Body,TimestampTime,ServiceName,TimestampTime FROM {HYPERDX_PARAM_1544803905:Identifier}.{HYPERDX_PARAM_129845054:Identifier} WHERE (TimestampTime >= fromUnixTimestamp64Milli({HYPERDX_PARAM_1456399765:Int64}) AND TimestampTime <= fromUnixTimestamp64Milli({HYPERDX_PARAM_1719057412:Int64})) AND (`ResourceAttributes`.`service`.`name` = 'serviceName') ORDER BY TimestampTime DESC LIMIT {HYPERDX_PARAM_49586:Int32} OFFSET {HYPERDX_PARAM_48:Int32}",
      params: {
        HYPERDX_PARAM_1544803905: 'default',
        HYPERDX_PARAM_129845054: 'otel_logs',
        HYPERDX_PARAM_1456399765: 1743038742000,
        HYPERDX_PARAM_1719057412: 1743040542000,
        HYPERDX_PARAM_49586: 200,
        HYPERDX_PARAM_48: 0,
      },
    };
    const res = chSqlToAliasMap(chSqlInput);
    const aliasMap = {
      ts: 'Timestamp',
      service: 'ResourceAttributes.service.name',
      start_time: 'toStartOfDay(LogAttributes.start.`time`)',
    };
    expect(res).toEqual(aliasMap);
  });
});

describe('computeRatio', () => {
  it('should correctly compute ratio of two numbers', () => {
    expect(computeRatio('10', '2')).toBe(5);
    expect(computeRatio('3', '4')).toBe(0.75);
    expect(computeRatio('0', '5')).toBe(0);
  });

  it('should return NaN when denominator is zero', () => {
    expect(isNaN(computeRatio('10', '0'))).toBe(true);
  });

  it('should return NaN for non-numeric inputs', () => {
    expect(isNaN(computeRatio('abc', '2'))).toBe(true);
    expect(isNaN(computeRatio('10', 'xyz'))).toBe(true);
    expect(isNaN(computeRatio('abc', 'xyz'))).toBe(true);
    expect(isNaN(computeRatio('', '5'))).toBe(true);
  });

  it('should handle string representations of numbers', () => {
    expect(computeRatio('10.5', '2')).toBe(5.25);
    expect(computeRatio('-10', '5')).toBe(-2);
    expect(computeRatio('10', '-5')).toBe(-2);
  });

  it('should handle number input types', () => {
    expect(computeRatio(10, 2)).toBe(5);
    expect(computeRatio(3, 4)).toBe(0.75);
    expect(computeRatio(10.5, 2)).toBe(5.25);
    expect(computeRatio(0, 5)).toBe(0);
    expect(isNaN(computeRatio(10, 0))).toBe(true);
    expect(computeRatio(-10, 5)).toBe(-2);
  });

  it('should handle mixed string and number inputs', () => {
    expect(computeRatio('10', 2)).toBe(5);
    expect(computeRatio(10, '2')).toBe(5);
    expect(computeRatio(3, '4')).toBe(0.75);
    expect(isNaN(computeRatio(10, ''))).toBe(true);
  });
});

describe('computeResultSetRatio', () => {
  it('should compute ratio for a valid result set with timestamp column', () => {
    const mockResultSet: ResponseJSON<any> = {
      meta: [
        { name: 'timestamp', type: 'DateTime' },
        { name: 'requests', type: 'UInt64' },
        { name: 'errors', type: 'UInt64' },
      ],
      data: [
        { timestamp: '2025-04-15 10:00:00', requests: '100', errors: '10' },
        { timestamp: '2025-04-15 11:00:00', requests: '200', errors: '20' },
      ],
      rows: 2,
      statistics: { elapsed: 0.1, rows_read: 2, bytes_read: 100 },
    };

    const result = computeResultSetRatio(mockResultSet);

    expect(result.meta.length).toBe(2);
    expect(result.meta[0].name).toBe('requests/errors');
    expect(result.meta[0].type).toBe('Float64');
    expect(result.meta[1].name).toBe('timestamp');

    expect(result.data.length).toBe(2);
    expect(result.data[0]['requests/errors']).toBe(10);
    expect(result.data[0].timestamp).toBe('2025-04-15 10:00:00');
    expect(result.data[1]['requests/errors']).toBe(10);
    expect(result.data[1].timestamp).toBe('2025-04-15 11:00:00');
  });

  it('should compute ratio for a valid result set without timestamp column', () => {
    const mockResultSet: ResponseJSON<any> = {
      meta: [
        { name: 'requests', type: 'UInt64' },
        { name: 'errors', type: 'UInt64' },
      ],
      data: [{ requests: '100', errors: '10' }],
      rows: 1,
      statistics: { elapsed: 0.1, rows_read: 1, bytes_read: 50 },
    };

    const result = computeResultSetRatio(mockResultSet);

    expect(result.meta.length).toBe(1);
    expect(result.meta[0].name).toBe('requests/errors');
    expect(result.meta[0].type).toBe('Float64');

    expect(result.data.length).toBe(1);
    expect(result.data[0]['requests/errors']).toBe(10);
    expect(result.data[0].timestamp).toBeUndefined();
  });

  it('should handle NaN values in ratio computation', () => {
    const mockResultSet: ResponseJSON<any> = {
      meta: [
        { name: 'timestamp', type: 'DateTime' },
        { name: 'requests', type: 'UInt64' },
        { name: 'errors', type: 'UInt64' },
      ],
      data: [
        { timestamp: '2025-04-15 10:00:00', requests: '100', errors: '0' },
        { timestamp: '2025-04-15 11:00:00', requests: 'invalid', errors: '20' },
      ],
      rows: 2,
      statistics: { elapsed: 0.1, rows_read: 2, bytes_read: 100 },
    };

    const result = computeResultSetRatio(mockResultSet);

    expect(result.data.length).toBe(2);
    expect(isNaN(result.data[0]['requests/errors'])).toBe(true);
    expect(isNaN(result.data[1]['requests/errors'])).toBe(true);
  });

  it('should throw error when result set has insufficient columns', () => {
    const mockResultSet: ResponseJSON<any> = {
      meta: [
        { name: 'timestamp', type: 'DateTime' },
        { name: 'requests', type: 'UInt64' },
      ],
      data: [{ timestamp: '2025-04-15 10:00:00', requests: '100' }],
      rows: 1,
      statistics: { elapsed: 0.1, rows_read: 1, bytes_read: 50 },
    };

    expect(() => computeResultSetRatio(mockResultSet)).toThrow(
      /Unable to compute ratio/,
    );
  });
});

describe('processClickhouseSettings - optimization settings', () => {
  let client: ClickhouseClient;
  let mockQueryMethod: jest.Mock;
  let metadataCache: MetadataCache;

  const createClient = () => {
    const newClient = new ClickhouseClient({
      host: 'http://localhost:8123',
      username: 'default',
      password: '',
    });

    // Mock the underlying ClickHouse client's query method
    const newMockQueryMethod = jest.fn();
    (newClient as any).client = {
      query: newMockQueryMethod,
    };

    // Create a fresh metadata cache for each test
    const newCache = new MetadataCache();

    // Mock getMetadata to return a metadata instance with our fresh cache
    jest
      // eslint-disable-next-line
      .spyOn(require('@/core/metadata'), 'getMetadata')
      .mockImplementation(() => {
        return new Metadata(newClient, newCache);
      });

    return {
      client: newClient,
      mockQueryMethod: newMockQueryMethod,
      cache: newCache,
    };
  };

  beforeEach(() => {
    const setup = createClient();
    client = setup.client;
    mockQueryMethod = setup.mockQueryMethod;
    metadataCache = setup.cache;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const setupMockQuery = (
    settingsData?: Array<{ name: string; value: string }>,
  ) => {
    mockQueryMethod.mockImplementation(
      async ({ query, clickhouse_settings }: any) => {
        // Return mocked settings for getSettings query
        if (query === 'SELECT name, value FROM system.settings') {
          return {
            json: async () => ({
              data: settingsData || [],
            }),
          };
        }
        // Return the settings so we can inspect them
        return {
          json: async () => ({ data: [], clickhouse_settings }),
        };
      },
    );
  };

  it('should apply default settings without server settings', async () => {
    setupMockQuery([]);

    await client.query({
      query: 'SELECT 1',
      format: 'JSON',
    });

    // Find the actual query call (not the settings query)
    const actualQueryCall = mockQueryMethod.mock.calls.find(
      (call: any) => call[0].query === 'SELECT 1',
    );

    expect(actualQueryCall).toBeDefined();
    expect(actualQueryCall[0].clickhouse_settings).toEqual({
      allow_experimental_analyzer: 1,
      date_time_output_format: 'iso',
      wait_end_of_query: 0,
      cancel_http_readonly_queries_on_client_close: 1,
    });
  });

  it('should apply all optimization settings when available on server', async () => {
    setupMockQuery([
      { name: 'query_plan_optimize_lazy_materialization', value: '1' },
      {
        name: 'query_plan_max_limit_for_lazy_materialization',
        value: '100000',
      },
      { name: 'use_skip_indexes_for_top_k', value: '1' },
      { name: 'query_plan_max_limit_for_top_k_optimization', value: '100000' },
      { name: 'use_top_k_dynamic_filtering', value: '1' },
      { name: 'use_skip_indexes_on_data_read', value: '1' },
      { name: 'use_skip_indexes_for_disjunctions', value: '1' },
    ]);

    await client.query({
      query: 'SELECT 1',
      format: 'JSON',
    });

    const actualQueryCall = mockQueryMethod.mock.calls.find(
      (call: any) => call[0].query === 'SELECT 1',
    );

    expect(actualQueryCall).toBeDefined();
    expect(actualQueryCall[0].clickhouse_settings).toEqual({
      allow_experimental_analyzer: 1,
      date_time_output_format: 'iso',
      wait_end_of_query: 0,
      cancel_http_readonly_queries_on_client_close: 1,
      query_plan_optimize_lazy_materialization: '1',
      query_plan_max_limit_for_lazy_materialization: '100000',
      use_skip_indexes_for_top_k: '1',
      query_plan_max_limit_for_top_k_optimization: '100000',
      use_top_k_dynamic_filtering: '1',
      use_skip_indexes_on_data_read: '1',
      use_skip_indexes_for_disjunctions: '1',
    });
  });

  it('should only apply available optimization settings', async () => {
    setupMockQuery([
      { name: 'use_skip_indexes_for_top_k', value: '1' },
      { name: 'use_skip_indexes_on_data_read', value: '1' },
    ]);

    await client.query({
      query: 'SELECT 1',
      format: 'JSON',
    });

    const actualQueryCall = mockQueryMethod.mock.calls.find(
      (call: any) => call[0].query === 'SELECT 1',
    );

    expect(actualQueryCall).toBeDefined();
    const settings = actualQueryCall[0].clickhouse_settings;
    expect(settings).toEqual({
      allow_experimental_analyzer: 1,
      date_time_output_format: 'iso',
      wait_end_of_query: 0,
      cancel_http_readonly_queries_on_client_close: 1,
      use_skip_indexes_for_top_k: '1',
      use_skip_indexes_on_data_read: '1',
    });
    expect(settings.query_plan_optimize_lazy_materialization).toBeUndefined();
    expect(settings.use_top_k_dynamic_filtering).toBeUndefined();
  });

  it('should merge external clickhouse settings with optimization settings', async () => {
    setupMockQuery([{ name: 'use_skip_indexes_for_top_k', value: '1' }]);

    await client.query({
      query: 'SELECT 1',
      format: 'JSON',
      clickhouse_settings: {
        max_rows_to_read: '1000000',
      },
    });

    const actualQueryCall = mockQueryMethod.mock.calls.find(
      (call: any) => call[0].query === 'SELECT 1',
    );

    expect(actualQueryCall).toBeDefined();
    expect(actualQueryCall[0].clickhouse_settings).toEqual({
      allow_experimental_analyzer: 1,
      date_time_output_format: 'iso',
      wait_end_of_query: 0,
      cancel_http_readonly_queries_on_client_close: 1,
      use_skip_indexes_for_top_k: '1',
      max_rows_to_read: '1000000',
    });
  });

  it('should not apply settings when shouldSkipApplySettings is true', async () => {
    setupMockQuery([{ name: 'use_skip_indexes_for_top_k', value: '1' }]);

    await client.query({
      query: 'SELECT name, value FROM system.settings',
      format: 'JSON',
      shouldSkipApplySettings: true,
    });

    const settingsQueryCall = mockQueryMethod.mock.calls.find(
      (call: any) =>
        call[0].query === 'SELECT name, value FROM system.settings',
    );

    expect(settingsQueryCall).toBeDefined();
    expect(settingsQueryCall[0].clickhouse_settings).toBeUndefined();
  });

  it('should handle metadata getSettings returning undefined (permissions error)', async () => {
    mockQueryMethod.mockImplementation(async ({ query }: any) => {
      if (query === 'SELECT name, value FROM system.settings') {
        throw new Error('Not enough privileges');
      }
      return { json: async () => ({ data: [] }) };
    });

    // Should not throw, but silently continue without optimization settings
    await client.query({
      query: 'SELECT 1',
      format: 'JSON',
    });

    const actualQueryCall = mockQueryMethod.mock.calls.find(
      (call: any) => call[0].query === 'SELECT 1',
    );

    expect(actualQueryCall).toBeDefined();
    expect(actualQueryCall[0].clickhouse_settings).toEqual({
      allow_experimental_analyzer: 1,
      date_time_output_format: 'iso',
      wait_end_of_query: 0,
      cancel_http_readonly_queries_on_client_close: 1,
    });
  });

  it('should cache settings result across multiple queries', async () => {
    setupMockQuery([{ name: 'use_skip_indexes_for_top_k', value: '1' }]);

    // Run two queries
    await client.query({ query: 'SELECT 1', format: 'JSON' });
    await client.query({ query: 'SELECT 2', format: 'JSON' });

    // Should only fetch settings once
    const settingsCalls = mockQueryMethod.mock.calls.filter(
      (call: any) =>
        call[0].query === 'SELECT name, value FROM system.settings',
    );
    expect(settingsCalls.length).toEqual(1);
  });
});
