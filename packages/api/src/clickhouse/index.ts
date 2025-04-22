import {
  BaseResultSet,
  createClient,
  ErrorLogParams as _CHErrorLogParams,
  Logger as _CHLogger,
  LogParams as _CHLogParams,
  ResponseJSON,
  SettingsMap,
} from '@clickhouse/client';
import opentelemetry from '@opentelemetry/api';
import _ from 'lodash';
import ms from 'ms';
import SqlString from 'sqlstring';

import * as config from '@/config';
import logger from '@/utils/logger';

const tracer = opentelemetry.trace.getTracer(__filename);

export enum SortOrder {
  Asc = 'asc',
  Desc = 'desc',
}

export enum SeriesReturnType {
  Ratio = 'ratio',
  Column = 'column',
}

export enum MetricsDataType {
  Gauge = 'Gauge',
  Histogram = 'Histogram',
  Sum = 'Sum',
  Summary = 'Summary',
  // TODO: support 'ExponentialHistogram'
}

export enum AggFn {
  Avg = 'avg',
  AvgRate = 'avg_rate',
  Count = 'count',
  CountDistinct = 'count_distinct',
  CountPerHour = 'count_per_hour',
  CountPerMin = 'count_per_min',
  CountPerSec = 'count_per_sec',
  LastValue = 'last_value',
  Max = 'max',
  MaxRate = 'max_rate',
  Min = 'min',
  MinRate = 'min_rate',
  P50 = 'p50',
  P50Rate = 'p50_rate',
  P90 = 'p90',
  P90Rate = 'p90_rate',
  P95 = 'p95',
  P95Rate = 'p95_rate',
  P99 = 'p99',
  P99Rate = 'p99_rate',
  Sum = 'sum',
  SumRate = 'sum_rate',
}

// TODO: move this somewhere shareable across the project
export enum Granularity {
  ThirtySecond = '30 second',
  OneMinute = '1 minute',
  FiveMinute = '5 minute',
  TenMinute = '10 minute',
  FifteenMinute = '15 minute',
  ThirtyMinute = '30 minute',
  OneHour = '1 hour',
  TwoHour = '2 hour',
  SixHour = '6 hour',
  TwelveHour = '12 hour',
  OneDay = '1 day',
  TwoDay = '2 day',
  SevenDay = '7 day',
  ThirtyDay = '30 day',
}

export enum TableName {
  LogStream = 'log_stream',
  Metric = 'metric_stream',
  Rrweb = 'rrweb',
}

export class CHLogger implements _CHLogger {
  debug({ module, message, args }: _CHLogParams): void {
    logger.debug({
      type: '@clickhouse/client',
      module,
      message,
      ...args,
    });
  }

  trace({ module, message, args }: _CHLogParams) {
    // TODO: trace level ??
    logger.info({
      type: '@clickhouse/client',
      module,
      message,
      ...args,
    });
  }

  info({ module, message, args }: _CHLogParams): void {
    logger.info({
      type: '@clickhouse/client',
      module,
      message,
      ...args,
    });
  }

  warn({ module, message, args }: _CHLogParams): void {
    logger.warn({
      type: '@clickhouse/client',
      module,
      message,
      ...args,
    });
  }

  error({ module, message, args, err }: _CHErrorLogParams): void {
    logger.error({
      type: '@clickhouse/client',
      module,
      message,
      ...args,
      err,
    });
  }
}

// TODO: TO BE DEPRECATED
export const client = createClient({
  host: config.CLICKHOUSE_HOST,
  username: config.CLICKHOUSE_USER,
  password: config.CLICKHOUSE_PASSWORD,
  request_timeout: ms('1m'),
  compression: {
    request: false,
    response: false, // has to be off to enable streaming
  },
  keep_alive: {
    enabled: true,
    // should be slightly less than the `keep_alive_timeout` setting in server's `config.xml`
    // default is 3s there, so 2500 milliseconds seems to be a safe client value in this scenario
    // another example: if your configuration has `keep_alive_timeout` set to 60s, you could put 59_000 here
    socket_ttl: 60000,
    retry_on_expired_socket: true,
  },
  clickhouse_settings: {
    connect_timeout: ms('1m') / 1000,
    date_time_output_format: 'iso',
    max_download_buffer_size: (10 * 1024 * 1024).toString(), // default
    max_download_threads: 32,
    max_execution_time: ms('2m') / 1000,
  },
  log: {
    LoggerClass: CHLogger,
  },
});

