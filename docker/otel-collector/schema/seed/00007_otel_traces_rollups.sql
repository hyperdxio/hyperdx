-- +goose Up

-- Key Value Rollup (all columns in one table)
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
TTL Timestamp + ${TABLES_TTL}
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- Key Only Rollup (derived from KV rollup)
CREATE TABLE IF NOT EXISTS ${DATABASE}.otel_traces_key_rollup_15m
(
    `Timestamp` DateTime,
    `ColumnIdentifier` LowCardinality(String),
    `Key` LowCardinality(String),
    `count` UInt64,
    INDEX idx_count_minmax count TYPE minmax GRANULARITY 1,
    INDEX idx_timestamp_minmax Timestamp TYPE minmax GRANULARITY 1
)
ENGINE = SummingMergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (ColumnIdentifier, Key, Timestamp)
TTL Timestamp + ${TABLES_TTL}
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- Key only rollup MV
CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.otel_traces_key_rollup_15m_mv TO ${DATABASE}.otel_traces_key_rollup_15m
AS SELECT
    Timestamp,
    ColumnIdentifier,
    Key,
    sum(count) AS count
FROM ${DATABASE}.otel_traces_kv_rollup_15m
GROUP BY ColumnIdentifier, Key, Timestamp;

-- Single MV: CTE with UNION ALL across all columns, then aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.otel_traces_kv_rollup_15m_mv TO ${DATABASE}.otel_traces_kv_rollup_15m
AS WITH elements AS (
    SELECT
        'ResourceAttributes' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        replaceRegexpAll(entry.1, '\\[\\d+\\]', '[*]') AS Key,
        entry.2 AS Value
    FROM ${DATABASE}.otel_traces
    ARRAY JOIN ResourceAttributes AS entry
    UNION ALL
    SELECT
        'SpanAttributes' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        replaceRegexpAll(entry.1, '\\[\\d+\\]', '[*]') AS Key,
        entry.2 AS Value
    FROM ${DATABASE}.otel_traces
    ARRAY JOIN SpanAttributes AS entry
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ServiceName' AS Key,
        ServiceName AS Value
    FROM ${DATABASE}.otel_traces
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'SpanName' AS Key,
        SpanName AS Value
    FROM ${DATABASE}.otel_traces
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'SpanKind' AS Key,
        SpanKind AS Value
    FROM ${DATABASE}.otel_traces
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'StatusCode' AS Key,
        StatusCode AS Value
    FROM ${DATABASE}.otel_traces
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ScopeName' AS Key,
        ScopeName AS Value
    FROM ${DATABASE}.otel_traces
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ScopeVersion' AS Key,
        ScopeVersion AS Value
    FROM ${DATABASE}.otel_traces
)
SELECT Timestamp, ColumnIdentifier, Key, Value, count() AS count FROM elements
GROUP BY Timestamp, ColumnIdentifier, Key, Value;
