#!/bin/bash
set -e

# We don't have a JSON schema yet, so let's let the collector create the tables
if [ "$BETA_CH_OTEL_JSON_SCHEMA_ENABLED" = "true" ]; then
  exit 0
fi

DATABASE=${HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE:-default}

clickhouse client -n <<EOFSQL
CREATE DATABASE IF NOT EXISTS ${DATABASE};

CREATE TABLE IF NOT EXISTS ${DATABASE}.otel_logs
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
  \`__hdx_materialized_k8s.cluster.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.cluster.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.container.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.container.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.deployment.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.deployment.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.namespace.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.namespace.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.node.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.node.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.pod.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.pod.name'] CODEC(ZSTD(1)),
  \`__hdx_materialized_k8s.pod.uid\` LowCardinality(String) MATERIALIZED ResourceAttributes['k8s.pod.uid'] CODEC(ZSTD(1)),
  \`__hdx_materialized_deployment.environment.name\` LowCardinality(String) MATERIALIZED ResourceAttributes['deployment.environment.name'] CODEC(ZSTD(1)),
  INDEX idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
  INDEX idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_log_attr_key mapKeys(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_log_attr_value mapValues(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  INDEX idx_lower_body lower(Body) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 8
)
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
PRIMARY KEY (toStartOfMinute(Timestamp), ServiceName, SeverityText, Timestamp)
ORDER BY (ServiceName, TimestampTime, Timestamp)
TTL TimestampTime + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;


CREATE TABLE otel_logs_vals_agg_rollup_1m (
    -- Dimensions
    Timestamp    DateTime,
    ServiceName  LowCardinality(String),
    SeverityText LowCardinality(String),
    -- Aggregate Values
    TraceFlagsCounts               SimpleAggregateFunction(sumMap, Map(UInt8, UInt64)),
    SeverityNumberCounts           SimpleAggregateFunction(sumMap, Map(UInt8, UInt64)),
    ResourceSchemaUrlCounts        SimpleAggregateFunction(sumMap, Map(String, UInt64)),
    ScopeSchemaUrlCounts           SimpleAggregateFunction(sumMap, Map(String, UInt64)),
    ScopeNameCounts                SimpleAggregateFunction(sumMap, Map(String, UInt64)), -- this one is not low cardinality, investigate
    ScopeVersionCounts             SimpleAggregateFunction(sumMap, Map(String, UInt64)),
    -- Aggregate Map Keys
    LogAttributesKeyCounts         SimpleAggregateFunction(sumMap, Map(String, UInt64)),
    ScopeAttributesKeyCounts       SimpleAggregateFunction(sumMap, Map(String, UInt64)),
    ResourceAttributesKeyCounts    SimpleAggregateFunction(sumMap, Map(String, UInt64)),
    -- High cardinality keyvals that we just store a hash for since a known size value will be far more efficient.
    --  They correspond to a Tuple(String, String).
    LogAttributesKeyValCounts      SimpleAggregateFunction(sumMap, Map(UInt64, UInt64)),
    ScopeAttributesKeyValCounts    SimpleAggregateFunction(sumMap, Map(UInt64, UInt64)),
    ResourceAttributesKeyValCounts SimpleAggregateFunction(sumMap, Map(UInt64, UInt64)),
    RowCount                       SimpleAggregateFunction(sum, UInt64)
)
ENGINE AggregatingMergeTree
PARTITION BY toDate(Timestamp)
PRIMARY KEY (Timestamp, ServiceName, SeverityText)
TTL Timestamp + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

SELECT
    toStartOfMinute(Timestamp) AS Timestamp,
    ServiceName,
    SeverityText,
    sumMap(LogAttributes.keys,      arrayMap(x -> 1, LogAttributes.keys)) AS LogAttributesKeyCounts,
    topKArray(100, 3, 'counts')(
        ResourceAttributes.keys
    ) AS ResourceAttributesTopKHashes
FROM otel_logs
GROUP BY Timestamp, ServiceName, SeverityText

CREATE MATERIALIZED VIEW otel_logs_vals_agg_rollup_1m_mv TO otel_logs_vals_agg_rollup_1m
AS SELECT
    toStartOfMinute(Timestamp) AS Timestamp,
    ServiceName,
    SeverityText,
    sumMap([TraceFlags],        [1]) AS TraceFlagsCounts,
    sumMap([SeverityNumber],    [1]) AS SeverityNumberCounts,
    sumMap([ResourceSchemaUrl], [1]) AS ResourceSchemaUrlCounts,
    sumMap([ScopeSchemaUrl],    [1]) AS ScopeSchemaUrlCounts,
    sumMap([ScopeName],         [1]) AS ScopeNameCounts,
    sumMap([ScopeVersion],      [1]) AS ScopeVersionCounts,
    sumMap(LogAttributes.keys,      arrayMap(x -> 1, LogAttributes.keys)) AS LogAttributesKeyCounts,
    sumMap(ScopeAttributes.keys,    arrayMap(x -> 1, ScopeAttributes.keys)) AS ScopeAttributesKeyCounts,
    sumMap(ResourceAttributes.keys, arrayMap(x -> 1, ResourceAttributes.keys)) AS ResourceAttributesKeyCounts,
    sumMap(arrayMap(x -> cityHash64(x), CAST(LogAttributes,      'Array(Tuple(String, String))')), arrayMap(x -> 1, LogAttributes.keys)) AS LogAttributesKeyValCounts,
    sumMap(arrayMap(x -> cityHash64(x), CAST(ScopeAttributes,    'Array(Tuple(String, String))')), arrayMap(x -> 1, ScopeAttributes.keys)) AS ScopeAttributesKeyValCounts,
    sumMap(arrayMap(x -> cityHash64(x), CAST(ResourceAttributes, 'Array(Tuple(String, String))')), arrayMap(x -> 1, ResourceAttributes.keys)) AS ResourceAttributesKeyValCounts,
    count() AS RowCount
FROM otel_logs
GROUP BY Timestamp, ServiceName, SeverityText;

CREATE TABLE otel_attribute_hash_lookup (
    attr_hash UInt64,
    attr_key String,
    attr_value String,
    last_seen DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(last_seen)
ORDER BY attr_hash
TTL last_seen + INTERVAL 90 DAY;  -- Auto-cleanup old mappings

CREATE MATERIALIZED VIEW otel_attribute_hash_lookup_mv TO otel_attribute_hash_lookup AS
SELECT 
    cityHash64(kv) AS attr_hash,
    kv.1 AS attr_key,
    kv.2 AS attr_value
FROM otel_logs
ARRAY JOIN 
    arrayConcat(
        CAST(LogAttributes,      'Array(Tuple(String, String))'),
        CAST(ScopeAttributes,    'Array(Tuple(String, String))'),
        CAST(ResourceAttributes, 'Array(Tuple(String, String))')
    ) AS kv;

CREATE DICTIONARY map_attr_hash_dict (
    attr_hash UInt64,
    attr_key String,
    attr_value String
)
PRIMARY KEY attr_hash
SOURCE(CLICKHOUSE(TABLE 'otel_attribute_hash_lookup'))
LAYOUT(HASHED())
LIFETIME(MIN 60 MAX 120);

-- -- IDEA: We only store the hash of the keyval tuple and we sumMap that. Then we 
-- --  have a separate lookup Dictionary table that just acts as a lookup table for 
-- --  hashes
-- 
-- THIS WAS THE ORIGINAL GUY
-- CREATE MATERIALIZED VIEW otel_logs_agg_map_key_rollup_1m_mv
-- ENGINE = AggregatingMergeTree
-- PARTITION BY toDate(Timestamp)
-- ORDER BY Timestamp, ServiceName, SeverityText
-- AS SELECT
--     toStartOfMinute(Timestamp) AS Timestamp,
--     ServiceName,
--     sumMapState(tuple(ResourceAttributes.keys, arrayMap(x -> toUInt64(1), ResourceAttributes.keys))) AS ResourceAttributesKeyCounts,
--     sumMapState(tuple(LogAttributes.keys     , arrayMap(x -> toUInt64(1), LogAttributes.keys     ))) AS LogAttributesKeyCounts,
--     sumMapState(tuple(ScopeAttributes.keys   , arrayMap(x -> toUInt64(1), ScopeAttributes.keys   ))) AS ScopeAttributesKeyCounts,
-- FROM otel_logs
-- GROUP BY Timestamp,

-- can be queried by
-- SELECT
--     Timestamp,
--     sumMapMerge(TraceFlagsCounts) AS TraceFlagsCounts,
--     sumMapMerge(SeverityTextCounts) AS SeverityTextCounts,
--     sumMapMerge(SeverityNumberCounts) AS SeverityNumberCounts,
--     sumMapMerge(ServiceNameCounts) AS ServiceNameCounts,
--     sumMapMerge(ResourceSchemaUrlCounts) AS ResourceSchemaUrlCounts,
--     sumMapMerge(ScopeSchemaUrlCounts) AS ScopeSchemaUrlCounts,
--     sumMapMerge(ScopeNameCounts) AS ScopeNameCounts,
--     sumMapMerge(ScopeVersionCounts) AS ScopeVersionCounts,
--     sumMapMerge(ResourceAttributesKeyCounts) AS ResourceAttributesKeyCounts,
--     sumMapMerge(LogAttributesKeyCounts) AS LogAttributesKeyCounts,
--     sumMapMerge(ScopeAttributesKeyCounts) AS ScopeAttributesKeyCounts,
--     countMerge(total_count) AS total_count
-- FROM otel_logs_agg_rollup_1m_mv
-- WHERE Timestamp >= now() - INTERVAL 1 HOUR
-- GROUP BY Timestamp
-- ORDER BY Timestamp DESC

-- Methodology:
-- Anything that is LowCardinality could be stored this way. I'm not sure if we'd want to do this for high cardinality data like trace ids.
-- Maybe would even want to do this but grouped by ServiceName? Then you at least have 2 dimensions, Timestamp and ServiceName

-- Advantages:
-- Can determine which values and keys are high frequency
-- Can determine frequency of presence compared to total count
-- Might be able to be used sort of like an index

-- Disadvantages:
-- Unable to determine which filters are present if conditions other than Timestamp are selected
-- Unable to determine which filters are present if conditions other than Timestamp are selected



-- I don't remember what I was doing below this point - I think it was an early iteration that I abandoned
-- SELECT
--     toStartOfMinute(Timestamp) AS Timestamp,
--     groupUniqArray(TraceFlags) AS TraceFlagsValues,
--     (SELECT groupArray((TraceFlags, count)) from (SELECT TraceFlags, count() as count from otel_logs where toStartOfMinute(otel_logs.Timestamp) = outer_otel_logs.Timestamp GROUP BY TraceFlags)) AS TraceFlagCounts,
--     groupUniqArray(SeverityText) AS SeverityTextValues,
--     groupUniqArray(SeverityNumber) AS SeverityNumberValues,
--     groupUniqArray(ServiceName) AS ServiceNameValues,
--     groupUniqArray(ResourceSchemaUrl) AS ResourceSchemaUrlValues,
--     groupUniqArray(ScopeSchemaUrl) AS ScopeSchemaUrlValues,
--     groupUniqArray(ScopeName) AS ScopeNameValues,
--     groupUniqArray(ScopeVersion) AS ScopeVersionValues,
--     (SELECT groupArrayDistinct(lowCardinalityKeys(arrayJoin(ResourceAttributes.keys))) AS keys FROM otel_logs WHERE toStartOfMinute(otel_logs.Timestamp) = Timestamp) AS ResourceAttributesKeys,
--     (SELECT groupArrayDistinct(lowCardinalityKeys(arrayJoin(LogAttributes.keys     ))) AS keys FROM otel_logs WHERE toStartOfMinute(otel_logs.Timestamp) = Timestamp) AS LogAttributesKeys,
--     (SELECT groupArrayDistinct(lowCardinalityKeys(arrayJoin(ScopeAttributes.keys   ))) AS keys FROM otel_logs WHERE toStartOfMinute(otel_logs.Timestamp) = Timestamp) AS ScopeAttributesKeys
-- FROM otel_logs outer_otel_logs
-- GROUP BY Timestamp
-- ORDER BY Timestamp DESC
-- LIMIT 1


CREATE TABLE IF NOT EXISTS ${DATABASE}.otel_traces
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
TTL toDate(Timestamp) + toIntervalDay(30)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

CREATE TABLE ${DATABASE}.hyperdx_sessions
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
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
EOFSQL
