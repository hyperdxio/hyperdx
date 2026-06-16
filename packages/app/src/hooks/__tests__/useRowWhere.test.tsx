import MD5 from 'crypto-js/md5';
import {
  ColumnMetaType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { renderHook } from '@testing-library/react';

import useRowWhere, { processRowToWhereClause } from '../useRowWhere';

// Mock crypto-js/md5
jest.mock('crypto-js/md5');

// Mock convertCHDataTypeToJSType
jest.mock('@hyperdx/common-utils/dist/clickhouse', () => ({
  ...jest.requireActual('@hyperdx/common-utils/dist/clickhouse'),
  convertCHDataTypeToJSType: jest.fn((type: string) => {
    const typeMap: Record<string, JSDataType> = {
      String: JSDataType.String,
      DateTime64: JSDataType.Date,
      'Array(String)': JSDataType.Array,
      'Map(String, String)': JSDataType.Map,
      JSON: JSDataType.JSON,
      Dynamic: JSDataType.Dynamic,
      Int32: JSDataType.Number,
      'Tuple(String, Int32)': JSDataType.Tuple,
    };
    return typeMap[type] || JSDataType.String;
  }),
}));

describe('processRowToWhereClause', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (MD5 as jest.Mock).mockImplementation((value: string) => ({
      toString: () => `md5_${value}`,
    }));
  });

  it('should handle string columns', () => {
    const columnMap = new Map([
      [
        'name',
        {
          name: 'name',
          type: 'String',
          valueExpr: 'name',
          jsType: JSDataType.String,
        },
      ],
    ]);

    const row = { name: 'test' };
    const result = processRowToWhereClause(row, columnMap);

    expect(result).toBe("name='test'");
  });

  it('should handle date columns', () => {
    const columnMap = new Map([
      [
        'created_at',
        {
          name: 'created_at',
          type: 'DateTime64',
          valueExpr: 'created_at',
          jsType: JSDataType.Date,
        },
      ],
    ]);

    const row = { created_at: '2024-01-01T00:00:00Z' };
    const result = processRowToWhereClause(row, columnMap);

    expect(result).toBe(
      "created_at=parseDateTime64BestEffort('2024-01-01T00:00:00Z', 9)",
    );
  });

  it('should handle array columns', () => {
    const columnMap = new Map([
      [
        'tags',
        {
          name: 'tags',
          type: 'Array(String)',
          valueExpr: 'tags',
          jsType: JSDataType.Array,
        },
      ],
    ]);

    const row = { tags: ['tag1', 'tag2'] };
    const result = processRowToWhereClause(row, columnMap);

    expect(result).toBe("tags=JSONExtract('tag1', 'tag2', 'Array(String)')");
  });

  it('should handle map columns', () => {
    const columnMap = new Map([
      [
        'attributes',
        {
          name: 'attributes',
          type: 'Map(String, String)',
          valueExpr: 'attributes',
          jsType: JSDataType.Map,
        },
      ],
    ]);

    const row = { attributes: { key: 'value' } };
    const result = processRowToWhereClause(row, columnMap);

    expect(result).toBe(
      "attributes=JSONExtract(`key` = 'value', 'Map(String, String)')",
    );
  });

  it('should handle JSON columns with MD5', () => {
    const columnMap = new Map([
      [
        'data',
        {
          name: 'data',
          type: 'JSON',
          valueExpr: 'data',
          jsType: JSDataType.JSON,
        },
      ],
    ]);

    const row = { data: '{"key": "value"}' };
    const result = processRowToWhereClause(row, columnMap);

    expect(result).toBe(
      'lower(hex(MD5(toString(data))))=\'md5_{\\"key\\": \\"value\\"}\'',
    );
    expect(MD5).toHaveBeenCalledWith('{"key": "value"}');
  });

  it('should handle Dynamic columns with null value', () => {
    const columnMap = new Map([
      [
        'dynamic_field',
        {
          name: 'dynamic_field',
          type: 'Dynamic',
          valueExpr: 'dynamic_field',
          jsType: JSDataType.Dynamic,
        },
      ],
    ]);

    const row = { dynamic_field: 'null' };
    const result = processRowToWhereClause(row, columnMap);

    expect(result).toBe('isNull(`dynamic_field`)');
  });

  it('should handle Dynamic columns with quoted string', () => {
    const columnMap = new Map([
      [
        'dynamic_field',
        {
          name: 'dynamic_field',
          type: 'Dynamic',
          valueExpr: 'dynamic_field',
          jsType: JSDataType.Dynamic,
        },
      ],
    ]);

    const row = { dynamic_field: '"quoted_value"' };
    const result = processRowToWhereClause(row, columnMap);

    expect(result).toBe(
      "toJSONString(dynamic_field) = coalesce(toJSONString(JSONExtract('\\\"quoted_value\\\"', 'Dynamic')), toJSONString('\\\"quoted_value\\\"'))",
    );
  });

  it('should handle Dynamic columns with escaped values', () => {
    const columnMap = new Map([
      [
        'dynamic_field',
        {
          name: 'dynamic_field',
          type: 'Dynamic',
          valueExpr: 'dynamic_field',
          jsType: JSDataType.Dynamic,
        },
      ],
    ]);

    const row = { dynamic_field: '{\\"took\\":7, not a valid json' };
    const result = processRowToWhereClause(row, columnMap);
    expect(result).toBe(
      "toJSONString(dynamic_field) = coalesce(toJSONString(JSONExtract('{\\\\\\\"took\\\\\\\":7, not a valid json', 'Dynamic')), toJSONString('{\\\\\\\"took\\\\\\\":7, not a valid json'))",
    );
  });

  it('should handle Dynamic columns with nested values', () => {
    const columnMap = new Map([
      [
        'dynamic_field',
        {
          name: 'dynamic_field',
          type: 'Dynamic',
          valueExpr: 'dynamic_field',
          jsType: JSDataType.Dynamic,
        },
      ],
    ]);

    const row = { dynamic_field: "{'foo': {'bar': 'baz'}}" };
    const result = processRowToWhereClause(row, columnMap);
    expect(result).toBe(
      "toJSONString(dynamic_field) = coalesce(toJSONString(JSONExtract('{\\'foo\\': {\\'bar\\': \\'baz\\'}}', 'Dynamic')), toJSONString('{\\'foo\\': {\\'bar\\': \\'baz\\'}}'))",
    );
  });

  it('should handle Dynamic columns with array values', () => {
    const columnMap = new Map([
      [
        'dynamic_field',
        {
          name: 'dynamic_field',
          type: 'Dynamic',
          valueExpr: 'dynamic_field',
          jsType: JSDataType.Dynamic,
        },
      ],
    ]);

    const row = { dynamic_field: "['foo', 'bar']" };
    const result = processRowToWhereClause(row, columnMap);
    expect(result).toBe(
      "toJSONString(dynamic_field) = coalesce(toJSONString(JSONExtract('[\\'foo\\', \\'bar\\']', 'Dynamic')), toJSONString('[\\'foo\\', \\'bar\\']'))",
    );
  });

  it('should handle long strings with MD5', () => {
    const columnMap = new Map([
      [
        'description',
        {
          name: 'description',
          type: 'String',
          valueExpr: 'description',
          jsType: JSDataType.String,
        },
      ],
    ]);

    const longString = 'a'.repeat(600);
    const row = { description: longString };
    const result = processRowToWhereClause(row, columnMap);

    expect(result).toBe(
      `lower(hex(MD5(leftUTF8(description, 1000))))='md5_${'a'.repeat(600)}'`,
    );
    expect(MD5).toHaveBeenCalledWith('a'.repeat(600));
  });

  it('should handle multiple columns with AND', () => {
    const columnMap = new Map([
      [
        'name',
        {
          name: 'name',
          type: 'String',
          valueExpr: 'name',
          jsType: JSDataType.String,
        },
      ],
      [
        'age',
        {
          name: 'age',
          type: 'Int32',
          valueExpr: 'age',
          jsType: JSDataType.Number,
        },
      ],
    ]);

    const row = { name: 'test', age: 25 };
    const result = processRowToWhereClause(row, columnMap);

    expect(result).toBe("name='test' AND age=25");
  });

  it('should use custom valueExpr when provided', () => {
    const columnMap = new Map([
      [
        'alias_name',
        {
          name: 'alias_name',
          type: 'String',
          valueExpr: 'original_column',
          jsType: JSDataType.String,
        },
      ],
    ]);

    const row = { alias_name: 'test' };
    const result = processRowToWhereClause(row, columnMap);

    expect(result).toBe("original_column='test'");
  });

  it('should handle Tuple columns', () => {
    const columnMap = new Map([
      [
        'coordinates',
        {
          name: 'coordinates',
          type: 'Tuple(String, Int32)',
          valueExpr: 'coordinates',
          jsType: JSDataType.Tuple,
        },
      ],
    ]);

    const row = { coordinates: '{"s": "city", "i": 123}' };
    const result = processRowToWhereClause(row, columnMap);

    expect(result).toBe(
      'toJSONString(coordinates)=\'{\\"s\\": \\"city\\", \\"i\\": 123}\'',
    );
  });

  it('should handle null value on Date column', () => {
    const columnMap = new Map([
      [
        'event_created',
        {
          name: 'event_created',
          type: "Nullable(DateTime64(3, 'UTC'))",
          valueExpr: 'event_created',
          jsType: JSDataType.Date,
        },
      ],
    ]);

    const row = { event_created: null };
    const result = processRowToWhereClause(row, columnMap);

    expect(result).toBe('isNull(event_created)');
  });

  it('should handle null value in default block', () => {
    const columnMap = new Map([
      [
        'name',
        {
          name: 'name',
          type: 'String',
          valueExpr: 'name',
          jsType: JSDataType.String,
        },
      ],
    ]);

    const row = { name: null };
    const result = processRowToWhereClause(row, columnMap);

    expect(result).toBe('isNull(name)');
  });

  it('should handle undefined value in default block', () => {
    const columnMap = new Map([
      [
        'description',
        {
          name: 'description',
          type: 'String',
          valueExpr: 'description',
          jsType: JSDataType.String,
        },
      ],
    ]);

    const row = { description: undefined };
    const result = processRowToWhereClause(row, columnMap);

    expect(result).toBe('isNull(description)');
  });

  it('should throw error when column type not found', () => {
    const columnMap = new Map();

    const row = { unknown_column: 'test' };

    expect(() => processRowToWhereClause(row, columnMap)).toThrow(
      'Column type not found for unknown_column',
    );
  });

  it('should throw error when valueExpr not found', () => {
    const columnMap = new Map([
      [
        'test',
        {
          name: 'test',
          type: 'String',
          valueExpr: null as any,
          jsType: JSDataType.String,
        },
      ],
    ]);

    const row = { test: 'value' };

    expect(() => processRowToWhereClause(row, columnMap)).toThrow(
      'valueExpr not found for test',
    );
  });
});

