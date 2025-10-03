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

    expect(result).toBe("toString(`dynamic_field`)='quoted_value'");
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

    const row = { dynamic_field: '{\\"took\\":7, this ins\'t a valid json' };
    const result = processRowToWhereClause(row, columnMap);
    expect(result).toBe(
      "toString(`dynamic_field`)='{\\\"took\\\":7, this ins't a valid json'",
    );
  });

  it('should handle Dynamic columns with delimited identifier', () => {
    const columnMap = new Map([
      [
        'dynamic_field.nested.needs\\toBeEscaped',
        {
          name: 'dynamic_field.nested\\ToBeEscaped',
          type: 'Dynamic',
          valueExpr: 'dynamic_field.nested.needs\\ToBeEscaped',
          jsType: JSDataType.Dynamic,
        },
      ],
    ]);

    const row = { 'dynamic_field.nested.needs\\toBeEscaped': 'some string' };
    const result = processRowToWhereClause(row, columnMap);
    expect(result).toBe(
      `toString(\`dynamic_field\`.\`nested\`.\`needs\\ToBeEscaped\`)='some string'`,
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
});
