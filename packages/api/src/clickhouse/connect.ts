
import * as config from '@/config';
import logger from '@/utils/logger';
import { client } from './client';
import { TableName } from './index';

// This file does not only connect but also creates the basic schema for
// storing data in clickhouse
// (to reorganize into separate schema creation file later)

export const healthCheck = () => client.ping();

export const connect = async () => {
    if (config.IS_CI) {
      return;
    }
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
  