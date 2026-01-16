import MD5 from 'crypto-js/md5';
import {
  ColumnMetaType,
  JSDataType,
} from '@hyperdx/common-utils/dist/clickhouse';
import { renderHook } from '@testing-library/react';

import useRowWhere, {
  expressionContainsAliasReferences,
  processRowToWhereClause,
} from '../useRowWhere';

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

describe('expressionContainsAliasReferences', () => {
  it('should return true when expression contains an alias as a column reference', () => {
    const aliasMap = {
      query_id: 'some_table.query_id',
    };

    // concat('text', query_id, 'more') - query_id is a column reference
    expect(
      expressionContainsAliasReferences(
        "concat('text', query_id, 'more')",
        aliasMap,
      ),
    ).toBe(true);
  });

  it('should return false when alias appears only in a string literal', () => {
    const aliasMap = {
      query_id: 'some_table.query_id',
    };

    // concat('query_id is here') - query_id is inside a string literal
    expect(
      expressionContainsAliasReferences("concat('query_id is here')", aliasMap),
    ).toBe(false);
  });

  it('should return false when expression does not contain any alias references', () => {
    const aliasMap = {
      query_id: 'some_table.query_id',
    };

    expect(
      expressionContainsAliasReferences('some_other_column', aliasMap),
    ).toBe(false);
  });

  it('should return false for simple column name that is not in aliasMap', () => {
    const aliasMap = {
      query_id: 'some_table.query_id',
    };

    expect(expressionContainsAliasReferences('timestamp', aliasMap)).toBe(
      false,
    );
  });

  it('should return true when expression has nested function calls with alias reference', () => {
    const aliasMap = {
      user_id: 'users.id',
      status: 'users.status',
    };

    expect(
      expressionContainsAliasReferences(
        "concat(toString(user_id), '-', status)",
        aliasMap,
      ),
    ).toBe(true);
  });

  it('should return false for empty aliasMap', () => {
    expect(
      expressionContainsAliasReferences("concat('text', query_id, 'more')", {}),
    ).toBe(false);
  });

  it('should handle multiple aliases and return true if any match', () => {
    const aliasMap = {
      col_a: 'table.a',
      col_b: 'table.b',
      col_c: 'table.c',
    };

    expect(
      expressionContainsAliasReferences("concat(col_b, '_suffix')", aliasMap),
    ).toBe(true);
  });

  it('should return false when parsing fails and fallback to safe default', () => {
    const aliasMap = {
      query_id: 'some_table.query_id',
    };

    // Invalid SQL expression should not throw, returns false as fallback
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    expect(expressionContainsAliasReferences('invalid sql (((', aliasMap)).toBe(
      false,
    );
    consoleSpy.mockRestore();
  });

  it('should return false for simple column expressions without aliases', () => {
    const aliasMap = {
      user_id: 'users.id',
    };

    // The expression itself is the column name, not a reference to another alias
    expect(expressionContainsAliasReferences('users.id', aliasMap)).toBe(false);
  });

  it('should handle expressions with arithmetic operators', () => {
    const aliasMap = {
      count: 'table.count',
    };

    expect(expressionContainsAliasReferences('count + 1', aliasMap)).toBe(true);
    expect(expressionContainsAliasReferences('other_col + 1', aliasMap)).toBe(
      false,
    );
  });
});

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

  it('should skip columns with containsAliasRefs set to true', () => {
    const columnMap = new Map([
      [
        'id',
        {
          name: 'id',
          type: 'String',
          valueExpr: 'id',
          jsType: JSDataType.String,
          containsAliasRefs: false,
        },
      ],
      [
        'computed_field',
        {
          name: 'computed_field',
          type: 'String',
          valueExpr: "concat('prefix_', other_alias)",
          jsType: JSDataType.String,
          containsAliasRefs: true,
        },
      ],
    ]);

    const row = { id: '123', computed_field: 'some_value' };
    const result = processRowToWhereClause(row, columnMap);

    // computed_field should be skipped because containsAliasRefs is true
    expect(result).toBe("id='123'");
  });

  it('should return empty string when all columns have containsAliasRefs', () => {
    const columnMap = new Map([
      [
        'computed_a',
        {
          name: 'computed_a',
          type: 'String',
          valueExpr: 'concat(alias_x)',
          jsType: JSDataType.String,
          containsAliasRefs: true,
        },
      ],
      [
        'computed_b',
        {
          name: 'computed_b',
          type: 'String',
          valueExpr: 'concat(alias_y)',
          jsType: JSDataType.String,
          containsAliasRefs: true,
        },
      ],
    ]);

    const row = { computed_a: 'val_a', computed_b: 'val_b' };
    const result = processRowToWhereClause(row, columnMap);

    expect(result).toBe('');
  });

  it('should handle mix of columns with and without alias refs', () => {
    const columnMap = new Map([
      [
        'timestamp',
        {
          name: 'timestamp',
          type: 'DateTime64',
          valueExpr: 'timestamp',
          jsType: JSDataType.Date,
          containsAliasRefs: false,
        },
      ],
      [
        'user_display',
        {
          name: 'user_display',
          type: 'String',
          valueExpr: "concat(user_name, ' <', email, '>')",
          jsType: JSDataType.String,
          containsAliasRefs: true,
        },
      ],
      [
        'status',
        {
          name: 'status',
          type: 'String',
          valueExpr: 'status',
          jsType: JSDataType.String,
          containsAliasRefs: false,
        },
      ],
    ]);

    const row = {
      timestamp: '2024-01-01T00:00:00Z',
      user_display: 'John Doe <john@example.com>',
      status: 'active',
    };
    const result = processRowToWhereClause(row, columnMap);

    // user_display should be skipped
    expect(result).toBe(
      "timestamp=parseDateTime64BestEffort('2024-01-01T00:00:00Z', 9) AND status='active'",
    );
  });

  it('should default containsAliasRefs to false when not provided', () => {
    const columnMap = new Map([
      [
        'name',
        {
          name: 'name',
          type: 'String',
          valueExpr: 'name',
          jsType: JSDataType.String,
          // containsAliasRefs not provided
        },
      ],
    ]);

    const row = { name: 'test' };
    const result = processRowToWhereClause(row, columnMap);

    // Should work normally, treating missing containsAliasRefs as false
    expect(result).toBe("name='test'");
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
    const whereClause = result.current(row);

    expect(whereClause).toBe("id='123' AND status='active'");
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
    const whereClause = result.current(row);

    expect(whereClause).toBe("users.id='123' AND users.status='active'");
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
    const whereClause = result.current(row);

    expect(whereClause).toBe("users.id='123' AND status='active'");
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
    const whereClause = result.current(row);

    expect(whereClause).toBe("users.id='123' AND status='active'");
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

  it('should skip columns with expressions that reference other aliases', () => {
    const meta: ColumnMetaType[] = [
      { name: 'timestamp', type: 'DateTime64' },
      { name: 'query_id', type: 'String' },
      { name: 'computed_col', type: 'String' },
    ];

    // query_id is an alias, and computed_col's expression references it
    const aliasMap = {
      timestamp: 'events.timestamp',
      query_id: 'events.query_id',
      computed_col: "concat('prefix_', query_id)", // references query_id alias
    };

    const { result } = renderHook(() => useRowWhere({ meta, aliasMap }));

    const row = {
      timestamp: '2024-01-01T00:00:00Z',
      query_id: 'qid_456',
      computed_col: 'prefix_qid_456',
    };
    const whereClause = result.current(row);

    // computed_col should be skipped because its expression references the query_id alias
    expect(whereClause).toBe(
      "events.timestamp=parseDateTime64BestEffort('2024-01-01T00:00:00Z', 9) AND events.query_id='qid_456'",
    );
  });

  it('should not skip columns when expression contains alias name in string literal only', () => {
    const meta: ColumnMetaType[] = [
      { name: 'timestamp', type: 'DateTime64' },
      { name: 'query_id', type: 'String' },
      { name: 'label', type: 'String' },
    ];

    const aliasMap = {
      timestamp: 'events.timestamp',
      query_id: 'events.query_id',
      label: "concat('query_id: ', some_other_column)", // 'query_id' is in string literal only, some_other_column is NOT an alias
    };

    const { result } = renderHook(() => useRowWhere({ meta, aliasMap }));

    const row = {
      timestamp: '2024-01-01T00:00:00Z',
      query_id: 'qid_456',
      label: 'query_id: 123',
    };
    const whereClause = result.current(row);

    // All columns should be included since 'query_id' appears only in a string literal
    // and some_other_column is not an alias
    expect(whereClause).toContain(
      "events.timestamp=parseDateTime64BestEffort('2024-01-01T00:00:00Z', 9)",
    );
    expect(whereClause).toContain("events.query_id='qid_456'");
    expect(whereClause).toContain("concat('query_id: ', some_other_column)");
  });

  it('should handle complex nested expressions with alias references', () => {
    const meta: ColumnMetaType[] = [
      { name: 'timestamp', type: 'DateTime64' },
      { name: 'user_id', type: 'String' },
      { name: 'display_name', type: 'String' },
    ];

    const aliasMap = {
      timestamp: 'events.timestamp',
      user_id: 'events.user_id',
      display_name:
        "concat(toString(user_id), ' - ', formatDateTime(timestamp, '%Y-%m-%d'))",
    };

    const { result } = renderHook(() => useRowWhere({ meta, aliasMap }));

    const row = {
      timestamp: '2024-01-01T00:00:00Z',
      user_id: 'user_123',
      display_name: 'user_123 - 2024-01-01',
    };
    const whereClause = result.current(row);

    // display_name should be skipped because it references both user_id and timestamp aliases
    expect(whereClause).toBe(
      "events.timestamp=parseDateTime64BestEffort('2024-01-01T00:00:00Z', 9) AND events.user_id='user_123'",
    );
  });

  it('should include all columns when no alias references exist', () => {
    const meta: ColumnMetaType[] = [
      { name: 'id', type: 'String' },
      { name: 'name', type: 'String' },
      { name: 'computed', type: 'String' },
    ];

    const aliasMap = {
      id: 'users.id',
      name: 'users.name',
      computed: "concat(first_name, ' ', last_name)", // first_name and last_name are not aliases
    };

    const { result } = renderHook(() => useRowWhere({ meta, aliasMap }));

    const row = { id: '123', name: 'John', computed: 'John Doe' };
    const whereClause = result.current(row);

    // All columns should be included since no alias references are detected
    expect(whereClause).toBe(
      "users.id='123' AND users.name='John' AND concat(first_name, ' ', last_name)='John Doe'",
    );
  });

  it('should handle aliasMap with undefined values correctly', () => {
    const meta: ColumnMetaType[] = [
      { name: 'id', type: 'String' },
      { name: 'status', type: 'String' },
    ];

    const aliasMap: Record<string, string | undefined> = {
      id: 'users.id',
      status: undefined, // undefined means use column name
    };

    const { result } = renderHook(() => useRowWhere({ meta, aliasMap }));

    const row = { id: '123', status: 'active' };
    const whereClause = result.current(row);

    // status uses column name since alias is undefined
    expect(whereClause).toBe("users.id='123' AND status='active'");
  });
});
