-- +goose Up

-- Key Value Rollup (many columns in one table)
CREATE TABLE IF NOT EXISTS ${DATABASE}.otel_traces_kv_rollup_15m
(
    `Timestamp` DateTime,
    `ColumnIdentifier` LowCardinality(String),
    `Key` LowCardinality(String),
    `Value` String,
    `count` UInt64,
    INDEX idx_count_minmax count TYPE minmax GRANULARITY 1,
    INDEX idx_timestamp_minmax Timestamp TYPE minmax GRANULARITY 1
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ColumnIdentifier, Key, Timestamp, Value)
TTL Timestamp + ${TRACES_TTL}
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- Single MV: CTE with UNION ALL across all columns, then aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.otel_traces_kv_rollup_15m_mv TO ${DATABASE}.otel_traces_kv_rollup_15m
AS WITH elements AS (
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ServiceName' AS Key,
        CAST(ServiceName AS String) AS Value
    FROM ${DATABASE}.otel_traces
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'SpanName' AS Key,
        CAST(SpanName AS String) AS Value
    FROM ${DATABASE}.otel_traces
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'SpanKind' AS Key,
        CAST(SpanKind AS String) AS Value
    FROM ${DATABASE}.otel_traces
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'StatusCode' AS Key,
        CAST(StatusCode AS String) AS Value
    FROM ${DATABASE}.otel_traces
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ScopeName' AS Key,
        CAST(ScopeName AS String) AS Value
    FROM ${DATABASE}.otel_traces
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ScopeVersion' AS Key,
        CAST(ScopeVersion AS String) AS Value
    FROM ${DATABASE}.otel_traces
)
SELECT Timestamp, ColumnIdentifier, Key, Value, count() AS count FROM elements
GROUP BY Timestamp, ColumnIdentifier, Key, Value;
