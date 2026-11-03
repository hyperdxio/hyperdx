-- +goose Up
-- Compatibility schema for ClickHouse < 26.2 (no full text search indexes).
-- The main schema (00005_otel_traces.sql) adds text(tokenizer='array') items
-- indexes that older ClickHouse cannot create; this file preserves the prior
-- bloom_filter-only schema so traces still works on those servers.
CREATE TABLE IF NOT EXISTS ${DATABASE}.otel_traces
(
    `Timestamp` DateTime64(9) CODEC(Delta, ZSTD(3)),
    `TraceId` String CODEC(ZSTD(3)),
    `SpanId` String CODEC(ZSTD(3)),
    `ParentSpanId` String CODEC(ZSTD(3)),
    `TraceState` String CODEC(ZSTD(3)),
    `SpanName` LowCardinality(String) CODEC(ZSTD(3)),
    `SpanKind` LowCardinality(String) CODEC(ZSTD(3)),
    `ServiceName` LowCardinality(String) CODEC(ZSTD(3)),
    `ResourceAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(3)),
    `ScopeName` String CODEC(ZSTD(3)),
    `ScopeVersion` String CODEC(ZSTD(3)),
    `SpanAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(3)),
    `Duration` UInt64 CODEC(ZSTD(3)),
    `StatusCode` LowCardinality(String) CODEC(ZSTD(3)),
    `StatusMessage` String CODEC(ZSTD(3)),
    `Events.Timestamp` Array(DateTime64(9)) CODEC(ZSTD(3)),
    `Events.Name` Array(LowCardinality(String)) CODEC(ZSTD(3)),
    `Events.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(3)),
    `Links.TraceId` Array(String) CODEC(ZSTD(3)),
    `Links.SpanId` Array(String) CODEC(ZSTD(3)),
    `Links.TraceState` Array(String) CODEC(ZSTD(3)),
    `Links.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(3)),
    `__hdx_materialized_rum.sessionId` String MATERIALIZED ResourceAttributes['rum.sessionId'] CODEC(ZSTD(3)),
    `SampleRate` UInt64 MATERIALIZED greatest(toUInt64OrZero(SpanAttributes['SampleRate']), 1) CODEC(T64, ZSTD(3)),
    INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_rum_session_id __hdx_materialized_rum.sessionId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_span_attr_key mapKeys(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_span_attr_value mapValues(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_duration Duration TYPE minmax GRANULARITY 1,
    INDEX idx_lower_span_name lower(SpanName) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 8
)
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ServiceName, SpanName, toDateTime(Timestamp))
TTL toDate(Timestamp) + ${TRACES_TTL}
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;