describe('useRowWhere', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (MD5 as jest.Mock).mockImplementation((value: string) => ({
      toString: () => `md5_${value}`,
    }));
  });

  it('should return a function that processes rows', () => {
    const meta: ColumnMetaType[] = [
      { name: 'id', type: 'String' },
      { name: 'status', type: 'String' },
    ];

    const { result } = renderHook(() => useRowWhere({ meta }));

    expect(typeof result.current).toBe('function');
  });

  it('should handle rows with meta', () => {
    const meta: ColumnMetaType[] = [
      { name: 'id', type: 'String' },
      { name: 'status', type: 'String' },
    ];

    const { result } = renderHook(() => useRowWhere({ meta }));

    const row = { id: '123', status: 'active' };
    const rowWhereResult = result.current(row);

    expect(rowWhereResult.where).toBe("id='123' AND status='active'");
    expect(rowWhereResult.aliasWith).toEqual([]);
  });

  it('should handle aliasMap correctly', () => {
    const meta: ColumnMetaType[] = [
      { name: 'user_id', type: 'String' },
      { name: 'user_status', type: 'String' },
    ];

    const aliasMap = {
      user_id: 'users.id',
      user_status: 'users.status',
    };

    const { result } = renderHook(() => useRowWhere({ meta, aliasMap }));

    const row = { user_id: '123', user_status: 'active' };
    const rowWhereResult = result.current(row);

    expect(rowWhereResult.where).toBe(
      "users.id='123' AND users.status='active'",
    );
    expect(rowWhereResult.aliasWith).toEqual([
      {
        name: 'user_id',
        sql: { sql: 'users.id', params: {} },
        isSubquery: false,
      },
      {
        name: 'user_status',
        sql: { sql: 'users.status', params: {} },
        isSubquery: false,
      },
    ]);
  });

  it('should use column name when alias not found in aliasMap', () => {
    const meta: ColumnMetaType[] = [
      { name: 'id', type: 'String' },
      { name: 'status', type: 'String' },
    ];

    const aliasMap = {
      id: 'users.id',
      // status is not in aliasMap
    };

    const { result } = renderHook(() => useRowWhere({ meta, aliasMap }));

    const row = { id: '123', status: 'active' };
    const rowWhereResult = result.current(row);

    expect(rowWhereResult.where).toBe("users.id='123' AND status='active'");
    expect(rowWhereResult.aliasWith).toEqual([
      { name: 'id', sql: { sql: 'users.id', params: {} }, isSubquery: false },
    ]);
  });

  it('should handle undefined alias values in aliasMap', () => {
    const meta: ColumnMetaType[] = [
      { name: 'id', type: 'String' },
      { name: 'status', type: 'String' },
    ];

    const aliasMap = {
      id: 'users.id',
      status: undefined,
    };

    const { result } = renderHook(() => useRowWhere({ meta, aliasMap }));

    const row = { id: '123', status: 'active' };
    const rowWhereResult = result.current(row);

    expect(rowWhereResult.where).toBe("users.id='123' AND status='active'");
    expect(rowWhereResult.aliasWith).toEqual([
      { name: 'id', sql: { sql: 'users.id', params: {} }, isSubquery: false },
    ]);
  });

  it('should memoize the column map', () => {
    const meta: ColumnMetaType[] = [{ name: 'id', type: 'String' }];

    const { result, rerender } = renderHook(props => useRowWhere(props), {
      initialProps: { meta },
    });

    const firstCallback = result.current;

    // Rerender with same props
    rerender({ meta });

    const secondCallback = result.current;

    // Callback should be the same reference
    expect(firstCallback).toBe(secondCallback);
  });

  it('should update callback when meta changes', () => {
    const meta1: ColumnMetaType[] = [{ name: 'id', type: 'String' }];

    const meta2: ColumnMetaType[] = [
      { name: 'id', type: 'String' },
      { name: 'status', type: 'String' },
    ];

    const { result, rerender } = renderHook(props => useRowWhere(props), {
      initialProps: { meta: meta1 },
    });

    const firstCallback = result.current;

    // Rerender with different meta
    rerender({ meta: meta2 });

    const secondCallback = result.current;

    // Callback should be different
    expect(firstCallback).not.toBe(secondCallback);
  });

  it('should handle empty meta', () => {
    const { result } = renderHook(() => useRowWhere({ meta: [] }));

    const row = { id: '123' };

    expect(() => result.current(row)).toThrow('Column type not found for id');
  });

  it('should handle undefined meta', () => {
    const { result } = renderHook(() => useRowWhere({ meta: undefined }));

    const row = { id: '123' };

    expect(() => result.current(row)).toThrow('Column type not found for id');
  });

  it('should filter to only primaryKeyColumns when provided', () => {
    const meta: ColumnMetaType[] = [
      { name: 'Timestamp', type: 'DateTime64' },
      { name: 'ServiceName', type: 'String' },
      { name: 'Body', type: 'String' },
      { name: '__hdx_id', type: 'String' },
    ];

    const primaryKeyColumns = new Set(['Timestamp', 'ServiceName', '__hdx_id']);

    const { result } = renderHook(() =>
      useRowWhere({ meta, primaryKeyColumns }),
    );

    const row = {
      Timestamp: '2024-01-01T00:00:00Z',
      ServiceName: 'my-service',
      Body: 'a very long log message that should not be in the WHERE clause',
      __hdx_id: 'abc123',
    };
    const rowWhereResult = result.current(row);

    // Body should NOT be in the WHERE clause
    expect(rowWhereResult.where).not.toContain('Body');
    expect(rowWhereResult.where).toContain('Timestamp');
    expect(rowWhereResult.where).toContain('ServiceName');
    expect(rowWhereResult.where).toContain('__hdx_id');
  });

  it('should use all columns when primaryKeyColumns is not provided', () => {
    const meta: ColumnMetaType[] = [
      { name: 'id', type: 'String' },
      { name: 'Body', type: 'String' },
    ];

    const { result } = renderHook(() => useRowWhere({ meta }));

    const row = { id: '123', Body: 'hello' };
    const rowWhereResult = result.current(row);

    expect(rowWhereResult.where).toBe("id='123' AND Body='hello'");
  });

  // Tests matching actual ClickHouse schemas in docker/otel-collector/schema/seed/
  // These simulate the full row data a user would see and verify that only
  // PK + partition + block columns end up in the WHERE clause.

  it('otel_logs schema: only PK/partition/block columns in WHERE, Body and SeverityText excluded', () => {
    // meta only contains actual columns — expression-based PK entries like
    // toStartOfFiveMinutes(Timestamp) don't appear as result columns.
    const meta: ColumnMetaType[] = [
      { name: 'Timestamp', type: "DateTime64(9, 'UTC')" },
      { name: 'ServiceName', type: 'String' },
      { name: 'SeverityText', type: 'String' },
      { name: 'Body', type: 'String' },
      { name: '_block_number', type: 'UInt64' },
      { name: '_block_offset', type: 'UInt64' },
    ];

    // primaryKeyColumns includes expression names from the raw PK even though
    // they won't match any row key — the filter silently skips them.
    const primaryKeyColumns = new Set([
      'Timestamp',
      'ServiceName',
      'toDate(Timestamp)',
      'toStartOfFiveMinutes(Timestamp)',
      '_block_number',
      '_block_offset',
    ]);

    const { result } = renderHook(() =>
      useRowWhere({ meta, primaryKeyColumns }),
    );

    const row = {
      Timestamp: '2026-05-20T21:20:00.123456789Z',
      ServiceName: 'api-server',
      SeverityText: 'ERROR',
      Body: 'Connection refused to downstream service after 30s timeout',
      _block_number: '2668',
      _block_offset: '4',
    };

    const rowWhereResult = result.current(row);

    // Non-PK columns must NOT appear
    expect(rowWhereResult.where).not.toContain('Body');
    expect(rowWhereResult.where).not.toContain('SeverityText');

    // Actual PK column references and block columns must appear
    expect(rowWhereResult.where).toContain('Timestamp');
    expect(rowWhereResult.where).toContain('ServiceName');
    expect(rowWhereResult.where).toContain('_block_number');
    expect(rowWhereResult.where).toContain('_block_offset');
  });

  it('otel_traces schema: only PK/partition/block columns in WHERE, Duration and StatusCode excluded', () => {
    const meta: ColumnMetaType[] = [
      { name: 'Timestamp', type: "DateTime64(9, 'UTC')" },
      { name: 'ServiceName', type: 'String' },
      { name: 'SpanName', type: 'String' },
      { name: 'Duration', type: 'Int64' },
      { name: 'StatusCode', type: 'String' },
      { name: '_block_number', type: 'UInt64' },
      { name: '_block_offset', type: 'UInt64' },
    ];

    const primaryKeyColumns = new Set([
      'Timestamp',
      'ServiceName',
      'SpanName',
      'toDate(Timestamp)',
      'toDateTime(Timestamp)',
      '_block_number',
      '_block_offset',
    ]);

    const { result } = renderHook(() =>
      useRowWhere({ meta, primaryKeyColumns }),
    );

    const row = {
      Timestamp: '2026-05-20T21:20:00.123456789Z',
      ServiceName: 'api-server',
      SpanName: 'GET /api/users',
      Duration: '150000000',
      StatusCode: 'STATUS_CODE_ERROR',
      _block_number: '100',
      _block_offset: '7',
    };

    const rowWhereResult = result.current(row);

    expect(rowWhereResult.where).not.toContain('Duration');
    expect(rowWhereResult.where).not.toContain('StatusCode');

    expect(rowWhereResult.where).toContain('ServiceName');
    expect(rowWhereResult.where).toContain('SpanName');
    expect(rowWhereResult.where).toContain('_block_number');
    expect(rowWhereResult.where).toContain('_block_offset');
  });

  it('otel_logs schema with __hdx_id in PK: hash column included, Body excluded', () => {
    const meta: ColumnMetaType[] = [
      { name: 'Timestamp', type: "DateTime64(9, 'UTC')" },
      { name: 'ServiceName', type: 'String' },
      { name: 'SeverityText', type: 'String' },
      { name: 'Body', type: 'String' },
      { name: '__hdx_id', type: 'String' },
      { name: '_block_number', type: 'UInt64' },
      { name: '_block_offset', type: 'UInt64' },
    ];

    const primaryKeyColumns = new Set([
      'Timestamp',
      'ServiceName',
      '__hdx_id',
      'toDate(Timestamp)',
      'toStartOfFiveMinutes(Timestamp)',
      '_block_number',
      '_block_offset',
    ]);

    const { result } = renderHook(() =>
      useRowWhere({ meta, primaryKeyColumns }),
    );

    const row = {
      Timestamp: '2026-05-20T21:20:00.123456789Z',
      ServiceName: 'api-server',
      SeverityText: 'INFO',
      Body: 'Request completed successfully with 200 OK',
      __hdx_id: 'a1b2c3d4e5f6',
      _block_number: '500',
      _block_offset: '12',
    };

    const rowWhereResult = result.current(row);

    expect(rowWhereResult.where).not.toContain('Body');
    expect(rowWhereResult.where).not.toContain('SeverityText');

    expect(rowWhereResult.where).toContain('Timestamp');
    expect(rowWhereResult.where).toContain('__hdx_id');
    expect(rowWhereResult.where).toContain('ServiceName');
    expect(rowWhereResult.where).toContain('_block_number');
    expect(rowWhereResult.where).toContain('_block_offset');
  });
});