export const healthCheck = async () => {
  const result = await client.ping();
  if (!result.success) {
    logger.error({
      message: 'ClickHouse health check failed',
      error: result.error,
    });
    throw result.error;
  }
};

export const connect = async () => {
  // FIXME: this is a hack to avoid CI failure
  logger.info('Checking connections to ClickHouse...');
  // health check
  await healthCheck();

  logger.info('Initializing ClickHouse...');

  // *************************************
  // Create Tables
  // *************************************
  // Log model (v1)
  // 1. https://opentelemetry.io/docs/reference/specification/logs/data-model/
  // 2. https://www.uber.com/blog/logging/
  // 3. https://clickhouse.com/blog/storing-log-data-in-clickhouse-fluent-bit-vector-open-telemetry#architectures
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS default.${TableName.LogStream} (
        id UUID DEFAULT generateUUIDv4(),
        type Enum8('log' = 1, 'span' = 2) DEFAULT 'log',
        timestamp DateTime64(9, 'UTC') CODEC(Delta(8), ZSTD(1)),
        observed_timestamp DateTime64(9, 'UTC') CODEC(Delta(8), ZSTD(1)),
        end_timestamp DateTime64(9, 'UTC') CODEC(Delta(8), ZSTD(1)),
        trace_id String CODEC(ZSTD(1)),
        span_name String CODEC(ZSTD(1)),
        span_id String CODEC(ZSTD(1)),
        parent_span_id String CODEC(ZSTD(1)),
        severity_number UInt8 CODEC(ZSTD(1)),
        severity_text String CODEC(ZSTD(1)),
        "string.names" Array(String),
        "string.values" Array(String),
        "number.names" Array(String),
        "number.values" Array(Float64),
        "bool.names" Array(String),
        "bool.values" Array(UInt8),
        _string_attributes Map(LowCardinality(String), String) MATERIALIZED CAST((string.names, string.values), 'Map(String, String)'),
        _number_attributes Map(LowCardinality(String), Float64) MATERIALIZED CAST((number.names, number.values), 'Map(String, Float64)'),
        _bool_attributes Map(LowCardinality(String), UInt8) MATERIALIZED CAST((bool.names, bool.values), 'Map(String, UInt8)'),
        _created_at DateTime64(9, 'UTC') DEFAULT toDateTime64(now(), 9) CODEC(Delta(8), ZSTD(1)),
        _namespace LowCardinality(String) CODEC(ZSTD(1)),
        _platform LowCardinality(String) CODEC(ZSTD(1)),
        _host String CODEC(ZSTD(1)),
        _service LowCardinality(String) CODEC(ZSTD(1)),
        _source String CODEC(ZSTD(1)),
        _timestamp_sort_key Int64 MATERIALIZED toUnixTimestamp64Nano(coalesce(timestamp, observed_timestamp, _created_at)),
        _hdx_body String MATERIALIZED "string.values"[indexOf("string.names", '_hdx_body')],
        _duration Float64 MATERIALIZED (toUnixTimestamp64Nano(end_timestamp) - toUnixTimestamp64Nano(timestamp)) / 1000000,
        _user_id String MATERIALIZED "string.values"[indexOf("string.names", 'userId')],
        _user_email String MATERIALIZED "string.values"[indexOf("string.names", 'userEmail')],
        _user_name String MATERIALIZED "string.values"[indexOf("string.names", 'userName')],
        _rum_session_id String MATERIALIZED "string.values"[indexOf("string.names", 'process.tag.rum.sessionId')],
        _hyperdx_event_size UInt32 MATERIALIZED length(_source),
            INDEX idx_trace_id trace_id TYPE bloom_filter(0.001) GRANULARITY 1,
            INDEX idx_rum_session_id _rum_session_id TYPE bloom_filter(0.001) GRANULARITY 1,
            INDEX idx_lower_source (lower(_source)) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1,
            INDEX idx_duration _duration TYPE minmax GRANULARITY 1,
            INDEX idx_string_attr_key mapKeys(_string_attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
            INDEX idx_string_attr_val mapValues(_string_attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
            INDEX idx_number_attr_key mapKeys(_number_attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
            INDEX idx_number_attr_val mapValues(_number_attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
            INDEX idx_bool_attr_key mapKeys(_bool_attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
            INDEX idx_bool_attr_val mapValues(_bool_attributes) TYPE bloom_filter(0.01) GRANULARITY 1
      )
      ENGINE = MergeTree
      TTL toDateTime(_created_at) + INTERVAL 1 MONTH DELETE
      ORDER BY (_timestamp_sort_key)
      SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
    `,
    // Recommended for cluster usage to avoid situations
    // where a query processing error occurred after the response code
    // and HTTP headers were sent to the client.
    // See https://clickhouse.com/docs/en/interfaces/http/#response-buffering
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  });

  // RRWeb table: storing rrweb metadata for the player
  await client.command({
    query: `
        CREATE TABLE IF NOT EXISTS default.${TableName.Rrweb} (
          id UUID DEFAULT generateUUIDv4(),
          timestamp DateTime64(9, 'UTC') CODEC(Delta(8), ZSTD(1)),
          "string.names" Array(String),
          "string.values" Array(String),
          "number.names" Array(String),
          "number.values" Array(Float64),
          "bool.names" Array(String),
          "bool.values" Array(UInt8),
          body MATERIALIZED "string.values"[indexOf("string.names", '_hdx_body')],
          session_id MATERIALIZED "string.values"[indexOf("string.names", 'rum.sessionId')],
          type MATERIALIZED "number.values"[indexOf("number.names", 'type')],
          _created_at DateTime64(9, 'UTC') DEFAULT toDateTime64(now(), 9) CODEC(Delta(8), ZSTD(1)),
          _service LowCardinality(String) CODEC(ZSTD(1)),
          _source String CODEC(ZSTD(1)),
          _timestamp_sort_key Int64 MATERIALIZED toUnixTimestamp64Nano(coalesce(timestamp, _created_at)),
          _hyperdx_event_size UInt32 MATERIALIZED length(_source)
        )
        ENGINE = MergeTree
        TTL toDateTime(_created_at) + INTERVAL 1 MONTH DELETE
        ORDER BY (session_id, type, _timestamp_sort_key)
        SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
      `,
    // Recommended for cluster usage to avoid situations
    // where a query processing error occurred after the response code
    // and HTTP headers were sent to the client.
    // See https://clickhouse.com/docs/en/interfaces/http/#response-buffering
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  });

  // Metric model
  // 1. https://opentelemetry.io/docs/specs/otel/metrics/data-model/#timeseries-model
  // 2. https://github.com/mindis/prom2click
  // 3. https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/exporter/clickhouseexporter/internal/gauge_metrics.go
  await client.command({
    query: `
      CREATE TABLE IF NOT EXISTS default.${TableName.Metric} (
        timestamp DateTime64(9, 'UTC') CODEC(Delta(8), ZSTD(1)),
        name LowCardinality(String) CODEC(ZSTD(1)),
        data_type LowCardinality(String) CODEC(ZSTD(1)),
        value Float64 CODEC(ZSTD(1)),
        flags UInt32  CODEC(ZSTD(1)),
        unit String CODEC(ZSTD(1)),
        is_delta Boolean CODEC(Delta, ZSTD(1)),
        is_monotonic Boolean CODEC(Delta, ZSTD(1)),
        _string_attributes Map(LowCardinality(String), String) CODEC(ZSTD(1)),
        _created_at DateTime64(9, 'UTC') DEFAULT toDateTime64(now(), 9) CODEC(Delta(8), ZSTD(1)),
        _timestamp_sort_key Int64 MATERIALIZED toUnixTimestamp64Nano(coalesce(timestamp, _created_at)),
            INDEX idx_string_attr_key mapKeys(_string_attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
            INDEX idx_string_attr_val mapValues(_string_attributes) TYPE bloom_filter(0.01) GRANULARITY 1
      )
      ENGINE = MergeTree
      PARTITION BY toDate(_created_at)
      TTL toDateTime(_created_at) + INTERVAL 1 MONTH DELETE
      ORDER BY (name, data_type, _string_attributes, _timestamp_sort_key)
      SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
    `,
    // Recommended for cluster usage to avoid situations
    // where a query processing error occurred after the response code
    // and HTTP headers were sent to the client.
    // See https://clickhouse.com/docs/en/interfaces/http/#response-buffering
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  });
};

export const getColumns = async ({
  database,
  table,
}: {
  database: string;
  table: string;
}) => {
  const rows = await client.query({
    query: 'DESCRIBE {database:Identifier}.{table:Identifier}',
    format: 'JSON',
    query_params: {
      database: database,
      table: table,
    },
  });
  return rows.json<
    ResponseJSON<{
      name: string;
      type: string;
      default_type: string;
      default_expression: string;
      comment: string;
      codec_expression: string;
      ttl_expression: string;
    }>
  >();
};

/**
 * Translate field from user ex. column.property.subproperty to SQL expression
 * Supports:
 * - Materialized Columns
 * - Map
 * - JSON Strings (via JSONExtract)
 * TODO:
 * - Nested Map
 * - JSONExtract for non-string types
 */
export async function buildColumnExpressionFromField({
  database,
  table,
  field,
  inferredSimpleType,
}: {
  database: string;
  table: string;
  field: string;
  inferredSimpleType: 'string' | 'number' | 'bool' | undefined;
}): Promise<{
  found: boolean;
  columnExpression: string;
  columnType: string;
}> {
  const jsonRows = await getColumns({
    database: database,
    table: table,
  });
  const columns = jsonRows.data;

  const columnMapByLowerName = columns.reduce((acc, column) => {
    acc.set(column.name.toLowerCase(), column);
    return acc;
  }, new Map<string, (typeof columns)[number]>());
  const lowerField = field.toLowerCase();

  const exactMatch = columnMapByLowerName.get(lowerField);
  if (exactMatch) {
    return {
      found: true,
      columnType: exactMatch.type,
      columnExpression: exactMatch.name,
    };
  }

  const lowerFieldPrefix = lowerField.split('.')[0];
  const prefixMatch = columnMapByLowerName.get(lowerFieldPrefix);
  if (prefixMatch) {
    const lowerFieldPostfix = lowerField.split('.').slice(1).join('.');
    if (prefixMatch.type.startsWith('Map')) {
      const valueType = prefixMatch.type.match(/,\s+(\w+)\)$/)?.[1];
      return {
        found: true,
        columnExpression: SqlString.format(`??[?]`, [
          prefixMatch.name,
          lowerFieldPostfix,
        ]),
        columnType: valueType ?? 'Unknown',
      };
    } else if (prefixMatch.type === 'String') {
      // TODO: Support non-strings
      return {
        found: true,
        columnExpression: `JSONExtractString(lower(${prefixMatch.name}), '${lowerFieldPostfix}')`,
        columnType: 'String',
      };
    }
    // TODO: Support arrays and tuples
    throw new Error('Unsupported column type for prefix match');
  }

  throw new Error('Column not found');
}

// ******************************************************
// ******************** Utils ***************************
// ******************************************************
export const msRangeToHistogramInterval = (msRange: number, total: number) => {
  const diffSeconds = Math.floor(msRange / 1000);
  const granularitySeconds = Math.ceil(diffSeconds / total);

  if (granularitySeconds <= 1) {
    return '1 second';
  } else if (granularitySeconds <= 2) {
    return '2 second';
  } else if (granularitySeconds <= 5) {
    return '5 second';
  } else if (granularitySeconds <= 10) {
    return '10 second';
  } else if (granularitySeconds <= 20) {
    return '20 second';
  } else if (granularitySeconds <= 30) {
    return '30 second';
  } else if (granularitySeconds <= 60) {
    return '1 minute';
  } else if (granularitySeconds <= 5 * 60) {
    return '5 minute';
  } else if (granularitySeconds <= 10 * 60) {
    return '10 minute';
  } else if (granularitySeconds <= 15 * 60) {
    return '15 minute';
  } else if (granularitySeconds <= 30 * 60) {
    return '30 minute';
  } else if (granularitySeconds <= 3600) {
    return '1 hour';
  } else if (granularitySeconds <= 2 * 3600) {
    return '2 hour';
  } else if (granularitySeconds <= 6 * 3600) {
    return '6 hour';
  } else if (granularitySeconds <= 12 * 3600) {
    return '12 hour';
  } else if (granularitySeconds <= 24 * 3600) {
    return '1 day';
  } else if (granularitySeconds <= 2 * 24 * 3600) {
    return '2 day';
  } else if (granularitySeconds <= 7 * 24 * 3600) {
    return '7 day';
  } else if (granularitySeconds <= 30 * 24 * 3600) {
    return '30 day';
  }

  return '30 day';
};

// ******************************************************
export const isRateAggFn = (aggFn: AggFn) => {
  return (
    aggFn === AggFn.SumRate ||
    aggFn === AggFn.AvgRate ||
    aggFn === AggFn.MaxRate ||
    aggFn === AggFn.MinRate ||
    aggFn === AggFn.P50Rate ||
    aggFn === AggFn.P90Rate ||
    aggFn === AggFn.P95Rate ||
    aggFn === AggFn.P99Rate
  );
};
