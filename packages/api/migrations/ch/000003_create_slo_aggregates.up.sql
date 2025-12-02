-- Create SLO aggregates table for efficient pre-computation
-- Improved based on review: Added Partitioning, TTL, and efficient Ordering
CREATE TABLE IF NOT EXISTS default.slo_aggregates (
    slo_id String, -- UUIDs are high cardinality, so String is appropriate. LowCardinality is for <10k unique values.
    timestamp DateTime CODEC(Delta, ZSTD(1)), -- Delta codec is great for time series
    numerator_count UInt64 CODEC(ZSTD(1)),
    denominator_count UInt64 CODEC(ZSTD(1)),
    created_at DateTime DEFAULT now()
) ENGINE = SummingMergeTree((numerator_count, denominator_count))
PARTITION BY toYYYYMM(timestamp)
ORDER BY (slo_id, timestamp)
TTL timestamp + INTERVAL 90 DAY;
