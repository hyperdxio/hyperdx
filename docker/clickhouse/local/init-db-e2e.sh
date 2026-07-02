#!/bin/bash
set -e

# E2E-specific database initialization script
# Creates tables with e2e_ prefix to avoid collision with local dev data

# We don't have a JSON schema yet, so let's let the collector create the tables
if [ "$BETA_CH_OTEL_JSON_SCHEMA_ENABLED" = "true" ]; then
  exit 0
fi

DATABASE=${HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE:-default}

clickhouse client -n <<EOFSQL
CREATE DATABASE IF NOT EXISTS ${DATABASE};

CREATE TABLE IF NOT EXISTS ${DATABASE}.e2e_otel_logs
(
  \`Timestamp\` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  \`TraceId\` String CODEC(ZSTD(1)),
  \`SpanId\` String CODEC(ZSTD(1)),
  \`TraceFlags\` UInt8,
  \`SeverityText\` LowCardinality(String) CODEC(ZSTD(1)),
  \`SeverityNumber\` UInt8,
  \`ServiceName\` LowCardinality(String) CODEC(ZSTD(1)),
  \`Body\` String CODEC(ZSTD(1)),
  \`ResourceSchemaUrl\` LowCardinality(String) CODEC(ZSTD(1)),
  \`ResourceAttributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  \`ScopeSchemaUrl\` LowCardinality(String) CODEC(ZSTD(1)),
  \`ScopeName\` String CODEC(ZSTD(1)),
  \`ScopeVersion\` LowCardinality(String) CODEC(ZSTD(1)),
  \`ScopeAttributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  \`LogAttributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  \`EventName\` String CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.cluster.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.cluster.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.container.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.container.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.deployment.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.deployment.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.namespace.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.namespace.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.node.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.node.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.pod.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.pod.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.pod.uid\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.pod.uid'] CODEC(ZSTD(1)),
  \`__hdx_materialized_deployment.environment.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['deployment.environment.name'] CODEC(ZSTD(1)),
  INDEX idx_trace_id TraceId TYPE text(tokenizer = 'array'),
  INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE text(tokenizer = 'array'),
  INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE text(tokenizer = 'array'),
  INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE text(tokenizer = 'array'),
  INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE text(tokenizer = 'array'),
  INDEX idx_log_attr_key mapKeys(LogAttributes) TYPE text(tokenizer = 'array'),
  INDEX idx_log_attr_value mapValues(LogAttributes) TYPE text(tokenizer = 'array'),
  INDEX idx_lower_body lower(Body) TYPE text(tokenizer = 'splitByNonAlpha')
)
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (toStartOfFiveMinutes(Timestamp), ServiceName, Timestamp)
TTL toDateTime(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS ${DATABASE}.e2e_otel_traces
(
    \`Timestamp\` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    \`TraceId\` String CODEC(ZSTD(1)),
    \`SpanId\` String CODEC(ZSTD(1)),
    \`ParentSpanId\` String CODEC(ZSTD(1)),
    \`TraceState\` String CODEC(ZSTD(1)),
    \`SpanName\` LowCardinality(String) CODEC(ZSTD(1)),
    \`SpanKind\` LowCardinality(String) CODEC(ZSTD(1)),
    \`ServiceName\` LowCardinality(String) CODEC(ZSTD(1)),
    \`ResourceAttributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    \`ScopeName\` String CODEC(ZSTD(1)),
    \`ScopeVersion\` String CODEC(ZSTD(1)),
    \`SpanAttributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    \`Duration\` UInt64 CODEC(ZSTD(1)),
    \`StatusCode\` LowCardinality(String) CODEC(ZSTD(1)),
    \`StatusMessage\` String CODEC(ZSTD(1)),
    \`Events.Timestamp\` Array(DateTime64(9)) CODEC(ZSTD(1)),
    \`Events.Name\` Array(LowCardinality(String)) CODEC(ZSTD(1)),
    \`Events.Attributes\` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
    \`Links.TraceId\` Array(String) CODEC(ZSTD(1)),
    \`Links.SpanId\` Array(String) CODEC(ZSTD(1)),
    \`Links.TraceState\` Array(String) CODEC(ZSTD(1)),
    \`Links.Attributes\` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
    \`__hdx_materialized_rum.sessionId\` String MATERIALIZED ResourceAttributes['rum.sessionId'] CODEC(ZSTD(1)),
    \`SampleRate\` UInt64 MATERIALIZED greatest(toUInt64OrZero(SpanAttributes['SampleRate']), 1) CODEC(T64, ZSTD(1)),
    \`ResourceAttributeItems\` Array(String) ALIAS arrayMap((arr) -> concat(arr.1, '=', arr.2), ResourceAttributes::Array(Tuple(String, String))),
    \`SpanAttributeItems\` Array(String) ALIAS arrayMap((arr) -> concat(arr.1, '=', arr.2), SpanAttributes::Array(Tuple(String, String))),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_rum_session_id __hdx_materialized_rum.sessionId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_res_attr_items ResourceAttributeItems TYPE text(tokenizer = 'array'),
    INDEX idx_span_attr_key mapKeys(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_span_attr_value mapValues(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_span_attr_items SpanAttributeItems TYPE text(tokenizer = 'array'),
    INDEX idx_duration Duration TYPE minmax GRANULARITY 1,
    INDEX idx_lower_span_name lower(SpanName) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 8
)
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ServiceName, SpanName, toDateTime(Timestamp))
TTL toDate(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE ${DATABASE}.e2e_hyperdx_sessions
(
    \`Timestamp\` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    \`TimestampTime\` DateTime DEFAULT toDateTime(Timestamp),
    \`TraceId\` String CODEC(ZSTD(1)),
    \`SpanId\` String CODEC(ZSTD(1)),
    \`TraceFlags\` UInt8,
    \`SeverityText\` LowCardinality(String) CODEC(ZSTD(1)),
    \`SeverityNumber\` UInt8,
    \`ServiceName\` LowCardinality(String) CODEC(ZSTD(1)),
    \`Body\` String CODEC(ZSTD(1)),
    \`ResourceSchemaUrl\` LowCardinality(String) CODEC(ZSTD(1)),
    \`ResourceAttributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    \`ScopeSchemaUrl\` LowCardinality(String) CODEC(ZSTD(1)),
    \`ScopeName\` String CODEC(ZSTD(1)),
    \`ScopeVersion\` LowCardinality(String) CODEC(ZSTD(1)),
    \`ScopeAttributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    \`LogAttributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    \`__hdx_materialized_rum.sessionId\` String MATERIALIZED ResourceAttributes['rum.sessionId'] CODEC(ZSTD(1)),
    \`__hdx_materialized_type\` LowCardinality(String) MATERIALIZED toString(simpleJSONExtractInt(Body, 'type')) CODEC(ZSTD(1)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_rum_session_id __hdx_materialized_rum.sessionId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_log_attr_key mapKeys(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_log_attr_value mapValues(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_body Body TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 8
)
ENGINE = MergeTree
PARTITION BY toDate(TimestampTime)
PRIMARY KEY (ServiceName, TimestampTime)
ORDER BY (ServiceName, TimestampTime, Timestamp)
TTL TimestampTime + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS ${DATABASE}.e2e_otel_metrics_gauge
(
    \`ResourceAttributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    \`ResourceSchemaUrl\` String CODEC(ZSTD(1)),
    \`ScopeName\` String CODEC(ZSTD(1)),
    \`ScopeVersion\` String CODEC(ZSTD(1)),
    \`ScopeAttributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    \`ScopeDroppedAttrCount\` UInt32 CODEC(ZSTD(1)),
    \`ScopeSchemaUrl\` String CODEC(ZSTD(1)),
    \`ServiceName\` LowCardinality(String) CODEC(ZSTD(1)),
    \`MetricName\` String CODEC(ZSTD(1)),
    \`MetricDescription\` String CODEC(ZSTD(1)),
    \`MetricUnit\` String CODEC(ZSTD(1)),
    \`Attributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    \`StartTimeUnix\` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    \`TimeUnix\` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    \`Value\` Float64 CODEC(ZSTD(1)),
    \`Flags\` UInt32 CODEC(ZSTD(1)),
    \`Exemplars.FilteredAttributes\` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
    \`Exemplars.TimeUnix\` Array(DateTime64(9)) CODEC(ZSTD(1)),
    \`Exemplars.Value\` Array(Float64) CODEC(ZSTD(1)),
    \`Exemplars.SpanId\` Array(String) CODEC(ZSTD(1)),
    \`Exemplars.TraceId\` Array(String) CODEC(ZSTD(1)),
    INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
TTL toDate(TimeUnix) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS ${DATABASE}.e2e_otel_metrics_sum
(
    \`ResourceAttributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    \`ResourceSchemaUrl\` String CODEC(ZSTD(1)),
    \`ScopeName\` String CODEC(ZSTD(1)),
    \`ScopeVersion\` String CODEC(ZSTD(1)),
    \`ScopeAttributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    \`ScopeDroppedAttrCount\` UInt32 CODEC(ZSTD(1)),
    \`ScopeSchemaUrl\` String CODEC(ZSTD(1)),
    \`ServiceName\` LowCardinality(String) CODEC(ZSTD(1)),
    \`MetricName\` String CODEC(ZSTD(1)),
    \`MetricDescription\` String CODEC(ZSTD(1)),
    \`MetricUnit\` String CODEC(ZSTD(1)),
    \`Attributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
    \`StartTimeUnix\` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    \`TimeUnix\` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    \`Value\` Float64 CODEC(ZSTD(1)),
    \`Flags\` UInt32 CODEC(ZSTD(1)),
    \`AggregationTemporality\` Int32 CODEC(ZSTD(1)),
    \`IsMonotonic\` Bool CODEC(Delta(1), ZSTD(1)),
    \`Exemplars.FilteredAttributes\` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
    \`Exemplars.TimeUnix\` Array(DateTime64(9)) CODEC(ZSTD(1)),
    \`Exemplars.Value\` Array(Float64) CODEC(ZSTD(1)),
    \`Exemplars.SpanId\` Array(String) CODEC(ZSTD(1)),
    \`Exemplars.TraceId\` Array(String) CODEC(ZSTD(1)),
    INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
TTL toDate(TimeUnix) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- Materialized view rollup for traces, used by E2E tests covering MV
-- acceleration. The target table pre-aggregates Duration over 1-minute
-- buckets grouped by the dimension columns ServiceName and StatusCode.
-- The 'E2E Traces MV' fixture source references e2e_otel_traces_1m.
CREATE TABLE IF NOT EXISTS ${DATABASE}.e2e_otel_traces_1m
(
    \`Timestamp\` DateTime,
    \`ServiceName\` LowCardinality(String),
    \`StatusCode\` LowCardinality(String),
    \`count\` SimpleAggregateFunction(sum, UInt64),
    \`avg__Duration\` AggregateFunction(avg, UInt64),
    \`max__Duration\` SimpleAggregateFunction(max, UInt64),
    \`quantile__Duration\` AggregateFunction(quantile(0.95), UInt64)
)
ENGINE = AggregatingMergeTree
ORDER BY (Timestamp, ServiceName, StatusCode)
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.e2e_otel_traces_1m_mv TO ${DATABASE}.e2e_otel_traces_1m
AS SELECT
    toStartOfMinute(Timestamp) AS Timestamp,
    ServiceName,
    StatusCode,
    count() AS count,
    avgState(Duration) AS avg__Duration,
    maxSimpleState(Duration) AS max__Duration,
    quantileState(0.95)(Duration) AS quantile__Duration
FROM ${DATABASE}.e2e_otel_traces
GROUP BY
    Timestamp,
    ServiceName,
    StatusCode;

-- Table covering "interesting" filter key edge cases: a column whose name
-- contains dots (\`__hdx_materialized_k8s.cluster.name\`),
-- a column whose name contains a hyphen (\`service-name\`), a Map column accessed
-- by a dotted key (ResourceAttributes['key.subKey.subSubKey']), a JSON column
-- accessed by a nested path (ResourceAttributesJSON.key.subKey.subSubKey), a Map
-- column whose NAME contains a hyphen (\`Map-Attributes\`['pod-name']), and a JSON
-- column whose name AND nested keys contain hyphens (\`JSON-Attributes\`.\`key-1\`.\`key-2\`).
-- Used by the filter-key edge case E2E tests to verify identifier escaping in filters.
SET allow_experimental_json_type = 1;
CREATE TABLE IF NOT EXISTS ${DATABASE}.otel_logs_interesting_filter_keys
(
    \`Timestamp\` DateTime64(9),
    \`TraceId\` String,
    \`SpanId\` String,
    \`SeverityText\` LowCardinality(String),
    \`ServiceName\` LowCardinality(String),
    \`Body\` String,
    \`ResourceAttributes\` Map(LowCardinality(String), String),
    \`ResourceAttributesJSON\` JSON,
    \`__hdx_materialized_k8s.cluster.name\` LowCardinality(String),
    \`service-name\` String,
    \`Map-Attributes\` Map(LowCardinality(String), String),
    \`JSON-Attributes\` JSON
)
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
PRIMARY KEY (ServiceName, Timestamp)
ORDER BY (ServiceName, Timestamp);

-- ---------------------------------------------------------------------------
-- Metadata materialized-view source
-- ---------------------------------------------------------------------------
-- A standard otel_logs-schema base table (\`e2e_otel_logs_metadata_mv\`) plus a
-- pair of "metadata" rollup tables that pre-aggregate facet keys and key/values
-- per ColumnIdentifier in 15-minute buckets. The rollups are populated by
-- materialized views that fire on insert into the base table. The
-- 'E2E Metadata MV Logs' fixture source registers these rollups via its
-- \`metadataMaterializedViews\` config, so the filter-key edge case tests exercise
-- the rollup-backed facet path (keys/values read from the rollups instead of the
-- base table) for the ServiceName native column and a LogAttributes map key.
CREATE TABLE IF NOT EXISTS ${DATABASE}.e2e_otel_logs_metadata_mv
(
  \`Timestamp\` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  \`TraceId\` String CODEC(ZSTD(1)),
  \`SpanId\` String CODEC(ZSTD(1)),
  \`TraceFlags\` UInt8,
  \`SeverityText\` LowCardinality(String) CODEC(ZSTD(1)),
  \`SeverityNumber\` UInt8,
  \`ServiceName\` LowCardinality(String) CODEC(ZSTD(1)),
  \`Body\` String CODEC(ZSTD(1)),
  \`ResourceSchemaUrl\` LowCardinality(String) CODEC(ZSTD(1)),
  \`ResourceAttributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  \`ScopeSchemaUrl\` LowCardinality(String) CODEC(ZSTD(1)),
  \`ScopeName\` String CODEC(ZSTD(1)),
  \`ScopeVersion\` LowCardinality(String) CODEC(ZSTD(1)),
  \`ScopeAttributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  \`LogAttributes\` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  \`EventName\` String CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.cluster.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.cluster.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.container.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.container.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.deployment.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.deployment.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.namespace.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.namespace.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.node.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.node.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.pod.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.pod.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.pod.uid\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.pod.uid'] CODEC(ZSTD(1)),
  \`__hdx_materialized_deployment.environment.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['deployment.environment.name'] CODEC(ZSTD(1))
)
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (toStartOfFiveMinutes(Timestamp), ServiceName, Timestamp)
TTL toDateTime(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE IF NOT EXISTS ${DATABASE}.e2e_otel_logs_kv_rollup_15m
(
    \`Timestamp\` DateTime,
    \`ColumnIdentifier\` LowCardinality(String),
    \`Key\` LowCardinality(String),
    \`Value\` String,
    \`count\` UInt64,
    INDEX idx_count_minmax count TYPE minmax GRANULARITY 1,
    INDEX idx_timestamp_minmax Timestamp TYPE minmax GRANULARITY 1
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ColumnIdentifier, Key, Timestamp, Value)
TTL Timestamp + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.e2e_otel_logs_attr_kv_rollup_15m_mv TO ${DATABASE}.e2e_otel_logs_kv_rollup_15m
(
    \`Timestamp\` DateTime,
    \`ColumnIdentifier\` String,
    \`Key\` String,
    \`Value\` String,
    \`count\` UInt64
)
AS WITH elements AS
    (
        SELECT
            'ResourceAttributes' AS ColumnIdentifier,
            toStartOfFifteenMinutes(Timestamp) AS Timestamp,
            replaceRegexpAll(entry.1, '\\\\[\\\\d+\\\\]', '[*]') AS Key,
            CAST(entry.2, 'String') AS Value
        FROM ${DATABASE}.e2e_otel_logs_metadata_mv
        ARRAY JOIN ResourceAttributes AS entry
        UNION ALL
        SELECT
            'LogAttributes' AS ColumnIdentifier,
            toStartOfFifteenMinutes(Timestamp) AS Timestamp,
            replaceRegexpAll(entry.1, '\\\\[\\\\d+\\\\]', '[*]') AS Key,
            CAST(entry.2, 'String') AS Value
        FROM ${DATABASE}.e2e_otel_logs_metadata_mv
        ARRAY JOIN LogAttributes AS entry
        UNION ALL
        SELECT
            'ScopeAttributes' AS ColumnIdentifier,
            toStartOfFifteenMinutes(Timestamp) AS Timestamp,
            replaceRegexpAll(entry.1, '\\\\[\\\\d+\\\\]', '[*]') AS Key,
            CAST(entry.2, 'String') AS Value
        FROM ${DATABASE}.e2e_otel_logs_metadata_mv
        ARRAY JOIN ScopeAttributes AS entry
        UNION ALL
        SELECT
            'NativeColumn' AS ColumnIdentifier,
            toStartOfFifteenMinutes(Timestamp) AS Timestamp,
            'SeverityText' AS Key,
            CAST(SeverityText, 'String') AS Value
        FROM ${DATABASE}.e2e_otel_logs_metadata_mv
        UNION ALL
        SELECT
            'NativeColumn' AS ColumnIdentifier,
            toStartOfFifteenMinutes(Timestamp) AS Timestamp,
            'ServiceName' AS Key,
            CAST(ServiceName, 'String') AS Value
        FROM ${DATABASE}.e2e_otel_logs_metadata_mv
        UNION ALL
        SELECT
            'NativeColumn' AS ColumnIdentifier,
            toStartOfFifteenMinutes(Timestamp) AS Timestamp,
            'ScopeName' AS Key,
            CAST(ScopeName, 'String') AS Value
        FROM ${DATABASE}.e2e_otel_logs_metadata_mv
    )
SELECT
    Timestamp,
    ColumnIdentifier,
    Key,
    Value,
    count() AS count
FROM elements
GROUP BY
    Timestamp,
    ColumnIdentifier,
    Key,
    Value;

CREATE TABLE IF NOT EXISTS ${DATABASE}.e2e_otel_logs_key_rollup_15m
(
    \`Timestamp\` DateTime,
    \`ColumnIdentifier\` LowCardinality(String),
    \`Key\` LowCardinality(String),
    \`count\` UInt64,
    INDEX idx_count_minmax count TYPE minmax GRANULARITY 1,
    INDEX idx_timestamp_minmax Timestamp TYPE minmax GRANULARITY 1
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ColumnIdentifier, Key, Timestamp)
TTL Timestamp + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.e2e_otel_logs_key_rollup_15m_mv TO ${DATABASE}.e2e_otel_logs_key_rollup_15m
(
    \`Timestamp\` DateTime,
    \`ColumnIdentifier\` LowCardinality(String),
    \`Key\` LowCardinality(String),
    \`count\` UInt64
)
AS SELECT
    Timestamp,
    ColumnIdentifier,
    Key,
    sum(count) AS count
FROM ${DATABASE}.e2e_otel_logs_kv_rollup_15m
GROUP BY
    ColumnIdentifier,
    Key,
    Timestamp;
EOFSQL
