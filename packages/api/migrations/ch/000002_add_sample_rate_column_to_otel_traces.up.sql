ALTER TABLE ${DATABASE}.otel_traces
    ADD COLUMN IF NOT EXISTS `SampleRate` UInt64
    MATERIALIZED greatest(toUInt64OrZero(SpanAttributes['SampleRate']), 1)
    CODEC(T64, ZSTD(1));
