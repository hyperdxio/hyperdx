ALTER TABLE ${DATABASE}.otel_logs
    ADD COLUMN IF NOT EXISTS `__hdx_id` UInt16
    MATERIALIZED toUInt16(rand());
