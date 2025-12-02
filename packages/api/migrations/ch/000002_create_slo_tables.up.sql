-- Create SLO definitions table (metadata stored in ClickHouse for fast lookups)
CREATE TABLE IF NOT EXISTS default.slo_definitions (
    id String,
    service_name String,
    slo_name String,
    metric_type String,  -- 'availability', 'latency', 'error_rate'
    target_value Decimal64(3),  -- 95.0 = 95%
    time_window String,  -- '30d', '90d'
    numerator_query Nullable(String),  -- ClickHouse query for success count
    denominator_query Nullable(String),  -- ClickHouse query for total count
    alert_threshold Nullable(Decimal64(3)),  -- 80 = alert at 80% of error budget
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (id, service_name, slo_name);

-- Create SLO measurements table (time-series data)
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
    status String,  -- 'healthy', 'at_risk', 'breached'
    created_at DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (timestamp, service_name, slo_name)
PARTITION BY toYYYYMM(timestamp)
TTL timestamp + INTERVAL 1 YEAR;

