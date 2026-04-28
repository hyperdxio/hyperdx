-- +goose Up

-- Map Attributes Key Value Rollup (all map columns in one table)
CREATE TABLE IF NOT EXISTS ${DATABASE}.otel_logs_kv_rollup_15m
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
CREATE TABLE IF NOT EXISTS ${DATABASE}.otel_logs_key_rollup_15m
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

CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.otel_logs_key_rollup_15m_mv TO ${DATABASE}.otel_logs_key_rollup_15m
AS SELECT
    Timestamp,
    ColumnIdentifier,
    Key,
    sum(count) as count
FROM ${DATABASE}.otel_logs_kv_rollup_15m
GROUP BY ColumnIdentifier, Key, Timestamp;

-- Single MV: CTE with UNION ALL across all columns, then aggregate
CREATE MATERIALIZED VIEW IF NOT EXISTS ${DATABASE}.otel_logs_attr_kv_rollup_15m_mv TO ${DATABASE}.otel_logs_kv_rollup_15m
AS WITH elements AS (
    SELECT
        'ResourceAttributes' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        replaceRegexpAll(entry.1, '\\[\\d+\\]', '[*]') AS Key,
        CAST(entry.2 AS String) AS Value
    FROM ${DATABASE}.otel_logs
    ARRAY JOIN ResourceAttributes AS entry
    UNION ALL
    SELECT
        'LogAttributes' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        replaceRegexpAll(entry.1, '\\[\\d+\\]', '[*]') AS Key,
        CAST(entry.2 AS String) AS Value
    FROM ${DATABASE}.otel_logs
    ARRAY JOIN LogAttributes AS entry
    UNION ALL
    SELECT
        'ScopeAttributes' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        replaceRegexpAll(entry.1, '\\[\\d+\\]', '[*]') AS Key,
        CAST(entry.2 AS String) AS Value
    FROM ${DATABASE}.otel_logs
    ARRAY JOIN ScopeAttributes AS entry
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'SeverityText' as Key,
        CAST(SeverityText AS String) as Value
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ServiceName' as Key,
        CAST(ServiceName AS String) as Value
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ScopeName' as Key,
        CAST(ScopeName AS String) as Value
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ScopeVersion' as Key,
        CAST(ScopeVersion AS String) as Value
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ResourceSchemaUrl' as Key,
        CAST(ResourceSchemaUrl AS String) as Value
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        'ScopeSchemaUrl' as Key,
        CAST(ScopeSchemaUrl AS String) as Value
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        '__hdx_materialized_k8s.cluster.name' as Key,
        CAST(`__hdx_materialized_k8s.cluster.name` AS String) as Value
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        '__hdx_materialized_k8s.container.name' as Key,
        CAST(`__hdx_materialized_k8s.container.name` AS String) as Value
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        '__hdx_materialized_k8s.deployment.name' as Key,
        CAST(`__hdx_materialized_k8s.deployment.name` AS String) as Value
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        '__hdx_materialized_k8s.namespace.name' as Key,
        CAST(`__hdx_materialized_k8s.namespace.name` AS String) as Value
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        '__hdx_materialized_k8s.node.name' as Key,
        CAST(`__hdx_materialized_k8s.node.name` AS String) as Value
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        '__hdx_materialized_k8s.pod.name' as Key,
        CAST(`__hdx_materialized_k8s.pod.name` AS String) as Value
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        '__hdx_materialized_k8s.pod.uid' as Key,
        CAST(`__hdx_materialized_k8s.pod.uid` AS String) as Value
    FROM ${DATABASE}.otel_logs
    UNION ALL
    SELECT
        'NativeColumn' AS ColumnIdentifier,
        toStartOfFifteenMinutes(Timestamp) AS Timestamp,
        '__hdx_materialized_deployment.environment.name' as Key,
        CAST(`__hdx_materialized_deployment.environment.name` AS String) as Value
    FROM ${DATABASE}.otel_logs
)
SELECT Timestamp, ColumnIdentifier, Key, Value, count() AS count FROM elements
GROUP BY Timestamp, ColumnIdentifier, Key, Value;
