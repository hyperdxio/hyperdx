import { ResponseJSON } from '@clickhouse/client-common';

import {
  ChSql,
  chSqlToAliasMap,
  computeRatio,
  computeResultSetRatio,
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
