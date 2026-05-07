import MD5 from 'crypto-js/md5';
import { renderHook } from '@testing-library/react';

import { ColumnMetaType, JSDataType } from '@/clickhouse-types';

import useRowWhere, { processRowToWhereClause } from '../useRowWhere';

// Mock crypto-js/md5
jest.mock('crypto-js/md5');

// Mock convertCHDataTypeToJSType
jest.mock('@/clickhouse-types', () => ({
  ...jest.requireActual('@/clickhouse-types'),
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

    expect(result).toBe("created_at=cast('2024-01-01 00:00:00' as timestamp)");
  });

  // Berg: complex column types (array/map/json/tuple/dynamic) are
  // skipped from the row-WHERE entirely.  The MD5 round-trip we used
  // for these in the CH days can't be made reliable across Trino's
  // `json_format` and JavaScript's `JSON.stringify` — different
  // canonical forms silently mean the server-side hash never matches
  // the client-side hash.  Scalar columns (timestamp, service, primary
  // keys) are enough to identify a row in practice.
  it('skips array columns from row-WHERE', () => {
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

    expect(processRowToWhereClause({ tags: ['tag1', 'tag2'] }, columnMap)).toBe(
      '',
    );
  });

  it('skips map columns from row-WHERE', () => {
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

    expect(
      processRowToWhereClause({ attributes: { key: 'value' } }, columnMap),
    ).toBe('');
  });

  it('skips JSON columns from row-WHERE', () => {
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

    expect(
      processRowToWhereClause({ data: '{"key": "value"}' }, columnMap),
    ).toBe('');
  });

  it('skips Dynamic columns from row-WHERE', () => {
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

    expect(processRowToWhereClause({ dynamic_field: 'null' }, columnMap)).toBe(
      '',
    );
    expect(
      processRowToWhereClause({ dynamic_field: '"quoted_value"' }, columnMap),
    ).toBe('');
    expect(
      processRowToWhereClause(
        { dynamic_field: '{\\"took\\":7, not a valid json' },
        columnMap,
      ),
    ).toBe('');
    expect(
      processRowToWhereClause(
        { dynamic_field: "{'foo': {'bar': 'baz'}}" },
        columnMap,
      ),
    ).toBe('');
    expect(
      processRowToWhereClause({ dynamic_field: "['foo', 'bar']" }, columnMap),
    ).toBe('');
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
      `lower(to_hex(md5(cast(substr(description, 1, 1000) as varbinary))))='md5_${'a'.repeat(600)}'`,
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

  it('skips Tuple columns from row-WHERE', () => {
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

    expect(
      processRowToWhereClause(
        { coordinates: '{"s": "city", "i": 123}' },
        columnMap,
      ),
    ).toBe('');
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

    expect(result).toBe('event_created IS NULL');
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

    expect(result).toBe('name IS NULL');
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

    expect(result).toBe('description IS NULL');
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
    // Berg: `aliasWith` is always empty — Trino's WITH is CTE-only,
    // and the alias's underlying expression is already substituted
    // directly into `where` via the column map.
    expect(rowWhereResult.aliasWith).toEqual([]);
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
    expect(rowWhereResult.aliasWith).toEqual([]);
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
    expect(rowWhereResult.aliasWith).toEqual([]);
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
