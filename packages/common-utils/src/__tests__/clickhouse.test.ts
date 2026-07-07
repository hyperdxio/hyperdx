import { ResponseJSON } from '@clickhouse/client';

import {
  ChSql,
  chSqlToAliasMap,
  computeRatio,
  computeResultSetRatio,
  convertCHDataTypeToJSType,
  JSDataType,
  mergeResultSets,
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

describe('chSqlToAliasMap - resilient parsing of ClickHouse-specific SQL', () => {
  // A sampling CTE renders `greatest(CAST(total / N AS UInt32), 1)`. The
  // `CAST(... AS UInt32)` cast is rejected by node-sql-parser's Postgresql
  // dialect, so the full statement no longer parses. Before the outer-
  // projection fallback this returned `{}`, which dropped every alias and
  // broke filters on select-alias columns (Event Patterns, histogram, alerts).
  const samplingCte =
    'WITH tableStats AS (SELECT count() as total, greatest(CAST(total / 10000 AS UInt32), 1) as sample_factor FROM db.t)';
  const samplingWhere =
    'cityHash64(Timestamp, rand()) % (SELECT sample_factor FROM tableStats) = 0';

  it('recovers plain aliases when a sampling CTE makes the full query unparseable', () => {
    const chSqlInput: ChSql = {
      sql: `${samplingCte} SELECT ServiceName as service, Timestamp as ts FROM db.t WHERE ${samplingWhere} GROUP BY service, ts`,
      params: {},
    };
    expect(chSqlToAliasMap(chSqlInput)).toEqual({
      service: 'ServiceName',
      ts: 'Timestamp',
    });
  });

  it('recovers bracket (map-access) aliases through the fallback', () => {
    const chSqlInput: ChSql = {
      sql: `${samplingCte} SELECT ResourceAttributes['service.name'] as svc, Timestamp as ts FROM db.t WHERE ${samplingWhere}`,
      params: {},
    };
    expect(chSqlToAliasMap(chSqlInput)).toEqual({
      svc: "ResourceAttributes['service.name']",
      ts: 'Timestamp',
    });
  });

  it('recovers expression aliases through the fallback', () => {
    const chSqlInput: ChSql = {
      sql: `${samplingCte} SELECT toString(SpanId) as span, ServiceName as service FROM db.t WHERE ${samplingWhere}`,
      params: {},
    };
    expect(chSqlToAliasMap(chSqlInput)).toEqual({
      span: 'toString(SpanId)',
      service: 'ServiceName',
    });
  });

  it('restores JSON-path aliases recovered through the fallback', () => {
    const chSqlInput: ChSql = {
      sql: `${samplingCte} SELECT ResourceAttributes.service.name as service, Timestamp as ts FROM db.t WHERE ${samplingWhere}`,
      params: {},
    };
    expect(chSqlToAliasMap(chSqlInput)).toEqual({
      service: 'ResourceAttributes.service.name',
      ts: 'Timestamp',
    });
  });

  it('ignores SELECT / FROM keywords inside string literals in the CTE', () => {
    const chSqlInput: ChSql = {
      sql: `WITH cte AS (SELECT 'a SELECT b FROM c literal' as lit, greatest(CAST(count() / 10 AS UInt32), 1) as sf FROM db.t) SELECT ServiceName as service FROM db.t WHERE rand() % (SELECT sf FROM cte) = 0`,
      params: {},
    };
    expect(chSqlToAliasMap(chSqlInput)).toEqual({
      service: 'ServiceName',
    });
  });

  it('ignores SELECT / FROM keywords inside SQL comments', () => {
    const chSqlInput: ChSql = {
      sql: `${samplingCte} SELECT /* not a real SELECT ... FROM */ ServiceName as service, -- trailing SELECT x FROM y\n Timestamp as ts FROM db.t WHERE ${samplingWhere}`,
      params: {},
    };
    expect(chSqlToAliasMap(chSqlInput)).toEqual({
      service: 'ServiceName',
      ts: 'Timestamp',
    });
  });

  it('returns an empty map when neither the full query nor the projection parses', () => {
    const chSqlInput: ChSql = {
      sql: 'NOT VALID SQL AT ALL )(',
      params: {},
    };
    expect(chSqlToAliasMap(chSqlInput)).toEqual({});
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

    const result = computeResultSetRatio(mockResultSet, {
      numeratorName: 'requests',
      denominatorName: 'errors',
    });

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

    const result = computeResultSetRatio(mockResultSet, {
      numeratorName: 'requests',
      denominatorName: 'errors',
    });

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

    const result = computeResultSetRatio(mockResultSet, {
      numeratorName: 'requests',
      denominatorName: 'errors',
    });

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

    // Denominator operand does not exist in the meta -> can't compute.
    expect(() =>
      computeResultSetRatio(mockResultSet, {
        numeratorName: 'requests',
        denominatorName: 'errors',
      }),
    ).toThrow(/Unable to compute ratio/);
  });

  it('computes a grouped ratio as each group own rate by default (per_group)', () => {
    // Joined meta seeds the two value columns first, then the group + timestamp
    // columns (mirrors queryChartConfig's merge output).
    const mockResultSet: ResponseJSON<any> = {
      meta: [
        { name: 'errors', type: 'UInt64' },
        { name: 'total', type: 'UInt64' },
        { name: 'tenant', type: 'String' },
        { name: 'timestamp', type: 'DateTime' },
      ],
      data: [
        { errors: '20', total: '100', tenant: 'acme', timestamp: 't0' },
        { errors: '30', total: '100', tenant: 'globex', timestamp: 't0' },
        { errors: '10', total: '100', tenant: 'acme', timestamp: 't1' },
      ],
      rows: 3,
      statistics: { elapsed: 0.1, rows_read: 3, bytes_read: 100 },
    };

    const result = computeResultSetRatio(mockResultSet, {
      numeratorName: 'errors',
      denominatorName: 'total',
    });

    // ratio column + carried-through group + timestamp
    expect(result.meta.map(m => m.name)).toEqual([
      'errors/total',
      'tenant',
      'timestamp',
    ]);
    // Each group divided by its own denominator (per-group rate), not a shared
    // bucket total.
    expect(result.data).toEqual([
      { 'errors/total': 0.2, tenant: 'acme', timestamp: 't0' }, // 20/100
      { 'errors/total': 0.3, tenant: 'globex', timestamp: 't0' }, // 30/100
      { 'errors/total': 0.1, tenant: 'acme', timestamp: 't1' }, // 10/100
    ]);
  });

  it('computes a grouped ratio as each group share of the per-bucket total in share_of_total mode (lines sum to the overall)', () => {
    const mockResultSet: ResponseJSON<any> = {
      meta: [
        { name: 'errors', type: 'UInt64' },
        { name: 'total', type: 'UInt64' },
        { name: 'tenant', type: 'String' },
        { name: 'timestamp', type: 'DateTime' },
      ],
      data: [
        { errors: '20', total: '100', tenant: 'acme', timestamp: 't0' },
        { errors: '30', total: '100', tenant: 'globex', timestamp: 't0' },
        { errors: '10', total: '100', tenant: 'acme', timestamp: 't1' },
      ],
      rows: 3,
      statistics: { elapsed: 0.1, rows_read: 3, bytes_read: 100 },
    };

    const result = computeResultSetRatio(
      mockResultSet,
      { numeratorName: 'errors', denominatorName: 'total' },
      'share_of_total',
    );

    // Denominator is the per-bucket total across all groups (t0: 200, t1: 100),
    // so each group is its contribution to the overall rate.
    expect(result.data).toEqual([
      { 'errors/total': 0.1, tenant: 'acme', timestamp: 't0' }, // 20/200
      { 'errors/total': 0.15, tenant: 'globex', timestamp: 't0' }, // 30/200
      { 'errors/total': 0.1, tenant: 'acme', timestamp: 't1' }, // 10/100
    ]);
    // t0 contributions sum to the overall error rate for that bucket (50/200).
    const t0 = result.data.filter(r => r.timestamp === 't0');
    expect(t0.reduce((s, r) => s + r['errors/total'], 0)).toBeCloseTo(0.25);
  });

  it('renders a zero-error group as 0% (missing numerator), not N/A', () => {
    const mockResultSet: ResponseJSON<any> = {
      meta: [
        { name: 'errors', type: 'UInt64' },
        { name: 'total', type: 'UInt64' },
        { name: 'tenant', type: 'String' },
        { name: 'timestamp', type: 'DateTime' },
      ],
      data: [
        // has errors -> contributes 20/200
        { errors: '20', total: '100', tenant: 'acme', timestamp: 't0' },
        // denominator only (no rows in the error-filtered numerator query) -> 0%
        { total: '100', tenant: 'globex', timestamp: 't0' },
      ],
      rows: 2,
      statistics: { elapsed: 0.1, rows_read: 2, bytes_read: 100 },
    };

    const result = computeResultSetRatio(
      mockResultSet,
      { numeratorName: 'errors', denominatorName: 'total' },
      'share_of_total',
    );

    expect(result.data[0]['errors/total']).toBe(0.1); // 20 / (100+100)
    expect(result.data[1]['errors/total']).toBe(0); // 0 / 200
  });

  it('does not let a group missing the denominator poison the bucket total', () => {
    const mockResultSet: ResponseJSON<any> = {
      meta: [
        { name: 'errors', type: 'UInt64' },
        { name: 'total', type: 'UInt64' },
        { name: 'tenant', type: 'String' },
        { name: 'timestamp', type: 'DateTime' },
      ],
      data: [
        // present in both numerator and denominator
        { errors: '20', total: '100', tenant: 'acme', timestamp: 't0' },
        // numerator only (no matching denominator row) -> total is undefined.
        // Must not turn the bucket total into NaN for the other groups.
        { errors: '5', tenant: 'globex', timestamp: 't0' },
      ],
      rows: 2,
      statistics: { elapsed: 0.1, rows_read: 2, bytes_read: 100 },
    };

    const result = computeResultSetRatio(
      mockResultSet,
      { numeratorName: 'errors', denominatorName: 'total' },
      'share_of_total',
    );

    // Bucket total is 100 (only acme contributes a denominator), so acme's
    // share is still well-defined rather than NaN.
    expect(result.data[0]['errors/total']).toBe(0.2); // 20 / 100
  });

  it('divides each group by the grand total in share_of_total mode when there is no timestamp column (Table/Number ratio)', () => {
    // No timestamp column -> every row shares the '__all__' bucket, so a grouped
    // non-time-series ratio in share_of_total mode is each group's share of the
    // grand total across all groups. This locks that intended semantic.
    const mockResultSet: ResponseJSON<any> = {
      meta: [
        { name: 'errors', type: 'UInt64' },
        { name: 'total', type: 'UInt64' },
        { name: 'tenant', type: 'String' },
      ],
      data: [
        { errors: '20', total: '100', tenant: 'acme' },
        { errors: '30', total: '300', tenant: 'globex' },
      ],
      rows: 2,
      statistics: { elapsed: 0.1, rows_read: 2, bytes_read: 100 },
    };

    const result = computeResultSetRatio(
      mockResultSet,
      { numeratorName: 'errors', denominatorName: 'total' },
      'share_of_total',
    );

    // Grand total = 100 + 300 = 400, so each group is divided by 400.
    expect(result.data).toEqual([
      { 'errors/total': 0.05, tenant: 'acme' }, // 20/400
      { 'errors/total': 0.075, tenant: 'globex' }, // 30/400
    ]);
  });

  it('divides each group by its own denominator in per_group mode (default)', () => {
    const mockResultSet: ResponseJSON<any> = {
      meta: [
        { name: 'errors', type: 'UInt64' },
        { name: 'total', type: 'UInt64' },
        { name: 'tenant', type: 'String' },
      ],
      data: [
        { errors: '20', total: '100', tenant: 'acme' },
        { errors: '30', total: '300', tenant: 'globex' },
      ],
      rows: 2,
      statistics: { elapsed: 0.1, rows_read: 2, bytes_read: 100 },
    };

    const result = computeResultSetRatio(mockResultSet, {
      numeratorName: 'errors',
      denominatorName: 'total',
    });

    expect(result.data).toEqual([
      { 'errors/total': 0.2, tenant: 'acme' }, // 20/100
      { 'errors/total': 0.1, tenant: 'globex' }, // 30/300
    ]);
  });
});

describe('mergeResultSets', () => {
  // Two split queries (one per series) that share a group-by dimension and are
  // NOT time-series (Table display, no timestamp column).
  const groupedSplits = (): ResponseJSON<any>[] => [
    {
      meta: [
        { name: 'errors', type: 'UInt64' },
        { name: 'tenant', type: 'String' },
      ],
      data: [
        { errors: '20', tenant: 'acme' },
        { errors: '30', tenant: 'globex' },
      ],
      rows: 2,
      statistics: { elapsed: 0.1, rows_read: 2, bytes_read: 100 },
    },
    {
      meta: [
        { name: 'total', type: 'UInt64' },
        { name: 'tenant', type: 'String' },
      ],
      data: [
        { total: '100', tenant: 'acme' },
        { total: '200', tenant: 'globex' },
      ],
      rows: 2,
      statistics: { elapsed: 0.1, rows_read: 2, bytes_read: 100 },
    },
  ];

  it('merges the numerator and denominator rows for the same group into one row instead of clobbering', () => {
    const merged = mergeResultSets({
      resultSets: groupedSplits(),
      isTimeSeries: false,
      isRatio: false,
    });

    // Each group keeps BOTH operands (the second split does not overwrite the
    // first) — this is the merge step the grouped-ratio fix depends on.
    expect(merged.meta?.map(m => m.name)).toEqual([
      'errors',
      'total',
      'tenant',
    ]);
    expect(merged.data).toEqual([
      { errors: '20', total: '100', tenant: 'acme' },
      { errors: '30', total: '200', tenant: 'globex' },
    ]);
  });

  it('computes the grouped ratio end-to-end from the split result sets (per-group default)', () => {
    const merged = mergeResultSets({
      resultSets: groupedSplits(),
      isTimeSeries: false,
      isRatio: true,
    });

    // Default per_group -> each group divided by its own denominator.
    expect(merged.data).toEqual([
      { 'errors/total': 20 / 100, tenant: 'acme' },
      { 'errors/total': 30 / 200, tenant: 'globex' },
    ]);
  });

  it('passes ratioMode through to computeResultSetRatio (share_of_total)', () => {
    const merged = mergeResultSets({
      resultSets: groupedSplits(),
      isTimeSeries: false,
      isRatio: true,
      ratioMode: 'share_of_total',
    });

    // No timestamp -> share of the grand total (300): 20/300, 30/300.
    expect(merged.data).toEqual([
      { 'errors/total': 20 / 300, tenant: 'acme' },
      { 'errors/total': 30 / 300, tenant: 'globex' },
    ]);
  });

  it('keeps grouped time-series rows distinct when computing a ratio (timestamp + group column)', () => {
    // Both a real timestamp and a group dimension: rows at the same bucket but
    // different groups must not collapse, and each group keeps its own operands.
    const resultSets: ResponseJSON<any>[] = [
      {
        meta: [
          { name: 'errors', type: 'UInt64' },
          { name: 'tenant', type: 'String' },
          { name: 'timestamp', type: 'DateTime' },
        ],
        data: [
          { errors: '20', tenant: 'acme', timestamp: 't0' },
          { errors: '30', tenant: 'globex', timestamp: 't0' },
        ],
        rows: 2,
        statistics: { elapsed: 0.1, rows_read: 2, bytes_read: 100 },
      },
      {
        meta: [
          { name: 'total', type: 'UInt64' },
          { name: 'tenant', type: 'String' },
          { name: 'timestamp', type: 'DateTime' },
        ],
        data: [
          { total: '100', tenant: 'acme', timestamp: 't0' },
          { total: '300', tenant: 'globex', timestamp: 't0' },
        ],
        rows: 2,
        statistics: { elapsed: 0.1, rows_read: 2, bytes_read: 100 },
      },
    ];

    const merged = mergeResultSets({
      resultSets,
      isTimeSeries: true,
      isRatio: true,
    });

    // Two distinct groups in the same bucket, each divided by its own total.
    expect(merged.data).toEqual([
      { 'errors/total': 0.2, tenant: 'acme', timestamp: 't0' }, // 20/100
      { 'errors/total': 0.1, tenant: 'globex', timestamp: 't0' }, // 30/300
    ]);
  });

  it('keeps operands distinct when both splits resolve to the same value-column alias', () => {
    // A ratio of count(request) filtered / unfiltered: the alias omits the WHERE
    // filter, so both splits emit a `count(request)` column. They must not
    // collapse into one column (which would make the ratio uncomputable).
    const resultSets: ResponseJSON<any>[] = [
      {
        meta: [
          { name: 'count(request)', type: 'UInt64' },
          { name: 'timestamp', type: 'DateTime' },
        ],
        data: [{ 'count(request)': '5', timestamp: 't0' }],
        rows: 1,
        statistics: { elapsed: 0.1, rows_read: 1, bytes_read: 100 },
      },
      {
        meta: [
          { name: 'count(request)', type: 'UInt64' },
          { name: 'timestamp', type: 'DateTime' },
        ],
        data: [{ 'count(request)': '20', timestamp: 't0' }],
        rows: 1,
        statistics: { elapsed: 0.1, rows_read: 1, bytes_read: 100 },
      },
    ];

    const merged = mergeResultSets({
      resultSets,
      isTimeSeries: true,
      isRatio: true,
    });

    // 5 / 20 — would throw "Unable to compute ratio" if the two operands
    // collapsed into a single column. The label strips the disambiguation
    // suffix so it reads count(request)/count(request).
    expect(merged.data).toEqual([
      { 'count(request)/count(request)': 0.25, timestamp: 't0' },
    ]);
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
    // Suppress expected console noise from permission check fallbacks
    // and ClickHouse query debug logging. These must be re-applied each
    // test because afterEach calls restoreAllMocks.
    jest.spyOn(console, 'debug').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
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
      output_format_json_quote_64bit_integers: 1,
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
      // { name: 'use_top_k_dynamic_filtering', value: '1' },
      { name: 'use_skip_indexes_on_data_read', value: '1' },
      { name: 'use_skip_indexes_for_disjunctions', value: '1' },
    ]);

    await client.query({
      query: 'SELECT 1',
      format: 'JSON',
      connectionId: 'test-conn',
    });

    const actualQueryCall = mockQueryMethod.mock.calls.find(
      (call: any) => call[0].query === 'SELECT 1',
    );

    expect(actualQueryCall).toBeDefined();
    expect(actualQueryCall[0].clickhouse_settings).toEqual({
      allow_experimental_analyzer: 1,
      date_time_output_format: 'iso',
      wait_end_of_query: 0,
      output_format_json_quote_64bit_integers: 1,
      cancel_http_readonly_queries_on_client_close: 1,
      query_plan_optimize_lazy_materialization: '1',
      query_plan_max_limit_for_lazy_materialization: '100000',
      use_skip_indexes_for_top_k: '1',
      query_plan_max_limit_for_top_k_optimization: '100000',
      // use_top_k_dynamic_filtering: '1',
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
      connectionId: 'test-conn',
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
      output_format_json_quote_64bit_integers: 1,
      cancel_http_readonly_queries_on_client_close: 1,
      use_skip_indexes_for_top_k: '1',
      use_skip_indexes_on_data_read: '1',
    });
    expect(settings.query_plan_optimize_lazy_materialization).toBeUndefined();
    // expect(settings.use_top_k_dynamic_filtering).toBeUndefined();
  });

  it('should merge external clickhouse settings with optimization settings', async () => {
    setupMockQuery([{ name: 'use_skip_indexes_for_top_k', value: '1' }]);

    await client.query({
      query: 'SELECT 1',
      format: 'JSON',
      connectionId: 'test-conn',
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
      output_format_json_quote_64bit_integers: 1,
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
      connectionId: 'test-conn',
    });

    const actualQueryCall = mockQueryMethod.mock.calls.find(
      (call: any) => call[0].query === 'SELECT 1',
    );

    expect(actualQueryCall).toBeDefined();
    expect(actualQueryCall[0].clickhouse_settings).toEqual({
      allow_experimental_analyzer: 1,
      date_time_output_format: 'iso',
      wait_end_of_query: 0,
      output_format_json_quote_64bit_integers: 1,
      cancel_http_readonly_queries_on_client_close: 1,
    });
  });

  it('should cache settings result across multiple queries', async () => {
    setupMockQuery([{ name: 'use_skip_indexes_for_top_k', value: '1' }]);

    // Run two queries
    await client.query({
      query: 'SELECT 1',
      format: 'JSON',
      connectionId: 'test-conn',
    });
    await client.query({
      query: 'SELECT 2',
      format: 'JSON',
      connectionId: 'test-conn',
    });

    // Should only fetch settings once
    const settingsCalls = mockQueryMethod.mock.calls.filter(
      (call: any) =>
        call[0].query === 'SELECT name, value FROM system.settings',
    );
    expect(settingsCalls.length).toEqual(1);
  });
});
