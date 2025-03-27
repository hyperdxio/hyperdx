import {
  ChSql,
  chSqlToAliasMap,
  convertCHDataTypeToJSType,
  JSDataType,
} from '@/clickhouse';

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
});
