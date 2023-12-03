ALTER TABLE default.metric_stream ADD COLUMN is_delta Boolean CODEC(Delta, ZSTD(1));

ALTER TABLE default.metric_stream ADD COLUMN is_monotonic Boolean CODEC(Delta, ZSTD(1));
