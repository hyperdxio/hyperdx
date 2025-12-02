-- Restore slo_measurements if needed (rollback)
CREATE TABLE IF NOT EXISTS default.slo_measurements (
    timestamp DateTime,
    service_name String,
    slo_name String,
    window_start DateTime,
    window_end DateTime,
    numerator UInt64,
    denominator UInt64,
    achieved_percentage Decimal64(3),
    error_budget_remaining Decimal64(3),
    status String,
    created_at DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (timestamp, service_name, slo_name)
PARTITION BY toYYYYMM(timestamp)
TTL timestamp + INTERVAL 1 YEAR;

